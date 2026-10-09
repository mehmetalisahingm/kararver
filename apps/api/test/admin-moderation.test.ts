/**
 * KV-24 (#26) moderasyon kuyruğu ve görsel inceleme: admin.reports.list/resolve, admin.media.list/decide.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Veritabanı diğer test dosyalarıyla paylaşıldığı
 * için kuyruk doğrulamaları topluluk kapsamlı moderatörle ya da kendi kayıtlarının kimliğiyle yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, MediaView, ReportView } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("moderasyon kuyruğu ve görsel inceleme (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `mod-${randomUUID().slice(0, 8)}`, name: "Moderasyon" } })).id;
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
    const account = { email: `mod_${id}@example.test`, username: `mod_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function staff(role: "ADMIN" | "MODERATOR"): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    return user;
  }

  /** Topluluk + o topluluğun moderatörü. Moderatörlük community_memberships satırından okunur (KV-12). */
  async function communityWithModerator() {
    const community = await db.community.create({
      data: { slug: `mod-${randomUUID().slice(0, 8)}`, name: "Moderasyon Topluluğu", createdById: superAdmin.id },
    });
    const moderator = await staff("MODERATOR");
    await db.communityMembership.create({ data: { communityId: community.id, userId: moderator.id, role: "MODERATOR" } });
    await db.community.update({ where: { id: community.id }, data: { memberCount: { increment: 1 } } });
    return { community, moderator };
  }

  async function createPoll(author: User, communityId?: string) {
    const res = await send(
      "POST",
      "/polls",
      {
        kind: "POLL",
        title: "Bu karar doğru mu?",
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

  /** Topluluk anketi: yazarın üyeliği API'nin yaptığı gibi satır + sayaçla açılır. */
  async function communityPoll(communityId: string) {
    const author = await signUp();
    await db.$transaction([
      db.communityMembership.create({ data: { communityId, userId: author.id } }),
      db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);
    return { author, pollId: await createPoll(author, communityId) };
  }

  const report = (cookie: string, type: string, id: string, reason = "SPAM") => send("POST", "/reports", { target: { type, id }, reason }, cookie);
  async function reportAs(type: string, id: string, reason = "SPAM") {
    const reporter = await signUp();
    const res = await report(reporter.cookie, type, id, reason);
    assert.equal(res.statusCode, 202, res.body);
    return { reporter, reportId: res.json().data.reportId as string };
  }

  /** Kuyruğun bütün sayfalarını gezer. */
  async function collect(url: string, cookie: string, limit = 50) {
    const seen: any[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await get(`${url}${url.includes("?") ? "&" : "?"}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, cookie);
      assert.equal(res.statusCode, 200, res.body);
      seen.push(...res.json().data);
      cursor = res.json().page.nextCursor;
    } while (cursor);
    return seen;
  }

  async function media(seed: { status: "PENDING" | "APPROVED" | "QUARANTINED" | "REJECTED"; purpose?: "POLL" | "AVATAR" | "COMMUNITY"; processed?: boolean }) {
    const uploader = await signUp();
    const key = `test/${randomUUID()}`;
    const processed = seed.processed ?? seed.status !== "PENDING";
    const row = await db.mediaAsset.create({
      data: {
        uploaderId: uploader.id,
        purpose: seed.purpose ?? "POLL",
        status: seed.status,
        originalObjectKey: `${key}/original`,
        processedObjectKey: processed ? `${key}/processed.webp` : null,
        width: 800,
        height: 600,
        // CHECK: public anahtar yalnız APPROVED'da dolu
        ...(seed.status === "APPROVED" ? { publicObjectKey: `m/${randomUUID()}.webp` } : {}),
      },
    });
    if (processed) h.storage.put(row.processedObjectKey!, 1000, "image/webp");
    return row;
  }

  /** Görseli topluluk anketinin galerisine bağlar (yetki kapsamı o topluluk olur). */
  async function attachToCommunityPoll(mediaId: string, communityId: string) {
    const { pollId } = await communityPoll(communityId);
    await db.pollMedia.create({ data: { pollId, mediaId, position: 0 } });
  }

  const resolve = (cookie: string | undefined, id: string, resolution = "DISMISSED", note = "İşlem gerekmedi") =>
    send("POST", `/admin/reports/${id}/resolve`, { resolution, note }, cookie);
  const decide = (cookie: string | undefined, id: string, decision = "APPROVE", reason = "İnceledim, uygun") =>
    send("POST", `/admin/media/${id}/decision`, { decision, reason }, cookie);

  // ─── Rapor kuyruğu ──────────────────────────────────────────

  test("yetki: misafir 401, normal kullanıcı 403, topluluğa atanmamış moderatör 403", async () => {
    const user = await signUp();
    const unassigned = await staff("MODERATOR");
    const pollId = await createPoll(user);
    const { reportId } = await reportAs("POLL", pollId);

    for (const path of ["/admin/reports", "/admin/media"]) {
      assertError(await get(path), 401, "UNAUTHENTICATED");
      assertError(await get(path, user.cookie), 403, "FORBIDDEN");
      assertError(await get(path, unassigned.cookie), 403, "FORBIDDEN");
    }
    assertError(await resolve(undefined, reportId), 401, "UNAUTHENTICATED");
    assertError(await resolve(user.cookie, reportId), 403, "FORBIDDEN");
    assertError(await resolve(unassigned.cookie, reportId), 403, "FORBIDDEN");
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: reportId } })).status, "OPEN");
  });

  test("kuyrukta hedef başına tek satır görünür; reportCount açık raporları sayar", async () => {
    const { community, moderator } = await communityWithModerator();
    const { pollId } = await communityPoll(community.id);
    const first = await reportAs("POLL", pollId, "MISLEADING");
    await reportAs("POLL", pollId, "SPAM");
    await reportAs("POLL", pollId, "HATE");

    const rows = await collect("/admin/reports", moderator.cookie);
    assert.equal(rows.length, 1);
    const view = ReportView.parse(rows[0]);
    assert.deepEqual(
      [view.id, view.target, view.reason, view.status, view.reportCount, view.communityId, view.resolvedAt],
      [first.reportId, { type: "POLL", id: pollId }, "MISLEADING", "OPEN", 3, community.id, null],
    );
  });

  test("kuyruk sayfalanır (en eski önce), tür filtresi çalışır, filtre değişince cursor reddedilir", async () => {
    const { community, moderator } = await communityWithModerator();
    const polls = [];
    for (let i = 0; i < 3; i++) {
      const { pollId } = await communityPoll(community.id);
      const { reportId } = await reportAs("POLL", pollId);
      await db.report.update({ where: { id: reportId }, data: { createdAt: new Date(Date.UTC(2026, 8, 1, 10, i)) } });
      polls.push(reportId);
    }
    const { author, pollId } = await communityPoll(community.id);
    await db.comment.create({ data: { pollId, authorId: author.id, body: "uygunsuz yorum" } }).then(async (c) => reportAs("COMMENT", c.id));

    const first = await get("/admin/reports?status=OPEN&targetType=POLL&limit=2", moderator.cookie);
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json().data.map((r: any) => r.id), polls.slice(0, 2));
    assert.equal(first.json().page.hasMore, true);

    const second = await get(`/admin/reports?status=OPEN&targetType=POLL&limit=2&cursor=${first.json().page.nextCursor}`, moderator.cookie);
    assert.deepEqual(second.json().data.map((r: any) => r.id), polls.slice(2));
    assert.equal(second.json().page.hasMore, false);

    const comments = await collect("/admin/reports?targetType=COMMENT", moderator.cookie);
    assert.deepEqual(comments.map((r) => r.target.type), ["COMMENT"]);

    assertError(await get(`/admin/reports?status=OPEN&targetType=COMMENT&cursor=${first.json().page.nextCursor}`, moderator.cookie), 400, "INVALID_CURSOR");
    assertError(await get("/admin/reports?cursor=bozuk", moderator.cookie), 400, "INVALID_CURSOR");
  });

  test("moderatör yalnız kendi topluluğunu görür ve sonuçlandırır; topluluğu olmayan hedef yalnız ADMIN+", async () => {
    const a = await communityWithModerator();
    const b = await communityWithModerator();
    const inA = await communityPoll(a.community.id);
    const ra = await reportAs("POLL", inA.pollId);
    const outside = await createPoll(await signUp());
    const ro = await reportAs("POLL", outside);
    const userTarget = await reportAs("USER", (await signUp()).id, "HARASSMENT");

    assert.deepEqual((await collect("/admin/reports", a.moderator.cookie)).map((r) => r.id), [ra.reportId]);
    assert.deepEqual(await collect("/admin/reports", b.moderator.cookie), []);
    // Başka topluluğun kuyruğunu filtreyle de açamaz.
    assert.deepEqual(await collect(`/admin/reports?communityId=${a.community.id}`, b.moderator.cookie), []);

    assertError(await resolve(b.moderator.cookie, ra.reportId), 403, "FORBIDDEN");
    assertError(await resolve(a.moderator.cookie, ro.reportId), 403, "FORBIDDEN");
    assertError(await resolve(a.moderator.cookie, userTarget.reportId), 403, "FORBIDDEN");

    const ids = (await collect("/admin/reports", admin.cookie)).map((r) => r.id);
    for (const id of [ra.reportId, ro.reportId, userTarget.reportId]) assert.ok(ids.includes(id), `ADMIN kuyruğunda ${id} yok`);
    assert.equal((await resolve(admin.cookie, userTarget.reportId, "ACTIONED", "Hesap incelendi")).statusCode, 200);
    assert.equal((await resolve(a.moderator.cookie, ra.reportId)).statusCode, 200);
  });

  test("DISMISSED hedefin bütün açık raporlarını kapatır ve moderasyon geçmişine yazar; tekrar idempotent", async () => {
    const { community, moderator } = await communityWithModerator();
    const { pollId } = await communityPoll(community.id);
    const first = await reportAs("POLL", pollId);
    const second = await reportAs("POLL", pollId, "HATE");

    const res = await resolve(moderator.cookie, first.reportId, "DISMISSED", "Kurallara uygun");
    assert.equal(res.statusCode, 200, res.body);
    const view = ReportView.parse(res.json().data);
    assert.deepEqual([view.id, view.status, view.reportCount, view.communityId], [first.reportId, "DISMISSED", 2, community.id]);
    assert.ok(view.resolvedAt);

    for (const id of [first.reportId, second.reportId]) {
      const row = await db.report.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([row.status, row.resolvedById, row.resolutionNote], ["DISMISSED", moderator.id, "Kurallara uygun"]);
    }
    const actions = await db.moderationAction.findMany({ where: { pollId } });
    assert.equal(actions.length, 1);
    assert.deepEqual([actions[0].action, actions[0].actorId, actions[0].reportId, actions[0].reason], ["DISMISS_REPORT", moderator.id, first.reportId, "Kurallara uygun"]);
    // Anket hiç değişmedi.
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "ACTIVE");

    assert.deepEqual(await collect("/admin/reports", moderator.cookie), []);
    const closed = await collect("/admin/reports?status=DISMISSED", moderator.cookie);
    assert.deepEqual(closed.map((r) => [r.id, r.reportCount]), [[first.reportId, 2]]);

    // Aynı karar tekrarı idempotent (ikinci geçmiş satırı yok); farklı karar kapanmış raporu değiştiremez.
    assert.equal((await resolve(moderator.cookie, first.reportId, "DISMISSED", "Kurallara uygun")).statusCode, 200);
    assert.equal(await db.moderationAction.count({ where: { pollId } }), 1);
    assertError(await resolve(moderator.cookie, first.reportId, "ACTIONED", "Fikrim değişti"), 409, "CONFLICT");

    // Aynı kullanıcı tekrar raporlarsa aynı satır yeniden kuyruğa girer (reports.create sözleşmesi).
    assert.equal((await report(first.reporter.cookie, "POLL", pollId, "SPAM")).json().data.reportId, first.reportId);
    assert.deepEqual((await collect("/admin/reports", moderator.cookie)).map((r) => [r.id, r.reportCount]), [[first.reportId, 1]]);
  });

  test("ACTIONED raporu kapatır ama içeriğe dokunmaz ve geçmişe işlem yazmaz", async () => {
    const { community, moderator } = await communityWithModerator();
    const { pollId } = await communityPoll(community.id);
    const { reportId } = await reportAs("POLL", pollId);

    assert.equal((await resolve(moderator.cookie, reportId, "ACTIONED", "Yazara uyarı gönderildi")).json().data.status, "ACTIONED");
    assert.equal(await db.moderationAction.count({ where: { pollId } }), 0);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "ACTIVE");
  });

  test("eşzamanlı iki sonuçlandırma tek geçmiş satırı bırakır; olmayan rapor 404, kısa gerekçe 400", async () => {
    const { community, moderator } = await communityWithModerator();
    const other = await staff("ADMIN");
    const { pollId } = await communityPoll(community.id);
    const { reportId } = await reportAs("POLL", pollId);

    const results = await Promise.all([resolve(moderator.cookie, reportId), resolve(other.cookie, reportId)]);
    const codes = results.map((r) => r.statusCode).sort();
    assert.ok(codes.includes(200), JSON.stringify(codes));
    assert.ok(codes.every((c) => c === 200 || c === 409), JSON.stringify(codes));
    assert.equal(await db.moderationAction.count({ where: { reportId } }), 1);

    assertError(await resolve(admin.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await resolve(admin.cookie, reportId, "DISMISSED", "x"), 400, "VALIDATION_ERROR");
    assertError(await resolve(admin.cookie, reportId, "BILINMEYEN"), 400, "VALIDATION_ERROR");
  });

  // ─── Görsel inceleme ────────────────────────────────────────

  test("görsel kuyruğu: moderatör yalnız kendi topluluğunun görselini görür, avatar yalnız ADMIN+ kuyruğunda", async () => {
    const a = await communityWithModerator();
    const b = await communityWithModerator();
    const inA = await media({ status: "QUARANTINED" });
    await attachToCommunityPoll(inA.id, a.community.id);
    const communityImage = await media({ status: "QUARANTINED", purpose: "COMMUNITY" });
    await db.community.update({ where: { id: a.community.id }, data: { imageMediaId: communityImage.id } });
    const avatar = await media({ status: "QUARANTINED", purpose: "AVATAR" });

    const seenByA = await collect("/admin/media", a.moderator.cookie);
    assert.deepEqual(seenByA.map((m) => m.id).sort(), [inA.id, communityImage.id].sort());
    assert.deepEqual(await collect("/admin/media", b.moderator.cookie), []);

    const seenByAdmin = (await collect("/admin/media", admin.cookie)).map((m) => m.id);
    for (const id of [inA.id, communityImage.id, avatar.id]) assert.ok(seenByAdmin.includes(id), `ADMIN kuyruğunda ${id} yok`);

    const view = MediaView.parse(seenByA.find((m) => m.id === inA.id));
    assert.equal(view.status, "QUARANTINED");
    assert.equal(view.url, null);
    assert.ok(view.preview, "karantinadaki görsel kısa ömürlü önizleme almalı");
    assert.ok(view.preview.url.includes("processed.webp"), "önizleme yalnız işlenmiş kopyadan olmalı");
  });

  test("görsel kuyruğu durum filtresi: PENDING işlenmemiş, REJECTED önizlemesi yalnız ADMIN+'da", async () => {
    const { community, moderator } = await communityWithModerator();
    const pending = await media({ status: "PENDING" });
    const rejected = await media({ status: "REJECTED" });
    await attachToCommunityPoll(pending.id, community.id);
    await attachToCommunityPoll(rejected.id, community.id);

    assert.deepEqual((await collect("/admin/media?status=PENDING", moderator.cookie)).map((m) => m.id), [pending.id]);
    const asModerator = await collect("/admin/media?status=REJECTED", moderator.cookie);
    assert.deepEqual(asModerator.map((m) => [m.id, m.preview]), [[rejected.id, null]]);
    const asAdmin = (await collect("/admin/media?status=REJECTED", admin.cookie)).find((m) => m.id === rejected.id);
    assert.ok(asAdmin?.preview, "ADMIN reddedilmiş görselin işlenmiş kopyasını itiraz için önizleyebilir");
    assertError(await get("/admin/media?status=APPROVED", admin.cookie), 400, "VALIDATION_ERROR");
  });

  test("onay: işlenmiş kopya public'e kopyalanır, durum APPROVED olur, geçmişe yazılır; tekrar idempotent", async () => {
    const { community, moderator } = await communityWithModerator();
    const item = await media({ status: "QUARANTINED" });
    await attachToCommunityPoll(item.id, community.id);

    const res = await decide(moderator.cookie, item.id, "APPROVE", "Zararsız manzara fotoğrafı");
    assert.equal(res.statusCode, 200, res.body);
    const view = MediaView.parse(res.json().data);
    assert.deepEqual([view.status, view.url, view.preview], ["APPROVED", `http://cdn.test/media/m/${item.id}.webp`, null]);
    assert.ok(h.storage.publicKeys.has(`m/${item.id}.webp`));

    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: item.id } });
    assert.deepEqual([row.status, row.publicObjectKey, row.reviewedById, row.reviewNote], ["APPROVED", `m/${item.id}.webp`, moderator.id, "Zararsız manzara fotoğrafı"]);
    const actions = await db.moderationAction.findMany({ where: { mediaId: item.id } });
    assert.deepEqual(actions.map((a) => [a.action, a.actorId, a.fromStatus, a.toStatus]), [["APPROVE", moderator.id, "QUARANTINED", "APPROVED"]]);

    assert.equal((await decide(moderator.cookie, item.id, "APPROVE")).statusCode, 200);
    assert.equal(await db.moderationAction.count({ where: { mediaId: item.id } }), 1);
  });

  test("red: karantinadaki görsel REJECTED olur ve public anahtar taşımaz", async () => {
    const { community, moderator } = await communityWithModerator();
    const item = await media({ status: "QUARANTINED" });
    await attachToCommunityPoll(item.id, community.id);

    const res = await decide(moderator.cookie, item.id, "REJECT", "Uygunsuz içerik");
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual([res.json().data.status, res.json().data.url, res.json().data.preview], ["REJECTED", null, null]);
    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: item.id } });
    assert.deepEqual([row.status, row.publicObjectKey], ["REJECTED", null]);
    assert.equal(h.storage.publicKeys.has(`m/${item.id}.webp`), false);
    // Reddedilen görsel kuyruğa geri dönmez ama kanıt olarak private bucket'ta kalır.
    assert.ok(h.storage.objects.has(row.processedObjectKey!));
  });

  test("yayındaki görselin kaldırılması: public nesne silinir, açık raporlar ACTIONED olur, yeni rapor alınmaz", async () => {
    const { community, moderator } = await communityWithModerator();
    const item = await media({ status: "APPROVED" });
    await attachToCommunityPoll(item.id, community.id);
    h.storage.publicKeys.add(item.publicObjectKey!);
    const reported = await reportAs("MEDIA", item.id, "INAPPROPRIATE");
    assert.equal((await collect("/admin/reports?targetType=MEDIA", moderator.cookie)).length, 1);

    const res = await decide(moderator.cookie, item.id, "REJECT", "Raporlar doğrulandı");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(h.storage.publicKeys.has(item.publicObjectKey!), false);
    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: item.id } });
    assert.deepEqual([row.status, row.publicObjectKey], ["REJECTED", null]);

    const closed = await db.report.findUniqueOrThrow({ where: { id: reported.reportId } });
    assert.deepEqual([closed.status, closed.resolvedById, closed.resolutionNote], ["ACTIONED", moderator.id, "Raporlar doğrulandı"]);
    assert.deepEqual(await collect("/admin/reports?targetType=MEDIA", moderator.cookie), []);
    assertError(await report((await signUp()).cookie, "MEDIA", item.id), 404, "NOT_FOUND");
  });

  test("reddedilen görsel ADMIN onayıyla yeniden yayınlanabilir; işlenmiş kopyası olmayan olamaz", async () => {
    const restored = await media({ status: "REJECTED" });
    const res = await decide(admin.cookie, restored.id, "APPROVE", "İtiraz haklı bulundu");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.status, "APPROVED");
    assert.ok(h.storage.publicKeys.has(`m/${restored.id}.webp`));

    const invalid = await media({ status: "REJECTED", processed: false });
    assertError(await decide(admin.cookie, invalid.id, "APPROVE"), 409, "CONFLICT");
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: invalid.id } })).status, "REJECTED");
  });

  test("hatalı durumlar: işlenen görsel 409, olmayan 404, başka topluluğun moderatörü 403, kısa gerekçe 400", async () => {
    const a = await communityWithModerator();
    const b = await communityWithModerator();
    const pending = await media({ status: "PENDING" });
    await attachToCommunityPoll(pending.id, a.community.id);
    const quarantined = await media({ status: "QUARANTINED" });
    await attachToCommunityPoll(quarantined.id, a.community.id);
    const avatar = await media({ status: "QUARANTINED", purpose: "AVATAR" });

    assertError(await decide(a.moderator.cookie, pending.id), 409, "CONFLICT");
    assertError(await decide(a.moderator.cookie, randomUUID()), 404, "NOT_FOUND");
    assertError(await decide(b.moderator.cookie, quarantined.id), 403, "FORBIDDEN");
    // Topluluğu olmayan görsel moderatörün yetkisinde değildir.
    assertError(await decide(a.moderator.cookie, avatar.id), 403, "FORBIDDEN");
    assertError(await decide(a.moderator.cookie, quarantined.id, "APPROVE", "x"), 400, "VALIDATION_ERROR");
    assertError(await decide(a.moderator.cookie, quarantined.id, "SILINSIN"), 400, "VALIDATION_ERROR");
    assertError(await decide((await signUp()).cookie, quarantined.id), 403, "FORBIDDEN");
    assertError(await decide(undefined, quarantined.id), 401, "UNAUTHENTICATED");
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: quarantined.id } })).status, "QUARANTINED");
    assert.equal(await db.moderationAction.count({ where: { mediaId: { in: [pending.id, quarantined.id, avatar.id] } } }), 0);
  });

  test("depolama hatasında karar uygulanmaz ve tekrar denenebilir", async () => {
    const approve = await media({ status: "QUARANTINED" });
    h.storage.failNext.publish = true;
    assert.equal((await decide(admin.cookie, approve.id)).statusCode, 500);
    const untouched = await db.mediaAsset.findUniqueOrThrow({ where: { id: approve.id } });
    assert.deepEqual([untouched.status, untouched.publicObjectKey], ["QUARANTINED", null]);
    assert.equal(await db.moderationAction.count({ where: { mediaId: approve.id } }), 0);
    assert.equal((await decide(admin.cookie, approve.id)).statusCode, 200);

    // Kaldırmada önce public nesne silinir; silinemezse görsel yayında kalır ve karar da uygulanmaz.
    h.storage.failNext.delete = true;
    assert.equal((await decide(admin.cookie, approve.id, "REJECT", "Geri alındı")).statusCode, 500);
    assert.equal((await db.mediaAsset.findUniqueOrThrow({ where: { id: approve.id } })).status, "APPROVED");
    assert.equal((await decide(admin.cookie, approve.id, "REJECT", "Geri alındı")).statusCode, 200);
  });
});
