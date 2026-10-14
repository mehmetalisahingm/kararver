/**
 * #181 kullanıcıya ait içeriğin toplu gizlenmesi/kaldırılması: önizleme → gerekçe → ayrı onay → kuyruk (çalıştırıcı) → geri alma.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Çalıştırıcı API testinde doğrudan çağrılır. audit_logs
 * append-only ve test DB'si dosyalar arasında sıfırlanmaz: sorgular her testin yeni kullanıcısına göre yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ContentJob, ContentJobPreview, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { MAX_ITEMS, PREVIEW_TTL_MS } from "../src/modules/content-jobs/routes.ts";
import { CHUNK, runContentJobs, type RunnerDeps } from "../src/modules/content-jobs/runner.ts";
import { createPrismaModerationStore } from "../src/modules/moderation/prisma-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const REASON = "Spam hesabı: tüm içerik gizlensin";

describe("kullanıcı içeriğinin toplu gizlenmesi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let moderator: User;
  let categoryId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `cj-${randomUUID().slice(0, 8)}`, name: "CJ" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: superAdmin.id } });
    moderator = await signUp();
    await db.userRole.create({ data: { userId: moderator.id, role: "MODERATOR", grantedById: superAdmin.id } });
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
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
    const account = { email: `cj_${id}@example.test`, username: `cj_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username, email: account.email };
  }

  const base = (id: string) => `/admin/users/${id}/content-jobs`;
  const preview = (id: string, action = "HIDE", scope = "all", cookie = admin.cookie) => send("GET", `${base(id)}/preview?action=${action}&scope=${scope}`, undefined, cookie);
  const create = (id: string, body: Record<string, unknown>, cookie = admin.cookie) => send("POST", base(id), { reason: REASON, ...body }, cookie);
  const list = (id: string, cookie = admin.cookie) => send("GET", base(id), undefined, cookie);
  const undo = (id: string, jobId: string, cookie = admin.cookie) => send("POST", `${base(id)}/${jobId}/undo`, { reason: "Hesap yanlışlıkla işaretlenmişti" }, cookie);
  const cancel = (id: string, jobId: string, cookie = admin.cookie) => send("POST", `${base(id)}/${jobId}/cancel`, { reason: "Yanlış hesap seçilmiş" }, cookie);

  const runnerDeps = (overrides: Partial<RunnerDeps> = {}): RunnerDeps => ({
    prisma: db,
    moderation: createPrismaModerationStore(db),
    now: () => h.clock.now,
    log: () => {},
    ...overrides,
  });
  async function drain(overrides: Partial<RunnerDeps> = {}) {
    for (let i = 0; i < 20; i++) if ((await runContentJobs(runnerDeps(overrides))).jobs === 0) return;
    throw new Error("çalıştırıcı bitmedi");
  }

  const past = (ms = HOUR) => new Date(h.clock.now.getTime() - ms);
  const pollData = (authorId: string, title: string, extra: Record<string, unknown> = {}) => ({
    authorId,
    categoryId,
    publicId: randomUUID().replaceAll("-", "").slice(0, 12),
    slug: "cj",
    title,
    closesAt: new Date("2031-01-01T00:00:00Z"),
    createdAt: past(),
    options: { create: [{ position: 0, label: "A" }, { position: 1, label: "B" }] },
    ...extra,
  });

  /** Hedef kullanıcı: 2 anket (ACTIVE) + kendi ve başkasının anketinde yorumlar; ve başkasına ait içerik. */
  async function seed(comments = 3) {
    const user = await signUp();
    const other = await signUp();
    const p1 = await db.poll.create({ data: pollData(user.id, "Hedef anket 1"), select: { id: true } });
    const p2 = await db.poll.create({ data: pollData(user.id, "Hedef anket 2"), select: { id: true } });
    const op = await db.poll.create({ data: pollData(other.id, "Başkasının anketi"), select: { id: true } });
    const own: string[] = [];
    for (let i = 0; i < comments; i++) {
      own.push((await db.comment.create({ data: { pollId: i % 2 ? p1.id : op.id, authorId: user.id, body: `kendi yorum ${i}`, createdAt: past() }, select: { id: true } })).id);
    }
    const foreign = await db.comment.create({ data: { pollId: p1.id, authorId: other.id, body: "BASKASININ-YORUMU", createdAt: past() }, select: { id: true } });
    const foreignPoll = op.id;
    // Sayaçlar yalnız ACTIVE yorumu sayar (KV-17); doğrudan eklenen satırlar için elle eşitlenir.
    for (const pollId of [p1.id, op.id]) {
      await db.poll.update({ where: { id: pollId }, data: { commentCount: await db.comment.count({ where: { pollId, status: "ACTIVE" } }) } });
    }
    return { user, other, polls: [p1.id, p2.id], foreignPoll, own, foreignComment: foreign.id, sharedPoll: p1.id };
  }

  const statusOf = async (kind: "poll" | "comment", id: string) =>
    (kind === "poll" ? (await db.poll.findUniqueOrThrow({ where: { id }, select: { status: true } })) : (await db.comment.findUniqueOrThrow({ where: { id }, select: { status: true } }))).status;
  const auditOf = (userId: string, operation: string) =>
    db.auditLog.findMany({ where: { action: "user.content.bulk", operation, targetType: "USER", targetId: userId }, orderBy: { createdAt: "asc" } });

  /** Önizle + onayla; yanıtı döner. */
  async function confirm(userId: string, action = "HIDE", scope = "all", cookie = admin.cookie) {
    const p = await preview(userId, action, scope, cookie);
    assert.equal(p.statusCode, 200, p.body);
    const data = ContentJobPreview.parse(p.json().data);
    return create(userId, { action, scope, cutoffAt: data.cutoffAt, expected: data.affected }, cookie);
  }

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve moderatör 403; ADMIN kendine ve admin hedefe 403, SUPER_ADMIN admin hedefe izin; olmayan hesap 404 (beş endpoint)", async () => {
    const { user } = await seed(1);
    const peerAdmin = await signUp();
    await db.userRole.create({ data: { userId: peerAdmin.id, role: "ADMIN", grantedById: superAdmin.id } });
    const fake = randomUUID();
    const calls: ((id: string, cookie: string) => Promise<Res>)[] = [
      (id, c) => preview(id, "HIDE", "all", c),
      (id, c) => create(id, { action: "HIDE", scope: "all", cutoffAt: h.clock.now.toISOString(), expected: { polls: 0, comments: 0 } }, c),
      (id, c) => list(id, c),
      (id, c) => undo(id, fake, c),
      (id, c) => cancel(id, fake, c),
    ];
    for (const call of calls) {
      assertError(await call(user.id, ""), 401, "UNAUTHENTICATED");
      assertError(await call(user.id, user.cookie), 403, "FORBIDDEN");
      assertError(await call(user.id, moderator.cookie), 403, "FORBIDDEN");
      assertError(await call(admin.id, admin.cookie), 403, "FORBIDDEN");
      assertError(await call(peerAdmin.id, admin.cookie), 403, "FORBIDDEN");
    }
    assert.equal((await preview(peerAdmin.id, "HIDE", "all", superAdmin.cookie)).statusCode, 200);
    assert.equal((await list(peerAdmin.id, superAdmin.cookie)).statusCode, 200);
    assertError(await preview(randomUUID()), 404, "NOT_FOUND");
    assertError(await list(randomUUID()), 404, "NOT_FOUND");
    assert.equal(await db.contentJob.count({ where: { userId: { in: [user.id, peerAdmin.id] } } }), 0);
  });

  // ─── Önizleme ───────────────────────────────────────────────

  test("önizleme: yalnız uygun içeriği sayar (HIDE: ACTIVE; REMOVE: REMOVED hariç hepsi), kapsam ve cutoff'u uygular, başkasının içeriğini saymaz; salt okuma", async () => {
    const s = await seed(4);
    // Durum çeşitliliği: bir anket HIDDEN, bir yorum REMOVED, bir yorum LOCKED değil (yorumda kilit yok) → HIDDEN.
    await db.poll.update({ where: { id: s.polls[1]! }, data: { status: "HIDDEN" } });
    await db.comment.update({ where: { id: s.own[0]! }, data: { status: "REMOVED", deletedAt: past() } });
    await db.comment.update({ where: { id: s.own[1]! }, data: { status: "HIDDEN" } });
    // cutoff'tan sonra yazılan içerik sayılmaz.
    await db.comment.create({ data: { pollId: s.polls[0]!, authorId: s.user.id, body: "gelecek", createdAt: new Date(h.clock.now.getTime() + HOUR) } });

    const hide = ContentJobPreview.parse((await preview(s.user.id, "HIDE", "all")).json().data);
    assert.deepEqual(hide.affected, { polls: 1, comments: 2 }, "HIDE yalnız ACTIVE");
    assert.equal(hide.total, 3);
    assert.equal(hide.maxItems, MAX_ITEMS);
    const remove = ContentJobPreview.parse((await preview(s.user.id, "REMOVE", "all")).json().data);
    assert.deepEqual(remove.affected, { polls: 2, comments: 3 }, "REMOVE: REMOVED hariç hepsi");
    assert.deepEqual(ContentJobPreview.parse((await preview(s.user.id, "REMOVE", "polls")).json().data).affected, { polls: 2, comments: 0 });
    assert.deepEqual(ContentJobPreview.parse((await preview(s.user.id, "REMOVE", "comments")).json().data).affected, { polls: 0, comments: 3 });

    assert.equal(await db.contentJob.count({ where: { userId: s.user.id } }), 0, "önizleme iş açmaz");
    assert.equal((await auditOf(s.user.id, "request")).length, 0);
    assertError(await send("GET", `${base(s.user.id)}/preview?action=LOCK`, undefined, admin.cookie), 400, "VALIDATION_ERROR");
  });

  // ─── Ayrı onay ──────────────────────────────────────────────

  test("onay: gerekçe zorunlu; eski/değişmiş önizleme 409 preview_expired|preview_stale; uygun içerik yoksa nothing_to_do; hiçbirinde iş/audit yok", async () => {
    const s = await seed(2);
    const p = ContentJobPreview.parse((await preview(s.user.id)).json().data);
    const body = { action: "HIDE", scope: "all", cutoffAt: p.cutoffAt, expected: p.affected };
    assertError(await send("POST", base(s.user.id), body, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("POST", base(s.user.id), { ...body, reason: "ab" }, admin.cookie), 400, "VALIDATION_ERROR");

    // Önizleme ile onay arasında içerik değişir → sayılar farklı.
    await db.comment.update({ where: { id: s.own[0]! }, data: { status: "HIDDEN" } });
    assertError(await create(s.user.id, body), 409, "CONFLICT", "preview_stale");
    await db.comment.update({ where: { id: s.own[0]! }, data: { status: "ACTIVE" } });

    h.clock.advance(PREVIEW_TTL_MS + MINUTE);
    assertError(await create(s.user.id, body), 409, "CONFLICT", "preview_expired");
    assertError(await create(s.user.id, { ...body, cutoffAt: new Date(h.clock.now.getTime() + HOUR).toISOString() }), 409, "CONFLICT", "preview_expired");

    const empty = await signUp();
    const e = ContentJobPreview.parse((await preview(empty.id)).json().data);
    assertError(await create(empty.id, { action: "HIDE", scope: "all", cutoffAt: e.cutoffAt, expected: e.affected }), 409, "CONFLICT", "nothing_to_do");
    assert.equal(await db.contentJob.count({ where: { userId: { in: [s.user.id, empty.id] } } }), 0);
    assert.equal((await auditOf(s.user.id, "request")).length, 0);
  });

  test("onay: tek işte en çok MAX_ITEMS içerik; aşılırsa 409 too_many", async () => {
    const s = await seed(0);
    const rows = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ pollId: s.polls[0]!, authorId: s.user.id, body: `toplu ${i}`, createdAt: past() }));
    await db.comment.createMany({ data: rows });
    await db.poll.update({ where: { id: s.polls[0]! }, data: { commentCount: MAX_ITEMS + 1 } });
    const res = await confirm(s.user.id, "HIDE", "comments");
    assertError(res, 409, "CONFLICT", "too_many");
    assert.equal(await db.contentJob.count({ where: { userId: s.user.id } }), 0);
  });

  // ─── Kuyruk ve işleme ───────────────────────────────────────

  test("HIDE: iş QUEUED döner (audit, gerekçe, request id); çalıştırıcı içeriği mevcut moderasyon yoluyla gizler (sayaçlar, geçmiş, audit, olay, rapor kapanması); başkasının içeriği ve cutoff sonrası içerik dokunulmaz", async () => {
    const s = await seed(4);
    const report = await db.report.create({ data: { reporterId: s.other.id, pollId: s.polls[0]!, reason: "SPAM" } });
    const created = await confirm(s.user.id);
    assert.equal(created.statusCode, 202, created.body);
    const queued = ContentJob.parse(created.json().data);
    assert.equal(queued.status, "QUEUED");
    assert.equal(queued.kind, "HIDE");
    assert.deepEqual(queued.expected, { polls: 2, comments: 4 });
    assert.equal(queued.canUndo, false);

    const [requested, ...more] = await auditOf(s.user.id, "request");
    assert.equal(more.length, 0);
    assert.equal(requested!.actorId, admin.id);
    assert.equal(requested!.reason, REASON);
    assert.ok(requested!.requestId);
    assert.deepEqual(requested!.after, { jobId: queued.id, kind: "HIDE", scope: "all", polls: 2, comments: 4 });

    // Onaydan sonra yazılan içerik cutoff'tan sonradır (bu testte saat sabit: açıkça ileri tarihli).
    const later = await db.comment.create({ data: { pollId: s.polls[0]!, authorId: s.user.id, body: "sonradan", createdAt: new Date(h.clock.now.getTime() + HOUR) }, select: { id: true } });
    await drain();

    const done = ContentJob.parse((await list(s.user.id)).json().data[0]);
    assert.equal(done.status, "DONE");
    assert.deepEqual([done.applied, done.unchanged, done.failed, done.skipped], [6, 0, 0, 0]);
    assert.equal(done.canUndo, true);
    for (const id of s.polls) assert.equal(await statusOf("poll", id), "HIDDEN");
    for (const id of s.own) assert.equal(await statusOf("comment", id), "HIDDEN");
    assert.equal(await statusOf("comment", s.foreignComment), "ACTIVE");
    assert.equal(await statusOf("poll", s.foreignPoll), "ACTIVE");
    assert.equal(await statusOf("comment", later.id), "ACTIVE");

    // Sayaç: yalnız ACTIVE yorumlar sayılır; gizlenen yorumlar düşer, başkasının yorumu kalır.
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: s.sharedPoll } })).commentCount, 1, "paylaşılan anket: yalnız başkasının ACTIVE yorumu sayılır (kendi 2 yorum düştü)");

    const actions = await db.moderationAction.findMany({ where: { actorId: admin.id, OR: [{ pollId: { in: s.polls } }, { commentId: { in: s.own } }] } });
    assert.equal(actions.length, 6);
    assert.ok(actions.every((a) => a.action === "HIDE" && a.reason === REASON && a.fromStatus === "ACTIVE" && a.toStatus === "HIDDEN"));
    const perItemAudit = await db.auditLog.count({ where: { action: { in: ["moderation.poll.apply", "moderation.comment.apply"] }, requestId: `content-job:${queued.id}` } });
    assert.equal(perItemAudit, 6, "içerik başına audit (mevcut moderasyon yolu)");
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status, "ACTIONED", "açık rapor kapandı");
    assert.equal(await db.contentJobItem.count({ where: { jobId: queued.id, result: "APPLIED" } }), 6);
  });

  test("REMOVE: ACTIVE ve HIDDEN içerik kaldırılır (deleted_at dolar); zaten kaldırılmış olan sayılmaz", async () => {
    const s = await seed(3);
    await db.poll.update({ where: { id: s.polls[1]! }, data: { status: "HIDDEN" } });
    await db.comment.update({ where: { id: s.own[0]! }, data: { status: "REMOVED", deletedAt: past() } });
    const res = await confirm(s.user.id, "REMOVE");
    assert.equal(res.statusCode, 202, res.body);
    assert.deepEqual(ContentJob.parse(res.json().data).expected, { polls: 2, comments: 2 });
    await drain();
    for (const id of s.polls) assert.equal(await statusOf("poll", id), "REMOVED");
    assert.equal(await statusOf("comment", s.own[1]!), "REMOVED");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: s.polls[0]! } })).deletedAt !== null, true);
    const job = ContentJob.parse((await list(s.user.id)).json().data[0]);
    assert.deepEqual([job.status, job.applied, job.failed], ["DONE", 4, 0]);
  });

  test("hesapta tek açık iş: ikinci onay 409 job_open; yedi paralel onay tek iş ve tek audit üretir", async () => {
    const s = await seed(2);
    const p = ContentJobPreview.parse((await preview(s.user.id)).json().data);
    const body = { action: "HIDE", scope: "all", cutoffAt: p.cutoffAt, expected: p.affected };
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => create(s.user.id, body, i % 2 ? superAdmin.cookie : admin.cookie)));
    assert.equal(results.filter((r) => r.statusCode === 202).length, 1, results.map((r) => r.statusCode).join(","));
    assert.equal(results.filter((r) => r.statusCode === 409).length, 6);
    for (const r of results.filter((x) => x.statusCode === 409)) assertError(r, 409, "CONFLICT", "job_open");
    assert.equal(await db.contentJob.count({ where: { userId: s.user.id } }), 1);
    assert.equal((await auditOf(s.user.id, "request")).length, 1);
    await drain();
    assert.equal((await confirm(s.user.id)).statusCode, 409, "içerik kalmadı");
  });

  test("işleme sürdürülebilir: tur bütçesi dolunca iş kuyruğa döner, sonraki tur kaldığı yerden sürer; çift işlenen veya kaybolan içerik yok", async () => {
    const s = await seed(0);
    const total = CHUNK + 5;
    await db.comment.createMany({ data: Array.from({ length: total }, (_, i) => ({ pollId: s.polls[0]!, authorId: s.user.id, body: `parça ${i}`, createdAt: past() })) });
    await db.poll.update({ where: { id: s.polls[0]! }, data: { commentCount: total } });
    const created = await confirm(s.user.id, "HIDE", "comments");
    const jobId = created.json().data.id as string;

    await runContentJobs(runnerDeps({ budgetMs: -1 }));
    const mid = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(mid.status, "QUEUED", "bütçe doldu → kuyruğa döndü");
    assert.equal(mid.applied, CHUNK);

    await drain();
    const end = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.deepEqual([end.status, end.applied, end.failed], ["DONE", total, 0]);
    assert.equal(await db.contentJobItem.count({ where: { jobId } }), total);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: s.polls[0]! } })).commentCount, 0);
  });

  test("takılmış PROCESSING iş süre sonra yeniden alınır; taze PROCESSING (başka süreç çalışıyor) alınmaz", async () => {
    const s = await seed(2);
    const jobId = (await confirm(s.user.id)).json().data.id as string;
    await db.contentJob.update({ where: { id: jobId }, data: { status: "PROCESSING", claimedAt: h.clock.now } });
    await runContentJobs(runnerDeps());
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "PROCESSING", "taze sahiplenme alınmaz");
    await db.contentJob.update({ where: { id: jobId }, data: { claimedAt: new Date(h.clock.now.getTime() - 10 * MINUTE) } });
    await drain();
    assert.equal((await db.contentJob.findUniqueOrThrow({ where: { id: jobId } })).status, "DONE");
  });

  test("aktör yetkisini kaybederse iş FAILED (actor_not_authorized): kalan içeriğe dokunulmaz", async () => {
    const s = await seed(0);
    const temp = await signUp();
    await db.userRole.create({ data: { userId: temp.id, role: "ADMIN", grantedById: superAdmin.id } });
    const total = CHUNK + 5;
    await db.comment.createMany({ data: Array.from({ length: total }, (_, i) => ({ pollId: s.polls[0]!, authorId: s.user.id, body: `yetki ${i}`, createdAt: past() })) });
    await db.poll.update({ where: { id: s.polls[0]! }, data: { commentCount: total } });
    const created = await confirm(s.user.id, "HIDE", "comments", temp.cookie);
    assert.equal(created.statusCode, 202, created.body);
    const jobId = created.json().data.id as string;
    await drain({
      afterItem: async (id, index) => {
        if (id === jobId && index === 0) await db.userRole.delete({ where: { userId: temp.id } });
      },
    });
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.deepEqual([job.status, job.failure, job.applied], ["FAILED", "actor_not_authorized", CHUNK]);
    assert.equal(await db.comment.count({ where: { authorId: s.user.id, status: "ACTIVE" } }), 5);
  });

  test("hedef hesap işten önce admin olursa (rol yükseldi) ve aktör yalnız ADMIN ise iş FAILED; silinmiş hesaba onay 409 user_deleted", async () => {
    const s = await seed(2);
    const jobId = (await confirm(s.user.id)).json().data.id as string;
    await db.userRole.create({ data: { userId: s.user.id, role: "ADMIN", grantedById: superAdmin.id } });
    await drain();
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.deepEqual([job.status, job.failure, job.applied], ["FAILED", "actor_not_authorized", 0]);
    assert.equal(await statusOf("poll", s.polls[0]!), "ACTIVE");

    const gone = await seed(1);
    const p = ContentJobPreview.parse((await preview(gone.user.id)).json().data);
    await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: h.clock.now } });
    assertError(await create(gone.user.id, { action: "HIDE", scope: "all", cutoffAt: p.cutoffAt, expected: p.affected }), 409, "CONFLICT", "user_deleted");
  });

  // ─── Durdurma ───────────────────────────────────────────────

  test("durdurma: kuyruktaki iş CANCELLED olur ve işlenmez; işlenmekte olan iş kalan içeriğe dokunmadan durur; bitmiş iş 409 not_cancellable; audit", async () => {
    const queuedUser = await seed(2);
    const queuedId = (await confirm(queuedUser.user.id)).json().data.id as string;
    const cancelled = await cancel(queuedUser.user.id, queuedId);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(ContentJob.parse(cancelled.json().data).status, "CANCELLED");
    await drain();
    assert.equal(await statusOf("poll", queuedUser.polls[0]!), "ACTIVE");
    const [entry, ...rest] = await auditOf(queuedUser.user.id, "cancel");
    assert.equal(rest.length, 0);
    assert.equal(entry!.reason, "Yanlış hesap seçilmiş");

    const s = await seed(0);
    const total = CHUNK + 10;
    await db.comment.createMany({ data: Array.from({ length: total }, (_, i) => ({ pollId: s.polls[0]!, authorId: s.user.id, body: `iptal ${i}`, createdAt: past() })) });
    await db.poll.update({ where: { id: s.polls[0]! }, data: { commentCount: total } });
    const jobId = (await confirm(s.user.id, "HIDE", "comments")).json().data.id as string;
    await drain({
      afterItem: async (id, index) => {
        if (id === jobId && index === 2) assert.equal((await cancel(s.user.id, jobId)).statusCode, 200);
      },
    });
    const job = await db.contentJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(job.status, "CANCELLED");
    assert.ok(job.applied >= 3 && job.applied < total, `kısmi: ${job.applied}`);
    assert.equal(await db.comment.count({ where: { authorId: s.user.id, status: "ACTIVE" } }), total - job.applied);

    assertError(await cancel(s.user.id, jobId), 409, "CONFLICT", "not_cancellable");
    assertError(await cancel(s.user.id, randomUUID()), 404, "NOT_FOUND");
    const other = await seed(1);
    assertError(await cancel(other.user.id, jobId), 404, "NOT_FOUND");
  });

  // ─── Geri alma ──────────────────────────────────────────────

  test("geri alma: yalnız önceki durumu ACTIVE olan içerik geri yüklenir (sayaçlar dönmüş); çift geri alma ve geri almanın geri alınması 409", async () => {
    const s = await seed(3);
    const jobId = (await confirm(s.user.id)).json().data.id as string;
    await drain();
    assert.equal(await statusOf("poll", s.polls[0]!), "HIDDEN");

    const res = await undo(s.user.id, jobId);
    assert.equal(res.statusCode, 202, res.body);
    const queued = ContentJob.parse(res.json().data);
    assert.deepEqual([queued.kind, queued.status, queued.undoOfId], ["UNDO", "QUEUED", jobId]);
    assert.deepEqual(queued.expected, { polls: 2, comments: 3 });
    assertError(await undo(s.user.id, jobId), 409, "CONFLICT", "job_open");

    await drain();
    for (const id of s.polls) assert.equal(await statusOf("poll", id), "ACTIVE");
    for (const id of s.own) assert.equal(await statusOf("comment", id), "ACTIVE");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: s.sharedPoll } })).commentCount, 2, "paylaşılan anket: başkasının + kendi yorum geri geldi");
    const jobs = (await list(s.user.id)).json().data as any[];
    const undone = jobs.find((j) => j.kind === "UNDO");
    assert.deepEqual([undone.status, undone.applied, undone.skipped], ["DONE", 5, 0]);
    assert.equal(jobs.find((j) => j.id === jobId).canUndo, false, "bir kez geri alınan iş yeniden geri alınamaz");
    assertError(await undo(s.user.id, jobId), 409, "CONFLICT", "not_undoable");
    assertError(await undo(s.user.id, undone.id), 409, "CONFLICT", "not_undoable");
    const [entry, ...rest] = await auditOf(s.user.id, "undo");
    assert.equal(rest.length, 0);
    assert.deepEqual(entry!.before, { jobId, kind: "HIDE" });
    assert.equal(entry!.reason, "Hesap yanlışlıkla işaretlenmişti");
  });

  test("güvenli geri alma: önceki durumu HIDDEN olan içerik geri yüklenmez; işten sonra durumu değişen içerik atlanır (SKIPPED)", async () => {
    const s = await seed(3);
    await db.poll.update({ where: { id: s.polls[1]! }, data: { status: "HIDDEN" } }); // önceden gizli
    const jobId = (await confirm(s.user.id, "REMOVE")).json().data.id as string;
    await drain();
    assert.equal(await statusOf("poll", s.polls[1]!), "REMOVED");

    // İşten sonra biri bir yorumu başka duruma taşıdı (geri yüklendi, sonra yeniden gizlendi).
    await db.comment.update({ where: { id: s.own[0]! }, data: { status: "ACTIVE", deletedAt: null } });
    await db.comment.update({ where: { id: s.own[1]! }, data: { status: "HIDDEN", deletedAt: null } });

    const res = await undo(s.user.id, jobId);
    assert.equal(res.statusCode, 202, res.body);
    assert.deepEqual(ContentJob.parse(res.json().data).expected, { polls: 1, comments: 3 }, "önceden gizli anket geri alınacaklar arasında değil");
    await drain();
    assert.equal(await statusOf("poll", s.polls[0]!), "ACTIVE");
    assert.equal(await statusOf("poll", s.polls[1]!), "REMOVED", "önceki durumu HIDDEN: daha görünür olmaz");
    assert.equal(await statusOf("comment", s.own[0]!), "ACTIVE", "zaten ACTIVE");
    assert.equal(await statusOf("comment", s.own[1]!), "HIDDEN", "başkası değiştirmişti: dokunulmadı");
    assert.equal(await statusOf("comment", s.own[2]!), "ACTIVE");
    const undone = ContentJob.parse((await list(s.user.id)).json().data.find((j: any) => j.kind === "UNDO"));
    assert.deepEqual([undone.status, undone.applied, undone.skipped], ["DONE", 2, 2]);
  });

  test("geri alma sınırları: bitmemiş iş ve uygulanan öğesi olmayan iş geri alınamaz; başka hesabın işi 404; silinmiş hesap 409", async () => {
    const s = await seed(2);
    const jobId = (await confirm(s.user.id)).json().data.id as string;
    assertError(await undo(s.user.id, jobId), 409, "CONFLICT", "job_open");
    await db.contentJob.update({ where: { id: jobId }, data: { status: "DONE" } });
    assertError(await undo(s.user.id, jobId), 409, "CONFLICT", "not_undoable");
    const other = await seed(1);
    assertError(await undo(other.user.id, jobId), 404, "NOT_FOUND");

    const gone = await seed(1);
    const done = (await confirm(gone.user.id)).json().data.id as string;
    await drain();
    await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: h.clock.now } });
    assertError(await undo(gone.user.id, done), 409, "CONFLICT", "user_deleted");
  });
});
