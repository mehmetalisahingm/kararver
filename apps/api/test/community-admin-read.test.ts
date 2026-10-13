/**
 * #184 topluluk yönetim görünümü (salt okuma): admin.communities.listAll / overview / members ve 7 gün / 10 üye eşiği durumu.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). Test DB'si dosyalar arasında sıfırlanmaz: listeler her testin
 * kendi slug önekiyle süzülür.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AdminCommunityOverview, AdminCommunityRow, CommunityMember, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { expireCommunityRequests } from "../../worker/src/jobs/communities/expire-requests.ts";
import { REQUIRED_MEMBERS, thresholdOf, type ThresholdRequest } from "../src/modules/communities/admin-read.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-13T12:00:00.000Z");
const approved = (deadline: Date | null): ThresholdRequest => ({ id: "r1", status: "APPROVED", approvedAt: new Date(NOW.getTime() - 3 * DAY), approvalDeadline: deadline, closedAt: null });

describe("eşik durumu (saf fonksiyon)", () => {
  test("başvurusuz veya karara bağlanmamış başvuru: NOT_APPLICABLE; 10 üye eşiği sabiti", () => {
    assert.equal(REQUIRED_MEMBERS, 10);
    assert.equal(thresholdOf(null, "ACTIVE", 3, NOW).state, "NOT_APPLICABLE");
    assert.equal(thresholdOf({ id: "r", status: "PENDING", approvedAt: null, approvalDeadline: null, closedAt: null }, "ACTIVE", 0, NOW).state, "NOT_APPLICABLE");
    assert.equal(thresholdOf({ id: "r", status: "REJECTED", approvedAt: null, approvalDeadline: null, closedAt: null }, "ACTIVE", 0, NOW).state, "NOT_APPLICABLE");
  });

  test("süre sürerken IN_PROGRESS ve kalan gün yukarı yuvarlanır; süre doldu: 10 üye REACHED, 9 üye OVERDUE; sınır anı süre dolmuş sayılır", () => {
    const soon = thresholdOf(approved(new Date(NOW.getTime() + 2 * DAY + 1)), "ACTIVE", 4, NOW);
    assert.deepEqual([soon.state, soon.daysLeft, soon.members, soon.requiredMembers], ["IN_PROGRESS", 3, 4, 10]);
    assert.equal(thresholdOf(approved(new Date(NOW.getTime() + 1)), "ACTIVE", 0, NOW).daysLeft, 1);
    assert.deepEqual([thresholdOf(approved(NOW), "ACTIVE", 10, NOW).state, thresholdOf(approved(NOW), "ACTIVE", 10, NOW).daysLeft], ["REACHED", null]);
    assert.equal(thresholdOf(approved(new Date(NOW.getTime() - DAY)), "ACTIVE", 25, NOW).state, "REACHED");
    assert.equal(thresholdOf(approved(new Date(NOW.getTime() - DAY)), "ACTIVE", 9, NOW).state, "OVERDUE");
    // Elle HIDDEN yapılmış topluluk: worker kapatmaz, süre dolmuş ve eşik altı → OVERDUE olarak görünür kalır.
    assert.equal(thresholdOf(approved(new Date(NOW.getTime() - DAY)), "HIDDEN", 2, NOW).state, "OVERDUE");
  });

  test("kapanış: CLOSED başvuru + HIDDEN topluluk AUTO_CLOSED; yönetici yeniden açtıysa REOPENED", () => {
    const closed: ThresholdRequest = { id: "r1", status: "CLOSED", approvedAt: new Date(NOW.getTime() - 9 * DAY), approvalDeadline: new Date(NOW.getTime() - 2 * DAY), closedAt: NOW };
    const auto = thresholdOf(closed, "HIDDEN", 3, NOW);
    assert.deepEqual([auto.state, auto.closedAt?.toISOString(), auto.daysLeft], ["AUTO_CLOSED", NOW.toISOString(), null]);
    assert.equal(thresholdOf(closed, "ACTIVE", 3, NOW).state, "REOPENED");
  });
});

describe("topluluk yönetim görünümü (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let admin: User;
  let moderator: User;
  let plain: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    const boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: boss.id } });
    moderator = await signUp();
    await db.userRole.create({ data: { userId: moderator.id, role: "MODERATOR", grantedById: boss.id } });
    plain = await signUp();
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: unknown, cookie?: string) {
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

  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ca_${id}@example.test`, username: `ca_${id}`, displayName: `Ad ${id}`, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username };
  }

  const prefix = () => `ca${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  async function community(slug: string, name = "Test topluluğu", visibility = "MEMBERS") {
    const res = await send("POST", "/admin/communities", { slug, name, membersVisibility: visibility }, admin.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const member = (communityId: string, userId: string, role: "MEMBER" | "MODERATOR" = "MEMBER", at?: Date) =>
    db.communityMembership.create({ data: { communityId, userId, role, ...(at ? { createdAt: at } : {}) } });
  const listAll = (query: string, cookie = admin.cookie) => send("GET", `/admin/communities${query}`, undefined, cookie);
  const overview = (id: string, cookie = admin.cookie) => send("GET", `/admin/communities/${id}/overview`, undefined, cookie);
  const members = (id: string, query = "", cookie = admin.cookie) => send("GET", `/admin/communities/${id}/members${query}`, undefined, cookie);
  const categoryId = async () => (await db.category.findFirst({ select: { id: true } }))?.id ?? (await db.category.create({ data: { slug: `c-${randomUUID().slice(0, 6)}`, name: "C" } })).id;
  async function poll(communityId: string, authorId: string, extra: Record<string, unknown> = {}) {
    return db.poll.create({
      data: {
        authorId,
        communityId,
        categoryId: await categoryId(),
        publicId: randomUUID().replaceAll("-", "").slice(0, 12),
        slug: "ca",
        title: "Topluluk anketi",
        closesAt: new Date("2031-01-01T00:00:00Z"),
        options: { create: [{ position: 0, label: "A" }, { position: 1, label: "B" }] },
        ...extra,
      },
      select: { id: true },
    });
  }

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve moderatör 403; ADMIN 200; olmayan topluluk 404 (üç endpoint)", async () => {
    const id = await community(prefix());
    for (const call of [(c: string) => listAll("", c), (c: string) => overview(id, c), (c: string) => members(id, "", c)]) {
      assertError(await call(""), 401, "UNAUTHENTICATED");
      assertError(await call(plain.cookie), 403, "FORBIDDEN");
      assertError(await call(moderator.cookie), 403, "FORBIDDEN");
      assert.equal((await call(admin.cookie)).statusCode, 200);
    }
    assertError(await overview(randomUUID()), 404, "NOT_FOUND");
    assertError(await members(randomUUID()), 404, "NOT_FOUND");
    assertError(await listAll("?status=DELETED"), 400, "VALIDATION_ERROR");
    assertError(await listAll("?q=a"), 400, "VALIDATION_ERROR");
  });

  // ─── Liste ──────────────────────────────────────────────────

  test("liste: kapalı topluluklar dahil, durum ve ad/slug süzgeci, sayılar (üye, moderatör, silinmemiş anket) ve sayfalama", async () => {
    const p = prefix();
    const a = await community(`${p}-bir`, "Alfa Kampüs");
    const b = await community(`${p}-iki`, "Beta Kampüs");
    const c = await community(`${p}-uc`, "Gama Teknoloji");
    const u1 = await signUp();
    const u2 = await signUp();
    await member(a, u1.id);
    await member(a, u2.id, "MODERATOR");
    const gone = await signUp();
    await member(a, gone.id);
    await db.user.update({ where: { id: gone.id }, data: { deletedAt: NOW } });
    await poll(a, u1.id);
    await poll(a, u1.id);
    await poll(a, u1.id, { status: "REMOVED", deletedAt: NOW });
    assert.equal((await send("PATCH", `/admin/communities/${b}`, { status: "HIDDEN", reason: "Kurallar ihlali nedeniyle kapatıldı" }, admin.cookie)).statusCode, 200);

    const all = await listAll(`?q=${p}`);
    assert.equal(all.statusCode, 200, all.body);
    const rows = (all.json().data as unknown[]).map((r) => AdminCommunityRow.parse(r));
    assert.deepEqual(rows.map((r) => r.slug).sort(), [`${p}-bir`, `${p}-iki`, `${p}-uc`]);
    const alfa = rows.find((r) => r.id === a)!;
    assert.deepEqual([alfa.members, alfa.moderators, alfa.polls, alfa.status], [2, 1, 2, "ACTIVE"], "silinmiş hesap ve kaldırılmış anket sayılmaz");
    assert.equal(alfa.threshold.state, "NOT_APPLICABLE");
    assert.equal(rows.find((r) => r.id === b)!.status, "HIDDEN", "kapalı topluluk yöneticiye görünür");

    assert.deepEqual(((await listAll(`?q=${p}&status=HIDDEN`)).json().data as any[]).map((r) => r.id), [b]);
    assert.deepEqual(((await listAll(`?q=${p}&status=ACTIVE`)).json().data as any[]).map((r) => r.id).sort(), [a, c].sort());
    assert.deepEqual(((await listAll(`?q=${p}-uc`)).json().data as any[]).map((r) => r.id), [c], "slug araması");
    assert.deepEqual(((await listAll(`?q=GAMA%20TEKNO`)).json().data as any[]).filter((r) => r.id === c).map((r) => r.id), [c], "ad araması büyük/küçük harf duyarsız");

    // Sayfalama: en yeni önce, tekrarsız ve eksiksiz; filtre değişince eski cursor reddedilir.
    const first = await listAll(`?q=${p}&limit=2`);
    assert.equal(first.json().data.length, 2);
    assert.equal(first.json().page.hasMore, true);
    const second = await listAll(`?q=${p}&limit=2&cursor=${first.json().page.nextCursor}`);
    const ids = [...first.json().data, ...second.json().data].map((r: any) => r.id);
    assert.equal(new Set(ids).size, 3);
    assert.equal(second.json().page.hasMore, false);
    assertError(await listAll(`?q=${p}&status=ACTIVE&limit=2&cursor=${first.json().page.nextCursor}`), 400, "INVALID_CURSOR");
  });

  // ─── Genel bakış ────────────────────────────────────────────

  test("genel bakış: etki sayıları (anket, açık anket, yorum, açık rapor), yaratıcı, kapalı topluluk okunur; salt okuma (iz bırakmaz)", async () => {
    const id = await community(prefix(), "Etki testi");
    const author = await signUp();
    const other = await signUp();
    await member(id, author.id);
    await member(id, other.id, "MODERATOR");
    const active = await poll(id, author.id);
    await poll(id, author.id, { status: "HIDDEN" });
    // Tartışma: ACTIVE ama oylanan anket değil (açık anket sayılmaz).
    await poll(id, author.id, { kind: "DISCUSSION", closesAt: null, resultsVisibility: null, options: undefined });
    await poll(id, author.id, { status: "REMOVED", deletedAt: NOW });
    await db.poll.update({ where: { id: active.id }, data: { commentCount: 7 } });
    const comment = await db.comment.create({ data: { pollId: active.id, authorId: other.id, body: "yorum" }, select: { id: true } });
    await db.report.create({ data: { reporterId: other.id, pollId: active.id, reason: "SPAM" } });
    await db.report.create({ data: { reporterId: author.id, commentId: comment.id, reason: "SPAM" } });
    const before = await db.auditLog.count({ where: { targetType: "COMMUNITY", targetId: id } });

    const open = AdminCommunityOverview.parse((await overview(id)).json().data);
    assert.deepEqual(open.impact, { members: 2, moderators: 1, polls: 3, activePolls: 2, openPolls: 1, comments: 7, openReports: 2 });
    assert.equal(open.createdBy.id, admin.id);
    assert.equal(open.status, "ACTIVE");
    assert.equal(await db.auditLog.count({ where: { targetType: "COMMUNITY", targetId: id } }), before, "okuma audit yazmaz");

    assert.equal((await send("PATCH", `/admin/communities/${id}`, { status: "HIDDEN", reason: "Etki önizlemesi sonrası kapatıldı" }, admin.cookie)).statusCode, 200);
    const closed = AdminCommunityOverview.parse((await overview(id)).json().data);
    assert.equal(closed.status, "HIDDEN");
    assert.equal(closed.impact.members, 2, "üyelikler silinmez");
    assert.equal(closed.impact.polls, 3, "anketler silinmez");
    assertError(await send("GET", `/communities/${id}`, undefined, plain.cookie), 404, "NOT_FOUND");
  });

  test("son yönetim izi: kapatma/açma gerekçe ve aktörle (yeniden eskiye, en çok 10); önce/sonra özeti dönmez", async () => {
    const id = await community(prefix(), "İz testi");
    assert.equal((await send("PATCH", `/admin/communities/${id}`, { status: "HIDDEN", reason: "Geçici kapatma: inceleme" }, admin.cookie)).statusCode, 200);
    assert.equal((await send("PATCH", `/admin/communities/${id}`, { status: "ACTIVE", reason: "İnceleme bitti, yeniden açıldı" }, admin.cookie)).statusCode, 200);
    const body = (await overview(id)).json().data;
    AdminCommunityOverview.parse(body);
    const changes = body.recentChanges as { reason: string; operation: string; action: string; actor: { id: string } | null }[];
    assert.ok(changes.length >= 3, "açma + iki güncelleme");
    assert.deepEqual(changes.slice(0, 2).map((c) => c.reason), ["İnceleme bitti, yeniden açıldı", "Geçici kapatma: inceleme"]);
    assert.equal(changes[0]!.actor?.id, admin.id);
    assert.ok(changes.every((c) => !("before" in c) && !("after" in c)));
    for (let i = 0; i < 12; i++) await send("PATCH", `/admin/communities/${id}`, { name: `İz testi ${i}`, reason: `Ad değişikliği ${i}` }, admin.cookie);
    assert.equal(((await overview(id)).json().data.recentChanges as unknown[]).length, 10);
  });

  // ─── 7 gün / 10 üye eşiği ───────────────────────────────────

  test("eşik: başvuru onayı IN_PROGRESS (7 gün); süre dolup eşik altında OVERDUE; worker kapatınca AUTO_CLOSED; yönetici açınca REOPENED ve yeniden kapanmaz", async () => {
    const requester = await signUp();
    const slug = prefix();
    const created = await send("POST", "/communities/requests", { name: "Eşik topluluğu", slug }, requester.cookie);
    assert.ok(created.statusCode === 200 || created.statusCode === 201, created.body);
    const requestId = created.json().data.id as string;
    const decided = await send("PATCH", `/admin/communities/requests/${requestId}`, { decision: "APPROVE", reason: "Uygun görüldü, onaylandı" }, admin.cookie);
    assert.equal(decided.statusCode, 200, decided.body);
    const communityId = decided.json().data.communityId as string;

    const start = AdminCommunityOverview.parse((await overview(communityId)).json().data);
    assert.equal(start.threshold.state, "IN_PROGRESS");
    assert.equal(start.threshold.requestId, requestId);
    assert.equal(start.threshold.members, 1, "başvuran üye olarak eklenir");
    assert.ok(start.threshold.daysLeft! >= 1 && start.threshold.daysLeft! <= 7, `kalan gün ${start.threshold.daysLeft}`);
    assert.ok(start.threshold.approvalDeadline);

    // Süre doldu, eşik altı: görünür ama henüz kapanmadı (günlük worker bekleniyor).
    const past = new Date(h.clock.now.getTime() - DAY);
    await db.communityRequest.update({ where: { id: requestId }, data: { approvalDeadline: past } });
    const overdue = (await overview(communityId)).json().data;
    assert.equal(overdue.threshold.state, "OVERDUE");
    assert.equal(overdue.status, "ACTIVE");
    assert.equal(((await listAll(`?q=${slug}`)).json().data as any[])[0].threshold.state, "OVERDUE", "liste satırında da görünür");

    const result = await expireCommunityRequests({ prisma: db, now: () => h.clock.now, log: () => {} });
    assert.ok(result.closed >= 1);
    const closed = (await overview(communityId)).json().data;
    assert.equal(closed.threshold.state, "AUTO_CLOSED");
    assert.equal(closed.status, "HIDDEN");
    assert.ok(closed.threshold.closedAt);
    const systemEntry = (closed.recentChanges as any[]).find((c) => c.action === "community.request.expire");
    assert.ok(systemEntry, "worker kapanışı yönetim izinde görünür");
    assert.equal(systemEntry.actor, null, "sistem işlemi aktörsüz");

    // Yönetici yeniden açar: başvuru CLOSED kaldığından worker bir daha kapatmaz.
    assert.equal((await send("PATCH", `/admin/communities/${communityId}`, { status: "ACTIVE", reason: "Topluluk sahibiyle görüşüldü, yeniden açıldı" }, admin.cookie)).statusCode, 200);
    assert.equal((await overview(communityId)).json().data.threshold.state, "REOPENED");
    await expireCommunityRequests({ prisma: db, now: () => h.clock.now, log: () => {} });
    assert.equal((await overview(communityId)).json().data.status, "ACTIVE", "yeniden açılan topluluk tekrar otomatik kapanmaz");
  });

  test("eşik: süre dolduğunda 10 üyeye ulaşmış topluluk REACHED olur ve worker kapatmaz", async () => {
    const requester = await signUp();
    const slug = prefix();
    const created = await send("POST", "/communities/requests", { name: "Dolu topluluk", slug }, requester.cookie);
    const requestId = created.json().data.id as string;
    const communityId = (await send("PATCH", `/admin/communities/requests/${requestId}`, { decision: "APPROVE", reason: "Uygun görüldü, onaylandı" }, admin.cookie)).json().data.communityId as string;
    for (let i = 0; i < 9; i++) await member(communityId, (await signUp()).id);
    await db.communityRequest.update({ where: { id: requestId }, data: { approvalDeadline: new Date(h.clock.now.getTime() - DAY) } });
    const reached = (await overview(communityId)).json().data;
    assert.deepEqual([reached.threshold.state, reached.threshold.members], ["REACHED", 10]);
    await expireCommunityRequests({ prisma: db, now: () => h.clock.now, log: () => {} });
    assert.equal((await overview(communityId)).json().data.status, "ACTIVE");
  });

  // ─── Üyeler ─────────────────────────────────────────────────

  test("üyeler: yönetici görünürlük ayarına (yalnız moderatörler) ve kapalı topluluğa takılmaz; arama, rol süzgeci, sayfalama; yalnız PublicUser alanları", async () => {
    const id = await community(prefix(), "Üye testi", "MODERATORS");
    const users = [];
    for (let i = 0; i < 5; i++) {
      const u = await signUp();
      users.push(u);
      await member(id, u.id, i === 0 ? "MODERATOR" : "MEMBER", new Date(NOW.getTime() - i * 1000));
    }
    const gone = await signUp();
    await member(id, gone.id);
    await db.user.update({ where: { id: gone.id }, data: { deletedAt: NOW } });
    // Genel liste yetkisiz izleyiciye 404 (görünürlük MODERATORS); yönetici görür.
    assertError(await send("GET", `/communities/${id}/members`, undefined, plain.cookie), 404, "NOT_FOUND");
    const all = await members(id);
    assert.equal(all.statusCode, 200, all.body);
    const rows = (all.json().data as unknown[]).map((r) => CommunityMember.parse(r));
    assert.equal(rows.length, 5, "silinmiş hesap listelenmez");
    assert.deepEqual(rows.map((r) => r.user.id), users.map((u) => u.id), "katılım zamanına göre yeniden eskiye");
    const text = all.body;
    for (const forbidden of ["email", "passwordHash", "status\":\"ACTIVE\",\"role", "emailVerified"]) assert.equal(text.includes(forbidden), false, forbidden);

    assert.deepEqual(((await members(id, "?role=MODERATOR")).json().data as any[]).map((r) => r.user.id), [users[0]!.id]);
    assert.deepEqual(((await members(id, `?q=${users[2]!.username.toUpperCase()}`)).json().data as any[]).map((r) => r.user.id), [users[2]!.id], "kullanıcı adı, büyük/küçük harf duyarsız");
    assert.equal(((await members(id, "?q=zzzz-yok")).json().data as any[]).length, 0);

    const first = await members(id, "?limit=2");
    const second = await members(id, `?limit=2&cursor=${first.json().page.nextCursor}`);
    const third = await members(id, `?limit=2&cursor=${second.json().page.nextCursor}`);
    const ids = [...first.json().data, ...second.json().data, ...third.json().data].map((r: any) => r.user.id);
    assert.deepEqual(ids, users.map((u) => u.id), "tekrarsız ve eksiksiz");
    assert.equal(third.json().page.hasMore, false);
    assertError(await members(id, `?role=MODERATOR&limit=2&cursor=${first.json().page.nextCursor}`), 400, "INVALID_CURSOR");

    assert.equal((await send("PATCH", `/admin/communities/${id}`, { status: "HIDDEN", reason: "Üye listesi testi: kapatma" }, admin.cookie)).statusCode, 200);
    assert.equal(((await members(id)).json().data as unknown[]).length, 5, "kapalı topluluğun üyeleri de listelenir");
  });
});
