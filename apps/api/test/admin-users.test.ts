/**
 * KV-33 (#35) yönetici kullanıcı işlemleri: admin.users.list/get/sanctions/reports/activity, admin.sanctions.create/lift.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Her değiştiren işlem aynı transaction'da users.status'u
 * yeniden hesaplar, SUSPEND/BAN'da oturumları iptal eder ve audit kaydı yazar (KV-39); burada hepsi DB'den doğrulanır.
 * audit_logs append-only ve test DB'si dosyalar arasında sıfırlanmaz: sorgular her testin yeni kullanıcısına göre yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AdminUserActivity, AdminUserDetail, AdminUserReport, AdminUserSummary, ErrorBody, headers, PollDetail, Sanction } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

const HOUR = 60 * 60 * 1000;

describe("admin kullanıcı ve yaptırım (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `kv33-${randomUUID().slice(0, 8)}`, name: "KV-33" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string, key?: string) {
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
    }) as unknown as Promise<Res>;
  }
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(name = "Kullanıcı"): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `au_${id}@example.test`, username: `au_${id}`, displayName: name, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username, email: account.email };
  }

  async function staff(role: "ADMIN" | "MODERATOR"): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    return user;
  }

  const later = (ms: number) => new Date(h.clock.now.getTime() + ms).toISOString();
  const apply = (userId: string, body: Record<string, unknown>, cookie = admin.cookie, key?: string) =>
    send("POST", `/admin/users/${userId}/sanctions`, { reason: "Tekrarlayan spam", ...body }, cookie, key);
  const lift = (userId: string, sanctionId: string, cookie = admin.cookie) =>
    send("POST", `/admin/users/${userId}/sanctions/${sanctionId}/lift`, { reason: "İtiraz kabul edildi" }, cookie);

  function created(res: Res) {
    assert.equal(res.statusCode, 201, res.body);
    return Sanction.parse(res.json().data);
  }
  const status = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } })).status;
  const audits = (userId: string) =>
    db.auditLog.findMany({
      where: { targetType: "USER", targetId: userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { actorId: true, source: true, action: true, operation: true, reason: true, before: true, after: true, requestId: true },
    });

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve moderatör 403; ADMIN admin hedefe 403, SUPER_ADMIN'e izin; kendine 403", async () => {
    const user = await signUp();
    const moderator = await staff("MODERATOR");
    const otherAdmin = await staff("ADMIN");

    assertError(await get("/admin/users"), 401, "UNAUTHENTICATED");
    assertError(await get("/admin/users", user.cookie), 403, "FORBIDDEN");
    assertError(await get("/admin/users", moderator.cookie), 403, "FORBIDDEN");
    assertError(await apply(user.id, { type: "WARNING" }, moderator.cookie), 403, "FORBIDDEN");

    assertError(await apply(otherAdmin.id, { type: "WARNING" }), 403, "FORBIDDEN");
    assertError(await apply(admin.id, { type: "WARNING" }), 403, "FORBIDDEN");
    created(await apply(otherAdmin.id, { type: "WARNING" }, superAdmin.cookie));
    assertError(await apply(randomUUID(), { type: "WARNING" }), 404, "NOT_FOUND");
    // Reddedilen işlemler audit yazmaz; SUPER_ADMIN'in uyarısı tek kayıt.
    assert.equal((await audits(otherAdmin.id)).length, 1);
    assert.deepEqual(await audits(user.id), []);
  });

  // ─── Arama ve detay ─────────────────────────────────────────

  test("arama: q en az 3 karakter; kullanıcı adı/görünen ad içerir, '@' ile e-posta tam eşleşme; durum filtresi ve cursor", async () => {
    const tag = randomUUID().replaceAll("-", "").slice(0, 8);
    const a = await signUp(`Arama ${tag}`);
    const b = await signUp(`Arama ${tag}`);
    assertError(await get("/admin/users?q=ab", admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await get("/admin/users?q=%20ab%20", admin.cookie), 400, "VALIDATION_ERROR");

    const first = await get(`/admin/users?q=${tag}&limit=1`, admin.cookie);
    assert.equal(first.statusCode, 200, first.body);
    const one = first.json();
    assert.deepEqual(one.data.map((u: { id: string }) => u.id), [b.id], "en yeni önce (id azalan)");
    AdminUserSummary.parse(one.data[0]);
    assert.deepEqual(one.data[0].roles, ["USER"]);
    const second = await get(`/admin/users?q=${tag}&limit=1&cursor=${one.page.nextCursor}`, admin.cookie);
    assert.deepEqual(second.json().data.map((u: { id: string }) => u.id), [a.id]);
    assert.equal(second.json().page.hasMore, false);
    assertError(await get(`/admin/users?q=${tag}x&cursor=${one.page.nextCursor}`, admin.cookie), 400, "INVALID_CURSOR");

    const byEmail = await get(`/admin/users?q=${encodeURIComponent(a.email.toUpperCase())}`, admin.cookie);
    assert.deepEqual(byEmail.json().data.map((u: { id: string }) => u.id), [a.id]);
    // E-postada içerir araması yok (PII taraması olmasın).
    assert.deepEqual((await get(`/admin/users?q=${encodeURIComponent("@example.test")}`, admin.cookie)).json().data, []);

    created(await apply(a.id, { type: "RESTRICT_COMMENTS" }));
    const restricted = await get(`/admin/users?q=${tag}&status=RESTRICTED`, admin.cookie);
    assert.deepEqual(restricted.json().data.map((u: { id: string }) => u.id), [a.id]);
  });

  test("detay: istatistik, aktif yaptırımlar, rol ve rapor sayısı; olmayan kullanıcı 404", async () => {
    const author = await signUp();
    const poll = await createPoll(author);
    const voter = await signUp();
    await vote(poll.id, poll.options[0]!.id, voter);
    await send("POST", "/reports", { target: { type: "POLL", id: poll.id }, reason: "SPAM" }, voter.cookie);
    await send("POST", "/reports", { target: { type: "USER", id: author.id }, reason: "HARASSMENT" }, voter.cookie);
    const warning = created(await apply(author.id, { type: "WARNING" }));

    const res = await get(`/admin/users/${author.id}`, admin.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const detail = AdminUserDetail.parse(res.json().data);
    assert.deepEqual(detail.stats, { pollCount: 1, commentCount: 0, voteCount: 0 });
    assert.equal(detail.reportCount, 2);
    assert.deepEqual(detail.activeSanctions.map((s) => s.id), [warning.id]);
    assert.equal(AdminUserDetail.parse((await get(`/admin/users/${voter.id}`, admin.cookie)).json().data).stats.voteCount, 1);
    assertError(await get(`/admin/users/${randomUUID()}`, admin.cookie), 404, "NOT_FOUND");
  });

  // ─── Yaptırım uygula ────────────────────────────────────────

  test("SUSPEND: durum SUSPENDED, oturumlar aynı transaction'da iptal, audit kaydı request id ile", async () => {
    const user = await signUp();
    const res = await apply(user.id, { type: "SUSPEND", endsAt: later(24 * HOUR) });
    const s = created(res);
    assert.deepEqual([s.type, s.liftedAt, s.liftedBy, s.createdBy.id], ["SUSPEND", null, null, admin.id]);
    assert.equal(await status(user.id), "SUSPENDED");
    assert.equal(await h.activeSessions(user.id), 0);
    // İptal edilen oturum misafir sayılır.
    assertError(await get("/me", user.cookie), 401, "UNAUTHENTICATED");

    assert.deepEqual(await audits(user.id), [
      {
        actorId: admin.id,
        source: "API",
        action: "user.sanction",
        operation: "apply",
        reason: "Tekrarlayan spam",
        before: { status: "ACTIVE", activeTypes: [] },
        after: { status: "SUSPENDED", sanctionId: s.id, type: "SUSPEND", endsAt: s.endsAt, sessionsRevoked: 1 },
        requestId: res.headers[headers.requestId.toLowerCase()],
      },
    ]);
  });

  test("doğrulama: WARNING'de endsAt yasak, SUSPEND'de zorunlu, BAN'da yasak, geçmiş endsAt reddedilir", async () => {
    const user = await signUp();
    assertError(await apply(user.id, { type: "WARNING", endsAt: later(HOUR) }), 400, "VALIDATION_ERROR");
    assertError(await apply(user.id, { type: "SUSPEND" }), 400, "VALIDATION_ERROR");
    assertError(await apply(user.id, { type: "BAN", endsAt: later(HOUR) }), 400, "VALIDATION_ERROR");
    assertError(await apply(user.id, { type: "SUSPEND", endsAt: later(-HOUR) }), 400, "VALIDATION_ERROR");
    assertError(await apply(user.id, { type: "WARNING", reason: "  a " }), 400, "VALIDATION_ERROR");
    assert.deepEqual(await audits(user.id), []);
  });

  test("RESTRICT oturuma dokunmaz; aynı tipte aktif yaptırım 409 already_active; WARNING tekrarlanabilir", async () => {
    const user = await signUp();
    created(await apply(user.id, { type: "RESTRICT_POSTING", endsAt: later(24 * HOUR) }));
    assert.equal(await status(user.id), "RESTRICTED");
    assert.equal(await h.activeSessions(user.id), 1);
    assertError(await apply(user.id, { type: "RESTRICT_POSTING", endsAt: later(48 * HOUR) }), 409, "CONFLICT", "already_active");
    created(await apply(user.id, { type: "WARNING" }));
    created(await apply(user.id, { type: "WARNING", reason: "İkinci uyarı" }));
    assert.equal(await status(user.id), "RESTRICTED", "WARNING durumu değiştirmez");
    assert.deepEqual((await audits(user.id)).map((a) => a.operation), ["apply", "apply", "apply"]);
  });

  test("durum kalan aktif yaptırımlardan yeniden hesaplanır: SUSPEND+BAN → BAN kaldır → SUSPENDED → SUSPEND kaldır → RESTRICTED → ACTIVE", async () => {
    const user = await signUp();
    const restrict = created(await apply(user.id, { type: "RESTRICT_COMMENTS", endsAt: later(72 * HOUR) }));
    assert.equal(await status(user.id), "RESTRICTED");
    const suspend = created(await apply(user.id, { type: "SUSPEND", endsAt: later(24 * HOUR) }));
    assert.equal(await status(user.id), "SUSPENDED");
    // Farklı tipe geçiş serbest: SUSPEND aktifken BAN.
    const ban = created(await apply(user.id, { type: "BAN", endsAt: null }));
    assert.equal(await status(user.id), "BANNED");

    const lifted = await lift(user.id, ban.id);
    assert.equal(lifted.statusCode, 200, lifted.body);
    const liftedBan = Sanction.parse(lifted.json().data);
    assert.deepEqual([liftedBan.liftedBy?.id, liftedBan.liftReason], [admin.id, "İtiraz kabul edildi"]);
    assert.equal(await status(user.id), "SUSPENDED", "BAN kalkınca kalan SUSPEND geçerli");
    assert.equal((await lift(user.id, suspend.id)).statusCode, 200);
    assert.equal(await status(user.id), "RESTRICTED");
    assert.equal((await lift(user.id, restrict.id)).statusCode, 200);
    assert.equal(await status(user.id), "ACTIVE");

    const trail = await audits(user.id);
    assert.deepEqual(
      trail.map((a) => [a.operation, (a.before as { status: string }).status, (a.after as { status: string }).status]),
      [
        ["apply", "ACTIVE", "RESTRICTED"],
        ["apply", "RESTRICTED", "SUSPENDED"],
        ["apply", "SUSPENDED", "BANNED"],
        ["lift", "BANNED", "SUSPENDED"],
        ["lift", "SUSPENDED", "RESTRICTED"],
        ["lift", "RESTRICTED", "ACTIVE"],
      ],
    );
    // Yaptırım kalkınca iptal edilmiş oturumlar geri gelmez; kullanıcı yeniden giriş yapar.
    assertError(await get("/me", user.cookie), 401, "UNAUTHENTICATED");
  });

  // ─── Kaldırma kuralları ─────────────────────────────────────

  test("kaldırma: zaten kaldırılmış 409 already_lifted, süresi dolmuş 409 expired; ikisi de audit yazmaz; başka kullanıcının yaptırımı 404", async () => {
    const user = await signUp();
    const other = await signUp();
    const warning = created(await apply(user.id, { type: "WARNING" }));
    assert.equal((await lift(user.id, warning.id)).statusCode, 200);
    assertError(await lift(user.id, warning.id), 409, "CONFLICT", "already_lifted");
    assertError(await lift(other.id, warning.id), 404, "NOT_FOUND");

    const suspend = created(await apply(user.id, { type: "SUSPEND", endsAt: later(HOUR) }));
    h.clock.advance(2 * HOUR);
    assertError(await lift(user.id, suspend.id), 409, "CONFLICT", "expired");
    assert.deepEqual((await audits(user.id)).map((a) => a.operation), ["apply", "lift", "apply"]);
    const row = await db.sanction.findUniqueOrThrow({ where: { id: suspend.id }, select: { liftedAt: true } });
    assert.equal(row.liftedAt, null);
  });

  test("silinmiş hesap: yeni yaptırım 409 user_deleted, mevcut yaptırımı kaldırmak serbest", async () => {
    const user = await signUp();
    const restrict = created(await apply(user.id, { type: "RESTRICT_POSTING", endsAt: later(24 * HOUR) }));
    await db.user.update({ where: { id: user.id }, data: { deletedAt: h.clock.now } });
    assertError(await apply(user.id, { type: "WARNING" }), 409, "CONFLICT", "user_deleted");
    assert.equal((await lift(user.id, restrict.id)).statusCode, 200);
    assert.equal(await status(user.id), "ACTIVE");
  });

  test("Idempotency-Key: aynı istek aynı yaptırımı döner, tek satır ve tek audit; farklı gövde 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const user = await signUp();
    const key = `kv33-${randomUUID()}`;
    const first = created(await apply(user.id, { type: "WARNING" }, admin.cookie, key));
    const again = created(await apply(user.id, { type: "WARNING" }, admin.cookie, key));
    assert.equal(again.id, first.id);
    assertError(await apply(user.id, { type: "WARNING", reason: "Başka gerekçe" }, admin.cookie, key), 409, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await db.sanction.count({ where: { userId: user.id } }), 1);
    assert.equal((await audits(user.id)).length, 1);
  });

  // ─── Oylar ──────────────────────────────────────────────────

  test("ban oyları silmez ve geçersiz saymaz; kaldırılınca da değişmez", async () => {
    const author = await signUp();
    const voter = await signUp();
    const poll = await createPoll(author);
    const voteId = await vote(poll.id, poll.options[1]!.id, voter);
    /** Oy satırı, sayaçlar, oy geçmişi ve public sonuç: ban ve kaldırma bunların hiçbirini değiştirmemeli. */
    async function snapshot() {
      const results = PollDetail.parse((await get(`/polls/${poll.id}`)).json().data).results;
      return {
        vote: await db.vote.findUniqueOrThrow({ where: { id: voteId }, select: { optionId: true, invalidatedAt: true } }),
        counts: await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { voteCount: true, options: { select: { voteCount: true }, orderBy: { position: "asc" } } } }),
        events: await db.voteEvent.findMany({ where: { pollId: poll.id }, select: { type: true }, orderBy: { occurredAt: "asc" } }),
        results: results?.visible ? results.options.map((o) => o.votes) : null,
      };
    }
    const before = await snapshot();
    assert.equal(before.vote.invalidatedAt, null);
    assert.deepEqual(before.events.map((e) => e.type), ["CAST"]);
    assert.deepEqual(before.results, [0, 1]);

    const ban = created(await apply(voter.id, { type: "BAN", endsAt: null }));
    assert.equal(await status(voter.id), "BANNED");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await lift(voter.id, ban.id)).statusCode, 200);
    assert.deepEqual(await snapshot(), before);
  });

  // ─── Geçmiş ─────────────────────────────────────────────────

  test("geçmiş: yaptırımlar (kaldırılanlar dahil), raporlar (hakkında/yaptığı) ve aktivite; sayfalı, olmayan kullanıcı 404", async () => {
    const user = await signUp();
    const reporter = await signUp();
    const poll = await createPoll(user);
    const othersPoll = await createPoll(reporter);
    const comment = await send("POST", `/polls/${poll.id}/comments`, { kind: "COMMENT", body: "Bence ikinci seçenek daha mantıklı." }, user.cookie);
    assert.equal(comment.statusCode, 201, comment.body);
    await send("POST", "/reports", { target: { type: "COMMENT", id: comment.json().data.id }, reason: "SPAM" }, reporter.cookie);
    await send("POST", "/reports", { target: { type: "USER", id: user.id }, reason: "HARASSMENT" }, reporter.cookie);
    // Kullanıcının yaptığı rapor (başkasının anketi): "hakkında" listesine girmez.
    await send("POST", "/reports", { target: { type: "POLL", id: othersPoll.id }, reason: "MISLEADING" }, user.cookie);

    const w = created(await apply(user.id, { type: "WARNING" }));
    h.clock.advance(1000);
    await lift(user.id, w.id);
    h.clock.advance(1000);
    const r = created(await apply(user.id, { type: "RESTRICT_COMMENTS", endsAt: later(HOUR) }));

    const s1 = await get(`/admin/users/${user.id}/sanctions?limit=1`, admin.cookie);
    assert.equal(s1.statusCode, 200, s1.body);
    assert.deepEqual(s1.json().data.map((s: unknown) => Sanction.parse(s).id), [r.id]);
    const s2 = await get(`/admin/users/${user.id}/sanctions?limit=1&cursor=${s1.json().page.nextCursor}`, admin.cookie);
    const liftedRow = Sanction.parse(s2.json().data[0]);
    assert.deepEqual([liftedRow.id, liftedRow.liftedBy?.id], [w.id, admin.id]);

    const against = (await get(`/admin/users/${user.id}/reports`, admin.cookie)).json().data.map((x: unknown) => AdminUserReport.parse(x));
    assert.deepEqual(against.map((x: { target: { type: string } }) => x.target.type).sort(), ["COMMENT", "USER"]);
    const filed = (await get(`/admin/users/${user.id}/reports?side=filed`, admin.cookie)).json().data.map((x: unknown) => AdminUserReport.parse(x));
    assert.deepEqual(filed.map((x: { target: { id: string } }) => x.target.id), [othersPoll.id]);

    const activity = (await get(`/admin/users/${user.id}/activity`, admin.cookie)).json().data.map((x: unknown) => AdminUserActivity.parse(x));
    assert.deepEqual(activity.map((x: { kind: string }) => x.kind).sort(), ["COMMENT", "POLL"]);
    assert.equal(activity.find((x: { kind: string }) => x.kind === "COMMENT").excerpt, "Bence ikinci seçenek daha mantıklı.");

    for (const sub of ["sanctions", "reports", "activity"]) assertError(await get(`/admin/users/${randomUUID()}/${sub}`, admin.cookie), 404, "NOT_FOUND");
  });

  // ─── Anket yardımcıları ─────────────────────────────────────

  async function createPoll(author: User) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Yönetim testi ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 48, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  async function vote(pollId: string, optionId: string, user: User) {
    const res = await send("PUT", `/polls/${pollId}/vote`, { optionId }, user.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return (await db.vote.findUniqueOrThrow({ where: { pollId_userId: { pollId, userId: user.id } }, select: { id: true } })).id;
  }
});
