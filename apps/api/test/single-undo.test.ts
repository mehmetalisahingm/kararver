/**
 * #183 tekil moderasyon kararının güvenli geri alınması (KV-37 §10): telafi çiftleri, telafinin yeni (append-only) satır olması,
 * sürüm koşulu (durum + son karar), tek geri alma, geri almanın geri alınamaması, kapsam/yetki (moderatör yalnız kendi kararı),
 * silinmiş içerik sahibi, yarış ve veritabanı kısıtları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ContentHistoryItem, ErrorBody, UndoActionPreview, UndoActionResult } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { inverseDecision } from "../src/modules/moderation/single-undo-routes.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "Moderatör incelemesi";
const UNDO_REASON = "Yanlış karar: geri alınıyor";

test("telafi çiftleri: yalnız kararın önceki duruma tam dönüşünü sağlayanlar; uyarı/yaptırım/taşıma/rapor reddi ve yorumda kilit/trend yok", () => {
  const poll = (action: string, fromStatus: string | null) => inverseDecision({ kind: "polls", action, fromStatus });
  const comment = (action: string, fromStatus: string | null) => inverseDecision({ kind: "comments", action, fromStatus });
  assert.equal(poll("HIDE", "ACTIVE"), "RESTORE");
  assert.equal(poll("REMOVE", "ACTIVE"), "RESTORE");
  assert.equal(poll("RESTORE", "HIDDEN"), "HIDE");
  assert.equal(poll("RESTORE", "REMOVED"), "REMOVE");
  assert.equal(poll("LOCK", "ACTIVE"), "UNLOCK");
  assert.equal(poll("UNLOCK", "LOCKED"), "LOCK");
  assert.equal(poll("EXCLUDE_FROM_TRENDS", "ACTIVE"), "INCLUDE_IN_TRENDS");
  assert.equal(poll("INCLUDE_IN_TRENDS", "ACTIVE"), "EXCLUDE_FROM_TRENDS");
  assert.equal(poll("CLOSE_COMMENTS", "ACTIVE"), "OPEN_COMMENTS");
  assert.equal(poll("OPEN_COMMENTS", "ACTIVE"), "CLOSE_COMMENTS");
  assert.equal(comment("HIDE", "ACTIVE"), "RESTORE");
  for (const [action, from] of [["REMOVE", "HIDDEN"], ["REMOVE", "LOCKED"], ["HIDE", "LOCKED"], ["RESTORE", "LOCKED"], ["RESTORE", "UNDER_REVIEW"], ["RESTORE", null], ["LOCK", "HIDDEN"], ["UNLOCK", "ACTIVE"]] as const) {
    assert.equal(poll(action, from), null, `${action} önce ${from}`);
  }
  for (const action of ["WARN_USER", "SANCTION_USER", "DISMISS_REPORT", "MOVE", "APPROVE", "REJECT"]) assert.equal(poll(action, "ACTIVE"), null, action);
  for (const action of ["LOCK", "UNLOCK", "EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS", "CLOSE_COMMENTS", "OPEN_COMMENTS"]) assert.equal(comment(action, "ACTIVE"), null, `yorumda ${action}`);
});

describe("tekil karar geri alma (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;
  let author: User;
  let authored = 0;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `single-undo-${randomUUID().slice(0, 8)}`, name: "Tekil geri alma" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
    author = await signUp();
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string, key?: string): Promise<Res> {
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
    const account = { email: `su_${id}@example.test`, username: `su_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
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
  const community = () => db.community.create({ data: { slug: `su-${randomUUID().slice(0, 8)}`, name: "Geri alma topluluğu", createdById: superAdmin.id } });
  async function poll(communityId?: string) {
    if (authored >= 8) {
      author = await signUp();
      authored = 0;
    }
    authored += 1;
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
  async function comment(pollId: string) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: `Geri alma yorumu ${randomUUID().slice(0, 6)}` }, author.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  /** Tekil karar; oluşan moderation_actions kaydının kimliğini döner. */
  async function decide(user: User, kind: "polls" | "comments", targetId: string, action: string): Promise<string> {
    const res = await send("POST", `/admin/${kind}/${targetId}/moderation`, { action, reason: REASON }, user.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const row = await db.moderationAction.findFirstOrThrow({ where: kind === "polls" ? { pollId: targetId } : { commentId: targetId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return row.id;
  }
  const preview = (user: User | undefined, actionId: string) => send("GET", `/admin/moderation/actions/${actionId}/undo/preview`, undefined, user?.cookie);
  const undo = (user: User | undefined, actionId: string, digest: string, reason: unknown = UNDO_REASON) => send("POST", `/admin/moderation/actions/${actionId}/undo`, { reason, digest }, user?.cookie);
  /** Önizleme + geri alma. */
  async function run(user: User, actionId: string) {
    const pv = await preview(user, actionId);
    assert.equal(pv.statusCode, 200, pv.body);
    return undo(user, actionId, pv.json().data.digest);
  }
  const pollRow = (id: string) => db.poll.findUniqueOrThrow({ where: { id } });
  const commentRow = (id: string) => db.comment.findUniqueOrThrow({ where: { id } });
  const actionRow = (id: string) => db.moderationAction.findUniqueOrThrow({ where: { id } });
  const actionsOf = (pollId: string) => db.moderationAction.count({ where: { pollId } });

  // ─── Telafi çiftleri ────────────────────────────────────────

  test("HIDE geri alınır: yeni telafi satırı undo_of_id'yi gösterir, eski satır ve audit değişmez, audit'e undoOfActionId yazılır", async () => {
    const pollId = await poll();
    const original = await decide(admin, "polls", pollId, "HIDE");
    const before = await actionRow(original);
    const pv = UndoActionPreview.parse((await preview(admin, original)).json().data);
    assert.equal(pv.outcome, "WILL_UNDO");
    assert.equal(pv.undoAction, "RESTORE");
    assert.equal(pv.originalAction, "HIDE");
    assert.equal(pv.currentStatus, "HIDDEN");
    assert.ok(pv.label);

    const res = await undo(admin, original, pv.digest);
    assert.equal(res.statusCode, 200, res.body);
    const out = UndoActionResult.parse(res.json().data);
    assert.equal(out.undoOfId, original);
    assert.equal(out.outcome.status, "ACTIVE");
    assert.equal((await pollRow(pollId)).status, "ACTIVE");

    const comp = await actionRow(out.actionId);
    assert.equal(comp.undoOfId, original);
    assert.equal(comp.action, "RESTORE");
    assert.equal(comp.fromStatus, "HIDDEN");
    assert.equal(comp.toStatus, "ACTIVE");
    assert.equal(comp.reason, UNDO_REASON);
    assert.deepEqual(await actionRow(original), before, "geri alınan satır değişmez (append-only)");
    const audits = await db.auditLog.findMany({ where: { targetId: pollId, action: "moderation.poll.apply" }, orderBy: { createdAt: "asc" } });
    const last = audits.find((a) => a.operation === "restore")!;
    assert.equal(last.reason, UNDO_REASON);
    assert.equal((last.after as Record<string, unknown>).undoOfActionId, original);
    assert.ok(audits.some((a) => a.operation === "hide"), "özgün audit kaydı yerinde");

    assert.equal(await actionsOf(pollId), 2, "özgün karar + telafi");
  });

  test("anket kararlarının hepsi geri alınır: LOCK↔UNLOCK, trend, yorum kapatma, RESTORE(HIDDEN)→HIDE, REMOVE→RESTORE, RESTORE(REMOVED)→REMOVE", async () => {
    const p1 = await poll();
    const lock = await decide(admin, "polls", p1, "LOCK");
    assert.equal((await run(admin, lock)).statusCode, 200);
    assert.equal((await pollRow(p1)).status, "ACTIVE");

    const p2 = await poll();
    const exclude = await decide(admin, "polls", p2, "EXCLUDE_FROM_TRENDS");
    assert.notEqual((await pollRow(p2)).trendExcludedAt, null);
    assert.equal((await run(admin, exclude)).statusCode, 200);
    assert.equal((await pollRow(p2)).trendExcludedAt, null);

    const p3 = await poll();
    const close = await decide(admin, "polls", p3, "CLOSE_COMMENTS");
    assert.notEqual((await pollRow(p3)).commentsClosedAt, null);
    assert.equal((await run(admin, close)).statusCode, 200);
    assert.equal((await pollRow(p3)).commentsClosedAt, null);

    const p4 = await poll();
    await decide(admin, "polls", p4, "HIDE");
    const restore = await decide(admin, "polls", p4, "RESTORE");
    assert.equal((await run(admin, restore)).statusCode, 200);
    assert.equal((await pollRow(p4)).status, "HIDDEN", "RESTORE (önceki HIDDEN) → HIDE");

    const p5 = await poll();
    const remove = await decide(admin, "polls", p5, "REMOVE");
    assert.equal((await pollRow(p5)).status, "REMOVED");
    assert.equal((await run(admin, remove)).statusCode, 200);
    assert.equal((await pollRow(p5)).status, "ACTIVE");
    assert.equal((await pollRow(p5)).deletedAt, null, "geri yüklemede deleted_at boşalır");

    const p6 = await poll();
    await decide(admin, "polls", p6, "REMOVE");
    const restoreRemoved = await decide(superAdmin, "polls", p6, "RESTORE");
    assert.equal((await run(admin, restoreRemoved)).statusCode, 200);
    assert.equal((await pollRow(p6)).status, "REMOVED", "RESTORE (önceki REMOVED) → REMOVE");
  });

  test("yorum kararı geri alınır ve anketin yorum sayaçları doğru kalır", async () => {
    const pollId = await poll();
    const c1 = await comment(pollId);
    await comment(pollId);
    assert.equal((await pollRow(pollId)).commentCount, 2);
    const hide = await decide(admin, "comments", c1, "HIDE");
    assert.equal((await pollRow(pollId)).commentCount, 1);
    const res = await run(admin, hide);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await commentRow(c1)).status, "ACTIVE");
    assert.equal((await pollRow(pollId)).commentCount, 2, "sayaç geri geldi");
  });

  test("geri alınamayanlar: uyarı/hedefsiz karar 404, kararın kapattığı rapor yeniden açılmaz", async () => {
    const pollId = await poll();
    const reporter = await signUp();
    assert.equal((await send("POST", "/reports", { target: { type: "POLL", id: pollId }, reason: "SPAM" }, reporter.cookie)).statusCode, 202);
    const hide = await decide(admin, "polls", pollId, "HIDE");
    const report = await db.report.findFirstOrThrow({ where: { pollId } });
    assert.equal(report.status, "ACTIONED");
    assert.equal((await run(admin, hide)).statusCode, 200);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status, "ACTIONED", "rapor geçmişi değişmez");

    // Kullanıcı hedefli (içerik/görsel dışı) karar bu yolun dışındadır.
    const warn = await db.moderationAction.create({ data: { actorId: admin.id, action: "WARN_USER", targetUserId: author.id, reason: "Uyarı" } });
    assertError(await preview(admin, warn.id), 404, "NOT_FOUND");
    assertError(await preview(admin, randomUUID()), 404, "NOT_FOUND");
  });

  // ─── Sürüm koşulu, tek geri alma ────────────────────────────

  test("sürüm koşulu: araya daha yeni karar girdiyse superseded, içerik durumu değiştiyse status_changed; hiçbir şey yazılmaz", async () => {
    const pollId = await poll();
    const a = await decide(admin, "polls", pollId, "HIDE");
    const b = await decide(admin, "polls", pollId, "RESTORE");
    const c = await decide(admin, "polls", pollId, "HIDE");
    const pa = UndoActionPreview.parse((await preview(admin, a)).json().data);
    assert.equal(pa.outcome, "BLOCKED");
    assert.equal(pa.blocked, "superseded", "durum HIDDEN ama son karar c");
    const pb = UndoActionPreview.parse((await preview(admin, b)).json().data);
    assert.equal(pb.blocked, "status_changed", "b ACTIVE bıraktı, şimdi HIDDEN");
    const before = await actionsOf(pollId);
    assertError(await undo(admin, a, pa.digest), 409, "CONFLICT", "superseded");
    assertError(await undo(admin, b, pb.digest), 409, "CONFLICT", "status_changed");
    assert.equal(await actionsOf(pollId), before);
    assert.equal((await pollRow(pollId)).status, "HIDDEN");
    // En son karar hâlâ geri alınabilir.
    assert.equal((await run(admin, c)).statusCode, 200);
  });

  test("tek geri alma: ikinci istek 409 already_undone; geri almanın geri alınamaması (is_undo); önizleme ALREADY_UNDONE der", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    const first = await run(admin, hide);
    assert.equal(first.statusCode, 200);
    const compensation = UndoActionResult.parse(first.json().data).actionId;
    const pv = UndoActionPreview.parse((await preview(admin, hide)).json().data);
    assert.equal(pv.outcome, "ALREADY_UNDONE");
    assertError(await undo(admin, hide, pv.digest), 409, "CONFLICT", "already_undone");
    const pu = UndoActionPreview.parse((await preview(admin, compensation)).json().data);
    assert.equal(pu.outcome, "BLOCKED");
    assert.equal(pu.blocked, "is_undo");
    assert.equal(pu.undoAction, "HIDE", "telafi satırı için de karşılık hesaplanır ama uygulanamaz");
    assertError(await undo(admin, compensation, pu.digest), 409, "CONFLICT", "is_undo");
    assert.equal((await pollRow(pollId)).status, "ACTIVE");
  });

  test("toplu geri almanın ürettiği karar tekil olarak geri alınamaz (is_undo); toplu partinin kararı tekil geri alınınca parti geri alması o kaydı atlar", async () => {
    const [p1, p2] = [await poll(), await poll()];
    const ids = [p1, p2];
    const pv = await send("GET", `/admin/moderation/polls/bulk/preview?ids=${ids.join(",")}&action=HIDE`, undefined, admin.cookie);
    const batch = await send("POST", "/admin/moderation/polls/bulk", { ids, action: "HIDE", reason: REASON, digest: pv.json().data.digest }, admin.cookie);
    assert.equal(batch.statusCode, 200, batch.body);
    const batchId = batch.json().data.batchId as string;
    const upv = await send("GET", `/admin/moderation/batches/${batchId}/undo/preview`, undefined, admin.cookie);
    const ub = await send("POST", `/admin/moderation/batches/${batchId}/undo`, { reason: UNDO_REASON, digest: upv.json().data.digest }, admin.cookie);
    assert.equal(ub.statusCode, 200, ub.body);
    const compensation = await db.moderationAction.findFirstOrThrow({ where: { pollId: p1, action: "RESTORE" } });
    const blocked = UndoActionPreview.parse((await preview(admin, compensation.id)).json().data);
    assert.equal(blocked.blocked, "is_undo");

    // Toplu partinin bir kararını tekil geri alma: toplu geri alma o kaydı (durum değişti) atlar, diğerini geri alır.
    const [q1, q2] = [await poll(), await poll()];
    const pv2 = await send("GET", `/admin/moderation/polls/bulk/preview?ids=${[q1, q2].join(",")}&action=HIDE`, undefined, admin.cookie);
    const batch2 = await send("POST", "/admin/moderation/polls/bulk", { ids: [q1, q2], action: "HIDE", reason: REASON, digest: pv2.json().data.digest }, admin.cookie);
    const single = await db.moderationAction.findFirstOrThrow({ where: { pollId: q1, action: "HIDE" } });
    assert.equal((await run(admin, single.id)).statusCode, 200);
    const upv2 = await send("GET", `/admin/moderation/batches/${batch2.json().data.batchId}/undo/preview`, undefined, admin.cookie);
    assert.equal(upv2.json().data.items.find((i: any) => i.id === q1).blocked, "status_changed");
    assert.equal(upv2.json().data.items.find((i: any) => i.id === q2).outcome, "WILL_UNDO");
  });

  test("önizleme özeti: önizlemeden sonra değişiklik olursa 409 preview_stale (ör. içerik başka topluluğa taşındı)", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    const pv = await preview(admin, hide);
    const other = await community();
    await db.poll.update({ where: { id: pollId }, data: { communityId: other.id } });
    assertError(await undo(admin, hide, pv.json().data.digest), 409, "CONFLICT", "preview_stale");
    assert.equal((await pollRow(pollId)).status, "HIDDEN");
  });

  test("silinmiş hesabın içeriği geri getirilmez (author_erased); önizleme ve uygulama aynı sonucu verir", async () => {
    const pollId = await poll();
    const owner = (await pollRow(pollId)).authorId;
    const hide = await decide(admin, "polls", pollId, "HIDE");
    await db.user.update({ where: { id: owner }, data: { deletedAt: new Date() } });
    const pv = UndoActionPreview.parse((await preview(admin, hide)).json().data);
    assert.equal(pv.blocked, "author_erased");
    assertError(await undo(admin, hide, pv.digest), 409, "CONFLICT", "author_erased");
    assert.equal((await pollRow(pollId)).status, "HIDDEN");
    await db.user.update({ where: { id: owner }, data: { deletedAt: null } });
  });

  // ─── Yetki ─────────────────────────────────────────────────

  test("yetki: misafir 401, kullanıcı 403; gerekçe ve özet doğrulanır; olmayan karar 404", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    assertError(await preview(undefined, hide), 401, "UNAUTHENTICATED");
    assertError(await preview(author, hide), 403, "FORBIDDEN");
    assertError(await undo(undefined, hide, "a".repeat(64)), 401, "UNAUTHENTICATED");
    assertError(await undo(author, hide, "a".repeat(64)), 403, "FORBIDDEN");
    const pv = await preview(admin, hide);
    assertError(await undo(admin, hide, pv.json().data.digest, "x"), 400, "VALIDATION_ERROR");
    assertError(await undo(admin, hide, "kısa"), 400, "VALIDATION_ERROR");
    assertError(await undo(admin, randomUUID(), "a".repeat(64)), 404, "NOT_FOUND");
    assert.equal((await pollRow(pollId)).status, "HIDDEN");
  });

  test("moderatör yalnız KENDİ kararını geri alır; başkasının kararı 404, ADMIN+ herhangi birini geri alır", async () => {
    const c = await community();
    const mod1 = await staff("MODERATOR", c.id);
    const mod2 = await staff("MODERATOR", c.id);
    const pollId = await poll(c.id);
    const byMod1 = await decide(mod1, "polls", pollId, "HIDE");
    assertError(await preview(mod2, byMod1), 404, "NOT_FOUND");
    assertError(await undo(mod2, byMod1, "a".repeat(64)), 404, "NOT_FOUND");
    assert.equal((await run(mod1, byMod1)).statusCode, 200, "kendi kararı");
    const again = await decide(mod2, "polls", pollId, "HIDE");
    assert.equal((await run(admin, again)).statusCode, 200, "ADMIN başkasının kararını da geri alır");
  });

  test("kapsam: moderatör topluluktan çıkarılınca kendi kararını bile geri alamaz (forbidden, içerik görünmez); kaldırılmış içeriği yalnız ADMIN+ geri yükler", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    const pollId = await poll(c.id);
    const hide = await decide(mod, "polls", pollId, "HIDE");
    await db.communityMembership.delete({ where: { communityId_userId: { communityId: c.id, userId: mod.id } } });
    const pv = UndoActionPreview.parse((await preview(mod, hide)).json().data);
    assert.equal(pv.blocked, "forbidden");
    assert.equal(pv.label, null, "kapsam dışı içerik sızmaz");
    assertError(await undo(mod, hide, pv.digest), 403, "FORBIDDEN");
    assert.equal((await pollRow(pollId)).status, "HIDDEN");

    const c2 = await community();
    const mod2 = await staff("MODERATOR", c2.id);
    const p2 = await poll(c2.id);
    const remove = await decide(mod2, "polls", p2, "REMOVE");
    const pv2 = UndoActionPreview.parse((await preview(mod2, remove)).json().data);
    assert.equal(pv2.blocked, "admin_required");
    assertError(await undo(mod2, remove, pv2.digest), 403, "FORBIDDEN");
    assert.equal((await run(admin, remove)).statusCode, 200, "ADMIN geri yükler");
  });

  // ─── Yarışlar ve veritabanı ─────────────────────────────────

  test("yarış: aynı kararın eşzamanlı iki geri alması — biri 200, diğeri 409; tek telafi satırı; sayaç bir kez oynar", async () => {
    const pollId = await poll();
    const c1 = await comment(pollId);
    const hide = await decide(admin, "comments", c1, "HIDE");
    const pv = await preview(admin, hide);
    const digest = pv.json().data.digest as string;
    const [x, y] = await Promise.all([undo(admin, hide, digest), undo(superAdmin, hide, digest)]);
    assert.deepEqual([x.statusCode, y.statusCode].sort(), [200, 409], x.body + y.body);
    assert.equal(await db.moderationAction.count({ where: { undoOfId: hide } }), 1);
    assert.equal((await commentRow(c1)).status, "ACTIVE");
    assert.equal((await pollRow(pollId)).commentCount, 1, "sayaç çift sayılmaz");
  });

  test("yarış: geri alma ile aynı içeriğe yeni karar aynı anda — yarışı biri kazanır, tutarsız durum kalmaz", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    const pv = await preview(admin, hide);
    const [u, d] = await Promise.all([
      undo(admin, hide, pv.json().data.digest),
      send("POST", `/admin/polls/${pollId}/moderation`, { action: "REMOVE", reason: REASON }, superAdmin.cookie),
    ]);
    assert.ok([200, 409].includes(u.statusCode) && d.statusCode === 200, u.body + d.body);
    const status = (await pollRow(pollId)).status;
    if (u.statusCode === 200) assert.ok(["ACTIVE", "REMOVED"].includes(status));
    else assert.equal(status, "REMOVED");
    assert.ok((await db.moderationAction.count({ where: { undoOfId: hide } })) <= 1);
  });

  test("veritabanı: bir karar iki kez telafi edilemez (UNIQUE), kendi kendini telafi edemez, eski satır güncellenemez (append-only)", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    assert.equal((await run(admin, hide)).statusCode, 200);
    const data = { actorId: admin.id, action: "RESTORE" as const, pollId, fromStatus: "HIDDEN", toStatus: "ACTIVE", reason: "Çift telafi", undoOfId: hide };
    await assert.rejects(db.moderationAction.create({ data }), "aynı karara ikinci telafi");
    await assert.rejects(db.$executeRaw`UPDATE moderation_actions SET undo_of_id = id WHERE id = ${hide}::uuid`);
    await assert.rejects(db.$executeRaw`UPDATE moderation_actions SET reason = 'değişti' WHERE id = ${hide}::uuid`, /APPEND_ONLY/);
  });

  test("geçmiş: telafi satırı undoOfId, geri alınan karar undone işaretiyle döner (sözleşmeye uygun)", async () => {
    const pollId = await poll();
    const hide = await decide(admin, "polls", pollId, "HIDE");
    const res = await run(admin, hide);
    const compensation = UndoActionResult.parse(res.json().data).actionId;
    const history = await send("GET", `/admin/polls/${pollId}/moderation-history`, undefined, admin.cookie);
    assert.equal(history.statusCode, 200, history.body);
    const items = (history.json().data as unknown[]).map((i) => ContentHistoryItem.parse(i));
    const actions = items.filter((i) => i.kind === "ACTION");
    const original = actions.find((i) => i.id === hide)!;
    const comp = actions.find((i) => i.id === compensation)!;
    assert.equal(original.kind === "ACTION" && original.undone, true);
    assert.equal(original.kind === "ACTION" && original.undoOfId, null);
    assert.equal(comp.kind === "ACTION" && comp.undone, false);
    assert.equal(comp.kind === "ACTION" && comp.undoOfId, hide);
  });
});
