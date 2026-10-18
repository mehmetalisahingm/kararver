/**
 * #183 toplu moderasyon (KV-37 §bulk): scoped HIDE/REMOVE/RESTORE, önizleme (salt okuma) + digest ile onay, kayıt başına bağımsız
 * işlem ve kısmi başarısızlık, kapsam yalıtımı, idempotency, yarışlar, parti geçmişi ve saatlik sınır.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { BulkPreview, BulkResult, ErrorBody, ModerationBatchView } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { BATCH_HOURLY_LIMIT } from "../src/modules/moderation/bulk-routes.ts";
import { batchDigest, type BulkItemState } from "../src/modules/moderation/bulk.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "Toplu moderasyon incelemesi";

test("özet: kimlik sırasından bağımsız, durum/topluluk/işlem/tür değişince farklı", () => {
  const states = new Map<string, BulkItemState>([
    ["a", { id: "a", label: "x", status: "ACTIVE" as const, communityId: null }],
    ["b", { id: "b", label: "y", status: "HIDDEN" as const, communityId: "c1" }],
  ]);
  const base = batchDigest("polls", "HIDE", ["a", "b"], states);
  assert.equal(base, batchDigest("polls", "HIDE", ["b", "a"], states));
  assert.equal(base.length, 64);
  assert.notEqual(base, batchDigest("comments", "HIDE", ["a", "b"], states));
  assert.notEqual(base, batchDigest("polls", "REMOVE", ["a", "b"], states));
  assert.notEqual(base, batchDigest("polls", "HIDE", ["a", "b", "z"], states), "olmayan kimlik de özette");
  const moved = new Map(states).set("b", { id: "b", label: "y", status: "HIDDEN" as const, communityId: "c2" });
  assert.notEqual(base, batchDigest("polls", "HIDE", ["a", "b"], moved));
  const changed = new Map(states).set("a", { id: "a", label: "x", status: "HIDDEN" as const, communityId: null });
  assert.notEqual(base, batchDigest("polls", "HIDE", ["a", "b"], changed));
});

describe("toplu moderasyon (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `bulk-mod-${randomUUID().slice(0, 8)}`, name: "Toplu moderasyon" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(key ? { "idempotency-key": key } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }
  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `bm_${id}@example.test`, username: `bm_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string };
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
  const community = () => db.community.create({ data: { slug: `bm-${randomUUID().slice(0, 8)}`, name: "Toplu moderasyon topluluğu", createdById: superAdmin.id } });
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
      { kind: "POLL", title: `Toplu moderasyon sorusu ${randomUUID().slice(0, 8)}`, categoryId, ...(communityId ? { communityId } : {}), durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  async function comment(pollId: string, cookie: string) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: `Toplu moderasyon yorumu ${randomUUID().slice(0, 6)}` }, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  const preview = (kind: "polls" | "comments", cookie: string | undefined, ids: string[], action = "HIDE") =>
    send("GET", `/admin/moderation/${kind}/bulk/preview?ids=${ids.join(",")}&action=${action}`, undefined, cookie);
  const apply = (kind: "polls" | "comments", cookie: string | undefined, ids: string[], action: string, digest: string, reason: unknown = REASON) =>
    send("POST", `/admin/moderation/${kind}/bulk`, { ids, action, reason, digest }, cookie);
  /** Önizleme + onay: dönen onay yanıtı. */
  async function run(kind: "polls" | "comments", cookie: string, ids: string[], action: string) {
    const pv = await preview(kind, cookie, ids, action);
    assert.equal(pv.statusCode, 200, pv.body);
    return apply(kind, cookie, ids, action, pv.json().data.digest);
  }
  const pollRow = (id: string) => db.poll.findUniqueOrThrow({ where: { id } });
  const commentRow = (id: string) => db.comment.findUniqueOrThrow({ where: { id } });
  const actionsOf = (targetId: string) => db.moderationAction.count({ where: { OR: [{ pollId: targetId }, { commentId: targetId }] } });
  const batches = () => db.moderationBatch.count();

  // ─── Yetki ve doğrulama ─────────────────────────────────────

  test("yetki: misafir 401, normal kullanıcı 403 (önizleme, onay ve geçmiş)", async () => {
    const author = await signUp();
    const id = await poll(author);
    const user = await signUp();
    for (const kind of ["polls", "comments"] as const) {
      assertError(await preview(kind, undefined, [id]), 401, "UNAUTHENTICATED");
      assertError(await preview(kind, user.cookie, [id]), 403, "FORBIDDEN");
      assertError(await apply(kind, undefined, [id], "HIDE", "a".repeat(64)), 401, "UNAUTHENTICATED");
      assertError(await apply(kind, user.cookie, [id], "HIDE", "a".repeat(64)), 403, "FORBIDDEN");
    }
    assertError(await send("GET", "/admin/moderation/batches"), 401, "UNAUTHENTICATED");
    assertError(await send("GET", "/admin/moderation/batches", undefined, user.cookie), 403, "FORBIDDEN");
    assert.equal((await pollRow(id)).status, "ACTIVE");
  });

  test("gövde doğrulaması: boş/51+/yinelenen kimlik, desteklenmeyen işlem, eksik digest, kısa gerekçe 400; hiçbiri iz bırakmaz", async () => {
    const author = await signUp();
    const id = await poll(author);
    const before = await batches();
    const ids51 = Array.from({ length: 51 }, () => randomUUID());
    assertError(await preview("polls", admin.cookie, []), 400, "VALIDATION_ERROR");
    assertError(await preview("polls", admin.cookie, ids51), 400, "VALIDATION_ERROR");
    assertError(await preview("polls", admin.cookie, [id, id]), 400, "VALIDATION_ERROR");
    assertError(await preview("polls", admin.cookie, [id], "LOCK"), 400, "VALIDATION_ERROR");
    assertError(await send("POST", "/admin/moderation/polls/bulk", { ids: [id], action: "HIDE", reason: REASON }, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await apply("polls", admin.cookie, [id], "HIDE", "a".repeat(64), "ab"), 400, "VALIDATION_ERROR");
    assertError(await apply("polls", admin.cookie, [id], "HIDE", "kisa"), 400, "VALIDATION_ERROR");
    assert.equal(await batches(), before);
    assert.equal((await pollRow(id)).status, "ACTIVE");
  });

  // ─── Önizleme ───────────────────────────────────────────────

  test("önizleme salt okunur ve kayıt başına sonuç verir; bulunamayan kayıt BLOCKED not_found, hiçbiri yoksa 404", async () => {
    const author = await signUp();
    const active = await poll(author);
    const hidden = await poll(author);
    assert.equal((await run("polls", admin.cookie, [hidden], "HIDE")).statusCode, 200);
    const ghost = randomUUID();
    const actionsBefore = await db.moderationAction.count();
    const batchesBefore = await batches();

    const res = await preview("polls", admin.cookie, [active, hidden, ghost], "HIDE");
    const data = BulkPreview.parse(res.json().data);
    const byId = new Map(data.items.map((i) => [i.id, i]));
    assert.equal(byId.get(active)!.outcome, "WILL_CHANGE");
    assert.equal(byId.get(hidden)!.outcome, "NO_CHANGE");
    assert.deepEqual([byId.get(ghost)!.outcome, byId.get(ghost)!.blocked, byId.get(ghost)!.label], ["BLOCKED", "not_found", null]);
    assert.deepEqual(data.summary, { willChange: 1, noChange: 1, blocked: 1 });
    assert.equal(data.maxItems, 50);
    assert.match(byId.get(active)!.label ?? "", /Toplu moderasyon sorusu/);
    assert.equal(await db.moderationAction.count(), actionsBefore, "önizleme yazmaz");
    assert.equal(await batches(), batchesBefore);
    assert.equal((await pollRow(active)).status, "ACTIVE");

    assertError(await preview("polls", admin.cookie, [ghost]), 404, "NOT_FOUND");
    assertError(await apply("polls", admin.cookie, [ghost], "HIDE", "a".repeat(64)), 404, "NOT_FOUND");
  });

  test("önizleme geçiş tablosunu uygular: REMOVED içeriğe HIDE geçersiz, REMOVED'i yalnız ADMIN+ geri yükler", async () => {
    const c = await community();
    const modA = await staff("MODERATOR", c.id);
    const author = await signUp();
    const inA = await poll(author, c.id);
    assert.equal((await run("polls", admin.cookie, [inA], "REMOVE")).statusCode, 200);

    const hide = BulkPreview.parse((await preview("polls", admin.cookie, [inA], "HIDE")).json().data);
    assert.deepEqual([hide.items[0]!.outcome, hide.items[0]!.blocked], ["BLOCKED", "invalid_transition"]);
    const modRestore = BulkPreview.parse((await preview("polls", modA.cookie, [inA], "RESTORE")).json().data);
    assert.deepEqual([modRestore.items[0]!.outcome, modRestore.items[0]!.blocked], ["BLOCKED", "admin_required"]);
    const adminRestore = BulkPreview.parse((await preview("polls", admin.cookie, [inA], "RESTORE")).json().data);
    assert.equal(adminRestore.items[0]!.outcome, "WILL_CHANGE");
  });

  // ─── Kapsam yalıtımı ────────────────────────────────────────

  test("kapsam: moderatör yalnız atandığı topluluğun kayıtlarını değiştirir; başka topluluk ve topluluksuz kayıt forbidden, dokunulmaz, etiketi görünmez", async () => {
    const a = await community();
    const b = await community();
    const modA = await staff("MODERATOR", a.id);
    const author = await signUp();
    const inA1 = await poll(author, a.id);
    const inA2 = await poll(author, a.id);
    const inB = await poll(author, b.id);
    const free = await poll(author);
    const ids = [inA1, inA2, inB, free];

    const pv = BulkPreview.parse((await preview("polls", modA.cookie, ids)).json().data);
    const byId = new Map(pv.items.map((i) => [i.id, i]));
    assert.equal(byId.get(inA1)!.outcome, "WILL_CHANGE");
    for (const id of [inB, free]) {
      assert.deepEqual([byId.get(id)!.outcome, byId.get(id)!.blocked, byId.get(id)!.label], ["BLOCKED", "forbidden", null], "başka kapsamın içeriği sızmaz");
    }

    const res = await apply("polls", modA.cookie, ids, "HIDE", pv.digest);
    assert.equal(res.statusCode, 200, res.body);
    const result = BulkResult.parse(res.json().data);
    assert.deepEqual(result.summary, { total: 4, applied: 2, unchanged: 0, failed: 2 });
    assert.equal((await pollRow(inA1)).status, "HIDDEN");
    assert.equal((await pollRow(inA2)).status, "HIDDEN");
    assert.equal((await pollRow(inB)).status, "ACTIVE");
    assert.equal((await pollRow(free)).status, "ACTIVE");
    assert.equal(await actionsOf(inB), 0);
    assert.equal(await actionsOf(free), 0);
    const failed = result.items.filter((i) => i.result === "FAILED");
    assert.deepEqual(failed.map((i) => i.code).sort(), ["forbidden", "forbidden"]);
  });

  test("ADMIN bütün toplulukları ve topluluksuz kayıtları tek partide değiştirir", async () => {
    const a = await community();
    const b = await community();
    const author = await signUp();
    const ids = [await poll(author, a.id), await poll(author, b.id), await poll(author)];
    const res = await run("polls", admin.cookie, ids, "HIDE");
    assert.deepEqual(BulkResult.parse(res.json().data).summary, { total: 3, applied: 3, unchanged: 0, failed: 0 });
    for (const id of ids) assert.equal((await pollRow(id)).status, "HIDDEN");
  });

  // ─── Uygulama: iz, sayaç, kısmi başarısızlık ────────────────

  test("uygulama kayıt başına gerçek karar yazar: moderation_actions, audit (gerekçe+requestId), olay; parti ve öğeler bağlanır", async () => {
    const author = await signUp();
    const ids = [await poll(author), await poll(author)];
    const res = await run("polls", admin.cookie, ids, "HIDE");
    const result = BulkResult.parse(res.json().data);
    assert.equal(result.summary.applied, 2);
    const batch = await db.moderationBatch.findUniqueOrThrow({ where: { id: result.batchId }, include: { items: true } });
    assert.deepEqual([batch.total, batch.applied, batch.unchanged, batch.failed], [2, 2, 0, 0]);
    assert.notEqual(batch.finishedAt, null);
    assert.equal(batch.reason, REASON);
    assert.equal(batch.actorId, admin.id);
    for (const id of ids) {
      const actions = await db.moderationAction.findMany({ where: { pollId: id } });
      assert.equal(actions.length, 1);
      assert.equal(actions[0]!.action, "HIDE");
      assert.equal(actions[0]!.reason, REASON);
      assert.equal(actions[0]!.fromStatus, "ACTIVE");
      assert.equal(actions[0]!.toStatus, "HIDDEN");
      const item = batch.items.find((i) => i.targetId === id)!;
      assert.equal(item.result, "APPLIED");
      assert.equal(item.moderationActionId, actions[0]!.id);
      assert.deepEqual([item.fromStatus, item.toStatus], ["ACTIVE", "HIDDEN"]);
      const audit = await db.auditLog.findMany({ where: { action: "moderation.poll.apply", targetId: id } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.reason, REASON);
      assert.equal(audit[0]!.requestId, batch.requestId, "bütün kayıtlar aynı istek kimliğiyle bağlı");
      assert.equal(audit[0]!.actorId, admin.id);
    }
    assert.equal(await db.domainEvent.count({ where: { type: "moderation.applied", subjectId: { in: ids } } }), 2);
  });

  test("yorumlarda sayaçlar tekil yolla aynı: HIDE comment_count'u düşürür, RESTORE geri getirir", async () => {
    const author = await signUp();
    const pollId = await poll(author);
    const c1 = await comment(pollId, author.cookie);
    const c2 = await comment(pollId, author.cookie);
    assert.equal((await pollRow(pollId)).commentCount, 2);
    assert.equal(BulkResult.parse((await run("comments", admin.cookie, [c1, c2], "HIDE")).json().data).summary.applied, 2);
    assert.equal((await pollRow(pollId)).commentCount, 0);
    assert.equal((await commentRow(c1)).status, "HIDDEN");
    assert.equal(BulkResult.parse((await run("comments", admin.cookie, [c1, c2], "RESTORE")).json().data).summary.applied, 2);
    assert.equal((await pollRow(pollId)).commentCount, 2);
  });

  test("kısmi başarısızlık: geçersiz geçiş/olmayan kayıt FAILED, geçerli kayıtlar uygulanır; sayılar tutarlı", async () => {
    const author = await signUp();
    const fine = await poll(author);
    const removed = await poll(author);
    assert.equal((await run("polls", admin.cookie, [removed], "REMOVE")).statusCode, 200);
    const ghost = randomUUID();
    const ids = [fine, removed, ghost];
    const res = await run("polls", admin.cookie, ids, "HIDE");
    assert.equal(res.statusCode, 200, res.body);
    const result = BulkResult.parse(res.json().data);
    assert.deepEqual(result.summary, { total: 3, applied: 1, unchanged: 0, failed: 2 });
    const code = (id: string) => result.items.find((i) => i.id === id)!.code;
    assert.equal(code(removed), "invalid_transition");
    assert.equal(code(ghost), "not_found");
    assert.equal((await pollRow(fine)).status, "HIDDEN");
    assert.equal((await pollRow(removed)).status, "REMOVED");
    const batch = await db.moderationBatch.findUniqueOrThrow({ where: { id: result.batchId }, include: { items: true } });
    assert.equal(batch.items.length, 3);
    assert.equal(batch.applied + batch.unchanged + batch.failed, batch.total);
    assert.equal(batch.items.find((i) => i.targetId === ghost)!.detail, "not_found");
  });

  // ─── Önizleme-onay bağı, idempotency, yarışlar ──────────────

  test("önizlemeden sonra durum veya topluluk değişirse 409 preview_stale ve hiçbir şey yazılmaz; yanlış digest de aynı", async () => {
    const c = await community();
    const other = await community();
    const author = await signUp();
    const a = await poll(author, c.id);
    const b = await poll(author, c.id);
    const pv = await preview("polls", admin.cookie, [a, b]);
    const digest = pv.json().data.digest as string;
    const before = await batches();

    await db.poll.update({ where: { id: b }, data: { status: "HIDDEN" } });
    assertError(await apply("polls", admin.cookie, [a, b], "HIDE", digest), 409, "CONFLICT", "preview_stale");
    await db.poll.update({ where: { id: b }, data: { status: "ACTIVE" } });
    await db.poll.update({ where: { id: a }, data: { communityId: other.id } });
    assertError(await apply("polls", admin.cookie, [a, b], "HIDE", digest), 409, "CONFLICT", "preview_stale");
    await db.poll.update({ where: { id: a }, data: { communityId: c.id } });
    assertError(await apply("polls", admin.cookie, [a, b], "HIDE", "f".repeat(64)), 409, "CONFLICT", "preview_stale");
    assert.equal(await batches(), before);
    assert.equal(await actionsOf(a) + (await actionsOf(b)), 0);
    // Durum eski haline dönünce aynı digest yine geçerli ve işlem uygulanır.
    assert.equal((await apply("polls", admin.cookie, [a, b], "HIDE", digest)).statusCode, 200);
  });

  test("idempotent: aynı toplu işlem tekrarında kayıtlar UNCHANGED, yeni karar kaydı yok; eski digest ise preview_stale", async () => {
    const author = await signUp();
    const ids = [await poll(author), await poll(author)];
    const pv = await preview("polls", admin.cookie, ids);
    const digest = pv.json().data.digest as string;
    assert.equal(BulkResult.parse((await apply("polls", admin.cookie, ids, "HIDE", digest)).json().data).summary.applied, 2);
    assertError(await apply("polls", admin.cookie, ids, "HIDE", digest), 409, "CONFLICT", "preview_stale");
    const second = BulkResult.parse((await run("polls", admin.cookie, ids, "HIDE")).json().data);
    assert.deepEqual(second.summary, { total: 2, applied: 0, unchanged: 2, failed: 0 });
    for (const id of ids) assert.equal(await actionsOf(id), 1);
  });

  test("yarış: aynı partinin iki eşzamanlı onayı — her kayıt tam bir kez uygulanır (ikinci onay stale veya unchanged)", async () => {
    const author = await signUp();
    const ids = [await poll(author), await poll(author), await poll(author)];
    // Taze yönetici: dosyadaki önceki testlerin onaysız hacmi bu aktörün ikinci onay penceresine sayılmasın (KV-37 §8).
    const racer = await staff("ADMIN");
    const pv = await preview("polls", racer.cookie, ids);
    const digest = pv.json().data.digest as string;
    const [x, y] = await Promise.all([apply("polls", racer.cookie, ids, "HIDE", digest), apply("polls", superAdmin.cookie, ids, "HIDE", digest)]);
    assert.ok([200, 409].includes(x.statusCode) && [200, 409].includes(y.statusCode), x.body + y.body);
    for (const id of ids) {
      assert.equal(await actionsOf(id), 1, "tek karar kaydı");
      assert.equal((await pollRow(id)).status, "HIDDEN");
    }
    const applied = [x, y].filter((r) => r.statusCode === 200).map((r) => BulkResult.parse(r.json().data).summary.applied);
    assert.equal(applied.reduce((a, b) => a + b, 0), 3, "toplam uygulanan = kayıt sayısı");
  });

  test("yarış: toplu işlem ile aynı kaydın tekil moderasyonu aynı anda — tek karar, çift sayım yok", async () => {
    const author = await signUp();
    const pollId = await poll(author);
    const c1 = await comment(pollId, author.cookie);
    const pv = await preview("comments", admin.cookie, [c1]);
    const [bulk, single] = await Promise.all([
      apply("comments", admin.cookie, [c1], "HIDE", pv.json().data.digest),
      send("POST", `/admin/comments/${c1}/moderation`, { action: "HIDE", reason: "Tekil moderasyon" }, superAdmin.cookie),
    ]);
    assert.ok([200, 409].includes(bulk.statusCode) && single.statusCode === 200, bulk.body + single.body);
    assert.equal(await actionsOf(c1), 1);
    assert.equal((await commentRow(c1)).status, "HIDDEN");
    assert.equal((await pollRow(pollId)).commentCount, 0, "sayaç bir kez düşer");
  });

  // ─── Sınır ve geçmiş ────────────────────────────────────────

  test("saatlik parti sınırı: aktör başına 20; aşılınca 429 RATE_LIMITED ve hiçbir şey yazılmaz; başka aktör etkilenmez", async () => {
    const limited = await staff("ADMIN");
    const author = await signUp();
    const id = await poll(author);
    for (let i = 0; i < BATCH_HOURLY_LIMIT; i++) {
      const res = await run("polls", limited.cookie, [id], "HIDE");
      assert.equal(res.statusCode, 200, `${i}: ${res.body}`);
    }
    const pv = await preview("polls", limited.cookie, [id], "HIDE");
    assert.equal(pv.statusCode, 200, "önizleme sınırsız");
    const before = await batches();
    const over = await apply("polls", limited.cookie, [id], "HIDE", pv.json().data.digest);
    assertError(over, 429, "RATE_LIMITED");
    assert.equal(await batches(), before);
    assert.equal((await run("polls", admin.cookie, [id], "HIDE")).statusCode, 200);
  });

  test("parti geçmişi: moderatör yalnız kendi partilerini, ADMIN hepsini görür; sayfalama; kayıtlar sözleşmeye uyar", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const author = await signUp();
    const mine = await poll(author, c.id);
    const adminsOwn = await poll(author);
    const m1 = BulkResult.parse((await run("polls", mod.cookie, [mine], "HIDE")).json().data).batchId;
    const a1 = BulkResult.parse((await run("polls", admin.cookie, [adminsOwn], "HIDE")).json().data).batchId;

    const modList = await send("GET", "/admin/moderation/batches?limit=50", undefined, mod.cookie);
    assert.equal(modList.statusCode, 200, modList.body);
    const modIds = (modList.json().data as Array<{ id: string }>).map((b) => b.id);
    assert.ok(modIds.includes(m1));
    assert.ok(!modIds.includes(a1), "moderatör başkasının partisini görmez");
    for (const b of modList.json().data) ModerationBatchView.parse(b);

    const adminList = await send("GET", "/admin/moderation/batches?limit=50", undefined, admin.cookie);
    const adminIds = (adminList.json().data as Array<{ id: string }>).map((b) => b.id);
    assert.ok(adminIds.includes(m1) && adminIds.includes(a1));

    const page1 = await send("GET", "/admin/moderation/batches?limit=1", undefined, admin.cookie);
    assert.equal(page1.json().data.length, 1);
    assert.equal(page1.json().page.hasMore, true);
    const page2 = await send("GET", `/admin/moderation/batches?limit=1&cursor=${encodeURIComponent(page1.json().page.nextCursor)}`, undefined, admin.cookie);
    assert.notEqual(page2.json().data[0].id, page1.json().data[0].id);
  });
});
