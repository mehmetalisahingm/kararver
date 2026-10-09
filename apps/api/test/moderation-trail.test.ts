/**
 * Moderasyon izi (KV-39 audit, KV-21 olay outbox'ı): rapor, görsel, içerik ve topluluk yönetimi mutasyonla aynı
 * transaction'da audit_logs ve domain_events yazar. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("moderasyon izi: audit ve olaylar (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `iz-${randomUUID().slice(0, 8)}`, name: "Moderasyon İzi" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string, key?: string) {
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

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `iz_${id}@example.test`, username: `iz_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
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

  async function community() {
    const res = await send("POST", "/admin/communities", { slug: `iz-${randomUUID().slice(0, 8)}`, name: "İz Topluluğu" }, admin.cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data as { id: string; slug: string };
  }

  async function communityPoll(communityId: string) {
    const author = await signUp();
    await db.$transaction([
      db.communityMembership.create({ data: { communityId, userId: author.id } }),
      db.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } }),
    ]);
    const res = await send(
      "POST",
      "/polls",
      {
        kind: "POLL",
        title: `Bu karar doğru mu? ${randomUUID().slice(0, 8)}`,
        categoryId,
        communityId,
        durationHours: 24,
        resultsVisibility: "ALWAYS",
        options: [{ label: "Evet" }, { label: "Hayır" }],
      },
      author.cookie,
      `poll-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return { author, pollId: res.json().data.id as string };
  }

  async function reportBy(type: string, id: string, reason = "SPAM") {
    const reporter = await signUp();
    const res = await send("POST", "/reports", { target: { type, id }, reason }, reporter.cookie);
    assert.equal(res.statusCode, 202, res.body);
    return { reporter, reportId: res.json().data.reportId as string };
  }

  const audit = (targetId: string, action?: string) =>
    db.auditLog.findMany({ where: { targetId, ...(action ? { action } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const events = (type: string, subjectId: string) => db.domainEvent.findMany({ where: { type, subjectId } });
  /** Aynı hedefte aynı türden birden çok audit satırı: işlem türüne göre seç (sıra test saatinde belirsizdir). */
  const byOperation = <T extends { operation: string }>(rows: T[], operation: string) => {
    const found = rows.filter((r) => r.operation === operation);
    assert.equal(found.length, 1, `${operation} için tek kayıt beklenirdi: ${rows.map((r) => r.operation).join(",")}`);
    return found[0]!;
  };

  async function rejectedMedia(opts: { status?: "REJECTED" | "QUARANTINED" | "APPROVED" } = {}) {
    const uploader = await signUp();
    const key = `test/${randomUUID()}`;
    const status = opts.status ?? "QUARANTINED";
    const row = await db.mediaAsset.create({
      data: {
        uploaderId: uploader.id,
        purpose: "POLL",
        status,
        originalObjectKey: `${key}/original`,
        processedObjectKey: `${key}/processed.webp`,
        contentSha256: randomUUID().replaceAll("-", "").repeat(2),
        perceptualHash: randomUUID().replaceAll("-", "").slice(0, 16),
        ...(status === "APPROVED" ? { publicObjectKey: `m/${randomUUID()}.webp` } : {}),
      },
    });
    h.storage.put(row.processedObjectKey!, 1000, "image/webp");
    return row;
  }

  // ─── Rapor ──────────────────────────────────────────────────

  test("report.created: yeni rapor ve kapanmış raporun yeniden açılması yazar; açık rapor tekrarı yazmaz", async () => {
    const c = await community();
    const { pollId } = await communityPoll(c.id);
    const first = await reportBy("POLL", pollId, "MISLEADING");
    const created = await events("report.created", first.reportId);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].payload, { targetType: "POLL", targetId: pollId, reason: "MISLEADING", communityId: c.id });
    assert.equal(created[0].actorId, first.reporter.id);

    // Açık raporu tekrar göndermek yeni olay üretmez.
    assert.equal((await send("POST", "/reports", { target: { type: "POLL", id: pollId }, reason: "SPAM" }, first.reporter.cookie)).statusCode, 202);
    assert.equal((await events("report.created", first.reportId)).length, 1);

    // Kapatılıp yeniden raporlanırsa aynı rapor için ikinci olay.
    await send("POST", `/admin/reports/${first.reportId}/resolve`, { resolution: "DISMISSED", note: "Kurallara uygun" }, admin.cookie);
    assert.equal((await send("POST", "/reports", { target: { type: "POLL", id: pollId }, reason: "HATE" }, first.reporter.cookie)).statusCode, 202);
    const again = await events("report.created", first.reportId);
    assert.deepEqual(again.map((e) => (e.payload as any).reason).sort(), ["HATE", "MISLEADING"]);
  });

  test("rapor sonuçlandırma: tek audit kaydı (gerekçe, önce/sonra) ve kapanan her rapor için report.resolved", async () => {
    const c = await community();
    const moderator = await staff("MODERATOR");
    await db.communityMembership.create({ data: { communityId: c.id, userId: moderator.id, role: "MODERATOR" } });
    const { pollId } = await communityPoll(c.id);
    const a = await reportBy("POLL", pollId);
    const b = await reportBy("POLL", pollId, "HATE");

    const res = await send("POST", `/admin/reports/${a.reportId}/resolve`, { resolution: "DISMISSED", note: "Kurallara uygun" }, moderator.cookie);
    assert.equal(res.statusCode, 200, res.body);

    const rows = await audit(a.reportId, "report.resolve");
    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0].source, rows[0].actorId, rows[0].operation, rows[0].targetType, rows[0].reason],
      ["API", moderator.id, "dismissed", "REPORT", "Kurallara uygun"],
    );
    assert.deepEqual(rows[0].before, { status: "OPEN", openReports: 2 });
    assert.deepEqual(rows[0].after, { status: "DISMISSED", targetType: "POLL", targetId: pollId, resolvedReports: 2 });
    assert.ok(rows[0].requestId, "X-Request-Id audit'e yazılır");

    for (const id of [a.reportId, b.reportId]) {
      const resolved = await events("report.resolved", id);
      assert.equal(resolved.length, 1, id);
      assert.deepEqual(resolved[0].payload, { resolution: "DISMISSED", targetType: "POLL", targetId: pollId });
    }
    // Aynı karar tekrarı idempotent: yeni audit yok.
    assert.equal((await send("POST", `/admin/reports/${a.reportId}/resolve`, { resolution: "DISMISSED", note: "Kurallara uygun" }, moderator.cookie)).statusCode, 200);
    assert.equal((await audit(a.reportId, "report.resolve")).length, 1);
  });

  // ─── İçerik moderasyonu ─────────────────────────────────────

  test("içerik moderasyonu: audit (before/after, gerekçe) + moderation.applied + kapanan rapor olayı; tekrar iz bırakmaz", async () => {
    const c = await community();
    const { pollId } = await communityPoll(c.id);
    const reported = await reportBy("POLL", pollId);

    const res = await send("POST", `/admin/polls/${pollId}/moderation`, { action: "HIDE", reason: "Spam doğrulandı" }, admin.cookie);
    assert.equal(res.statusCode, 200, res.body);

    const rows = await audit(pollId, "moderation.poll.apply");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].operation, rows[0].actorId, rows[0].reason], ["hide", admin.id, "Spam doğrulandı"]);
    assert.deepEqual(rows[0].before, { status: "ACTIVE", trendExcluded: false, commentsClosed: false });
    assert.deepEqual(rows[0].after, { status: "HIDDEN", trendExcluded: false, commentsClosed: false, closedReports: 1 });

    const action = await db.moderationAction.findFirstOrThrow({ where: { pollId } });
    const applied = await events("moderation.applied", pollId);
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].payload, { moderationActionId: action.id, action: "HIDE", fromStatus: "ACTIVE", toStatus: "HIDDEN", reportId: null });
    assert.equal((await events("report.resolved", reported.reportId)).length, 1);

    // Aynı işlem tekrarı (idempotent) ne audit ne olay üretir.
    assert.equal((await send("POST", `/admin/polls/${pollId}/moderation`, { action: "HIDE", reason: "Spam doğrulandı" }, admin.cookie)).statusCode, 200);
    assert.equal((await audit(pollId, "moderation.poll.apply")).length, 1);
    assert.equal((await events("moderation.applied", pollId)).length, 1);

    // Trendden çıkarma da izlenir (operation küçük harf, durum değişmez).
    await send("POST", `/admin/polls/${pollId}/moderation`, { action: "RESTORE", reason: "İtiraz kabul" }, admin.cookie);
    await send("POST", `/admin/polls/${pollId}/moderation`, { action: "EXCLUDE_FROM_TRENDS", reason: "Manipülasyon şüphesi" }, admin.cookie);
    const ops = (await audit(pollId, "moderation.poll.apply")).map((r) => r.operation);
    assert.deepEqual([...ops].sort(), ["exclude_from_trends", "hide", "restore"]);
  });

  test("yorum moderasyonu moderation.comment.apply olarak yazılır", async () => {
    const c = await community();
    const { author, pollId } = await communityPoll(c.id);
    const created = await send("POST", `/polls/${pollId}/comments`, { body: "Uygunsuz yorum" }, author.cookie);
    assert.equal(created.statusCode, 201, created.body);
    const commentId = created.json().data.id as string;

    assert.equal((await send("POST", `/admin/comments/${commentId}/moderation`, { action: "REMOVE", reason: "Hakaret" }, admin.cookie)).statusCode, 200);
    const rows = await audit(commentId, "moderation.comment.apply");
    assert.deepEqual([rows.length, rows[0].targetType, rows[0].operation, rows[0].reason], [1, "COMMENT", "remove", "Hakaret"]);
    assert.deepEqual(rows[0].after, { status: "REMOVED", closedReports: 0 });
    assert.equal((await events("moderation.applied", commentId)).length, 1);
  });

  // ─── Görsel ─────────────────────────────────────────────────

  test("görsel kararı: media.review audit'i; red açık raporları kapatır ve report.resolved yazar", async () => {
    const media = await rejectedMedia({ status: "APPROVED" });
    const reported = await reportBy("MEDIA", media.id, "INAPPROPRIATE");

    assert.equal((await send("POST", `/admin/media/${media.id}/decision`, { decision: "REJECT", reason: "Raporlar doğrulandı" }, admin.cookie)).statusCode, 200);
    const rows = await audit(media.id, "media.review");
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].operation, rows[0].actorId, rows[0].reason], ["reject", admin.id, "Raporlar doğrulandı"]);
    assert.deepEqual(rows[0].before, { status: "APPROVED" });
    assert.deepEqual(rows[0].after, { status: "REJECTED", closedReports: 1 });
    assert.equal((await events("report.resolved", reported.reportId)).length, 1);

    // Aynı karar tekrarı iz bırakmaz.
    assert.equal((await send("POST", `/admin/media/${media.id}/decision`, { decision: "REJECT", reason: "Raporlar doğrulandı" }, admin.cookie)).statusCode, 200);
    assert.equal((await audit(media.id, "media.review")).length, 1);
  });

  test("önizleme erişimi: URL alan her görsel için media.queue.read/preview audit'i (liste ve karar cevabı)", async () => {
    const c = await community();
    const moderator = await staff("MODERATOR");
    await db.communityMembership.create({ data: { communityId: c.id, userId: moderator.id, role: "MODERATOR" } });
    const items = [await rejectedMedia(), await rejectedMedia()];
    for (const item of items) {
      const { pollId } = await communityPoll(c.id);
      await db.pollMedia.create({ data: { pollId, mediaId: item.id, position: 0 } });
    }

    const list = await send("GET", "/admin/media?limit=50", undefined, moderator.cookie);
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.filter((m: any) => m.preview).length, 2);
    for (const item of items) {
      const rows = await audit(item.id, "media.queue.read");
      assert.equal(rows.length, 1, item.id);
      assert.deepEqual([rows[0].operation, rows[0].actorId, rows[0].targetType], ["preview", moderator.id, "MEDIA"]);
    }
    // Her yeni liste çağrısı yeni erişimdir.
    await send("GET", "/admin/media?limit=50", undefined, moderator.cookie);
    assert.equal((await audit(items[0].id, "media.queue.read")).length, 2);

    // Önizleme içermeyen cevap (APPROVE sonrası public URL) erişim izi bırakmaz.
    assert.equal((await send("POST", `/admin/media/${items[0].id}/decision`, { decision: "APPROVE", reason: "Zararsız" }, moderator.cookie)).statusCode, 200);
    assert.equal((await audit(items[0].id, "media.queue.read")).length, 2);
  });

  test("yasak ekleme ve kaldırma audit'e yazılır; tekrar silme iz bırakmaz", async () => {
    const media = await rejectedMedia({ status: "QUARANTINED" });
    await send("POST", `/admin/media/${media.id}/decision`, { decision: "REJECT", reason: "Uygunsuz" }, admin.cookie);

    const ban = await send("POST", "/admin/media/bans", { mediaId: media.id, reason: "Tekrar yüklenen görsel" }, admin.cookie);
    assert.equal(ban.statusCode, 201, ban.body);
    // Zaten yasaklı olanı tekrar eklemek iz bırakmaz.
    assert.equal((await send("POST", "/admin/media/bans", { mediaId: media.id, reason: "Başka gerekçe" }, admin.cookie)).statusCode, 200);

    assert.equal((await send("DELETE", `/admin/media/bans/${ban.json().data.id}`, undefined, admin.cookie)).statusCode, 204);
    assert.equal((await send("DELETE", `/admin/media/bans/${ban.json().data.id}`, undefined, admin.cookie)).statusCode, 204);

    const rows = await audit(media.id, "media.ban.manage");
    assert.equal(rows.length, 2);
    const added = byOperation(rows, "create");
    const removed = byOperation(rows, "delete");
    assert.deepEqual([added.reason, added.after], ["Tekrar yüklenen görsel", { banId: ban.json().data.id, matchesExact: true, matchesSimilar: true }]);
    assert.deepEqual([removed.reason, removed.before], [null, { banId: ban.json().data.id }]);
  });

  // ─── Topluluk ───────────────────────────────────────────────

  test("topluluk yönetimi: açma, yalnız değişen alanlarla düzenleme ve moderatör atama/kaldırma audit'e yazılır", async () => {
    const c = await community();
    const created = await audit(c.id, "community.create");
    assert.deepEqual([created.length, created[0].operation, created[0].actorId, created[0].before], [1, "create", admin.id, null]);
    assert.deepEqual(created[0].after, { slug: c.slug, name: "İz Topluluğu", membersVisibility: "MEMBERS", imageMediaId: null });

    const patch = await send("PATCH", `/admin/communities/${c.id}`, { name: "Yeni Ad", membersVisibility: "MEMBERS", reason: "Ad güncellendi" }, admin.cookie);
    assert.equal(patch.statusCode, 200, patch.body);
    let updates = await audit(c.id, "community.update");
    assert.equal(updates.length, 1);
    // membersVisibility zaten MEMBERS'tı: yalnız gerçekten değişen alan before/after'da.
    assert.deepEqual([updates[0].reason, updates[0].before, updates[0].after], ["Ad güncellendi", { name: "İz Topluluğu" }, { name: "Yeni Ad" }]);
    const renamed = updates[0];
    // Değişiklik yoksa iz de yok; kapatma da izlenir.
    await send("PATCH", `/admin/communities/${c.id}`, { name: "Yeni Ad", reason: "Aynı ad" }, admin.cookie);
    assert.equal((await audit(c.id, "community.update")).length, 1);
    await send("PATCH", `/admin/communities/${c.id}`, { status: "HIDDEN", reason: "Geçici kapatma" }, admin.cookie);
    updates = await audit(c.id, "community.update");
    assert.equal(updates.length, 2);
    const closed = updates.find((r) => r.id !== renamed.id)!;
    assert.deepEqual(closed.after, { status: "HIDDEN" });
    assert.deepEqual(closed.before, { status: "ACTIVE" });

    const user = await signUp();
    assert.equal((await send("PUT", `/admin/communities/${c.id}/moderators/${user.id}`, { reason: "Aktif üye" }, admin.cookie)).statusCode, 200);
    assert.equal((await send("PUT", `/admin/communities/${c.id}/moderators/${user.id}`, { reason: "Aktif üye" }, admin.cookie)).statusCode, 200);
    assert.equal((await send("DELETE", `/admin/communities/${c.id}/moderators/${user.id}`, undefined, admin.cookie)).statusCode, 204);
    assert.equal((await send("DELETE", `/admin/communities/${c.id}/moderators/${user.id}`, undefined, admin.cookie)).statusCode, 204);

    const mods = await audit(c.id, "community.moderator.assign");
    assert.equal(mods.length, 2, "idempotent tekrarlar iz bırakmaz");
    const assigned = byOperation(mods, "assign");
    const demoted = byOperation(mods, "remove");
    assert.deepEqual([assigned.reason, assigned.before, assigned.after], ["Aktif üye", { userId: user.id, role: null }, { userId: user.id, role: "MODERATOR" }]);
    assert.deepEqual([demoted.reason, demoted.after], [null, { userId: user.id, role: "MEMBER" }]);
  });

  test("audit kaydı değiştirilemez: UPDATE ve DELETE reddedilir", async () => {
    const c = await community();
    const [row] = await audit(c.id, "community.create");
    await assert.rejects(db.$executeRaw`UPDATE audit_logs SET reason = 'değişti' WHERE id = ${row.id}::uuid`);
    await assert.rejects(db.$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}::uuid`);
    assert.equal((await audit(c.id, "community.create")).length, 1);
  });
});
