/**
 * KV-37 (#39) anket ve yorum moderasyonu: admin.moderation.polls / admin.moderation.comments.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Durum geçişleri, sayaçlar, görünürlük,
 * topluluk kapsamı ve rapor kapanışı DB'den doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { counterDelta, statusTransition } from "../src/modules/moderation/store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

test("durum geçişleri: DATA_MODEL §7.1 tablosu", () => {
  assert.equal(statusTransition("ACTIVE", "HIDE"), "HIDDEN");
  assert.equal(statusTransition("ACTIVE", "LOCK"), "LOCKED");
  assert.equal(statusTransition("LOCKED", "UNLOCK"), "ACTIVE");
  for (const from of ["HIDDEN", "UNDER_REVIEW", "LOCKED", "REMOVED"] as const) assert.equal(statusTransition(from, "RESTORE"), "ACTIVE");
  for (const from of ["ACTIVE", "UNDER_REVIEW", "HIDDEN", "LOCKED"] as const) assert.equal(statusTransition(from, "REMOVE"), "REMOVED");
  // Aynı duruma işlem idempotenttir.
  assert.equal(statusTransition("HIDDEN", "HIDE"), "same");
  assert.equal(statusTransition("REMOVED", "REMOVE"), "same");
  assert.equal(statusTransition("ACTIVE", "RESTORE"), "same");
  assert.equal(statusTransition("ACTIVE", "UNLOCK"), "same");
  // Diyagramda olmayan geçişler.
  assert.equal(statusTransition("HIDDEN", "LOCK"), "invalid");
  assert.equal(statusTransition("LOCKED", "HIDE"), "invalid");
  assert.equal(statusTransition("REMOVED", "HIDE"), "invalid");
  assert.equal(statusTransition("HIDDEN", "UNLOCK"), "invalid");
});

test("sayaç yalnız ACTIVE kümesine girip çıkarken oynar", () => {
  assert.equal(counterDelta("ACTIVE", "HIDDEN"), -1);
  assert.equal(counterDelta("ACTIVE", "REMOVED"), -1);
  assert.equal(counterDelta("HIDDEN", "ACTIVE"), 1);
  assert.equal(counterDelta("REMOVED", "ACTIVE"), 1);
  assert.equal(counterDelta("HIDDEN", "REMOVED"), 0);
  assert.equal(counterDelta("UNDER_REVIEW", "HIDDEN"), 0);
});

type User = { cookie: string; id: string };

describe("içerik moderasyonu (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `icerik-mod-${randomUUID().slice(0, 8)}`, name: "İçerik Moderasyonu" } })).id;
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
    });
  }
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `icm_${id}@example.test`, username: `icm_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function staff(role: "ADMIN" | "MODERATOR", communityId?: string): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    if (communityId) {
      await db.$transaction([
        db.communityMembership.create({ data: { communityId, userId: user.id, role: "MODERATOR" } }),
        db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
      ]);
    }
    return user;
  }

  async function community() {
    return db.community.create({ data: { slug: `icm-${randomUUID().slice(0, 8)}`, name: "Moderasyon Topluluğu", createdById: superAdmin.id } });
  }

  async function poll(author: User, communityId?: string) {
    if (communityId) {
      await db.$transaction([
        db.communityMembership.upsert({ where: { communityId_userId: { communityId, userId: author.id } }, create: { communityId, userId: author.id }, update: {} }),
        db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
      ]);
    }
    const res = await send(
      "POST",
      "/polls",
      {
        kind: "POLL",
        title: `Bu karar doğru mu? ${randomUUID().slice(0, 8)}`,
        categoryId,
        ...(communityId ? { communityId } : {}),
        durationHours: 24,
        resultsVisibility: "ALWAYS",
        options: [{ label: "Evet" }, { label: "Hayır" }],
      },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  async function comment(pollId: string, cookie: string, body: Record<string, unknown> = {}) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: "Bence kararın arkasındayım.", ...body }, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  const moderatePoll = (cookie: string | undefined, id: string, action: string, reason = "Moderatör incelemesi") =>
    send("POST", `/admin/polls/${id}/moderation`, { action, reason }, cookie);
  const moderateComment = (cookie: string | undefined, id: string, action: string, reason = "Moderatör incelemesi") =>
    send("POST", `/admin/comments/${id}/moderation`, { action, reason }, cookie);
  const pollRow = (id: string) => db.poll.findUniqueOrThrow({ where: { id } });
  const commentRow = (id: string) => db.comment.findUniqueOrThrow({ where: { id } });

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401, normal kullanıcı 403, başka topluluğun moderatörü ve topluluksuz içerikte moderatör 403", async () => {
    const a = await community();
    const b = await community();
    const author = await signUp();
    const user = await signUp();
    const modA = await staff("MODERATOR", a.id);
    const inA = await poll(author, a.id);
    const free = await poll(author);
    const commentInA = await comment(inA, author.cookie);

    assertError(await moderatePoll(undefined, inA, "HIDE"), 401, "UNAUTHENTICATED");
    assertError(await moderatePoll(user.cookie, inA, "HIDE"), 403, "FORBIDDEN");
    assertError(await moderateComment(user.cookie, commentInA, "HIDE"), 403, "FORBIDDEN");
    assertError(await moderatePoll((await staff("MODERATOR", b.id)).cookie, inA, "HIDE"), 403, "FORBIDDEN");
    assertError(await moderatePoll(modA.cookie, free, "HIDE"), 403, "FORBIDDEN");
    assert.equal((await pollRow(inA)).status, "ACTIVE");
    assert.equal(await db.moderationAction.count({ where: { pollId: { in: [inA, free] } } }), 0);

    assert.equal((await moderatePoll(modA.cookie, inA, "HIDE")).statusCode, 200);
    assert.equal((await moderateComment(modA.cookie, commentInA, "HIDE")).statusCode, 200);
    assert.equal((await moderatePoll(admin.cookie, free, "HIDE")).statusCode, 200);
    assertError(await moderatePoll(admin.cookie, randomUUID(), "HIDE"), 404, "NOT_FOUND");
    assertError(await moderateComment(admin.cookie, randomUUID(), "HIDE"), 404, "NOT_FOUND");
  });

  // ─── Anket ──────────────────────────────────────────────────

  test("gizleme: anket herkesten kaybolur, geri yükleyince döner; geçmiş önce/sonra durumuyla yazılır", async () => {
    const author = await signUp();
    const id = await poll(author);
    assert.equal((await get(`/polls/${id}`)).statusCode, 200);

    const hide = await moderatePoll(admin.cookie, id, "HIDE", "Kural ihlali şüphesi");
    assert.equal(hide.statusCode, 200, hide.body);
    assert.deepEqual(hide.json().data, { id, status: "HIDDEN", trendExcluded: false });
    assertError(await get(`/polls/${id}`), 404, "NOT_FOUND");
    assertError(await get(`/polls/${id}`, author.cookie), 404, "NOT_FOUND");

    const restore = await moderatePoll(admin.cookie, id, "RESTORE", "İnceleme sonrası uygun bulundu");
    assert.equal(restore.json().data.status, "ACTIVE");
    assert.equal((await get(`/polls/${id}`)).statusCode, 200);

    const history = await db.moderationAction.findMany({ where: { pollId: id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(
      history.map((a) => [a.action, a.actorId, a.fromStatus, a.toStatus, a.reason]),
      [
        ["HIDE", admin.id, "ACTIVE", "HIDDEN", "Kural ihlali şüphesi"],
        ["RESTORE", admin.id, "HIDDEN", "ACTIVE", "İnceleme sonrası uygun bulundu"],
      ],
    );
  });

  test("geçersiz geçiş 409; aynı işlem tekrarı idempotent ve geçmişe ikinci satır yazmaz", async () => {
    const id = await poll(await signUp());
    assert.equal((await moderatePoll(admin.cookie, id, "LOCK")).json().data.status, "LOCKED");
    const again = await moderatePoll(admin.cookie, id, "LOCK");
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.status, "LOCKED");
    assert.equal(await db.moderationAction.count({ where: { pollId: id } }), 1);

    const invalid = await moderatePoll(admin.cookie, id, "HIDE");
    assertError(invalid, 409, "CONFLICT");
    assert.equal(invalid.json().error.details[0].code, "invalid_transition");
    assert.equal((await pollRow(id)).status, "LOCKED");

    assertError(await moderatePoll(admin.cookie, id, "SILINSIN"), 400, "VALIDATION_ERROR");
    assertError(await send("POST", `/admin/polls/${id}/moderation`, { action: "HIDE", reason: "x" }, admin.cookie), 400, "VALIDATION_ERROR");
  });

  test("kilitleme: anket görünür kalır ama yeni yorum alınmaz; kilit açılınca yorum yazılır", async () => {
    const author = await signUp();
    const id = await poll(author);
    assert.equal((await moderatePoll(admin.cookie, id, "LOCK")).statusCode, 200);

    assert.equal((await get(`/polls/${id}`)).statusCode, 200);
    assertError(await send("POST", `/polls/${id}/comments`, { body: "Kilitliyken yorum" }, author.cookie), 409, "CONTENT_LOCKED");

    assert.equal((await moderatePoll(admin.cookie, id, "UNLOCK")).json().data.status, "ACTIVE");
    await comment(id, author.cookie);
  });

  test("kaldırma: soft delete, yalnız ADMIN+ geri yükler; moderatör kaldırılmış içeriği geri yükleyemez", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const id = await poll(await signUp(), c.id);

    const removed = await moderatePoll(mod.cookie, id, "REMOVE", "Kural ihlali");
    assert.equal(removed.json().data.status, "REMOVED");
    const row = await pollRow(id);
    assert.equal(row.status, "REMOVED");
    assert.ok(row.deletedAt, "REMOVED ⇔ deleted_at dolu");
    assertError(await get(`/polls/${id}`), 404, "NOT_FOUND");

    assertError(await moderatePoll(mod.cookie, id, "RESTORE"), 403, "FORBIDDEN");
    assertError(await moderatePoll(admin.cookie, id, "HIDE"), 409, "CONFLICT");
    assert.equal((await pollRow(id)).status, "REMOVED");

    assert.equal((await moderatePoll(admin.cookie, id, "RESTORE", "Yanlışlıkla kaldırılmış")).json().data.status, "ACTIVE");
    const restored = await pollRow(id);
    assert.deepEqual([restored.status, restored.deletedAt], ["ACTIVE", null]);
    assert.equal((await get(`/polls/${id}`)).statusCode, 200);
  });

  test("yayını kısıtlayan işlem açık raporları ACTIONED yapar; geri yükleme yapmaz", async () => {
    const id = await poll(await signUp());
    const reporter = await signUp();
    const filed = await send("POST", "/reports", { target: { type: "POLL", id }, reason: "SPAM" }, reporter.cookie);
    assert.equal(filed.statusCode, 202, filed.body);

    await moderatePoll(admin.cookie, id, "HIDE", "Spam doğrulandı");
    const closed = await db.report.findUniqueOrThrow({ where: { id: filed.json().data.reportId } });
    assert.deepEqual([closed.status, closed.resolvedById, closed.resolutionNote], ["ACTIONED", admin.id, "Spam doğrulandı"]);

    await moderatePoll(admin.cookie, id, "RESTORE");
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: closed.id } })).status, "ACTIONED");
  });

  test("trendden çıkarma: bayrak değişir, durum değişmez; tekrar idempotent; kaldırılmış ankette 409", async () => {
    const id = await poll(await signUp());
    const out = await moderatePoll(admin.cookie, id, "EXCLUDE_FROM_TRENDS", "Manipülatif etkileşim");
    assert.deepEqual(out.json().data, { id, status: "ACTIVE", trendExcluded: true });
    assert.ok((await pollRow(id)).trendExcludedAt);
    assert.equal((await moderatePoll(admin.cookie, id, "EXCLUDE_FROM_TRENDS")).json().data.trendExcluded, true);
    assert.equal(await db.moderationAction.count({ where: { pollId: id } }), 1);

    assert.deepEqual((await moderatePoll(admin.cookie, id, "INCLUDE_IN_TRENDS")).json().data, { id, status: "ACTIVE", trendExcluded: false });
    assert.equal((await pollRow(id)).trendExcludedAt, null);

    await moderatePoll(admin.cookie, id, "REMOVE");
    assertError(await moderatePoll(admin.cookie, id, "EXCLUDE_FROM_TRENDS"), 409, "CONFLICT");
  });

  // ─── Yorum ──────────────────────────────────────────────────

  test("yorum gizleme ve geri yükleme anket ve üst yorum sayaçlarını tutarlı tutar", async () => {
    const author = await signUp();
    const id = await poll(author);
    const parent = await comment(id, author.cookie);
    const reply = await comment(id, author.cookie, { parentId: parent, body: "Cevap" });
    const counters = async () => ({ poll: (await pollRow(id)).commentCount, replies: (await commentRow(parent)).replyCount });
    assert.deepEqual(await counters(), { poll: 2, replies: 1 });

    const hide = await moderateComment(admin.cookie, reply, "HIDE");
    assert.deepEqual(hide.json().data, { id: reply, status: "HIDDEN", trendExcluded: null });
    assert.deepEqual(await counters(), { poll: 1, replies: 0 });
    const listed = await get(`/polls/${id}/comments`);
    assert.equal(JSON.stringify(listed.json()).includes(reply), false, "gizli yorum listelenmez");

    // Gizliden kaldırmaya geçiş sayacı ikinci kez düşürmez.
    assert.equal((await moderateComment(admin.cookie, reply, "REMOVE")).json().data.status, "REMOVED");
    assert.deepEqual(await counters(), { poll: 1, replies: 0 });
    assert.ok((await commentRow(reply)).deletedAt);

    assert.equal((await moderateComment(admin.cookie, reply, "RESTORE")).json().data.status, "ACTIVE");
    assert.deepEqual(await counters(), { poll: 2, replies: 1 });
    assert.equal((await commentRow(reply)).deletedAt, null);
  });

  test("yorumda kilit ve trend işlemi desteklenmez: LOCK 409, EXCLUDE_FROM_TRENDS 400", async () => {
    const author = await signUp();
    const id = await poll(author);
    const commentId = await comment(id, author.cookie);

    const locked = await moderateComment(admin.cookie, commentId, "LOCK");
    assertError(locked, 409, "CONFLICT");
    assert.equal(locked.json().error.details[0].code, "unsupported_action");
    assertError(await moderateComment(admin.cookie, commentId, "EXCLUDE_FROM_TRENDS"), 400, "VALIDATION_ERROR");
    assert.equal((await commentRow(commentId)).status, "ACTIVE");
    assert.equal((await pollRow(id)).commentCount, 1);
  });

  test("topluluk moderatörü yorumu kaldırır (sayaç bir kez düşer, tekrar idempotent); kaldırılmışı yalnız ADMIN+ geri yükler", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const author = await signUp();
    const id = await poll(author, c.id);
    const commentId = await comment(id, author.cookie);
    assert.equal((await send("PUT", `/comments/${commentId}/reaction`, { value: "LIKE" }, (await signUp()).cookie)).statusCode, 200);

    assert.equal((await moderateComment(mod.cookie, commentId, "REMOVE", "Hakaret içeriyor")).statusCode, 200);
    assert.equal((await pollRow(id)).commentCount, 0);
    // Aynı işlem tekrarı sayaçı bir daha düşürmez.
    assert.equal((await moderateComment(mod.cookie, commentId, "REMOVE")).statusCode, 200);
    assert.equal((await pollRow(id)).commentCount, 0);
    assert.equal(await db.moderationAction.count({ where: { commentId } }), 1);
    assertError(await moderateComment(mod.cookie, commentId, "RESTORE"), 403, "FORBIDDEN");
  });

  test("eşzamanlı iki yorum kaldırma sayacı bir kez düşürür", async () => {
    const author = await signUp();
    const id = await poll(author);
    const commentId = await comment(id, author.cookie);
    const other = await staff("ADMIN");
    const results = await Promise.all([moderateComment(admin.cookie, commentId, "REMOVE"), moderateComment(other.cookie, commentId, "REMOVE")]);
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200]);
    assert.equal((await pollRow(id)).commentCount, 0);
    assert.equal(await db.moderationAction.count({ where: { commentId } }), 1);
  });
});
