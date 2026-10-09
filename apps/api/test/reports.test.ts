/**
 * KV-24 (#26) rapor gönderme senaryoları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı):
 * kullanıcı + hedef başına tek satır unique index'le, "tam olarak bir hedef" ve sonuçlandırma kuralları
 * CHECK'lerle korunur; bellek içinde taklit edilmez.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("raporlar (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `rapor-${randomUUID().slice(0, 8)}`, name: "Rapor" } })).id;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "POST", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `rapor_${id}@example.test`, username: `rapor_${id}`, displayName: "Raporlayan", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function createPoll(cookie: string) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: "Bu araba bu fiyata alınır mı?", categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Alınır" }, { label: "Alınmaz" }] },
      cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  const report = (cookie: string | undefined, type: string, id: string, reason = "SPAM", note?: string) =>
    send("POST", "/reports", { target: { type, id }, reason, ...(note !== undefined ? { note } : {}) }, cookie);

  async function reportId(res: { statusCode: number; body: string; json(): any }) {
    assert.equal(res.statusCode, 202, res.body);
    return res.json().data.reportId as string;
  }

  // ─── Senaryolar ─────────────────────────────────────────────

  test("anket raporu 202 döner, kuyruğa OPEN düşer ve içeriğe dokunmaz", async () => {
    const author = await signUp();
    const reporter = await signUp();
    const pollId = await createPoll(author.cookie);
    const id = await reportId(await report(reporter.cookie, "POLL", pollId, "MISLEADING", "Fiyat yanlış yazılmış"));

    const row = await db.report.findUniqueOrThrow({ where: { id } });
    assert.deepEqual(
      [row.reporterId, row.pollId, row.commentId, row.mediaId, row.reportedUserId, row.reason, row.details, row.status],
      [reporter.id, pollId, null, null, null, "MISLEADING", "Fiyat yanlış yazılmış", "OPEN"],
    );
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "ACTIVE");
  });

  test("aynı hedefe tekrar ve eşzamanlı raporlar tek satır üretir; başka kullanıcı ayrı rapor açar", async () => {
    const pollId = await createPoll((await signUp()).cookie);
    const reporter = await signUp();
    const results = await Promise.all(Array.from({ length: 8 }, () => report(reporter.cookie, "POLL", pollId)));
    const ids = new Set(await Promise.all(results.map(reportId)));
    assert.equal(ids.size, 1);
    assert.equal(await db.report.count({ where: { pollId, reporterId: reporter.id } }), 1);

    await reportId(await report((await signUp()).cookie, "POLL", pollId));
    assert.equal(await db.report.count({ where: { pollId } }), 2);
  });

  test("açık rapor tekrarında neden değişmez; kapanmış rapor aynı kimlikle yeniden açılır", async () => {
    const pollId = await createPoll((await signUp()).cookie);
    const reporter = await signUp();
    const moderator = await signUp();
    const id = await reportId(await report(reporter.cookie, "POLL", pollId, "SPAM"));
    assert.equal(await reportId(await report(reporter.cookie, "POLL", pollId, "HATE")), id);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id } })).reason, "SPAM");

    await db.report.update({
      where: { id },
      data: { status: "DISMISSED", resolvedById: moderator.id, resolvedAt: new Date(), resolutionNote: "işlem gerekmedi" },
    });
    assert.equal(await reportId(await report(reporter.cookie, "POLL", pollId, "HARASSMENT", "tekrar başladı")), id);
    const row = await db.report.findUniqueOrThrow({ where: { id } });
    assert.deepEqual(
      [row.status, row.reason, row.details, row.resolvedById, row.resolvedAt, row.resolutionNote],
      ["OPEN", "HARASSMENT", "tekrar başladı", null, null, null],
    );
  });

  test("yorum, yayınlanmış görsel ve kullanıcı raporlanabilir", async () => {
    const author = await signUp();
    const reporter = await signUp();
    const pollId = await createPoll(author.cookie);
    const comment = await db.comment.create({ data: { pollId, authorId: author.id, body: "hakaret içeren yorum" } });
    const media = await h.addMedia(author.id, { purpose: "POLL", status: "APPROVED" });

    const c = await db.report.findUniqueOrThrow({ where: { id: await reportId(await report(reporter.cookie, "COMMENT", comment.id, "HARASSMENT")) } });
    assert.equal(c.commentId, comment.id);
    const m = await db.report.findUniqueOrThrow({ where: { id: await reportId(await report(reporter.cookie, "MEDIA", media.id, "INAPPROPRIATE")) } });
    assert.equal(m.mediaId, media.id);
    const u = await db.report.findUniqueOrThrow({ where: { id: await reportId(await report(reporter.cookie, "USER", author.id, "HARASSMENT")) } });
    assert.equal(u.reportedUserId, author.id);
  });

  test("görünmeyen hedef 404: olmayan, kaldırılmış anket, yayınlanmamış görsel, silinmiş hesap", async () => {
    const author = await signUp();
    const reporter = await signUp();
    assertError(await report(reporter.cookie, "POLL", randomUUID()), 404, "NOT_FOUND");

    const removed = await createPoll(author.cookie);
    await db.poll.update({ where: { id: removed }, data: { status: "REMOVED", deletedAt: new Date() } });
    assertError(await report(reporter.cookie, "POLL", removed), 404, "NOT_FOUND");

    const pending = await h.addMedia(author.id, { purpose: "POLL", status: "PENDING" });
    assertError(await report(reporter.cookie, "MEDIA", pending.id), 404, "NOT_FOUND");

    const gone = await signUp();
    await db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    assertError(await report(reporter.cookie, "USER", gone.id), 404, "NOT_FOUND");
    assert.equal(await db.report.count({ where: { reporterId: reporter.id } }), 0);
  });

  test("kendini raporlama 400, girişsiz 401, sözleşme dışı gövde 400", async () => {
    const user = await signUp();
    const self = await report(user.cookie, "USER", user.id);
    assertError(self, 400, "VALIDATION_ERROR");
    assert.equal(self.json().error.details[0].code, "self_report");

    assertError(await report(undefined, "USER", user.id), 401, "UNAUTHENTICATED");
    const pollId = await createPoll(user.cookie);
    assertError(await report(user.cookie, "POLL", pollId, "BILINMEYEN"), 400, "VALIDATION_ERROR");
    assertError(await report(user.cookie, "DECISION", pollId), 400, "VALIDATION_ERROR");
    assertError(await report(user.cookie, "POLL", pollId, "SPAM", "x".repeat(1001)), 400, "VALIDATION_ERROR");
  });
});
