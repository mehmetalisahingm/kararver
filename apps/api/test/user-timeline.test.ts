/**
 * #183 kullanıcı birleşik geçmişi (KV-33 §13): yetki, bütün olay türleri, süzgeçler (tür, topluluk, içerik, zaman), keyset sayfalama
 * (eşit zamanlı kayıtlarda tekrar/boşluk yok), başkasının verisinin sızmaması ve veri politikası (IP/cihaz/raporlayan yok).
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, UserTimelineItem, UserTimelineSummary } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("kullanıcı birleşik geçmişi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `tl-${randomUUID().slice(0, 8)}`, name: "Birleşik geçmiş" } })).id;
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
  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }
  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `tl_${id}@example.test`, username: `tl_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, username: account.username };
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
  const community = () => db.community.create({ data: { slug: `tl-${randomUUID().slice(0, 8)}`, name: "Birleşik geçmiş topluluğu", createdById: superAdmin.id } });
  async function poll(author: User, communityId?: string, title = `Birleşik geçmiş sorusu ${randomUUID().slice(0, 8)}`) {
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
    return res.json().data.id as string;
  }
  async function comment(pollId: string, cookie: string, body = `Birleşik geçmiş yorumu ${randomUUID().slice(0, 6)}`) {
    const res = await send("POST", `/polls/${pollId}/comments`, { body }, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const timeline = (cookie: string | undefined, userId: string, qs = "") => send("GET", `/admin/users/${userId}/timeline${qs ? `?${qs}` : ""}`, undefined, cookie);
  const summary = (cookie: string | undefined, userId: string) => send("GET", `/admin/users/${userId}/timeline/summary`, undefined, cookie);
  async function all(userId: string, qs = ""): Promise<Array<ReturnType<typeof UserTimelineItem.parse>>> {
    const out: Array<ReturnType<typeof UserTimelineItem.parse>> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res: Res = await timeline(admin.cookie, userId, `limit=100${qs ? `&${qs}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      for (const item of res.json().data) out.push(UserTimelineItem.parse(item));
      cursor = res.json().page.nextCursor;
      if (!cursor) return out;
    }
    throw new Error("sayfalama bitmedi");
  }

  /** Her olay türünden en az bir kaydı olan hesap. */
  async function populated() {
    const c = await community();
    const other = await signUp();
    const mod = await staff("MODERATOR", c.id);
    const subject = await signUp();
    const inCommunity = await poll(subject, c.id);
    const free = await poll(subject);
    const ownComment = await comment(inCommunity, subject.cookie);
    const othersPoll = await poll(other);
    const media = await db.mediaAsset.create({ data: { uploaderId: subject.id, purpose: "POLL", status: "APPROVED", originalObjectKey: `orig/${randomUUID()}`, processedObjectKey: `proc/${randomUUID()}`, publicObjectKey: `m/${randomUUID()}.webp` } });
    const filed = await db.report.create({ data: { reporterId: subject.id, pollId: othersPoll, reason: "SPAM" } });
    const against = await db.report.create({ data: { reporterId: other.id, pollId: inCommunity, reason: "HARASSMENT" } });
    const againstUser = await db.report.create({ data: { reporterId: other.id, reportedUserId: subject.id, reason: "OTHER" } });
    // Moderasyon: moderatör kendi topluluğundaki içeriği gizler (subject hakkında MODERATION, mod için MODERATION_BY).
    const hide = await send("POST", `/admin/polls/${inCommunity}/moderation`, { action: "HIDE", reason: "Moderatör incelemesi" }, mod.cookie);
    assert.equal(hide.statusCode, 200, hide.body);
    const sanction = await db.sanction.create({ data: { userId: subject.id, type: "WARNING", reason: "Uyarı gerekçesi", createdById: admin.id } });
    return { c, other, mod, subject, inCommunity, free, ownComment, othersPoll, media, filed, against, againstUser, sanction };
  }

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401, kullanıcı ve moderatör 403 (yalnız ADMIN+), olmayan kullanıcı 404 (iki uç da)", async () => {
    const user = await signUp();
    const c = await community();
    const mod = await staff("MODERATOR", c.id);
    for (const call of [(cookie?: string) => timeline(cookie, user.id), (cookie?: string) => summary(cookie, user.id)]) {
      assertError(await call(undefined), 401, "UNAUTHENTICATED");
      assertError(await call(user.cookie), 403, "FORBIDDEN");
      assertError(await call(mod.cookie), 403, "FORBIDDEN");
      assert.equal((await call(admin.cookie)).statusCode, 200);
      assert.equal((await call(superAdmin.cookie)).statusCode, 200);
    }
    assertError(await timeline(admin.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await summary(admin.cookie, randomUUID()), 404, "NOT_FOUND");
  });

  // ─── İçerik ─────────────────────────────────────────────────

  test("bütün olay türleri tek çizgide: alanlar sözleşmeye uyar, en yeni önce, özet sayıları listeyle tutarlı", async () => {
    const d = await populated();
    const items = await all(d.subject.id);
    const kinds = new Set(items.map((i) => i.kind));
    for (const kind of ["POLL", "COMMENT", "MEDIA", "REPORT_FILED", "REPORT_AGAINST", "MODERATION", "SANCTION"]) assert.ok(kinds.has(kind as never), kind);
    assert.deepEqual(items.map((i) => i.at), [...items.map((i) => i.at)].sort().reverse(), "en yeni önce");

    const byKind = (kind: string) => items.filter((i) => i.kind === kind);
    assert.equal(byKind("POLL").length, 2);
    assert.equal(byKind("COMMENT").length, 1);
    assert.equal(byKind("MEDIA").length, 1);
    assert.equal(byKind("REPORT_FILED").length, 1);
    assert.equal(byKind("REPORT_AGAINST").length, 2, "içeriğe ve hesaba yapılan");
    assert.equal(byKind("SANCTION").length, 1);
    const hidden = byKind("MODERATION").find((i) => i.refs.pollId === d.inCommunity)!;
    assert.equal(hidden.detail, "HIDE");
    assert.equal(hidden.reason, "Moderatör incelemesi");
    assert.equal(hidden.status, "HIDDEN");
    assert.equal(hidden.actor?.id, d.mod.id);
    assert.equal(hidden.refs.communityId, d.c.id);
    const sanction = byKind("SANCTION")[0]!;
    assert.deepEqual([sanction.detail, sanction.status, sanction.reason, sanction.actor?.id], ["WARNING", "ACTIVE", "Uyarı gerekçesi", admin.id]);
    const poll = byKind("POLL").find((i) => i.id === d.inCommunity)!;
    assert.match(poll.title ?? "", /Birleşik geçmiş sorusu/);
    assert.equal(poll.refs.communityId, d.c.id);
    const media = byKind("MEDIA")[0]!;
    assert.deepEqual([media.refs.mediaId, media.detail, media.status], [d.media.id, "POLL", "APPROVED"]);

    const sum = UserTimelineSummary.parse((await summary(admin.cookie, d.subject.id)).json().data);
    for (const kind of Object.keys(sum.counts) as Array<keyof typeof sum.counts>) assert.equal(sum.counts[kind], byKind(kind).length, kind);
    assert.equal(sum.lastAt, items[0]!.at);
    assert.equal(sum.firstAt, items.at(-1)!.at);
  });

  test("moderatörün kendi verdiği kararlar MODERATION_BY olarak çıkar (actor yok), kendi hesabı hakkındaki karar ise MODERATION", async () => {
    const d = await populated();
    const modItems = await all(d.mod.id);
    const by = modItems.filter((i) => i.kind === "MODERATION_BY");
    assert.equal(by.length, 1);
    assert.deepEqual([by[0]!.detail, by[0]!.actor, by[0]!.refs.pollId], ["HIDE", null, d.inCommunity]);
    assert.equal(modItems.filter((i) => i.kind === "MODERATION").length, 0);
  });

  test("yaptırım durumu: kaldırılan LIFTED, süresi dolan EXPIRED, süren ACTIVE", async () => {
    const user = await signUp();
    const t0 = new Date(h.clock.now.getTime() - 48 * 3600_000);
    const mk = (type: "WARNING" | "SUSPEND", extra: Record<string, unknown>) =>
      db.sanction.create({ data: { userId: user.id, type, reason: `Yaptırım ${type}`, createdById: admin.id, startsAt: t0, createdAt: t0, ...extra } });
    await mk("WARNING", { liftedAt: h.clock.now, liftedById: admin.id, liftReason: "kaldırıldı" });
    await mk("SUSPEND", { endsAt: new Date(h.clock.now.getTime() - 3600_000) });
    await mk("SUSPEND", { endsAt: new Date(h.clock.now.getTime() + 3600_000), createdAt: new Date(t0.getTime() + 1000) });
    const states = (await all(user.id, "kinds=SANCTION")).map((i) => i.status).sort();
    assert.deepEqual(states, ["ACTIVE", "EXPIRED", "LIFTED"]);
  });

  // ─── Süzgeçler ──────────────────────────────────────────────

  test("süzgeçler: tür listesi, topluluk, içerik ve zaman penceresi; bilinmeyen/yinelenen tür 400", async () => {
    const d = await populated();
    const onlyPolls = await all(d.subject.id, "kinds=POLL,COMMENT");
    assert.ok(onlyPolls.every((i) => i.kind === "POLL" || i.kind === "COMMENT"));
    assert.equal(onlyPolls.length, 3);

    const inCommunity = await all(d.subject.id, `communityId=${d.c.id}`);
    assert.ok(inCommunity.length >= 4, "topluluk anketi, yorumu, ona yapılan rapor ve karar");
    assert.ok(inCommunity.every((i) => i.refs.communityId === d.c.id));
    assert.ok(!inCommunity.some((i) => i.refs.pollId === d.free), "topluluksuz anket süzülür");

    const byContent = await all(d.subject.id, `contentId=${d.inCommunity}`);
    assert.ok(byContent.length >= 4);
    assert.ok(byContent.every((i) => i.refs.pollId === d.inCommunity), "yalnız o içerikle ilişkili olaylar");
    const byComment = await all(d.subject.id, `contentId=${d.ownComment}`);
    assert.deepEqual(byComment.map((i) => i.kind), ["COMMENT"]);
    const byMedia = await all(d.subject.id, `contentId=${d.media.id}`);
    assert.deepEqual(byMedia.map((i) => i.kind), ["MEDIA"]);

    const first = (await all(d.subject.id)).at(-1)!;
    const after = await all(d.subject.id, `from=${encodeURIComponent(new Date(new Date(first.at).getTime() + 1).toISOString())}`);
    assert.ok(!after.some((i) => i.id === first.id && i.kind === first.kind), "from dahil, öncesi hariç");
    const before = await all(d.subject.id, `to=${encodeURIComponent(first.at)}`);
    assert.equal(before.length, 0, "to hariç");
    const window = await all(d.subject.id, `from=${encodeURIComponent(first.at)}&to=${encodeURIComponent(new Date(new Date(first.at).getTime() + 1).toISOString())}`);
    assert.ok(window.every((i) => i.at === first.at) && window.length >= 1);

    assertError(await timeline(admin.cookie, d.subject.id, "kinds=POLL,YOK"), 400, "VALIDATION_ERROR");
    assertError(await timeline(admin.cookie, d.subject.id, "kinds=POLL,POLL"), 400, "VALIDATION_ERROR");
    assertError(await timeline(admin.cookie, d.subject.id, "communityId=x"), 400, "VALIDATION_ERROR");
  });

  // ─── Sayfalama ──────────────────────────────────────────────

  test("keyset sayfalama: küçük sayfalarla gezmek tüm olayları sırayla, tekrarsız ve boşluksuz verir; eşit zamanlı kayıtlar kararlı sıralanır", async () => {
    const user = await signUp();
    const t = new Date(h.clock.now.getTime() - 3600_000);
    // Aynı anda oluşmuş çok sayıda kayıt: sıralama (zaman, tür, kimlik) ile kararlı olmalı.
    for (let i = 0; i < 6; i++) {
      await db.sanction.create({ data: { userId: user.id, type: "WARNING", reason: `Eşit zamanlı uyarı ${i}`, createdById: admin.id, createdAt: t, startsAt: t } });
      await db.mediaAsset.create({ data: { uploaderId: user.id, purpose: "POLL", status: "APPROVED", originalObjectKey: `orig/${randomUUID()}`, processedObjectKey: `proc/${randomUUID()}`, publicObjectKey: `m/${randomUUID()}.webp`, createdAt: t } });
    }
    const full = await all(user.id);
    assert.equal(full.length, 12);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Res = await timeline(admin.cookie, user.id, `limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      for (const i of res.json().data) seen.push(`${i.kind}:${i.id}`);
      cursor = res.json().page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, full.map((i) => `${i.kind}:${i.id}`), "aynı sıra, tekrar ve boşluk yok");
    assert.equal(new Set(seen).size, 12);
    assert.equal(pages, 3);
  });

  test("cursor süzgece bağlıdır: süzgeç değişince eski cursor 400 INVALID_CURSOR; bozuk cursor da", async () => {
    const d = await populated();
    const page = await timeline(admin.cookie, d.subject.id, "limit=1");
    const cursor = page.json().page.nextCursor as string;
    assert.ok(cursor);
    assertError(await timeline(admin.cookie, d.subject.id, `limit=1&kinds=POLL&cursor=${encodeURIComponent(cursor)}`), 400, "INVALID_CURSOR");
    assertError(await timeline(admin.cookie, d.subject.id, `cursor=bozuk`), 400, "INVALID_CURSOR");
    // Başka kullanıcının cursor'ı da geçersizdir.
    const other = await signUp();
    assertError(await timeline(admin.cookie, other.id, `limit=1&cursor=${encodeURIComponent(cursor)}`), 400, "INVALID_CURSOR");
  });

  // ─── Yalıtım ve veri politikası ─────────────────────────────

  test("başkasının verisi sızmaz: aynı topluluk/anket üzerindeki diğer kullanıcının olayları bu geçmişte yok; raporlayan kimliği yok", async () => {
    const d = await populated();
    const items = await all(d.subject.id);
    assert.ok(!items.some((i) => i.refs.pollId === d.othersPoll && i.kind !== "REPORT_FILED"), "diğer kullanıcının anketi yalnız subject'in raporu olarak görünür");
    assert.ok(!items.some((i) => i.kind === "POLL" && i.id === d.othersPoll));
    const text = JSON.stringify(items);
    assert.equal(text.includes(d.other.id), false, "raporlayan kimliği yok");
    assert.equal(text.includes(d.other.username), false);
    for (const i of items.filter((x) => x.kind === "REPORT_AGAINST" || x.kind === "REPORT_FILED")) assert.equal(i.actor, null);
    // Diğer kullanıcının geçmişi ise kendi olaylarını gösterir.
    const otherItems = await all(d.other.id);
    assert.ok(otherItems.some((i) => i.kind === "POLL" && i.id === d.othersPoll));
    assert.equal(otherItems.filter((i) => i.kind === "REPORT_FILED").length, 2);
  });

  test("veri politikası: yanıtlarda IP, cihaz (user-agent), e-posta veya parola alanı yok", async () => {
    const d = await populated();
    await db.session.updateMany({ where: { userId: d.subject.id }, data: { ipAddress: "203.0.113.77", userAgent: "TestTarayici/9.9" } });
    const list = await timeline(admin.cookie, d.subject.id, "limit=100");
    const sum = await summary(admin.cookie, d.subject.id);
    for (const res of [list, sum]) {
      for (const secret of ["203.0.113.77", "TestTarayici", "@example.test", "passwordHash", "ipAddress", "userAgent"]) assert.equal(res.body.includes(secret), false, `${secret} yanıtta olmamalı`);
    }
  });

  test("salt okuma: çağrılar hiçbir tabloya yazmaz (audit dahil)", async () => {
    const d = await populated();
    const before = [await db.auditLog.count(), await db.moderationAction.count(), await db.report.count()];
    await timeline(admin.cookie, d.subject.id, "limit=100");
    await summary(admin.cookie, d.subject.id);
    assert.deepEqual([await db.auditLog.count(), await db.moderationAction.count(), await db.report.count()], before);
  });

  test("silinmiş hesap da görüntülenir (denetim için); silinmiş içerik metni sızmaz", async () => {
    const d = await populated();
    await db.poll.updateMany({ where: { authorId: d.subject.id }, data: { title: "Silinmiş içerik", status: "REMOVED" } });
    await db.comment.updateMany({ where: { authorId: d.subject.id }, data: { body: "[Silinmiş yorum]", status: "REMOVED" } });
    await db.user.update({ where: { id: d.subject.id }, data: { deletedAt: new Date() } });
    const items = await all(d.subject.id);
    assert.ok(items.filter((i) => i.kind === "POLL").every((i) => i.title === "Silinmiş içerik"));
    assert.ok(items.filter((i) => i.kind === "COMMENT").every((i) => i.title === "[Silinmiş yorum]"));
    assert.equal((await summary(admin.cookie, d.subject.id)).statusCode, 200);
  });
});
