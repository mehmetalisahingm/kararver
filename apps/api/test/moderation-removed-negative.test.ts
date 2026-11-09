/**
 * #303 güvenlik incelemesi: yeni içerik yayınlanmadan önce moderasyon yetki retleri ve kaldırılmış içeriğin davranışı.
 * Gerçek PostgreSQL gerektirir. Üretim kodu değişmez; mevcut davranışı negatif senaryolarla sabitler.
 *  1. Yatay yetki (IDOR): başka topluluğun moderatörü geçmiş, karar, rapor, taşıma ve geri alma işlemlerine ulaşamaz; listelerde
 *     görmez; reddedilen denemeler iz bırakmaz.
 *  2. Moderasyonla kaldırılan anket: sahibi dahil herkese 404; yazma yolları kayıt üretmez; profil, kayıtlı listesi ve trendde yok.
 *  3. Moderasyonla kaldırılan yorum: tepki, düzenleme ve cevap yazılamaz; profilde yok; metni sızmaz.
 *  4. Audit: başarılı kaldırma tek kayıt yazar (aktör, gerekçe, istek kimliği, önce/sonra).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

describe("#303 moderasyon yetki retleri ve kaldırılmış içerik (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  function send(method: Method, url: string, body?: unknown, cookie?: string): Promise<Res> {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        "idempotency-key": `r303-${randomUUID()}`,
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);
  function assertError(res: Res, status: number, code: string, label: string) {
    assert.equal(res.statusCode, status, `${label}: ${res.body}`);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code, label);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `r303_${id}@example.test`, username: `r303_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, username: account.username };
  }
  async function moderatorOf(communityId: string): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role: "MODERATOR", grantedById: superAdmin.id } });
    await db.$transaction([
      db.communityMembership.create({ data: { communityId, userId: user.id, role: "MODERATOR" } }),
      db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);
    return user;
  }
  const community = () => db.community.create({ data: { slug: `r303-${randomUUID().slice(0, 8)}`, name: "Kapsam Topluluğu", createdById: superAdmin.id } });
  async function createPoll(author: User, communityId?: string) {
    if (communityId) {
      await db.$transaction([
        db.communityMembership.upsert({ where: { communityId_userId: { communityId, userId: author.id } }, create: { communityId, userId: author.id }, update: {} }),
        db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
      ]);
    }
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Kapsam sorusu ${randomUUID().slice(0, 8)}`, categoryId, ...(communityId ? { communityId } : {}), durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
    );
    assert.equal(res.statusCode, 201, res.body);
    const data = res.json().data;
    return { id: data.id as string, publicId: data.publicId as string, optionId: data.options[0].id as string };
  }
  async function createComment(pollId: string, author: User, text = "Bence kararın arkasındayım.") {
    const res = await send("POST", `/polls/${pollId}/comments`, { body: text }, author.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const moderate = (kind: "polls" | "comments", id: string, action: string, cookie?: string) =>
    send("POST", `/admin/${kind}/${id}/moderation`, { action, reason: "Güvenlik incelemesi" }, cookie);
  const ids = (res: Res) => (res.json().data as { id: string }[]).map((r) => r.id);

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `r303-${randomUUID().slice(0, 8)}`, name: "Güvenlik İncelemesi" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: superAdmin.id } });
  });
  after(async () => {
    await h?.close();
  });

  test("yatay yetki: B moderatörü A'nın içeriğinde geçmiş, karar, rapor, taşıma ve geri almaya ulaşamaz; iz bırakmaz", async () => {
    const a = await community();
    const b = await community();
    const author = await signUp();
    const reporter = await signUp();
    const modB = await moderatorOf(b.id);
    const poll = await createPoll(author, a.id);
    const commentId = await createComment(poll.id, author);
    const filed = await send("POST", "/reports", { target: { type: "POLL", id: poll.id }, reason: "SPAM" }, reporter.cookie);
    assert.equal(filed.statusCode, 202, filed.body);
    const reportId = filed.json().data.reportId as string;
    // Geri alma denemesi için A'da gerçek bir karar: yöneticinin gizlemesi.
    const commentHidden = await moderate("comments", commentId, "HIDE", admin.cookie);
    assert.equal(commentHidden.statusCode, 200, commentHidden.body);
    const [action] = await db.moderationAction.findMany({ where: { commentId }, select: { id: true } });

    const auditBefore = await db.auditLog.count();
    const actionsBefore = await db.moderationAction.count();
    const denied: [string, Res][] = [
      ["anket kararı", await moderate("polls", poll.id, "HIDE", modB.cookie)],
      ["yorum kararı", await moderate("comments", commentId, "RESTORE", modB.cookie)],
      ["anket geçmişi", await get(`/admin/polls/${poll.id}/moderation-history`, modB.cookie)],
      ["yorum geçmişi", await get(`/admin/comments/${commentId}/moderation-history`, modB.cookie)],
      ["rapor sonuçlandırma", await send("POST", `/admin/reports/${reportId}/resolve`, { resolution: "DISMISSED", note: "Kapsam dışı deneme" }, modB.cookie)],
      ["rapordan uyarı", await send("POST", `/admin/reports/${reportId}/warn`, { reason: "Kapsam dışı deneme" }, modB.cookie)],
      ["taşıma", await send("PATCH", `/admin/polls/${poll.id}/placement`, { communityId: b.id, reason: "Kapsam dışı deneme" }, modB.cookie)],
    ];
    for (const [label, res] of denied) assertError(res, 403, "FORBIDDEN", label);
    // Başkasının kararı: varlığı da ele verilmez (403 değil 404).
    assertError(await get(`/admin/moderation/actions/${action!.id}/undo/preview`, modB.cookie), 404, "NOT_FOUND", "geri alma önizlemesi");
    assertError(await send("POST", `/admin/moderation/actions/${action!.id}/undo`, { reason: "Kapsam dışı deneme", digest: "a".repeat(64) }, modB.cookie), 404, "NOT_FOUND", "geri alma");

    assert.equal(await db.auditLog.count(), auditBefore, "reddedilen denemeler audit yazmaz");
    assert.equal(await db.moderationAction.count(), actionsBefore, "reddedilen denemeler karar yazmaz");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).status, "ACTIVE");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).communityId, a.id, "taşınmadı");
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: reportId } })).status, "OPEN");
    assert.equal((await db.comment.findUniqueOrThrow({ where: { id: commentId } })).status, "HIDDEN");

    // Listeler kapsamla süzülür; communityId vermek kapsamı genişletmez.
    for (const url of ["/admin/polls?limit=100", `/admin/polls?limit=100&communityId=${a.id}`]) {
      const res = await get(url, modB.cookie);
      if (res.statusCode === 200) assert.ok(!ids(res).includes(poll.id), `${url}: başka topluluğun anketi listelendi`);
      else assertError(res, 403, "FORBIDDEN", url);
    }
    for (const url of ["/admin/comments?limit=100", `/admin/comments?limit=100&communityId=${a.id}`]) {
      const res = await get(url, modB.cookie);
      if (res.statusCode === 200) assert.ok(!ids(res).includes(commentId), `${url}: başka topluluğun yorumu listelendi`);
      else assertError(res, 403, "FORBIDDEN", url);
    }
    for (const url of ["/admin/reports?limit=100", `/admin/reports?limit=100&communityId=${a.id}`]) {
      const res = await get(url, modB.cookie);
      if (res.statusCode === 200) assert.ok(!ids(res).includes(reportId), `${url}: başka topluluğun raporu listelendi`);
      else assertError(res, 403, "FORBIDDEN", url);
      assert.ok(!res.body.includes(reporter.id) && !res.body.includes(reporter.username), `${url}: raporlayan sızdı`);
    }
  });

  test("A moderatörü anketini kendi yetkisi olmayan topluluğa taşıyamaz; rolsüz üye ve misafir moderasyon uçlarına giremez", async () => {
    const a = await community();
    const b = await community();
    const author = await signUp();
    const member = await signUp();
    const modA = await moderatorOf(a.id);
    const poll = await createPoll(author, a.id);
    const commentId = await createComment(poll.id, author);
    assertError(await send("PATCH", `/admin/polls/${poll.id}/placement`, { communityId: b.id, reason: "Başka topluluğa taşıma" }, modA.cookie), 403, "FORBIDDEN", "taşıma");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).communityId, a.id);

    for (const [label, cookie, status, code] of [["üye", member.cookie, 403, "FORBIDDEN"], ["içerik sahibi", author.cookie, 403, "FORBIDDEN"], ["misafir", undefined, 401, "UNAUTHENTICATED"]] as const) {
      assertError(await get("/admin/polls", cookie), status, code, `${label}: anket listesi`);
      assertError(await get("/admin/comments", cookie), status, code, `${label}: yorum listesi`);
      assertError(await get(`/admin/polls/${poll.id}/moderation-history`, cookie), status, code, `${label}: geçmiş`);
      assertError(await moderate("polls", poll.id, "REMOVE", cookie), status, code, `${label}: kaldırma`);
      assertError(await moderate("comments", commentId, "REMOVE", cookie), status, code, `${label}: yorum kaldırma`);
    }
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).status, "ACTIVE");
  });

  test("audit: kaldırma tek kayıt yazar (aktör, gerekçe, istek kimliği, önce/sonra); tekrar iz bırakmaz", async () => {
    const author = await signUp();
    const poll = await createPoll(author);
    const res = await moderate("polls", poll.id, "REMOVE", admin.cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await moderate("polls", poll.id, "REMOVE", admin.cookie)).statusCode, 200, "idempotent");
    const rows = await db.auditLog.findMany({ where: { action: "moderation.poll.apply", targetId: poll.id } });
    assert.equal(rows.length, 1, "tekrar audit yazmaz");
    const [row] = rows;
    assert.deepEqual([row!.actorId, row!.operation, row!.source, row!.targetType, row!.reason], [admin.id, "remove", "API", "POLL", "Güvenlik incelemesi"]);
    assert.equal(row!.requestId, res.headers["x-request-id"]);
    assert.equal((row!.before as { status: string }).status, "ACTIVE");
    assert.equal((row!.after as { status: string }).status, "REMOVED");
    assert.ok(!JSON.stringify(row).includes(author.username), "özet kullanıcı adı taşımaz");
  });

  /** Yazma istekleri. Aynı liste aktif ankette de denenir: uç yoksa da 404 döneceği için ret kontrolü tek başına kanıt değildir. */
  const writeAttempts = (poll: { id: string; optionId: string }, viewer: User, author: User): [string, () => Promise<Res>][] => [
    ["oy", () => send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.optionId }, viewer.cookie)],
    ["tepki", () => send("PUT", `/polls/${poll.id}/reaction`, { value: "LIKE" }, viewer.cookie)],
    ["yorum", () => send("POST", `/polls/${poll.id}/comments`, { body: "Ankete yorum denemesi" }, viewer.cookie)],
    ["kayıt", () => send("PUT", `/polls/${poll.id}/bookmark`, undefined, viewer.cookie)],
    ["takip", () => send("PUT", `/polls/${poll.id}/follow`, undefined, viewer.cookie)],
    ["paylaşım", () => send("POST", `/polls/${poll.id}/shares`, { channel: "other" }, viewer.cookie)],
    ["rapor", () => send("POST", "/reports", { target: { type: "POLL", id: poll.id }, reason: "SPAM" }, viewer.cookie)],
    ["sahip ek açıklama", () => send("POST", `/polls/${poll.id}/addenda`, { body: "Ankete ek açıklama denemesi" }, author.cookie)],
    ["sahip kararı", () => send("PUT", `/polls/${poll.id}/decision`, { chosenOptionId: poll.optionId, note: "Kararımı açıklıyorum" }, author.cookie)],
    ["sahip düzenleme", () => send("PATCH", `/polls/${poll.id}`, { title: "Yeni başlık denemesi uzun metin" }, author.cookie)],
    ["sahip kapatma", () => send("POST", `/polls/${poll.id}/close`, undefined, author.cookie)],
  ];

  test("kontrol: aynı yazma istekleri aktif ankette uca ulaşır (404 değil), kaldırılan testi boş geçmez", async () => {
    const author = await signUp();
    const viewer = await signUp();
    const poll = await createPoll(author);
    for (const [label, attempt] of writeAttempts(poll, viewer, author)) {
      const res = await attempt();
      // 409 kabul: ör. ilk oydan sonra düzenleme kilidi. 400 ve 404 kabul değil, istek işleyiciye ulaşmalı.
      assert.ok(res.statusCode < 400 || res.statusCode === 409, `${label}: ${res.statusCode} ${res.body}`);
    }
  });

  test("kaldırılan anket: sahibi dahil herkese 404; yazma yolları kayıt üretmez; profil, kayıtlı listesi ve trendde yok", async () => {
    const author = await signUp();
    const viewer = await signUp();
    const poll = await createPoll(author);
    const commentId = await createComment(poll.id, viewer, "Silinecek ankette yorum");
    assert.equal((await send("PUT", `/polls/${poll.id}/bookmark`, undefined, viewer.cookie)).statusCode, 200);
    assert.ok(ids(await get(`/profiles/${author.username}/polls`, viewer.cookie)).includes(poll.id), "önce profilde");
    assert.ok(ids(await get(`/profiles/${viewer.username}/comments`, viewer.cookie)).includes(commentId), "önce profilde yorum");
    assert.equal((await get("/me/bookmarks", viewer.cookie)).body.includes(poll.id), true, "önce kayıtlılarda");

    const latest = await db.trendRun.findFirst({ orderBy: { windowEnd: "desc" }, select: { windowEnd: true } });
    const windowEnd = new Date((latest?.windowEnd.getTime() ?? h.clock.now.getTime()) + 60_000);
    const run = await db.trendRun.create({
      data: { format: "WEEKLY_MOST_VOTED", calculationVersion: 1, status: "SUCCEEDED", windowStart: new Date(windowEnd.getTime() - 3_600_000), windowEnd, startedAt: windowEnd, finishedAt: windowEnd },
    });
    await db.trendScore.create({ data: { runId: run.id, pollId: poll.id, rank: 1, score: 10, components: {} } });
    try {
      assert.ok((await get(`/trends/WEEKLY_MOST_VOTED?categoryId=${categoryId}`)).body.includes(poll.id), "önce trendde");

      assert.equal((await moderate("polls", poll.id, "REMOVE", admin.cookie)).statusCode, 200);

      for (const [who, cookie] of [["misafir", undefined], ["üye", viewer.cookie], ["sahip", author.cookie]] as const) {
        for (const url of [`/polls/${poll.id}`, `/polls/${poll.id}/comments`, `/polls/${poll.id}/history`, `/polls/${poll.id}/decision`, `/polls/lookup?publicId=${poll.publicId}`]) {
          assertError(await get(url, cookie), 404, "NOT_FOUND", `${who} ${url}`);
        }
        for (const url of [`/profiles/${author.username}/polls`, `/profiles/${viewer.username}/comments`]) {
          const res = await get(url, cookie);
          assert.equal(res.statusCode, 200, res.body);
          assert.ok(!res.body.includes(poll.id), `${who} ${url}: kaldırılan anket izi`);
        }
        assert.ok(!(await get(`/trends/WEEKLY_MOST_VOTED?categoryId=${categoryId}`, cookie)).body.includes(poll.id), `${who}: trend`);
      }
      assert.ok(!(await get("/me/bookmarks", viewer.cookie)).body.includes(poll.id), "kayıtlı listesi");

      const counts = async () => ({
        votes: await db.vote.count({ where: { pollId: poll.id } }),
        comments: await db.comment.count({ where: { pollId: poll.id } }),
        reports: await db.report.count({ where: { pollId: poll.id } }),
        shares: await db.shareLink.count({ where: { pollId: poll.id } }),
        audit: await db.auditLog.count({ where: { targetId: poll.id } }),
        title: (await db.poll.findUniqueOrThrow({ where: { id: poll.id } })).title,
      });
      const before = await counts();
      for (const [label, attempt] of writeAttempts(poll, viewer, author)) assertError(await attempt(), 404, "NOT_FOUND", label);
      assert.deepEqual(await counts(), before, "yazma denemeleri kayıt üretmez");
    } finally {
      await db.trendRun.delete({ where: { id: run.id } });
    }
  });

  test("kaldırılan yorum: metni sızmaz, profilde yok; tepki, düzenleme ve cevap yazılamaz", async () => {
    const author = await signUp();
    const commenter = await signUp();
    const viewer = await signUp();
    const poll = await createPoll(author);
    const secret = `GIZLIYORUM${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const commentId = await createComment(poll.id, commenter, secret);
    const reply = await send("POST", `/polls/${poll.id}/comments`, { body: "Cevap bırakıyorum", parentId: commentId }, viewer.cookie);
    assert.equal(reply.statusCode, 201, reply.body);

    assert.equal((await moderate("comments", commentId, "REMOVE", admin.cookie)).statusCode, 200);

    for (const url of [`/polls/${poll.id}/comments`, `/profiles/${commenter.username}/comments`, `/comments/${commentId}/replies`]) {
      for (const cookie of [undefined, viewer.cookie, commenter.cookie]) {
        assert.ok(!(await get(url, cookie)).body.includes(secret), `${url}: kaldırılan yorum metni sızdı`);
      }
    }
    assert.ok(!(await get(`/profiles/${commenter.username}/comments`, commenter.cookie)).body.includes(commentId), "profilde yok");

    const stored = await db.comment.findUniqueOrThrow({ where: { id: commentId } });
    assertError(await send("PUT", `/comments/${commentId}/reaction`, { value: "LIKE" }, viewer.cookie), 404, "NOT_FOUND", "tepki");
    assertError(await send("PATCH", `/comments/${commentId}`, { body: "Kaldırıldıktan sonra düzenleme" }, commenter.cookie), 404, "NOT_FOUND", "sahip düzenleme");
    const replied = await send("POST", `/polls/${poll.id}/comments`, { body: "Kaldırılmış yoruma cevap", parentId: commentId }, viewer.cookie);
    // Var olmayan üst yorumla aynı cevap: kaldırılan yorumun varlığı ele verilmez.
    assertError(replied, 400, "VALIDATION_ERROR", "kaldırılan yoruma cevap");
    assert.deepEqual(replied.json().error.details[0], { field: "parentId", code: "not_found" });
    const ghost = await send("POST", `/polls/${poll.id}/comments`, { body: "Olmayan yoruma cevap", parentId: randomUUID() }, viewer.cookie);
    assert.deepEqual(ghost.json().error.details, replied.json().error.details, "olmayan yorumla ayırt edilemez");
    const after = await db.comment.findUniqueOrThrow({ where: { id: commentId } });
    assert.deepEqual([after.body, after.replyCount, after.status], [stored.body, stored.replyCount, "REMOVED"], "yazma denemeleri değiştirmedi");
  });
});
