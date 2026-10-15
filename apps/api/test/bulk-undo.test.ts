/**
 * #183 toplu işlemin güvenli geri alınması (KV-37 §bulk): telafi çiftleri, sürüm koşulu (durum + son karar), silinmiş içerik sahibinin
 * içeriğinin asla geri gelmemesi, kapsam/yetki, öğe başına tek geri alma, geri almanın geri alınamaması, yarışlar ve append-only
 * kayıtların değişmemesi. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { BulkResult, ErrorBody, ModerationBatchView, UndoPreview, UndoResult } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { inverseOf, undoDigest } from "../src/modules/moderation/bulk.ts";
import { createPrismaModerationStore } from "../src/modules/moderation/prisma-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "Toplu moderasyon incelemesi";
const UNDO_REASON = "Yanlış pozitif: kararlar geri alınıyor";

test("telafi çiftleri yalnız kararın önceki durumuna tam dönüşü sağlayanlardır", () => {
  assert.equal(inverseOf("HIDE", "ACTIVE"), "RESTORE");
  assert.equal(inverseOf("REMOVE", "ACTIVE"), "RESTORE");
  assert.equal(inverseOf("RESTORE", "HIDDEN"), "HIDE");
  assert.equal(inverseOf("RESTORE", "REMOVED"), "REMOVE");
  // Tek kararla aynı duruma döndürülemeyenler geri alınmaz.
  for (const [action, from] of [["REMOVE", "HIDDEN"], ["REMOVE", "LOCKED"], ["HIDE", "LOCKED"], ["RESTORE", "LOCKED"], ["RESTORE", "UNDER_REVIEW"], ["RESTORE", null], ["HIDE", null]] as const) {
    assert.equal(inverseOf(action, from), null, `${action} önce ${from}`);
  }
});

test("geri alma özeti: parti, durum, topluluk, son karar ve geri alındı bilgisine duyarlı; sıra önemsiz", () => {
  const rows = [
    { id: "a", status: "HIDDEN", communityId: null, latestActionId: "x1", undone: false },
    { id: "b", status: "HIDDEN", communityId: "c", latestActionId: "x2", undone: false },
  ];
  const base = undoDigest("p1", rows);
  assert.equal(base, undoDigest("p1", [...rows].reverse()));
  assert.equal(base.length, 64);
  assert.notEqual(base, undoDigest("p2", rows));
  assert.notEqual(base, undoDigest("p1", [{ ...rows[0]!, status: "ACTIVE" }, rows[1]!]));
  assert.notEqual(base, undoDigest("p1", [{ ...rows[0]!, latestActionId: "yeni" }, rows[1]!]));
  assert.notEqual(base, undoDigest("p1", [{ ...rows[0]!, undone: true }, rows[1]!]));
  assert.notEqual(base, undoDigest("p1", [rows[0]!, { ...rows[1]!, communityId: "d" }]));
});

describe("toplu işlem geri alma (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `bulk-undo-${randomUUID().slice(0, 8)}`, name: "Toplu geri alma" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  // Saatlik parti sınırı aktör başınadır: her test taze bir yönetici kullanır.
  beforeEach(async () => {
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
    const account = { email: `bu_${id}@example.test`, username: `bu_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
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
  const community = () => db.community.create({ data: { slug: `bu-${randomUUID().slice(0, 8)}`, name: "Geri alma topluluğu", createdById: superAdmin.id } });
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
      { kind: "POLL", title: `Geri alma sorusu ${randomUUID().slice(0, 8)}`, categoryId, ...(communityId ? { communityId } : {}), durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  async function comment(pollId: string, cookie: string) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: `Geri alma yorumu ${randomUUID().slice(0, 6)}` }, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  const previewBulk = (kind: "polls" | "comments", cookie: string, ids: string[], action: string) =>
    send("GET", `/admin/moderation/${kind}/bulk/preview?ids=${ids.join(",")}&action=${action}`, undefined, cookie);
  /** Toplu işlem (önizleme + onay): yeni partinin kimliği. */
  async function bulk(kind: "polls" | "comments", cookie: string, ids: string[], action: string) {
    const pv = await previewBulk(kind, cookie, ids, action);
    assert.equal(pv.statusCode, 200, pv.body);
    const res = await send("POST", `/admin/moderation/${kind}/bulk`, { ids, action, reason: REASON, digest: pv.json().data.digest }, cookie);
    assert.equal(res.statusCode, 200, res.body);
    return BulkResult.parse(res.json().data).batchId;
  }
  const undoPreview = (cookie: string | undefined, batchId: string) => send("GET", `/admin/moderation/batches/${batchId}/undo/preview`, undefined, cookie);
  const undo = (cookie: string | undefined, batchId: string, digest: string, reason: unknown = UNDO_REASON) => send("POST", `/admin/moderation/batches/${batchId}/undo`, { reason, digest }, cookie);
  async function doUndo(cookie: string, batchId: string) {
    const pv = await undoPreview(cookie, batchId);
    assert.equal(pv.statusCode, 200, pv.body);
    return undo(cookie, batchId, pv.json().data.digest);
  }
  const single = (cookie: string, kind: "polls" | "comments", id: string, action: string) =>
    send("POST", `/admin/${kind}/${id}/moderation`, { action, reason: "Tekil moderasyon" }, cookie);
  const pollRow = (id: string) => db.poll.findUniqueOrThrow({ where: { id } });
  const commentRow = (id: string) => db.comment.findUniqueOrThrow({ where: { id } });
  const actionsOf = (id: string) => db.moderationAction.findMany({ where: { OR: [{ pollId: id }, { commentId: id }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

  // ─── Yetki ve koşullar ──────────────────────────────────────

  test("yetki: misafir 401, kullanıcı 403, olmayan parti 404; moderatör başkasının partisini göremez/geri alamaz (404), ADMIN alabilir", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const other = await staff("MODERATOR", c.id);
    const author = await signUp();
    const id = await poll(author, c.id);
    const batchId = await bulk("polls", mod.cookie, [id], "HIDE");
    const user = await signUp();

    assertError(await undoPreview(undefined, batchId), 401, "UNAUTHENTICATED");
    assertError(await undoPreview(user.cookie, batchId), 403, "FORBIDDEN");
    assertError(await undo(undefined, batchId, "a".repeat(64)), 401, "UNAUTHENTICATED");
    assertError(await undo(user.cookie, batchId, "a".repeat(64)), 403, "FORBIDDEN");
    assertError(await undoPreview(mod.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await undoPreview(other.cookie, batchId), 404, "NOT_FOUND");
    assertError(await undo(other.cookie, batchId, "a".repeat(64)), 404, "NOT_FOUND");
    assert.equal((await pollRow(id)).status, "HIDDEN");
    assert.equal((await undoPreview(admin.cookie, batchId)).statusCode, 200);
  });

  test("gövde doğrulaması: kısa gerekçe ve bozuk digest 400; izsiz", async () => {
    const author = await signUp();
    const id = await poll(author);
    const batchId = await bulk("polls", admin.cookie, [id], "HIDE");
    assertError(await undo(admin.cookie, batchId, "a".repeat(64), "ab"), 400, "VALIDATION_ERROR");
    assertError(await undo(admin.cookie, batchId, "kisa"), 400, "VALIDATION_ERROR");
    assertError(await send("POST", `/admin/moderation/batches/${batchId}/undo`, { reason: UNDO_REASON }, admin.cookie), 400, "VALIDATION_ERROR");
    assert.equal(await db.moderationBatch.count({ where: { undoOfId: batchId } }), 0);
    assert.equal((await pollRow(id)).status, "HIDDEN");
  });

  // ─── Geri alma ──────────────────────────────────────────────

  test("HIDE partisi geri alınır: telafi kararları kendi kaydını yazar, geçmiş kayıtlar değişmez, parti ve öğeler bağlanır", async () => {
    const author = await signUp();
    const ids = [await poll(author), await poll(author), await poll(author)];
    const batchId = await bulk("polls", admin.cookie, ids, "HIDE");
    const auditBefore = await db.auditLog.findMany({ where: { action: "moderation.poll.apply", targetId: { in: ids } }, orderBy: { id: "asc" } });
    assert.equal(auditBefore.length, 3);

    const pv = UndoPreview.parse((await undoPreview(admin.cookie, batchId)).json().data);
    assert.deepEqual(pv.summary, { willUndo: 3, blocked: 0, alreadyUndone: 0 });
    assert.ok(pv.items.every((i) => i.outcome === "WILL_UNDO" && i.undoAction === "RESTORE" && i.label !== null));
    const written = await db.moderationAction.count();
    await undoPreview(admin.cookie, batchId);
    assert.equal(await db.moderationAction.count(), written, "önizleme yazmaz");

    const res = await undo(admin.cookie, batchId, pv.digest);
    assert.equal(res.statusCode, 200, res.body);
    const result = UndoResult.parse(res.json().data);
    assert.deepEqual(result.summary, { total: 3, applied: 3, unchanged: 0, failed: 0 });
    assert.equal(result.undoOfId, batchId);
    for (const id of ids) {
      assert.equal((await pollRow(id)).status, "ACTIVE");
      const actions = await actionsOf(id);
      assert.deepEqual(actions.map((a) => a.action), ["HIDE", "RESTORE"]);
      assert.equal(actions[1]!.reason, UNDO_REASON);
      assert.deepEqual([actions[1]!.fromStatus, actions[1]!.toStatus], ["HIDDEN", "ACTIVE"]);
    }
    // Append-only: eski audit kayıtları aynen durur, her telafi yeni audit yazar.
    const auditAfter = await db.auditLog.findMany({ where: { action: "moderation.poll.apply", targetId: { in: ids } }, orderBy: { id: "asc" } });
    assert.equal(auditAfter.length, 6);
    for (const old of auditBefore) assert.deepEqual(auditAfter.find((a) => a.id === old.id), old);
    assert.equal(auditAfter.filter((a) => a.reason === UNDO_REASON).length, 3);

    const undoBatch = await db.moderationBatch.findUniqueOrThrow({ where: { id: result.batchId }, include: { items: true } });
    assert.equal(undoBatch.undoOfId, batchId);
    assert.equal(undoBatch.reason, UNDO_REASON);
    assert.deepEqual([undoBatch.total, undoBatch.applied, undoBatch.failed], [3, 3, 0]);
    const original = await db.moderationBatchItem.findMany({ where: { batchId } });
    assert.ok(original.every((i) => i.undoneByBatchId === result.batchId));

    const list = await send("GET", "/admin/moderation/batches?limit=50", undefined, admin.cookie);
    const views = (list.json().data as unknown[]).map((b) => ModerationBatchView.parse(b));
    const orig = views.find((b) => b.id === batchId)!;
    assert.deepEqual([orig.undone, orig.undoable, orig.undoOfId], [3, false, null]);
    assert.equal(views.find((b) => b.id === result.batchId)!.undoOfId, batchId);
    assert.equal(views.find((b) => b.id === result.batchId)!.undoable, false, "geri almanın geri alması yok");
  });

  test("yorum sayaçları: HIDE geri alınınca comment_count eski değerine döner", async () => {
    const author = await signUp();
    const pollId = await poll(author);
    const c1 = await comment(pollId, author.cookie);
    const c2 = await comment(pollId, author.cookie);
    const batchId = await bulk("comments", admin.cookie, [c1, c2], "HIDE");
    assert.equal((await pollRow(pollId)).commentCount, 0);
    assert.equal((await doUndo(admin.cookie, batchId)).statusCode, 200);
    assert.equal((await pollRow(pollId)).commentCount, 2);
    assert.equal((await commentRow(c1)).status, "ACTIVE");
  });

  test("REMOVE geri alma ADMIN şartı taşır; RESTORE partisi geri alınınca önceki durum (HIDDEN / REMOVED) eksiksiz döner", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const author = await signUp();
    const removed = await poll(author, c.id);
    const batchId = await bulk("polls", mod.cookie, [removed], "REMOVE");
    const modPv = UndoPreview.parse((await undoPreview(mod.cookie, batchId)).json().data);
    assert.deepEqual([modPv.items[0]!.outcome, modPv.items[0]!.blocked], ["BLOCKED", "admin_required"]);
    assertError(await undo(mod.cookie, batchId, modPv.digest), 409, "CONFLICT", "nothing_to_undo");
    assert.equal((await pollRow(removed)).status, "REMOVED");
    assert.equal((await doUndo(admin.cookie, batchId)).statusCode, 200);
    assert.equal((await pollRow(removed)).status, "ACTIVE");

    // RESTORE partisi: HIDDEN → ACTIVE, REMOVED → ACTIVE; geri alma ikisini de eski haline getirir.
    const a = await poll(author);
    const b = await poll(author);
    await bulk("polls", admin.cookie, [a], "HIDE");
    await bulk("polls", admin.cookie, [b], "REMOVE");
    const restoreBatch = await bulk("polls", admin.cookie, [a, b], "RESTORE");
    assert.equal((await pollRow(a)).status, "ACTIVE");
    assert.equal((await doUndo(admin.cookie, restoreBatch)).statusCode, 200);
    assert.equal((await pollRow(a)).status, "HIDDEN");
    assert.equal((await pollRow(b)).status, "REMOVED");
    assert.notEqual((await pollRow(b)).deletedAt, null);
  });

  test("tek geri alma: ikinci deneme 409 nothing_to_undo; geri alma partisi geri alınamaz (not_undoable); bitmemiş parti geri alınamaz", async () => {
    const author = await signUp();
    const id = await poll(author);
    const batchId = await bulk("polls", admin.cookie, [id], "HIDE");
    const pv = (await undoPreview(admin.cookie, batchId)).json().data;
    const first = await undo(admin.cookie, batchId, pv.digest);
    assert.equal(first.statusCode, 200, first.body);
    assertError(await undoPreview(admin.cookie, batchId), 409, "CONFLICT", "nothing_to_undo");
    assertError(await undo(admin.cookie, batchId, pv.digest), 409, "CONFLICT", "nothing_to_undo");
    assertError(await undoPreview(admin.cookie, UndoResult.parse(first.json().data).batchId), 409, "CONFLICT", "not_undoable");
    assert.equal((await actionsOf(id)).length, 2, "tek telafi kararı");

    const open = await db.moderationBatch.create({ data: { actorId: admin.id, kind: "POLLS", action: "HIDE", reason: REASON, digest: "d".repeat(64), total: 1 } });
    assertError(await undoPreview(admin.cookie, open.id), 409, "CONFLICT", "not_undoable");
  });

  // ─── Sürüm koşulu ───────────────────────────────────────────

  test("sürüm koşulu: araya daha yeni karar girdiyse (durum aynı olsa bile) superseded; durum değiştiyse status_changed; içerik dokunulmaz", async () => {
    const author = await signUp();
    const superseded = await poll(author);
    const changed = await poll(author);
    const batchId = await bulk("polls", admin.cookie, [superseded, changed], "HIDE");
    // superseded: başkası geri yükleyip yeniden gizledi → durum yine HIDDEN ama son karar farklı.
    assert.equal((await single(superAdmin.cookie, "polls", superseded, "RESTORE")).statusCode, 200);
    assert.equal((await single(superAdmin.cookie, "polls", superseded, "HIDE")).statusCode, 200);
    // changed: başkası geri yükledi → durum ACTIVE.
    assert.equal((await single(superAdmin.cookie, "polls", changed, "RESTORE")).statusCode, 200);

    const pv = UndoPreview.parse((await undoPreview(admin.cookie, batchId)).json().data);
    const byId = new Map(pv.items.map((i) => [i.id, i]));
    assert.deepEqual([byId.get(superseded)!.outcome, byId.get(superseded)!.blocked], ["BLOCKED", "superseded"]);
    assert.deepEqual([byId.get(changed)!.outcome, byId.get(changed)!.blocked], ["BLOCKED", "status_changed"]);
    assertError(await undo(admin.cookie, batchId, pv.digest), 409, "CONFLICT", "nothing_to_undo");
    assert.equal((await pollRow(superseded)).status, "HIDDEN");
    assert.equal((await pollRow(changed)).status, "ACTIVE");
    assert.equal(await db.moderationBatch.count({ where: { undoOfId: batchId } }), 0, "boş geri alma partisi açılmaz");
  });

  test("önizleme ile onay arasında daha yeni karar gelirse digest değişir: 409 preview_stale, hiçbir şey yazılmaz", async () => {
    const author = await signUp();
    const [a, b] = [await poll(author), await poll(author)];
    const batchId = await bulk("polls", admin.cookie, [a, b], "HIDE");
    const pv = (await undoPreview(admin.cookie, batchId)).json().data;
    assert.equal(pv.summary.willUndo, 2);
    assert.equal((await single(superAdmin.cookie, "polls", b, "RESTORE")).statusCode, 200);
    assertError(await undo(admin.cookie, batchId, pv.digest), 409, "CONFLICT", "preview_stale");
    assert.equal((await pollRow(a)).status, "HIDDEN");
    assert.equal(await db.moderationBatch.count({ where: { undoOfId: batchId } }), 0);
  });

  test("koşul uygulama içinde kilit altında doğrulanır: eskimiş beklenti superseded, doğru beklenti uygulanır (apply doğrudan)", async () => {
    const author = await signUp();
    const id = await poll(author);
    const batchId = await bulk("polls", admin.cookie, [id], "HIDE");
    const item = await db.moderationBatchItem.findFirstOrThrow({ where: { batchId, targetId: id } });
    const store = createPrismaModerationStore(db);
    const base = { kind: "polls" as const, id, actorId: admin.id, action: "RESTORE" as const, reason: UNDO_REASON, now: h.clock.now, requestId: randomUUID(), actorIsAdmin: true, communityId: null };

    const stale = await store.apply({ ...base, expect: { actionId: randomUUID(), status: "HIDDEN" } });
    assert.deepEqual(stale, { kind: "conflict", reason: "superseded" });
    const wrongStatus = await store.apply({ ...base, expect: { actionId: item.moderationActionId!, status: "ACTIVE" } });
    assert.deepEqual(wrongStatus, { kind: "conflict", reason: "superseded" });
    assert.equal((await pollRow(id)).status, "HIDDEN");
    const ok = await store.apply({ ...base, expect: { actionId: item.moderationActionId!, status: "HIDDEN" } });
    assert.equal(ok.kind, "applied");
    assert.equal((await pollRow(id)).status, "ACTIVE");
  });

  // ─── Silinmiş veri asla geri üretilmez ──────────────────────

  test("içerik sahibi silinmiş/anonimleştirilmişse içerik geri getirilmez (author_erased): önizlemede engelli, uygulamada kilit altında da reddedilir", async () => {
    const author = await signUp();
    const erased = await poll(author);
    const live = await poll(await signUp());
    const batchId = await bulk("polls", admin.cookie, [erased, live], "REMOVE");

    const pv = (await undoPreview(admin.cookie, batchId)).json().data;
    assert.equal(pv.summary.willUndo, 2);
    // Önizlemeden sonra içerik sahibi anonimleştirildi: digest değişmese bile (durum aynı) kilit altındaki kontrol yakalar.
    await db.user.update({ where: { id: author.id }, data: { deletedAt: new Date() } });
    const res = await undo(admin.cookie, batchId, pv.digest);
    assert.equal(res.statusCode, 200, res.body);
    const result = UndoResult.parse(res.json().data);
    assert.deepEqual(result.summary, { total: 2, applied: 1, unchanged: 0, failed: 1 });
    assert.equal(result.items.find((i) => i.id === erased)!.code, "author_erased");
    assert.equal((await pollRow(erased)).status, "REMOVED", "silinmiş sahibin içeriği geri gelmez");
    assert.equal((await pollRow(live)).status, "ACTIVE");
    const item = await db.moderationBatchItem.findFirstOrThrow({ where: { batchId, targetId: erased } });
    assert.equal(item.undoneByBatchId, null, "uygulanmayan karar geri alındı sayılmaz");

    // Sonraki önizleme de aynı nedenle engelli gösterir.
    const again = UndoPreview.parse((await undoPreview(admin.cookie, batchId)).json().data);
    assert.deepEqual(again.items.find((i) => i.id === erased)!.blocked, "author_erased");
    assert.equal(again.summary.alreadyUndone, 1);
  });

  // ─── Kapsam ve yarış ────────────────────────────────────────

  test("kapsam: içerik başka topluluğa taşındıysa moderatör geri alamaz (forbidden); ADMIN alabilir", async () => {
    const a = await community();
    const b = await community();
    const mod = await staff("MODERATOR", a.id);
    const author = await signUp();
    const id = await poll(author, a.id);
    const batchId = await bulk("polls", mod.cookie, [id], "HIDE");
    await db.poll.update({ where: { id }, data: { communityId: b.id } });

    const pv = UndoPreview.parse((await undoPreview(mod.cookie, batchId)).json().data);
    assert.deepEqual([pv.items[0]!.blocked, pv.items[0]!.label], ["forbidden", null]);
    assertError(await undo(mod.cookie, batchId, pv.digest), 409, "CONFLICT", "nothing_to_undo");
    assert.equal((await pollRow(id)).status, "HIDDEN");
    assert.equal((await doUndo(admin.cookie, batchId)).statusCode, 200);
    assert.equal((await pollRow(id)).status, "ACTIVE");
  });

  test("yarış: aynı partinin iki eşzamanlı geri almasında her karar tam bir kez telafi edilir", async () => {
    const author = await signUp();
    const ids = [await poll(author), await poll(author), await poll(author)];
    const batchId = await bulk("polls", admin.cookie, ids, "HIDE");
    const pv = (await undoPreview(admin.cookie, batchId)).json().data;
    const [x, y] = await Promise.all([undo(admin.cookie, batchId, pv.digest), undo(superAdmin.cookie, batchId, pv.digest)]);
    assert.ok([200, 409].includes(x.statusCode) && [200, 409].includes(y.statusCode), x.body + y.body);
    for (const id of ids) {
      assert.equal((await pollRow(id)).status, "ACTIVE");
      assert.deepEqual((await actionsOf(id)).map((a) => a.action), ["HIDE", "RESTORE"], "tek telafi kararı");
    }
    const items = await db.moderationBatchItem.findMany({ where: { batchId } });
    assert.ok(items.every((i) => i.undoneByBatchId !== null));
    const applied = await db.moderationBatch.aggregate({ where: { undoOfId: batchId }, _sum: { applied: true } });
    assert.equal(applied._sum.applied, 3);
  });

  test("yarış: geri alma ile aynı kaydın tekil yeni kararı aynı anda — geri alma yalnız karar hâlâ sonuncuysa uygulanır", async () => {
    const author = await signUp();
    const id = await poll(author);
    const batchId = await bulk("polls", admin.cookie, [id], "HIDE");
    const pv = (await undoPreview(admin.cookie, batchId)).json().data;
    const [u, s] = await Promise.all([undo(admin.cookie, batchId, pv.digest), single(superAdmin.cookie, "polls", id, "REMOVE")]);
    assert.ok(s.statusCode === 200 || s.statusCode === 409, s.body);
    const actions = (await actionsOf(id)).map((a) => a.action);
    const status = (await pollRow(id)).status;
    if (u.statusCode === 200 && UndoResult.parse(u.json().data).summary.applied === 1) {
      // Geri alma kazandı: sonra tekil karar da uygulanmış olabilir ama çift telafi yok.
      assert.equal(actions.filter((a) => a === "RESTORE").length, 1);
    } else {
      // Tekil karar önce geldi: geri alma uygulanmadı, içerik tekil kararın durumunda.
      assert.equal(actions.filter((a) => a === "RESTORE").length, 0);
      assert.equal(status, "REMOVED");
    }
  });
});
