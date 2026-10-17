/**
 * #183 yüksek hacimli toplu moderasyonda ikinci onay (KV-37 §8): eşik ve pencere, talep açma (202, içerik değişmez), başlatandan
 * farklı ADMIN+ + taze MFA step-up ile onay, başlatan adına uygulama, self-approval/step-up/yetki reddi, eski özet (preview_stale),
 * başlatanın yetki kaybı, süre dolumu, bekleyen sınırı, yarışlar, DB kısıtları ve audit.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { BULK_APPROVAL_PENDING_MAX, BULK_APPROVAL_THRESHOLD, BulkApprovalDecision, BulkApprovalDetail, BulkApprovalView, BulkPreview, ErrorBody, actions, getEndpoint, permissionForEndpoint } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createPrismaBulkApprovalStore } from "../src/modules/moderation/bulk-approval.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; password: string; sessionId: string; secret?: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "Spam dalgası temizliği";
const N = BULK_APPROVAL_THRESHOLD;
const MIN = 60_000;

describe("toplu moderasyon ikinci onay (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let author: User;
  let authored = 0;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `bulk-ap-${randomUUID().slice(0, 8)}`, name: "Toplu onay" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
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
    const account = { email: `ba_${id}@example.test`, username: `ba_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    const uid = login.json().data.id as string;
    const session = await db.session.findFirstOrThrow({ where: { userId: uid }, orderBy: { createdAt: "desc" } });
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: uid, password: account.password, sessionId: session.id };
  }
  const totp = (secret: string) => hotp(decodeBase32(secret), Math.floor(h.clock.now.getTime() / 30000));
  async function enroll(user: User) {
    const start = await send("POST", "/me/mfa/setup", { password: user.password }, user.cookie);
    assert.equal(start.statusCode, 200, start.body);
    user.secret = start.json().data.secret as string;
    assert.equal((await send("POST", "/me/mfa/confirm", { code: totp(user.secret) }, user.cookie)).statusCode, 200);
  }
  /** Taze, tek kullanımlık step-up (TOTP tekrarını önlemek için bir adım ilerletilir). */
  async function stepup(user: User) {
    h.clock.advance(30_000);
    assert.equal((await send("POST", "/me/mfa/step-up", { code: totp(user.secret!) }, user.cookie)).statusCode, 200);
  }
  /** Aynı hesapla yeni bir oturum (farklı session id → ayrı step-up). */
  async function login(user: User): Promise<User> {
    const email = (await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } })).email;
    const res = await send("POST", "/auth/login", { email, password: user.password });
    assert.equal(res.statusCode, 200, res.body);
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return { ...user, cookie: sessionCookie(res.headers["set-cookie"] as string), sessionId: session.id };
  }
  const consumedAt = async (user: User) => (await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: user.sessionId } })).consumedAt;
  async function staff(role: "ADMIN" | "MODERATOR", opts: { communityId?: string; mfa?: boolean } = {}): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    if (opts.communityId) {
      await db.$transaction([
        db.communityMembership.create({ data: { communityId: opts.communityId, userId: user.id, role: "MODERATOR" } }),
        db.community.update({ where: { id: opts.communityId }, data: { memberCount: { increment: 1 } } }),
      ]);
    }
    if (opts.mfa) {
      await enroll(user);
      // Kurulum doğrulaması taze bir step-up bırakabilir; testler step-up'ı açıkça verir.
      h.clock.advance(6 * MIN);
    }
    return user;
  }
  const community = () => db.community.create({ data: { slug: `ba-${randomUUID().slice(0, 8)}`, name: "Onay topluluğu", createdById: superAdmin.id } });
  async function poll(communityId?: string) {
    // Günlük gönderi sınırı: yazar belirli sayıda ankette yenilenir.
    if (authored >= 10) {
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
      { kind: "POLL", title: `Onay sorusu ${randomUUID().slice(0, 8)}`, categoryId, ...(communityId ? { communityId } : {}), durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const polls = async (n: number, communityId?: string) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(await poll(communityId));
    return out;
  };

  const preview = (cookie: string, ids: string[], action = "HIDE") => send("GET", `/admin/moderation/polls/bulk/preview?ids=${ids.join(",")}&action=${action}`, undefined, cookie);
  const apply = (cookie: string, ids: string[], digest: string, action = "HIDE") => send("POST", "/admin/moderation/polls/bulk", { ids, action, reason: REASON, digest }, cookie);
  /** Önizleme + uygulama (eşik aşılırsa 202). */
  async function submit(user: User, ids: string[], action = "HIDE") {
    const pv = await preview(user.cookie, ids, action);
    assert.equal(pv.statusCode, 200, pv.body);
    return apply(user.cookie, ids, pv.json().data.digest, action);
  }
  /** Eşiği aşan bir talep açar; talep kimliğini döner. */
  async function request(user: User, ids: string[], action = "HIDE") {
    const res = await submit(user, ids, action);
    assert.equal(res.statusCode, 202, res.body);
    const view = BulkApprovalView.parse(res.json().data);
    assert.equal(view.status, "PENDING");
    return view.id;
  }
  const approve = (cookie: string, id: string, reason = "Kayıtları inceledim") => send("POST", `/admin/moderation/bulk-approvals/${id}/approve`, { reason }, cookie);
  const reject = (cookie: string, id: string, reason = "Kapsam fazla geniş") => send("POST", `/admin/moderation/bulk-approvals/${id}/reject`, { reason }, cookie);
  const cancel = (cookie: string, id: string, reason = "Vazgeçtim") => send("POST", `/admin/moderation/bulk-approvals/${id}/cancel`, { reason }, cookie);
  const statusOf = async (id: string) => (await db.poll.findUniqueOrThrow({ where: { id } })).status;
  const statuses = async (ids: string[]) => Promise.all(ids.map(statusOf));
  const actionsOf = (targetId: string) => db.moderationAction.count({ where: { pollId: targetId } });
  const approvalRow = (id: string) => db.moderationBulkApproval.findUniqueOrThrow({ where: { id } });
  const auditOf = (targetId: string) => db.auditLog.findMany({ where: { targetType: "BULK_APPROVAL", targetId }, orderBy: { createdAt: "asc" } });

  // ─── Eşik ve pencere ────────────────────────────────────────

  test("eşik: eşiğin altında doğrudan uygulanır (200) ve önizleme gerekmediğini söyler", async () => {
    const mod = await staff("ADMIN");
    const ids = await polls(3);
    const pv = await preview(mod.cookie, ids);
    const data = BulkPreview.parse(pv.json().data);
    assert.deepEqual(data.approval, { required: false, threshold: N, windowMinutes: 60, windowApplied: 0 });
    const res = await apply(mod.cookie, ids, data.digest);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(await statuses(ids), ["HIDDEN", "HIDDEN", "HIDDEN"]);
  });

  test("eşik: tam eşikte talep açılır (202), içerik DEĞİŞMEZ, parti açılmaz; talep ve audit kaydı yazılır", async () => {
    const mod = await staff("ADMIN");
    const ids = await polls(N);
    const pv = BulkPreview.parse((await preview(mod.cookie, ids)).json().data);
    assert.equal(pv.approval.required, true);
    const batchesBefore = await db.moderationBatch.count();
    const res = await apply(mod.cookie, ids, pv.digest);
    assert.equal(res.statusCode, 202, res.body);
    const view = BulkApprovalView.parse(res.json().data);
    assert.equal(view.itemCount, N);
    assert.equal(view.initiator.id, mod.id);
    assert.equal(view.decidedBy, null);
    assert.ok(new Date(view.expiresAt).getTime() - new Date(view.createdAt).getTime() === 30 * MIN);
    assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]), "talep içeriği değiştirmez");
    assert.equal(await db.moderationBatch.count(), batchesBefore, "onaydan önce parti yok");
    const row = await approvalRow(view.id);
    assert.equal(row.status, "PENDING");
    assert.deepEqual([...row.ids].sort(), [...ids].sort());
    assert.equal(row.digest, pv.digest);
    const audit = await auditOf(view.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.action, "moderation.bulk.approve", "talep ve onay aynı işlemin türleridir (user.role.assign deseni); onay raporları operation='approve' süzer");
    assert.equal(audit[0]!.operation, "request");
    assert.equal(audit[0]!.actorId, mod.id);
    assert.equal(audit[0]!.reason, REASON);
  });

  test("pencere: son saatte onaysız uygulananlar da sayılır (parçalara bölerek eşik aşılamaz); sonrası temizlenir", async () => {
    const mod = await staff("ADMIN");
    const first = await polls(N - 4);
    assert.equal((await submit(mod, first)).statusCode, 200, "eşiğin altı doğrudan");
    const more = await polls(4);
    const pv = BulkPreview.parse((await preview(mod.cookie, more)).json().data);
    assert.equal(pv.approval.windowApplied, N - 4);
    assert.equal(pv.approval.required, true, "N-4 + 4 = eşik");
    assert.equal((await apply(mod.cookie, more, pv.digest)).statusCode, 202);
    h.clock.advance(61 * MIN);
    const later = await polls(2);
    const after = BulkPreview.parse((await preview(mod.cookie, later)).json().data);
    assert.equal(after.approval.windowApplied, 0, "pencere dışı sayılmaz");
    assert.equal(after.approval.required, false);
  });

  test("pencere: değişecek kayıt yoksa (hepsi zaten o durumda) ikinci onay gerekmez", async () => {
    const mod = await staff("ADMIN");
    const ids = await polls(N);
    // Hepsi zaten gizli: toplu önizleme NO_CHANGE olur.
    await db.poll.updateMany({ where: { id: { in: ids } }, data: { status: "HIDDEN" } });
    const pv = BulkPreview.parse((await preview(mod.cookie, ids)).json().data);
    assert.equal(pv.summary.willChange, 0);
    assert.equal(pv.approval.required, false);
  });

  // ─── Onay ──────────────────────────────────────────────────

  test("onay: başka ADMIN + taze step-up → parti BAŞLATAN adına uygulanır; onaylayan talepte ve audit'te; step-up tüketilir", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    await stepup(approver);
    const res = await approve(approver.cookie, id);
    assert.equal(res.statusCode, 200, res.body);
    const out = BulkApprovalDecision.parse(res.json().data);
    assert.equal(out.approval.status, "APPROVED");
    assert.equal(out.approval.decidedBy?.id, approver.id);
    assert.equal(out.approval.initiator.id, initiator.id);
    assert.equal(out.result.summary.applied, N);
    assert.deepEqual(new Set(await statuses(ids)), new Set(["HIDDEN"]));

    const batch = await db.moderationBatch.findUniqueOrThrow({ where: { id: out.result.batchId } });
    assert.equal(batch.actorId, initiator.id, "parti başlatan adına");
    assert.equal(batch.reason, REASON);
    assert.ok(batch.finishedAt);
    const actions = await db.moderationAction.findMany({ where: { pollId: { in: ids } } });
    assert.equal(actions.length, N);
    assert.ok(actions.every((a) => a.actorId === initiator.id), "karar aktörü başlatan");
    const row = await approvalRow(id);
    assert.equal(row.batchId, batch.id);
    assert.equal(row.decidedById, approver.id);
    const audit = await auditOf(id);
    assert.deepEqual(audit.map((a) => `${a.operation}:${a.actorId}`).sort(), [`approve:${approver.id}`, `request:${initiator.id}`].sort());
    assert.equal((await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: approver.sessionId } })).consumedAt !== null, true, "step-up tüketildi");

    // Onaylanan parti sonraki pencereye sayılmaz ve sonradan tekrar onaylanamaz.
    assertError(await approve(approver.cookie, id), 409, "CONFLICT", "closed");
    const small = BulkPreview.parse((await preview(initiator.cookie, await polls(2))).json().data);
    assert.equal(small.approval.windowApplied, 0, "ikinci onaydan geçen parti pencereye girmez");
  });

  test("onay: başlatan kendi talebini onaylayamaz (self_approval) ve step-up'ı HARCANMAZ; talep açık kalır", async () => {
    const initiator = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    await stepup(initiator);
    assertError(await approve(initiator.cookie, id), 403, "FORBIDDEN", "self_approval");
    assertError(await reject(initiator.cookie, id), 403, "FORBIDDEN", "self_approval");
    assert.equal((await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: initiator.sessionId } })).consumedAt, null);
    assert.equal((await approvalRow(id)).status, "PENDING");
    assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]));
  });

  test("onay: taze step-up yoksa 403 stepup_required, hiçbir şey uygulanmaz; step-up verilince aynı talep onaylanır", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    assertError(await approve(approver.cookie, id), 403, "FORBIDDEN", "stepup_required");
    assert.equal((await approvalRow(id)).status, "PENDING");
    assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]));
    // MFA'sı hiç kurulmamış ADMIN da onaylayamaz.
    const noMfa = await staff("ADMIN");
    assertError(await approve(noMfa.cookie, id), 403, "FORBIDDEN", "stepup_required");
    await stepup(approver);
    assert.equal((await approve(approver.cookie, id)).statusCode, 200);
  });

  test("onay: step-up tek kullanımlık — bir onay tüketir, ikinci talep yeniden step-up ister", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const first = await request(initiator, await polls(N));
    const second = await request(initiator, await polls(N));
    await stepup(approver);
    assert.equal((await approve(approver.cookie, first)).statusCode, 200);
    assertError(await approve(approver.cookie, second), 403, "FORBIDDEN", "stepup_required");
    assert.equal((await approvalRow(second)).status, "PENDING");
  });

  test("yetki: moderatör ve kullanıcı onaylayamaz/reddedemez; misafir 401", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", { communityId: c.id, mfa: true });
    const ids = await polls(N, c.id);
    const id = await request(mod, ids);
    await stepup(mod);
    assertError(await approve(mod.cookie, id), 403, "FORBIDDEN");
    assertError(await reject(mod.cookie, id), 403, "FORBIDDEN");
    assertError(await approve(author.cookie, id), 403, "FORBIDDEN");
    assertError(await approve(undefined as unknown as string, id), 401, "UNAUTHENTICATED");
    assert.equal((await approvalRow(id)).status, "PENDING");
  });

  test("kapsam: moderatör kendi topluluğunda talep açar; onay başlatanın yetkisiyle hesaplanır, kapsam dışı kayıt asla uygulanmaz", async () => {
    const own = await community();
    const other = await community();
    const mod = await staff("MODERATOR", { communityId: own.id });
    const approver = await staff("ADMIN", { mfa: true });
    const mine = await polls(N, own.id);
    const foreign = await polls(2, other.id);
    const all = [...mine, ...foreign];
    const id = await request(mod, all);
    const detail = BulkApprovalDetail.parse((await send("GET", `/admin/moderation/bulk-approvals/${id}`, undefined, approver.cookie)).json().data);
    assert.equal(detail.stale, false);
    assert.equal(detail.items.filter((i) => i.outcome === "WILL_CHANGE").length, N);
    assert.deepEqual(detail.items.filter((i) => i.blocked === "forbidden").map((i) => i.label), [null, null], "kapsam dışı kaydın içeriği yok");
    await stepup(approver);
    const res = await approve(approver.cookie, id);
    assert.equal(res.statusCode, 200, res.body);
    const out = BulkApprovalDecision.parse(res.json().data);
    assert.equal(out.result.summary.applied, N);
    assert.equal(out.result.summary.failed, 2);
    assert.deepEqual(new Set(await statuses(foreign)), new Set(["ACTIVE"]), "ADMIN onaylasa da başlatanın kapsamı aşılmaz");
    assert.deepEqual(new Set(await statuses(mine)), new Set(["HIDDEN"]));
  });

  // ─── Eski özet, başlatan değişimi, süre ─────────────────────

  test("eski özet: talepten sonra kayıt değişirse onay 409 preview_stale; hiçbir şey uygulanmaz ve step-up harcanmaz", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    await db.poll.update({ where: { id: ids[0]! }, data: { status: "LOCKED" } });
    const detail = BulkApprovalDetail.parse((await send("GET", `/admin/moderation/bulk-approvals/${id}`, undefined, approver.cookie)).json().data);
    assert.equal(detail.stale, true);
    await stepup(approver);
    assertError(await approve(approver.cookie, id), 409, "CONFLICT", "preview_stale");
    assert.equal((await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: approver.sessionId } })).consumedAt, null);
    assert.equal((await approvalRow(id)).status, "PENDING");
    assert.equal(await db.moderationAction.count({ where: { pollId: { in: ids } } }), 0);
    assert.equal((await reject(approver.cookie, id)).statusCode, 200, "eski talep reddedilebilir");
  });

  test("başlatan değişti: rolü alınan başlatanın talebi onaylanmaz (initiator_changed); kapsamı daralan başlatanınki de (preview_stale)", async () => {
    const approver = await staff("ADMIN", { mfa: true });
    const demoted = await staff("ADMIN");
    const id1 = await request(demoted, await polls(N));
    await db.userRole.delete({ where: { userId: demoted.id } });
    await stepup(approver);
    assertError(await approve(approver.cookie, id1), 409, "CONFLICT", "initiator_changed");
    assert.equal((await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: approver.sessionId } })).consumedAt, null);

    const c = await community();
    const mod = await staff("MODERATOR", { communityId: c.id });
    const ids = await polls(N, c.id);
    const id2 = await request(mod, ids);
    await db.communityMembership.delete({ where: { communityId_userId: { communityId: c.id, userId: mod.id } } });
    assertError(await approve(approver.cookie, id2), 409, "CONFLICT", "preview_stale");
    assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]), "kapsamı kalmayan başlatanın kararı onaylayanın yetkisine yükselmez");

    const banned = await staff("ADMIN");
    const id3 = await request(banned, await polls(N));
    await db.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    assertError(await approve(approver.cookie, id3), 409, "CONFLICT", "initiator_changed");
  });

  test("süre: 30 dakika sonra talep EXPIRED sayılır, onaylanamaz/reddedilemez/geri çekilemez; liste süzgeci ve bekleyen sınırı bunu bilir", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const id = await request(initiator, await polls(N));
    h.clock.advance(31 * MIN);
    await stepup(approver);
    assertError(await approve(approver.cookie, id), 409, "CONFLICT", "closed");
    assertError(await reject(approver.cookie, id), 409, "CONFLICT", "closed");
    assertError(await cancel(initiator.cookie, id), 409, "CONFLICT", "closed");
    const row = await approvalRow(id);
    assert.equal(row.status, "PENDING", "kayıt değişmez; okunurken EXPIRED");
    const ids = (list: Res) => list.json().data.map((a: any) => a.id as string);
    const expired = await send("GET", "/admin/moderation/bulk-approvals?status=EXPIRED&limit=100", undefined, initiator.cookie);
    assert.ok(expired.json().data.some((a: any) => a.id === id && a.status === "EXPIRED"));
    assert.ok(expired.json().data.every((a: any) => a.status === "EXPIRED"), "süzgeç yalnız süresi dolanları getirir");
    const pending = await send("GET", "/admin/moderation/bulk-approvals?status=PENDING&limit=100", undefined, initiator.cookie);
    assert.equal(ids(pending).includes(id), false);
    assert.equal((await send("GET", `/admin/moderation/bulk-approvals/${id}`, undefined, initiator.cookie)).json().data.status, "EXPIRED");
  });

  test("bekleyen sınırı: başlatan başına en çok 3 açık talep; dördüncüsü 409 too_many_pending; geri çekince yer açılır; süresi dolan sayılmaz", async () => {
    const initiator = await staff("ADMIN");
    const made: string[] = [];
    for (let i = 0; i < BULK_APPROVAL_PENDING_MAX; i++) made.push(await request(initiator, await polls(N)));
    const ids = await polls(N);
    assertError(await submit(initiator, ids), 409, "CONFLICT", "too_many_pending");
    assert.equal((await cancel(initiator.cookie, made[0]!)).statusCode, 200);
    const again = await submit(initiator, ids);
    assert.equal(again.statusCode, 202, again.body);
    h.clock.advance(31 * MIN);
    assert.equal((await submit(initiator, await polls(N))).statusCode, 202, "süresi dolanlar sınırı doldurmaz");
  });

  // ─── Reddetme, geri çekme, görünürlük ───────────────────────

  test("ret ve geri çekme: ADMIN başka birinin talebini reddeder, başlatan kendi talebini geri çeker; içerik değişmez; audit yazılır", async () => {
    const mod = await staff("ADMIN");
    const other = await staff("ADMIN");
    const ids = await polls(N);
    const rejected = await request(mod, ids);
    const res = await reject(other.cookie, rejected, "Kapsam fazla geniş");
    assert.equal(res.statusCode, 200, res.body);
    const view = BulkApprovalView.parse(res.json().data);
    assert.equal(view.status, "REJECTED");
    assert.equal(view.decidedBy?.id, other.id);
    assert.equal(view.decisionReason, "Kapsam fazla geniş");
    const canceled = await request(mod, await polls(N));
    const c = await cancel(mod.cookie, canceled, "Vazgeçtim");
    assert.equal(BulkApprovalView.parse(c.json().data).status, "CANCELED");
    assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]));
    // Aynı saat damgasında sıra belirsiz olabilir: kayıtlar kümece karşılaştırılır.
    const trail = async (target: string) => (await auditOf(target)).map((a) => `${a.action}:${a.operation}:${a.actorId}`).sort();
    assert.deepEqual(await trail(rejected), [`moderation.bulk.approve:reject:${other.id}`, `moderation.bulk.approve:request:${mod.id}`].sort());
    assert.deepEqual(await trail(canceled), [`moderation.bulk.approve:request:${mod.id}`, `moderation.bulk.cancel:cancel:${mod.id}`].sort());
    // Kapalı talep tekrar sonuçlanmaz.
    assertError(await reject(other.cookie, rejected), 409, "CONFLICT", "closed");
    assertError(await cancel(mod.cookie, canceled), 409, "CONFLICT", "closed");
  });

  test("geri çekme yalnız başlatan: başkasının talebi 404 (varlığı gizli); olmayan talep 404", async () => {
    const a = await staff("ADMIN");
    const b = await staff("ADMIN");
    const id = await request(a, await polls(N));
    assertError(await cancel(b.cookie, id), 404, "NOT_FOUND");
    assertError(await cancel(a.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await reject(b.cookie, randomUUID()), 404, "NOT_FOUND");
    assert.equal((await approvalRow(id)).status, "PENDING");
  });

  test("liste ve ayrıntı: moderatör yalnız kendi taleplerini görür, başkasınınki 404; ADMIN hepsini; imleç süzgece bağlı", async () => {
    const c = await community();
    const mod1 = await staff("MODERATOR", { communityId: c.id });
    const mod2 = await staff("MODERATOR", { communityId: c.id });
    const admin = await staff("ADMIN");
    const id1 = await request(mod1, await polls(N, c.id));
    const id2 = await request(mod2, await polls(N, c.id));
    const mine = await send("GET", "/admin/moderation/bulk-approvals", undefined, mod1.cookie);
    assert.equal(mine.statusCode, 200, mine.body);
    assert.deepEqual(mine.json().data.map((a: any) => a.id), [id1]);
    assertError(await send("GET", `/admin/moderation/bulk-approvals/${id2}`, undefined, mod1.cookie), 404, "NOT_FOUND");
    assert.equal((await send("GET", `/admin/moderation/bulk-approvals/${id1}`, undefined, mod1.cookie)).statusCode, 200);
    const all = await send("GET", `/admin/moderation/bulk-approvals?limit=1`, undefined, admin.cookie);
    assert.equal(all.json().data.length, 1);
    assert.equal(all.json().page.hasMore, true);
    const cursor = all.json().page.nextCursor as string;
    assert.equal((await send("GET", `/admin/moderation/bulk-approvals?limit=1&cursor=${encodeURIComponent(cursor)}`, undefined, admin.cookie)).statusCode, 200);
    assertError(await send("GET", `/admin/moderation/bulk-approvals?limit=1&status=APPROVED&cursor=${encodeURIComponent(cursor)}`, undefined, admin.cookie), 400, "INVALID_CURSOR");
    assert.equal((await send("GET", "/admin/moderation/bulk-approvals", undefined, author.cookie)).statusCode, 403);
  });

  // ─── Yarışlar ve veritabanı kısıtları ───────────────────────

  test("yarış: iki onaycı aynı anda onaylar — biri 200, diğeri 409 closed; her kayıt tam bir kez uygulanır; yalnız kazananın step-up'ı tüketilir", async () => {
    const initiator = await staff("ADMIN");
    const x = await staff("ADMIN", { mfa: true });
    const y = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    await stepup(x);
    await stepup(y);
    const [rx, ry] = await Promise.all([approve(x.cookie, id), approve(y.cookie, id)]);
    const codes = [rx.statusCode, ry.statusCode].sort();
    assert.deepEqual(codes, [200, 409], rx.body + ry.body);
    for (const pid of ids) assert.equal(await actionsOf(pid), 1, "tek karar kaydı");
    assert.equal(await db.moderationBatch.count({ where: { actorId: initiator.id, approval: { isNot: null } } }), 1);
    const loser = rx.statusCode === 409 ? y : x;
    void loser;
    const consumed = await Promise.all([x, y].map(async (u) => (await db.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: u.sessionId } })).consumedAt !== null));
    assert.equal(consumed.filter(Boolean).length, 1, "kaybeden onaycının step-up'ı harcanmaz");
  });

  test("yarış: eşzamanlı onay ve geri çekme — tek sonuç (ya uygulanır ya geri çekilir), asla ikisi birden", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const ids = await polls(N);
    const id = await request(initiator, ids);
    await stepup(approver);
    const [ra, rc] = await Promise.all([approve(approver.cookie, id), cancel(initiator.cookie, id)]);
    const row = await approvalRow(id);
    if (row.status === "APPROVED") {
      assert.equal(ra.statusCode, 200);
      assert.equal(rc.statusCode, 409);
      assert.deepEqual(new Set(await statuses(ids)), new Set(["HIDDEN"]));
    } else {
      assert.equal(row.status, "CANCELED");
      assert.equal(rc.statusCode, 200);
      assert.equal(ra.statusCode, 409);
      assert.deepEqual(new Set(await statuses(ids)), new Set(["ACTIVE"]));
    }
  });

  test("veritabanı: başlatan kendi talebini APPROVED/REJECTED yapamaz, geri çekmeyi başkası yapamaz, parti yalnız onaylı talepte; karar alanları tutarlı", async () => {
    const initiator = await staff("ADMIN");
    const other = await staff("ADMIN");
    const id = await request(initiator, await polls(N));
    const set = (data: Record<string, unknown>) => db.moderationBulkApproval.update({ where: { id }, data: data as never });
    await assert.rejects(set({ status: "APPROVED", decidedById: initiator.id, decidedAt: new Date(), decisionReason: "Kendi kendime", batchId: null }));
    await assert.rejects(set({ status: "REJECTED", decidedById: initiator.id, decidedAt: new Date(), decisionReason: "Kendi kendime" }));
    await assert.rejects(set({ status: "CANCELED", decidedById: other.id, decidedAt: new Date(), decisionReason: "Başkası geri çekti" }));
    await assert.rejects(set({ status: "REJECTED", decidedById: other.id, decidedAt: new Date(), decisionReason: "x" }), "gerekçe en az 3 karakter");
    await assert.rejects(set({ status: "REJECTED", decidedById: other.id, decidedAt: null, decisionReason: "Gerekçeli ret" }), "karar zamanı zorunlu");
    await assert.rejects(set({ status: "APPROVED", decidedById: other.id, decidedAt: new Date(), decisionReason: "Onay", batchId: null }), "onaylı talepte parti zorunlu");
    assert.equal((await approvalRow(id)).status, "PENDING");
  });

  // ─── İnceleme düzeltmeleri (PR #252) ────────────────────────

  test("eşik paralel isteklerle aşılamaz: 19'ar kayıtlık iki eşzamanlı istekten biri uygulanır (200), diğeri onaya düşer (202)", async () => {
    const racer = await staff("ADMIN");
    const a = await polls(N - 1);
    const b = await polls(N - 1);
    const pa = BulkPreview.parse((await preview(racer.cookie, a)).json().data);
    const pb = BulkPreview.parse((await preview(racer.cookie, b)).json().data);
    assert.equal(pa.approval.required, false);
    assert.equal(pb.approval.required, false, "ikisi de tek başına eşiğin altında");
    const [x, y] = await Promise.all([apply(racer.cookie, a, pa.digest), apply(racer.cookie, b, pb.digest)]);
    assert.deepEqual([x.statusCode, y.statusCode].sort(), [200, 202], x.body + y.body);
    const applied = x.statusCode === 200 ? a : b;
    const held = x.statusCode === 200 ? b : a;
    assert.deepEqual(new Set(await statuses(applied)), new Set(["HIDDEN"]));
    assert.deepEqual(new Set(await statuses(held)), new Set(["ACTIVE"]), "onaya düşen talep içeriği değiştirmez");
  });

  test("yarıda kalan (bitmemiş) parti rezerve ettiği sayıyla pencerede kalır: çökmüş 19 kayıtlık parti sonrası 1 kayıt bile onaya düşer", async () => {
    const racer = await staff("ADMIN");
    // Çökmüş parti: açıldı, finishBatch hiç yazılmadı (applied 0, reserved 19).
    await db.moderationBatch.create({ data: { actorId: racer.id, kind: "POLLS", action: "HIDE", reason: REASON, digest: "b".repeat(64), total: N - 1, reserved: N - 1, createdAt: h.clock.now } });
    const one = await polls(1);
    const pv = BulkPreview.parse((await preview(racer.cookie, one)).json().data);
    assert.equal(pv.approval.windowApplied, N - 1);
    assert.equal(pv.approval.required, true);
    assert.equal((await apply(racer.cookie, one, pv.digest)).statusCode, 202);
    // Bitmiş partide yalnız gerçekten uygulanan sayılır (rezervasyon uygulanan sayıya iner).
    const other = await staff("ADMIN");
    const batch = await db.moderationBatch.create({ data: { actorId: other.id, kind: "POLLS", action: "HIDE", reason: REASON, digest: "c".repeat(64), total: N - 1, reserved: N - 1, createdAt: h.clock.now } });
    await db.moderationBatch.update({ where: { id: batch.id }, data: { applied: 2, unchanged: N - 3, finishedAt: h.clock.now } });
    const two = BulkPreview.parse((await preview(other.cookie, await polls(1))).json().data);
    assert.equal(two.approval.windowApplied, 2);
    assert.equal(two.approval.required, false);
  });

  test("onay transaction'ı başlatanın yetkisini yeniden doğrular (route ön kontrolünü atlasa bile): rol, hesap, atama, yönetici gereksinimi, aktif yaptırım; step-up harcanmaz", async () => {
    const store = createPrismaBulkApprovalStore(db);
    const approver = await staff("ADMIN", { mfa: true });
    const tryApprove = async (id: string) => {
      await stepup(approver);
      const result = await store.approve({ approvalId: id, approverId: approver.id, sessionId: approver.sessionId, reason: "Kayıtları inceledim", requestId: randomUUID(), now: h.clock.now });
      if (result.kind === "ok") assert.notEqual(await consumedAt(approver), null, "başarılı onay step-up'ı harcar");
      else assert.equal(await consumedAt(approver), null, "reddedilen onay step-up'ı harcamaz");
      return result;
    };

    // a) rolü alındı
    const demoted = await staff("ADMIN");
    const a = await request(demoted, await polls(N));
    await db.userRole.delete({ where: { userId: demoted.id } });
    assert.deepEqual(await tryApprove(a), { kind: "rejected", reason: "initiator_changed" });

    // b) hesap banlandı
    const banned = await staff("ADMIN");
    const b = await request(banned, await polls(N));
    await db.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    assert.deepEqual(await tryApprove(b), { kind: "rejected", reason: "initiator_changed" });

    // c) moderatörün topluluk ataması kaldırıldı
    const c1 = await community();
    const mod = await staff("MODERATOR", { communityId: c1.id });
    const c = await request(mod, await polls(N, c1.id));
    await db.communityMembership.delete({ where: { communityId_userId: { communityId: c1.id, userId: mod.id } } });
    assert.deepEqual(await tryApprove(c), { kind: "rejected", reason: "initiator_changed" });

    // d) yönetici topluluksuz içerik için talep açtı, sonra moderatöre düşürüldü (topluluksuz içerik yönetici ister)
    const downgraded = await staff("ADMIN");
    const d = await request(downgraded, await polls(N));
    assert.equal((await approvalRow(d)).needsAdmin, true);
    await db.userRole.update({ where: { userId: downgraded.id }, data: { role: "MODERATOR" } });
    assert.deepEqual(await tryApprove(d), { kind: "rejected", reason: "initiator_changed" });

    // e) başlatanda aktif BAN yaptırımı (users.status senkronu olmasa bile)
    const sanctioned = await staff("ADMIN");
    const e = await request(sanctioned, await polls(N));
    await db.sanction.create({ data: { userId: sanctioned.id, type: "BAN", reason: "Test yaptırımı", createdById: superAdmin.id } });
    assert.deepEqual(await tryApprove(e), { kind: "rejected", reason: "initiator_changed" });

    // f) yetkisi sürenler onaylanır: topluluk ataması duran moderatör
    const c2 = await community();
    const ok = await staff("MODERATOR", { communityId: c2.id });
    const f1 = await request(ok, await polls(N, c2.id));
    const approved = await tryApprove(f1);
    assert.equal(approved.kind, "ok");
    if (approved.kind === "ok") assert.equal(approved.initiatorIsAdmin, false);
    for (const id of [a, b, c, d, e]) assert.equal((await approvalRow(id)).status, "PENDING");
  });

  test("onaylayanda aktif askı/ban yaptırımı varsa onay reddedilir (403), step-up harcanmaz", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const id = await request(initiator, await polls(N));
    await db.sanction.create({ data: { userId: approver.id, type: "BAN", reason: "Test yaptırımı", createdById: superAdmin.id } });
    await stepup(approver);
    const res = await approve(approver.cookie, id);
    assert.ok([401, 403].includes(res.statusCode), res.body);
    assert.equal((await approvalRow(id)).status, "PENDING");
  });

  test("step-up: süresi (5 dk) dolmuş doğrulama ve başka oturumun doğrulaması kabul edilmez", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const id = await request(initiator, await polls(N));
    await stepup(approver);
    h.clock.advance(5 * MIN + 1_000);
    assertError(await approve(approver.cookie, id), 403, "FORBIDDEN", "stepup_required");
    // Başka oturumda yapılan doğrulama bu oturuma geçmez.
    const second = await login(approver);
    await stepup(second);
    assertError(await approve(approver.cookie, id), 403, "FORBIDDEN", "stepup_required");
    assert.equal((await approve(second.cookie, id)).statusCode, 200, "doğrulamanın yapıldığı oturum onaylar");
  });

  test("worker ile kalıcı EXPIRED olan talep: liste EXPIRED gösterir, onay/ret/geri çekme 409 closed, bekleyen sınırını doldurmaz", async () => {
    const initiator = await staff("ADMIN");
    const approver = await staff("ADMIN", { mfa: true });
    const id = await request(initiator, await polls(N));
    await db.moderationBulkApproval.update({ where: { id }, data: { status: "EXPIRED", decidedAt: h.clock.now } });
    await stepup(approver);
    assertError(await approve(approver.cookie, id), 409, "CONFLICT", "closed");
    assertError(await reject(approver.cookie, id), 409, "CONFLICT", "closed");
    assertError(await cancel(initiator.cookie, id), 409, "CONFLICT", "closed");
    const expired = await send("GET", "/admin/moderation/bulk-approvals?status=EXPIRED&limit=100", undefined, initiator.cookie);
    assert.ok(expired.json().data.some((a: any) => a.id === id && a.status === "EXPIRED"));
    const view = BulkApprovalDetail.parse((await send("GET", `/admin/moderation/bulk-approvals/${id}`, undefined, initiator.cookie)).json().data);
    assert.equal(view.status, "EXPIRED");
    for (let i = 0; i < BULK_APPROVAL_PENDING_MAX; i++) await request(initiator, await polls(N));
  });

  test("yetki seviyesi sabit: onay ve ret ADMIN+, geri çekme moderatör; endpoint.auth ile işlem kuralı birlikte düşürülemez", () => {
    for (const id of ["admin.moderation.bulkApprovals.approve", "admin.moderation.bulkApprovals.reject"]) {
      assert.equal(getEndpoint(id).auth, "admin", id);
      assert.equal(permissionForEndpoint(id), "moderation.bulk.approve", id);
    }
    assert.equal(actions["moderation.bulk.approve"].level, "admin");
    assert.equal(getEndpoint("admin.moderation.bulkApprovals.cancel").auth, "moderator");
    assert.equal(actions["moderation.bulk.cancel"].level, "moderator");
  });

  test("kapsamı (topluluk ataması) kaldırılan moderatör kendi talebini listeleyemez ama geri çekebilir (bilinçli: bekleyen talebi kapatabilmeli)", async () => {
    const c = await community();
    const mod = await staff("MODERATOR", { communityId: c.id });
    const id = await request(mod, await polls(N, c.id));
    await db.communityMembership.delete({ where: { communityId_userId: { communityId: c.id, userId: mod.id } } });
    assertError(await send("GET", "/admin/moderation/bulk-approvals", undefined, mod.cookie), 403, "FORBIDDEN");
    const res = await cancel(mod.cookie, id);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await approvalRow(id)).status, "CANCELED");
  });
});
