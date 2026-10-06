/**
 * KV-37 (#39) gelişmiş admin içerik işlemleri: arama listeleri, yalnız yorumları kapatma, kategori/topluluk taşıma,
 * içerik başına rapor + moderasyon geçmişi, kuyruktan uyar / yaptırım bağlantısı ve ilk oydan sonra anlam kilidi.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Testler yeniden çalıştırılabilir: aramalar benzersiz
 * işaretçiyle yapılır, ortak tabloların (kategori, topluluk) tamamına bakılmaz.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AdminCommentItem, AdminPollItem, ContentHistoryItem, ErrorBody, PollCard } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createPrismaModerationStore } from "../src/modules/moderation/prisma-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("gelişmiş admin içerik işlemleri (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let otherCategoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    const tag = randomUUID().slice(0, 8);
    categoryId = (await db.category.create({ data: { slug: `ops-a-${tag}`, name: "Ops A" } })).id;
    otherCategoryId = (await db.category.create({ data: { slug: `ops-b-${tag}`, name: "Ops B" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, cookie?: string, key?: string) {
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
    const account = { email: `ops_${id}@example.test`, username: `ops_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
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
    return db.community.create({ data: { slug: `ops-${randomUUID().slice(0, 8)}`, name: "Operasyon Topluluğu", createdById: superAdmin.id } });
  }

  /** Harf-only işaretçi: kv_normalize aramasında rakam/tire sorun çıkarmaz, her çalıştırmada benzersizdir. */
  const marker = () => `Zqx${randomUUID().replace(/[0-9-]/g, "").slice(0, 8)}`;

  async function poll(communityId?: string, title = `Bu karar doğru mu? ${marker()}`) {
    const author = await signUp();
    if (communityId) {
      await db.$transaction([
        db.communityMembership.upsert({ where: { communityId_userId: { communityId, userId: author.id } }, create: { communityId, userId: author.id }, update: {} }),
        db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
      ]);
    }
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title, categoryId, ...(communityId ? { communityId } : {}), durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return { id: res.json().data.id as string, author, title };
  }

  async function comment(pollId: string, cookie: string, body = "Bence kararın arkasındayım.") {
    const res = await send("POST", `/polls/${pollId}/comments`, { body }, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  async function vote(pollId: string) {
    const voter = await signUp();
    const optionId = (await get(`/polls/${pollId}`)).json().data.options[0].id as string;
    assert.ok([200, 201].includes((await send("PUT", `/polls/${pollId}/vote`, { optionId }, voter.cookie)).statusCode));
    return voter;
  }

  async function report(cookie: string | undefined, type: string, id: string, reason = "SPAM") {
    const res = await send("POST", "/reports", { target: { type, id }, reason }, cookie);
    assert.equal(res.statusCode, 202, res.body);
    return res.json().data.reportId as string;
  }
  async function reportedBy(type: string, id: string, reason = "SPAM") {
    return report((await signUp()).cookie, type, id, reason);
  }

  const moderatePoll = (cookie: string | undefined, id: string, action: string, reason = "Moderatör incelemesi") =>
    send("POST", `/admin/polls/${id}/moderation`, { action, reason }, cookie);
  const moderateComment = (cookie: string | undefined, id: string, action: string, reason = "Moderatör incelemesi") =>
    send("POST", `/admin/comments/${id}/moderation`, { action, reason }, cookie);
  const move = (cookie: string | undefined, id: string, body: Record<string, unknown>) =>
    send("PATCH", `/admin/polls/${id}/placement`, { reason: "Yanlış yere açılmış", ...body }, cookie);
  const audit = (targetId: string, action?: string) =>
    db.auditLog.findMany({ where: { targetId, ...(action ? { action } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const events = (type: string, subjectId: string) => db.domainEvent.findMany({ where: { type, subjectId } });
  const ids = (res: { json(): any }) => (res.json().data as { id: string }[]).map((x) => x.id);

  // ─── Arama listeleri ────────────────────────────────────────

  test("anket arama: Türkçe duyarsız metin, durum/rapor/trend süzgeçleri, gizli ve kaldırılmış dahil; sözleşmeye uyar", async () => {
    const m = marker();
    const a = await poll(undefined, `Çalışma masası alınır mı ${m}`);
    const b = await poll(undefined, `Üçüncü kat odası ${m}`);
    const c = await poll(undefined, `Başka konu ${m}`);
    assert.equal((await moderatePoll(admin.cookie, b.id, "HIDE")).statusCode, 200);
    assert.equal((await moderatePoll(admin.cookie, c.id, "REMOVE")).statusCode, 200);
    assert.equal((await moderatePoll(admin.cookie, a.id, "EXCLUDE_FROM_TRENDS")).statusCode, 200);
    await reportedBy("POLL", a.id);

    const all = await get(`/admin/polls?q=${m.toLocaleLowerCase("tr")}`, admin.cookie);
    assert.equal(all.statusCode, 200, all.body);
    for (const item of all.json().data) AdminPollItem.parse(item);
    assert.deepEqual(new Set(ids(all)), new Set([a.id, b.id, c.id]));

    // Türkçe harf duyarsız: "calisma" → "Çalışma".
    assert.deepEqual(ids(await get(`/admin/polls?q=${encodeURIComponent("calisma masasi")}`, admin.cookie)).includes(a.id), true);
    assert.deepEqual(ids(await get(`/admin/polls?q=${m}&status=HIDDEN`, admin.cookie)), [b.id]);
    assert.deepEqual(ids(await get(`/admin/polls?q=${m}&status=REMOVED`, admin.cookie)), [c.id]);
    assert.deepEqual(ids(await get(`/admin/polls?q=${m}&reported=true`, admin.cookie)), [a.id]);
    assert.deepEqual(ids(await get(`/admin/polls?q=${m}&trendExcluded=true`, admin.cookie)), [a.id]);
    assert.deepEqual(new Set(ids(await get(`/admin/polls?q=${m}&reported=false`, admin.cookie))), new Set([b.id, c.id]));

    const item = AdminPollItem.parse(all.json().data.find((x: { id: string }) => x.id === a.id));
    assert.deepEqual([item.status, item.trendExcluded, item.commentsClosed, item.contentLocked, item.openReportCount], ["ACTIVE", true, false, false, 1]);
    assert.equal(item.author.id, a.author.id);
    assert.equal(item.category.id, categoryId);

    // Gizli/kaldırılmış anket public listelerde yok, yönetici listesinde var.
    const publicHits = ((await get(`/search?q=${m.toLocaleLowerCase("tr")}`)).json().data as { poll: { id: string } }[]).map((r) => r.poll.id);
    assert.deepEqual(publicHits, [a.id], "public arama gizli ve kaldırılmışı döndürmez");
  });

  test("anket listesi: sayfalama (en yeni önce), geçersiz cursor ve yetki", async () => {
    const m = marker();
    const created = [(await poll(undefined, `Sayfa bir ${m}`)).id, (await poll(undefined, `Sayfa iki ${m}`)).id, (await poll(undefined, `Sayfa üç ${m}`)).id];
    const first = await get(`/admin/polls?q=${m}&limit=2`, admin.cookie);
    assert.equal(first.json().data.length, 2);
    assert.equal(first.json().page.hasMore, true);
    const second = await get(`/admin/polls?q=${m}&limit=2&cursor=${first.json().page.nextCursor}`, admin.cookie);
    assert.equal(second.json().data.length, 1);
    assert.equal(second.json().page.hasMore, false);
    assert.deepEqual(new Set([...ids(first), ...ids(second)]), new Set(created));
    assert.equal(new Set([...ids(first), ...ids(second)]).size, 3, "sayfalar çakışmaz");

    // Filtre değişince eski cursor geçersizdir.
    assertError(await get(`/admin/polls?q=${m}&status=HIDDEN&limit=2&cursor=${first.json().page.nextCursor}`, admin.cookie), 400, "INVALID_CURSOR");
    assertError(await get("/admin/polls"), 401, "UNAUTHENTICATED");
    assertError(await get("/admin/polls", (await signUp()).cookie), 403, "FORBIDDEN");
    assertError(await get(`/admin/polls?q=a`, admin.cookie), 400, "VALIDATION_ERROR");
  });

  test("moderatör yalnız atandığı topluluğun anket ve yorumlarını listeler; topluluksuz içerik yalnız admin listesinde", async () => {
    const a = await community();
    const b = await community();
    const m = marker();
    const inA = await poll(a.id, `A topluluğu ${m}`);
    const inB = await poll(b.id, `B topluluğu ${m}`);
    const free = await poll(undefined, `Topluluksuz ${m}`);
    const commentA = await comment(inA.id, inA.author.cookie, `Yorum ${m}`);
    await comment(inB.id, inB.author.cookie, `Yorum ${m}`);
    const mod = await staff("MODERATOR", a.id);

    assert.deepEqual(ids(await get(`/admin/polls?q=${m}`, mod.cookie)), [inA.id]);
    assert.deepEqual(new Set(ids(await get(`/admin/polls?q=${m}`, admin.cookie))), new Set([inA.id, inB.id, free.id]));
    assert.deepEqual(ids(await get(`/admin/comments?q=${m}`, mod.cookie)), [commentA]);
    // Filtre yetki değildir: başka topluluğu süzmek yine boş döner.
    assert.deepEqual(ids(await get(`/admin/polls?q=${m}&communityId=${b.id}`, mod.cookie)), []);
    // Topluluğu olmayan moderatör (hiçbir yerde atanmamış) kuyruğa giremez.
    assertError(await get(`/admin/polls?q=${m}`, (await staff("MODERATOR")).cookie), 403, "FORBIDDEN");
  });

  test("yorum arama: metin, durum, anket ve rapor süzgeçleri; gizli ve kaldırılmış yorum dahil", async () => {
    const p = await poll();
    const m = marker();
    const keep = await comment(p.id, p.author.cookie, `Normal yorum ${m}`);
    const hidden = await comment(p.id, p.author.cookie, `Gizlenecek yorum ${m}`);
    const removed = await comment(p.id, p.author.cookie, `Kaldırılacak yorum ${m}`);
    assert.equal((await moderateComment(admin.cookie, hidden, "HIDE")).statusCode, 200);
    assert.equal((await moderateComment(admin.cookie, removed, "REMOVE")).statusCode, 200);
    await reportedBy("COMMENT", keep);

    const res = await get(`/admin/comments?q=${m}`, admin.cookie);
    assert.equal(res.statusCode, 200, res.body);
    for (const item of res.json().data) AdminCommentItem.parse(item);
    assert.deepEqual(new Set(ids(res)), new Set([keep, hidden, removed]));
    assert.deepEqual(ids(await get(`/admin/comments?q=${m}&status=HIDDEN`, admin.cookie)), [hidden]);
    assert.deepEqual(ids(await get(`/admin/comments?q=${m}&status=REMOVED`, admin.cookie)), [removed]);
    assert.deepEqual(ids(await get(`/admin/comments?q=${m}&reported=true`, admin.cookie)), [keep]);
    assert.deepEqual(new Set(ids(await get(`/admin/comments?pollId=${p.id}`, admin.cookie))), new Set([keep, hidden, removed]));
    const row = res.json().data.find((x: { id: string }) => x.id === keep);
    assert.deepEqual([row.pollId, row.pollTitle, row.openReportCount, row.parentId], [p.id, p.title, 1, null]);
    assertError(await get(`/admin/comments?q=${m}`, (await signUp()).cookie), 403, "FORBIDDEN");
  });

  // ─── Yalnız yorumları kapatma ───────────────────────────────

  test("yorumları kapat: yeni yorum ve cevap 409, oy açık kalır, mevcut yorumlar görünür; sahip geri açamaz; yönetici açar", async () => {
    const p = await poll();
    const existing = await comment(p.id, p.author.cookie, "Kapanmadan önceki yorum");
    const reporter = await reportedBy("POLL", p.id);

    const closed = await moderatePoll(admin.cookie, p.id, "CLOSE_COMMENTS", "Tartışma kontrolden çıktı");
    assert.equal(closed.statusCode, 200, closed.body);
    assert.deepEqual(closed.json().data, { id: p.id, status: "ACTIVE", trendExcluded: false, commentsClosed: true });
    assert.ok((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).commentsClosedAt);

    // Yeni yorum ve cevap engellenir; oy ve görünürlük etkilenmez.
    const visitor = await signUp();
    assertError(await send("POST", `/polls/${p.id}/comments`, { body: "Yeni yorum" }, visitor.cookie), 409, "COMMENTS_DISABLED");
    assertError(await send("POST", `/polls/${p.id}/comments`, { body: "Cevap", parentId: existing }, visitor.cookie), 409, "COMMENTS_DISABLED");
    await vote(p.id);
    const detail = (await get(`/polls/${p.id}`)).json().data;
    assert.equal(detail.status, "ACTIVE");
    assert.equal(detail.allowComments, false, "etkin değer kapalı gösterilir");
    assert.deepEqual(ids(await get(`/polls/${p.id}/comments`)), [existing]);

    // Kapatma raporu karşılamaz (içerik görünür kalıyor); LOCK'tan ayrıdır.
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: reporter } })).status, "OPEN");

    // Sahip allowComments=true yapsa bile moderasyon kapatması geçerlidir.
    const ownerOpen = await send("PATCH", `/polls/${p.id}`, { allowComments: true }, p.author.cookie);
    assert.equal(ownerOpen.statusCode, 200, ownerOpen.body);
    assertError(await send("POST", `/polls/${p.id}/comments`, { body: "Hâlâ kapalı" }, visitor.cookie), 409, "COMMENTS_DISABLED");

    // Tekrar kapatma idempotent: yeni iz yok.
    const trailBefore = [(await audit(p.id, "moderation.poll.apply")).length, await db.moderationAction.count({ where: { pollId: p.id } })];
    assert.equal((await moderatePoll(admin.cookie, p.id, "CLOSE_COMMENTS")).statusCode, 200);
    assert.deepEqual([(await audit(p.id, "moderation.poll.apply")).length, await db.moderationAction.count({ where: { pollId: p.id } })], trailBefore);

    const rows = (await audit(p.id, "moderation.poll.apply")).filter((r) => r.operation === "close_comments");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].actorId, rows[0].reason], [admin.id, "Tartışma kontrolden çıktı"]);
    assert.deepEqual(rows[0].before, { status: "ACTIVE", trendExcluded: false, commentsClosed: false });
    assert.deepEqual(rows[0].after, { status: "ACTIVE", trendExcluded: false, commentsClosed: true, closedReports: 0 });
    assert.equal((await events("moderation.applied", p.id)).filter((e) => (e.payload as { action: string }).action === "CLOSE_COMMENTS").length, 1);

    // Aç: yorum yeniden yazılabilir.
    const opened = await moderatePoll(admin.cookie, p.id, "OPEN_COMMENTS");
    assert.deepEqual(opened.json().data, { id: p.id, status: "ACTIVE", trendExcluded: false, commentsClosed: false });
    assert.equal((await send("POST", `/polls/${p.id}/comments`, { body: "Artık açık" }, visitor.cookie)).statusCode, 201);
  });

  test("yorumları kapat: yorum hedefinde desteklenmez, kaldırılmış ankette 409, moderatör kapsamı dışında 403, normal kullanıcı 403", async () => {
    const c = await community();
    const other = await community();
    const p = await poll(c.id);
    const commentId = await comment(p.id, p.author.cookie);
    const mod = await staff("MODERATOR", c.id);

    assertError(await moderateComment(admin.cookie, commentId, "CLOSE_COMMENTS"), 400, "VALIDATION_ERROR");
    assertError(await moderatePoll(p.author.cookie, p.id, "CLOSE_COMMENTS"), 403, "FORBIDDEN");
    assertError(await moderatePoll((await staff("MODERATOR", other.id)).cookie, p.id, "CLOSE_COMMENTS"), 403, "FORBIDDEN");
    assert.equal((await moderatePoll(mod.cookie, p.id, "CLOSE_COMMENTS")).statusCode, 200);

    assert.equal((await moderatePoll(admin.cookie, p.id, "REMOVE")).statusCode, 200);
    assertError(await moderatePoll(admin.cookie, p.id, "OPEN_COMMENTS"), 409, "CONFLICT");
  });

  // ─── Kategori / topluluk taşıma ─────────────────────────────

  test("taşıma: ilk oydan sonra da serbest; soru, seçenek, oy ve yorumlar yerinde kalır; feed ve detay yeni yerde; audit + sürüm + geçmiş", async () => {
    const from = await community();
    const to = await community();
    const p = await poll(from.id);
    await comment(p.id, p.author.cookie);
    await vote(p.id);
    const before = await db.poll.findUniqueOrThrow({ where: { id: p.id }, include: { options: { orderBy: { position: "asc" } } } });
    assert.ok(before.firstValidVoteAt, "ilk geçerli oy kilidi aktif");

    const res = await move(admin.cookie, p.id, { categoryId: otherCategoryId, communityId: to.id });
    assert.equal(res.statusCode, 200, res.body);
    const item = AdminPollItem.parse(res.json().data);
    assert.deepEqual([item.category.id, item.community?.id, item.contentLocked, item.voteCount, item.commentCount], [otherCategoryId, to.id, true, 1, 1]);

    const after = await db.poll.findUniqueOrThrow({ where: { id: p.id }, include: { options: { orderBy: { position: "asc" } } } });
    assert.deepEqual([after.title, after.description, after.resultsVisibility, after.firstValidVoteAt?.getTime()], [before.title, before.description, before.resultsVisibility, before.firstValidVoteAt?.getTime()]);
    assert.deepEqual(after.options.map((o) => [o.id, o.label, o.voteCount]), before.options.map((o) => [o.id, o.label, o.voteCount]));

    // Public okuma ve listeler canlı okur: eski yerde yok, yeni yerde var.
    const detail = (await get(`/polls/${p.id}`)).json().data;
    assert.deepEqual([detail.category.id, detail.community.id], [otherCategoryId, to.id]);
    const feedIn = async (communityId: string) => ((await get(`/feed?tab=new&communityId=${communityId}&limit=50`)).json().data as unknown[]).map((c) => PollCard.parse(c).id);
    assert.equal((await feedIn(from.id)).includes(p.id), false);
    assert.equal((await feedIn(to.id)).includes(p.id), true);
    const byCategory = ((await get(`/feed?tab=new&categoryId=${otherCategoryId}&limit=100`)).json().data as unknown[]).map((c) => PollCard.parse(c).id);
    assert.equal(byCategory.includes(p.id), true);

    // İz: audit önce/sonra, MOVE kaydı, içerik sürümü (kim taşıdı).
    const rows = await audit(p.id, "moderation.poll.move");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].operation, rows[0].actorId, rows[0].reason, rows[0].targetType], ["move", admin.id, "Yanlış yere açılmış", "POLL"]);
    assert.deepEqual(rows[0].before, { categoryId, communityId: from.id });
    assert.deepEqual(rows[0].after, { categoryId: otherCategoryId, communityId: to.id });
    const action = await db.moderationAction.findFirstOrThrow({ where: { pollId: p.id, action: "MOVE" } });
    assert.deepEqual([action.actorId, action.fromStatus, action.toStatus], [admin.id, "ACTIVE", "ACTIVE"]);
    const revision = await db.pollRevision.findFirstOrThrow({ where: { pollId: p.id }, orderBy: { version: "desc" } });
    assert.equal(revision.editorId, admin.id);
    assert.deepEqual([(revision.snapshot as any).categoryId, (revision.snapshot as any).communityId], [otherCategoryId, to.id]);

    // Aynı yere taşıma idempotent: yeni iz yok.
    assert.equal((await move(admin.cookie, p.id, { categoryId: otherCategoryId, communityId: to.id })).statusCode, 200);
    assert.equal((await audit(p.id, "moderation.poll.move")).length, 1);
    assert.equal(await db.moderationAction.count({ where: { pollId: p.id, action: "MOVE" } }), 1);
  });

  test("taşıma yetkisi: moderatör iki toplulukta da atanmışsa taşır; yalnız kaynakta atanmışsa, topluluktan çıkarmada ve topluluksuz ankette 403", async () => {
    const a = await community();
    const b = await community();
    const onlyA = await staff("MODERATOR", a.id);
    const both = await staff("MODERATOR", a.id);
    await db.$transaction([
      db.communityMembership.create({ data: { communityId: b.id, userId: both.id, role: "MODERATOR" } }),
      db.community.update({ where: { id: b.id }, data: { memberCount: { increment: 1 } } }),
    ]);
    const p = await poll(a.id);
    const free = await poll();

    assertError(await move(undefined, p.id, { communityId: b.id }), 401, "UNAUTHENTICATED");
    assertError(await move(p.author.cookie, p.id, { communityId: b.id }), 403, "FORBIDDEN");
    assertError(await move(onlyA.cookie, p.id, { communityId: b.id }), 403, "FORBIDDEN");
    assertError(await move(onlyA.cookie, p.id, { communityId: null }), 403, "FORBIDDEN");
    assertError(await move(onlyA.cookie, free.id, { communityId: a.id }), 403, "FORBIDDEN");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).communityId, a.id);
    assert.equal(await db.moderationAction.count({ where: { pollId: p.id, action: "MOVE" } }), 0);

    // Yalnız kategori değişimi kendi topluluğunda moderatöre açık.
    assert.equal((await move(onlyA.cookie, p.id, { categoryId: otherCategoryId })).statusCode, 200);
    assert.equal((await move(both.cookie, p.id, { communityId: b.id })).statusCode, 200);
    // Admin topluluktan çıkarır ve topluluksuz anketi topluluğa alır.
    const out = await move(admin.cookie, p.id, { communityId: null });
    assert.equal(out.json().data.community, null);
    assert.equal((await move(admin.cookie, free.id, { communityId: a.id })).json().data.community.id, a.id);
    assertError(await move(admin.cookie, randomUUID(), { categoryId: otherCategoryId }), 404, "NOT_FOUND");
  });

  test("taşıma doğrulaması: bilinmeyen/kapalı kategori ve topluluk 400, kaldırılmış anket 409, gövde en az bir alan ister", async () => {
    const closedCommunity = await db.community.create({ data: { slug: `ops-kapali-${randomUUID().slice(0, 8)}`, name: "Kapalı", status: "HIDDEN", createdById: superAdmin.id } });
    const inactive = await db.category.create({ data: { slug: `ops-pasif-${randomUUID().slice(0, 8)}`, name: "Pasif", isActive: false } });
    const p = await poll();

    const unknownCategory = await move(admin.cookie, p.id, { categoryId: randomUUID() });
    assertError(unknownCategory, 400, "VALIDATION_ERROR");
    assert.deepEqual([unknownCategory.json().error.details[0].field, unknownCategory.json().error.details[0].code], ["categoryId", "unknown_category"]);
    assertError(await move(admin.cookie, p.id, { categoryId: inactive.id }), 400, "VALIDATION_ERROR");
    const unknownCommunity = await move(admin.cookie, p.id, { communityId: randomUUID() });
    assert.equal(unknownCommunity.json().error.details[0].code, "unknown_community");
    assertError(await move(admin.cookie, p.id, { communityId: closedCommunity.id }), 400, "VALIDATION_ERROR");
    assertError(await send("PATCH", `/admin/polls/${p.id}/placement`, { reason: "Boş istek" }, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await send("PATCH", `/admin/polls/${p.id}/placement`, { categoryId: otherCategoryId }, admin.cookie), 400, "VALIDATION_ERROR");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).categoryId, categoryId);
    assert.equal(await db.moderationAction.count({ where: { pollId: p.id, action: "MOVE" } }), 0);

    assert.equal((await moderatePoll(admin.cookie, p.id, "REMOVE")).statusCode, 200);
    assertError(await move(admin.cookie, p.id, { categoryId: otherCategoryId }), 409, "CONFLICT");
  });

  test("ilk oydan sonra anlam değiştirme yönetici için de kapalı: yönetici düzenleme yolu yok, DB kilidi başlık/seçenek değişimini reddeder, taşıma bunları değiştirmez", async () => {
    const p = await poll();
    await vote(p.id);
    // Yönetici sahibin düzenleme endpoint'ini kullanamaz.
    const edit = await send("PATCH", `/polls/${p.id}`, { title: "Anlamı değişen soru" }, admin.cookie);
    assert.ok(edit.statusCode === 403 || edit.statusCode === 404, edit.body);
    // Sahibin kendi denemesi POLL_CONTENT_LOCKED ile reddedilir.
    assertError(await send("PATCH", `/polls/${p.id}`, { title: "Anlamı değişen soru" }, p.author.cookie), 409, "POLL_CONTENT_LOCKED");
    // DB tetikleyicisi (hiçbir uygulama yolu bu kilidi aşamaz).
    await assert.rejects(db.poll.update({ where: { id: p.id }, data: { title: "Doğrudan değişim" } }), /KV_POLL_CONTENT_LOCKED/);
    await assert.rejects(db.pollOption.updateMany({ where: { pollId: p.id }, data: { label: "Değişti" } }), /KV_POLL_CONTENT_LOCKED/);
    // Taşıma izinlidir ve anlamı değiştirmez.
    assert.equal((await move(admin.cookie, p.id, { categoryId: otherCategoryId })).statusCode, 200);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).title, p.title);
  });

  test("yetki yarışı: moderasyon işlemi okunduktan sonra anket başka topluluğa taşınmışsa işlem 409 (eski yetkiyle uygulanmaz)", async () => {
    const a = await community();
    const b = await community();
    const p = await poll(a.id);
    const store = createPrismaModerationStore(db);
    // İstek A topluluğuna göre yetkilendirildi; bu arada anket B'ye taşındı.
    assert.equal((await move(admin.cookie, p.id, { communityId: b.id })).statusCode, 200);
    const stale = await store.apply({
      kind: "polls",
      id: p.id,
      actorId: admin.id,
      action: "HIDE",
      reason: "Eski yetkiyle",
      now: h.clock.now,
      requestId: null,
      actorIsAdmin: false,
      communityId: a.id,
    });
    assert.deepEqual(stale, { kind: "conflict", reason: "community_changed" });
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: p.id } })).status, "ACTIVE");
    const staleMove = await store.movePoll({ id: p.id, actorId: admin.id, communityId: a.id, categoryId: otherCategoryId, reason: "Eski yetkiyle", now: h.clock.now, requestId: null });
    assert.deepEqual(staleMove, { kind: "conflict", reason: "community_changed" });
  });

  // ─── Rapor ve moderasyon geçmişi ────────────────────────────

  test("içerik geçmişi: raporlar ve moderasyon işlemleri tek çizgide, raporlayan kimliği yok; sayfalama ve yetki", async () => {
    const c = await community();
    const p = await poll(c.id);
    const mod = await staff("MODERATOR", c.id);
    const reporter1 = await signUp();
    const reporter2 = await signUp();
    await report(reporter1.cookie, "POLL", p.id, "SPAM");
    h.clock.advance(1000);
    await report(reporter2.cookie, "POLL", p.id, "HATE");
    h.clock.advance(1000);
    assert.equal((await moderatePoll(mod.cookie, p.id, "HIDE", "Nefret söylemi doğrulandı")).statusCode, 200);
    h.clock.advance(1000);
    assert.equal((await moderatePoll(admin.cookie, p.id, "RESTORE", "İtiraz kabul edildi")).statusCode, 200);

    const res = await get(`/admin/polls/${p.id}/moderation-history`, mod.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const items = res.json().data.map((x: unknown) => ContentHistoryItem.parse(x));
    const kinds = items.map((x: { kind: string }) => x.kind);
    assert.equal(items.length, 4);
    assert.deepEqual(kinds.filter((k: string) => k === "REPORT").length, 2);
    // En yeni önce.
    const times = items.map((x: { at: string }) => Date.parse(x.at));
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
    const actions = items.filter((x: { kind: string }) => x.kind === "ACTION").map((x: { action: string }) => x.action);
    assert.deepEqual(actions, ["RESTORE", "HIDE"]);
    const hide = items.find((x: { action?: string }) => x.action === "HIDE");
    assert.deepEqual([hide.actor.id, hide.reason, hide.fromStatus, hide.toStatus], [mod.id, "Nefret söylemi doğrulandı", "ACTIVE", "HIDDEN"]);
    // Kapanmış rapor: sonuçlandıran ve gerekçe görünür; raporlayan görünmez.
    const closed = items.filter((x: { kind: string }) => x.kind === "REPORT");
    assert.ok(closed.every((r: { status: string; resolvedBy: { id: string } | null }) => r.status === "ACTIONED" && r.resolvedBy?.id === mod.id));
    const serialized = JSON.stringify(res.json());
    assert.equal(serialized.includes(reporter1.id) || serialized.includes(reporter2.id), false, "raporlayan kimliği dönmez");

    // Sayfalama.
    const first = await get(`/admin/polls/${p.id}/moderation-history?limit=3`, mod.cookie);
    assert.equal(first.json().data.length, 3);
    const second = await get(`/admin/polls/${p.id}/moderation-history?limit=3&cursor=${first.json().page.nextCursor}`, mod.cookie);
    assert.equal(second.json().data.length, 1);
    assert.deepEqual(new Set([...ids(first), ...ids(second)]).size, 4);

    // Yetki: başka topluluğun moderatörü ve normal kullanıcı okuyamaz; olmayan içerik 404.
    assertError(await get(`/admin/polls/${p.id}/moderation-history`, (await staff("MODERATOR", (await community()).id)).cookie), 403, "FORBIDDEN");
    assertError(await get(`/admin/polls/${p.id}/moderation-history`, reporter1.cookie), 403, "FORBIDDEN");
    assertError(await get(`/admin/polls/${randomUUID()}/moderation-history`, admin.cookie), 404, "NOT_FOUND");
  });

  test("yorum geçmişi: yorumun raporları ve moderasyon işlemleri; kapanmamış rapor OPEN görünür", async () => {
    const p = await poll();
    const id = await comment(p.id, p.author.cookie);
    await reportedBy("COMMENT", id, "HARASSMENT");
    const open = await get(`/admin/comments/${id}/moderation-history`, admin.cookie);
    assert.equal(open.statusCode, 200, open.body);
    assert.deepEqual(open.json().data.map((x: { kind: string; status?: string }) => [x.kind, x.status]), [["REPORT", "OPEN"]]);
    h.clock.advance(1000);
    assert.equal((await moderateComment(admin.cookie, id, "HIDE", "Taciz doğrulandı")).statusCode, 200);
    const done = (await get(`/admin/comments/${id}/moderation-history`, admin.cookie)).json().data.map((x: unknown) => ContentHistoryItem.parse(x));
    assert.deepEqual(done.map((x: { kind: string }) => x.kind), ["ACTION", "REPORT"]);
  });

  // ─── Kuyruktan uyar ve yaptırım ─────────────────────────────

  test("rapor kuyruğu satırı hedef özeti, durumu ve sahibini taşır", async () => {
    const c = await community();
    const p = await poll(c.id);
    const id = await comment(p.id, p.author.cookie, `Uzun yorum ${"x".repeat(300)}`);
    await reportedBy("COMMENT", id);
    await reportedBy("POLL", p.id);
    const mod = await staff("MODERATOR", c.id);
    const rows = (await get(`/admin/reports?communityId=${c.id}&limit=50`, mod.cookie)).json().data as any[];
    const onComment = rows.find((r) => r.target.id === id);
    assert.equal(onComment.excerpt.length, 140);
    assert.deepEqual([onComment.contentStatus, onComment.targetUser.id], ["ACTIVE", p.author.id]);
    const onPoll = rows.find((r) => r.target.id === p.id);
    assert.deepEqual([onPoll.excerpt, onPoll.targetUser.id], [p.title, p.author.id]);
  });

  test("uyar: WARNING yaptırımı yazılır, hesap durumu değişmez, açık raporlar ACTIONED olur; moderation_actions + audit + olay rapora bağlıdır", async () => {
    const c = await community();
    const p = await poll(c.id);
    const commentId = await comment(p.id, p.author.cookie);
    const first = await reportedBy("COMMENT", commentId, "HARASSMENT");
    const second = await reportedBy("COMMENT", commentId, "HATE");
    const mod = await staff("MODERATOR", c.id);

    const res = await send("POST", `/admin/reports/${first}/warn`, { reason: "Hakaret içeren yorum, ilk uyarı" }, mod.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const { sanctionId, userId, closedReports } = res.json().data;
    assert.deepEqual([userId, closedReports], [p.author.id, 2]);

    const sanction = await db.sanction.findUniqueOrThrow({ where: { id: sanctionId } });
    assert.deepEqual([sanction.type, sanction.userId, sanction.createdById, sanction.endsAt, sanction.reason], ["WARNING", p.author.id, mod.id, null, "Hakaret içeren yorum, ilk uyarı"]);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: p.author.id } })).status, "ACTIVE");
    // Yorum kendiliğinden gizlenmez: uyarı içeriğe dokunmaz.
    assert.equal((await db.comment.findUniqueOrThrow({ where: { id: commentId } })).status, "ACTIVE");
    for (const id of [first, second]) assert.equal((await db.report.findUniqueOrThrow({ where: { id } })).status, "ACTIONED");

    const action = await db.moderationAction.findFirstOrThrow({ where: { reportId: first, action: "WARN_USER" } });
    assert.deepEqual([action.actorId, action.targetUserId, action.reason], [mod.id, p.author.id, "Hakaret içeren yorum, ilk uyarı"]);
    const rows = await audit(p.author.id, "moderation.user.warn");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].operation, rows[0].actorId, rows[0].targetType], ["warn", mod.id, "USER"]);
    assert.deepEqual(rows[0].after, { reportId: first, targetType: "COMMENT", targetId: commentId, sanctionId, type: "WARNING", closedReports: 2 });
    assert.equal((await events("sanction.applied", p.author.id)).filter((e) => (e.payload as { sanctionId: string }).sanctionId === sanctionId).length, 1);
    for (const id of [first, second]) assert.equal((await events("report.resolved", id)).length, 1);

    // Geçmişte rapor + uyarı birlikte görünür; kapanmış rapora tekrar uyarı 409.
    const history = (await get(`/admin/comments/${commentId}/moderation-history`, mod.cookie)).json().data as any[];
    assert.ok(history.some((x) => x.kind === "ACTION" && x.action === "WARN_USER" && x.reportId === first));
    assertError(await send("POST", `/admin/reports/${first}/warn`, { reason: "Tekrar uyarı" }, mod.cookie), 409, "CONFLICT");
    assert.equal(await db.sanction.count({ where: { userId: p.author.id, type: "WARNING" } }), 1);
  });

  test("uyar yetkisi: kapsam dışı moderatör ve normal kullanıcı 403; moderatör kadro hesabını uyaramaz, admin uyarır; hedef sahibi yoksa 409", async () => {
    const c = await community();
    const other = await community();
    const p = await poll(c.id);
    const staffMember = await signUp();
    await db.userRole.create({ data: { userId: staffMember.id, role: "MODERATOR", grantedById: superAdmin.id } });
    const reportId = await reportedBy("POLL", p.id);
    const mod = await staff("MODERATOR", c.id);

    assertError(await send("POST", `/admin/reports/${reportId}/warn`, { reason: "Uyarı" }, undefined), 401, "UNAUTHENTICATED");
    assertError(await send("POST", `/admin/reports/${reportId}/warn`, { reason: "Uyarı" }, p.author.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/admin/reports/${reportId}/warn`, { reason: "Uyarı" }, (await staff("MODERATOR", other.id)).cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/admin/reports/${randomUUID()}/warn`, { reason: "Uyarı" }, admin.cookie), 404, "NOT_FOUND");
    assertError(await send("POST", `/admin/reports/${reportId}/warn`, { reason: "ab" }, mod.cookie), 400, "VALIDATION_ERROR");

    // Raporlanan hesap kadroda: moderatör uyaramaz, admin uyarır.
    const staffReport = await reportedBy("USER", staffMember.id);
    assertError(await send("POST", `/admin/reports/${staffReport}/warn`, { reason: "Kadro uyarısı" }, mod.cookie), 403, "FORBIDDEN");
    assert.equal((await send("POST", `/admin/reports/${staffReport}/warn`, { reason: "Kadro uyarısı" }, admin.cookie)).statusCode, 200);

    // Silinmiş hesabın içeriği: sahibi yok → 409.
    const gone = await poll(c.id);
    const goneReport = await reportedBy("POLL", gone.id);
    await db.user.update({ where: { id: gone.author.id }, data: { deletedAt: h.clock.now } });
    const noOwner = await send("POST", `/admin/reports/${goneReport}/warn`, { reason: "Uyarı" }, admin.cookie);
    assertError(noOwner, 409, "CONFLICT");
    assert.equal(noOwner.json().error.details[0].code, "no_target_user");
    assert.equal(await db.sanction.count({ where: { userId: gone.author.id } }), 0);
  });

  test("sert yaptırım kuyruktan: admin.sanctions.create reportId ile rapora bağlanır (SANCTION_USER, audit, ACTIONED); yanlış rapor 409, olmayan rapor 404", async () => {
    const p = await poll();
    const mine = await reportedBy("POLL", p.id);
    const others = await poll();
    const foreign = await reportedBy("POLL", others.id);

    const wrong = await send("POST", `/admin/users/${p.author.id}/sanctions`, { type: "RESTRICT_COMMENTS", reason: "Yanlış rapor", endsAt: null, reportId: foreign }, admin.cookie);
    assertError(wrong, 409, "CONFLICT");
    assert.equal(wrong.json().error.details[0].code, "report_mismatch");
    assertError(await send("POST", `/admin/users/${p.author.id}/sanctions`, { type: "RESTRICT_COMMENTS", reason: "Olmayan rapor", endsAt: null, reportId: randomUUID() }, admin.cookie), 404, "NOT_FOUND");
    assert.equal(await db.sanction.count({ where: { userId: p.author.id } }), 0, "reddedilen istek yaptırım bırakmaz");
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: foreign } })).status, "OPEN");

    const ok = await send("POST", `/admin/users/${p.author.id}/sanctions`, { type: "RESTRICT_COMMENTS", reason: "Tekrarlayan spam", endsAt: null, reportId: mine }, admin.cookie);
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: mine } })).status, "ACTIONED");
    const action = await db.moderationAction.findFirstOrThrow({ where: { reportId: mine, action: "SANCTION_USER" } });
    assert.deepEqual([action.actorId, action.targetUserId], [admin.id, p.author.id]);
    const row = (await audit(p.author.id, "user.sanction")).at(-1)!;
    assert.deepEqual([row.operation, (row.after as any).reportId, (row.after as any).closedReports], ["apply", mine, 1]);

    // reportId'siz yaptırım eskisi gibi çalışır ve rapora iz bırakmaz.
    const plain = await poll();
    const plainReport = await reportedBy("POLL", plain.id);
    assert.equal((await send("POST", `/admin/users/${plain.author.id}/sanctions`, { type: "WARNING", reason: "Serbest uyarı", endsAt: null }, admin.cookie)).statusCode, 201);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: plainReport } })).status, "OPEN");
  });
});
