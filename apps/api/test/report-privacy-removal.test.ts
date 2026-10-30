/**
 * #290 / #284 L0: karar gerektirmeyen, MEVCUT davranışı ölçen testler (docs/LEGAL_290_TAKEDOWN_APPEALS_DECISIONS.md §4).
 *  1. Raporlayanın kimliği (kimlik, kullanıcı adı, e-posta, görünen ad, rapor notu, rapor kimliği) hedef kullanıcının
 *     görebildiği hiçbir yüzeyde ve ona yazılan bildirim satırlarında bulunmaz. Test boş geçmesin diye hedef gerçekten
 *     uyarı + moderasyon bildirimi alır.
 *  2. Kaldırılan (REMOVE) içerik misafir ve üye için detay, yorumlar, akış ve aramadan düşer.
 *  3. Yetkisiz kişiler rapor kuyruğunu okuyamaz ve raporu sonuçlandıramaz/uyaramaz.
 * Yeni davranış eklemez; hukuki karar (#285) gerektiren hiçbir şeyi varsaymaz. Gerçek PostgreSQL gerektirir.
 * Worker dağıtıcısı ve bildirim tüketicisi bu testte göreli yolla import edilir (bkz. kv21-trend-exclusion-notify.test.ts).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollCard } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { dispatchBatch, processNext, type DispatchDeps } from "../../worker/src/jobs/events/dispatch.ts";
import { createNotificationsConsumer } from "../../worker/src/jobs/notifications/consumer.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string; displayName: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("rapor gizliliği ve kaldırma tutarlılığı (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let root: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `l0-${randomUUID().slice(0, 8)}`, name: "Hukuki L0" } })).id;
    root = await signUp();
    await db.userRole.create({ data: { userId: root.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: root.id } });
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
  const get = (url: string, cookie?: string) => send("GET", url, undefined, cookie);
  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }
  async function signUp(label = "L0"): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `l0_${id}@example.test`, username: `l0_${id}`, displayName: `${label} Kişi ${id}`, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, username: account.username, email: account.email, displayName: account.displayName };
  }
  async function createPoll(cookie: string, title: string) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      cookie,
      `l0-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }
  const moderate = async (pollId: string, action: string) => {
    const res = await send("POST", `/admin/polls/${pollId}/moderation`, { action, reason: "Moderatör incelemesi" }, admin.cookie);
    assert.equal(res.statusCode, 200, `${action}: ${res.body}`);
  };
  const report = (cookie: string | undefined, type: string, id: string, reason: string, note?: string) =>
    send("POST", "/reports", { target: { type, id }, reason, ...(note !== undefined ? { note } : {}) }, cookie);
  async function drain() {
    const deps: DispatchDeps = { prisma: db, consumers: [createNotificationsConsumer()], now: () => new Date(), log: () => {} };
    for (;;) {
      const d = await dispatchBatch(deps);
      let n = 0;
      while ((await processNext(deps)) !== "none") n++;
      if (d.events === 0 && n === 0) return;
    }
  }

  // ─── 1. Raporlayan gizliliği ────────────────────────────────

  test("hedef kullanıcı: bildirim, profil, anket ve yorum yüzeylerinde ve bildirim satırlarında raporlayanın izi yok", async () => {
    const author = await signUp("Hedef");
    const reporter = await signUp("Raporlayan");
    const noteMarker = `RAPORNOTU${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const title = `Telif sorusu ${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const pollId = await createPoll(author.cookie, title);
    const comment = await send("POST", `/polls/${pollId}/comments`, { body: "Bu içerik başkasına ait olabilir" }, author.cookie);
    assert.equal(comment.statusCode, 201, comment.body);
    const commentId = comment.json().data.id as string;

    const pollReport = await report(reporter.cookie, "POLL", pollId, "COPYRIGHT", noteMarker);
    const commentReport = await report(reporter.cookie, "COMMENT", commentId, "HARASSMENT", `${noteMarker}-yorum`);
    const userReport = await report(reporter.cookie, "USER", author.id, "HARASSMENT", `${noteMarker}-kullanıcı`);
    const reportIds = [pollReport, commentReport, userReport].map((r) => {
      assert.equal(r.statusCode, 202, r.body);
      return r.json().data.reportId as string;
    });

    // Yönetici: rapordan uyarı, anketi gizleme ve raporu sonuçlandırma. Hedef bunların bildirimini alır.
    assert.equal((await send("POST", `/admin/reports/${reportIds[0]}/warn`, { reason: "Telif iddiası: içeriği düzenleyin" }, admin.cookie)).statusCode, 200);
    await moderate(pollId, "HIDE");
    assert.equal((await send("POST", `/admin/reports/${reportIds[0]}/resolve`, { resolution: "ACTIONED", note: "Telif iddiası incelendi, içerik gizlendi" }, admin.cookie)).statusCode, 200);
    await drain();

    // Test boş geçmesin: hedef gerçekten bildirim almış olmalı.
    const mine = await get("/notifications?limit=50", author.cookie);
    assert.equal(mine.statusCode, 200, mine.body);
    const types = (mine.json().data as { type: string }[]).map((n) => n.type);
    assert.ok(types.includes("MODERATION_APPLIED"), `MODERATION_APPLIED bekleniyordu: ${types.join(",")}`);

    const surfaces: [string, Res][] = [
      ["/notifications", mine],
      ["/notifications/unread-count", await get("/notifications/unread-count", author.cookie)],
      ["/me", await get("/me", author.cookie)],
      [`/polls/${pollId}`, await get(`/polls/${pollId}`, author.cookie)],
      [`/polls/${pollId}/comments`, await get(`/polls/${pollId}/comments`, author.cookie)],
    ];
    // Tarama anlamlı olsun: aynı yüzeyler hedefin kendi bilgisini gerçekten içeriyor (arama alanı boş değil).
    assert.ok(surfaces[2]![1].body.includes(author.username), "/me hedefin kendi kullanıcı adını içermeli");
    assert.ok(surfaces[3]![1].body.includes(title) || surfaces[3]![1].statusCode !== 200, "anket detayı 200 ise başlığı içermeli");
    const secrets = [reporter.id, reporter.username, reporter.email, reporter.displayName, noteMarker, ...reportIds];
    for (const [name, res] of surfaces) {
      for (const secret of secrets) assert.ok(!res.body.includes(secret), `${name} raporlayanın izini sızdırıyor: ${secret}`);
    }

    // Hedefe yazılan bildirim satırlarının tamamı (veri, aktör, olay bağlantısı, konu): raporlayan kimliği ve rapor kimliği yok.
    const rows = await db.notification.findMany({ where: { recipientId: author.id } });
    assert.ok(rows.length >= 1);
    const dump = JSON.stringify(rows);
    assert.ok(dump.includes(author.id), "bildirim satırları hedefin kendi kimliğini içermeli (arama alanı boş değil)");
    for (const secret of secrets) assert.ok(!dump.includes(secret), `bildirim satırı raporlayanın izini taşıyor: ${secret}`);
    for (const row of rows) assert.notEqual(row.actorId, reporter.id);
  });

  // ─── 2. Kaldırılan içerik her yüzeyden düşer ────────────────

  test("REMOVE sonrası misafir ve üye için detay, yorumlar, akış ve arama içeriği döndürmez", async () => {
    const author = await signUp("Sahip");
    const viewer = await signUp("İzleyici");
    // Yalnız harf: arama normalizasyonu rakamlı belirteçleri farklı ele alabilir (search.test.ts aynı kuralı kullanır).
    const token = `kld${randomUUID().replaceAll("-", "").replace(/[0-9]/g, "").slice(0, 8) || "abcdefgh"}`;
    const pollId = await createPoll(author.cookie, `Kaldırılacak ${token} içerik`);
    await send("POST", `/polls/${pollId}/comments`, { body: "yorum" }, viewer.cookie);

    const listsIn = async (cookie?: string) => {
      const feed = ((await get("/feed?tab=new&limit=100", cookie)).json().data as unknown[]).map((c) => PollCard.parse(c).id);
      const found = ((await get(`/search?${new URLSearchParams({ q: token, type: "polls" })}`, cookie)).json().data as { type: string; poll?: { id: string } }[])
        .filter((r) => r.type === "poll")
        .map((r) => r.poll!.id);
      return { feed, found };
    };
    // Kontrol: kaldırmadan önce içerik gerçekten görünür (testin anlamlı olması için).
    assert.equal((await get(`/polls/${pollId}`)).statusCode, 200);
    const before = await listsIn();
    assert.ok(before.feed.includes(pollId), "kaldırmadan önce akışta olmalı");
    assert.ok(before.found.includes(pollId), "kaldırmadan önce aramada olmalı");

    await moderate(pollId, "REMOVE");

    for (const cookie of [undefined, viewer.cookie]) {
      const who = cookie ? "üye" : "misafir";
      assert.equal((await get(`/polls/${pollId}`, cookie)).statusCode, 404, `${who}: detay`);
      assert.equal((await get(`/polls/${pollId}/comments`, cookie)).statusCode, 404, `${who}: yorumlar`);
      const after = await listsIn(cookie);
      assert.ok(!after.feed.includes(pollId), `${who}: akış`);
      assert.ok(!after.found.includes(pollId), `${who}: arama`);
    }
  });

  // ─── 3. Yetkisiz kişiler ────────────────────────────────────

  test("rapor kuyruğu ve işlemleri: misafir 401; rolsüz üye 403; topluluğu olmayan moderatör kapsam dışı içerikte 403", async () => {
    const author = await signUp("Hedef");
    const reporter = await signUp("Raporlayan");
    const member = await signUp("Üye");
    const moderator = await signUp("Moderatör");
    await db.userRole.create({ data: { userId: moderator.id, role: "MODERATOR", grantedById: root.id } });
    const pollId = await createPoll(author.cookie, `Yetki sorusu ${randomUUID().slice(0, 8)}`);
    const filed = await report(reporter.cookie, "POLL", pollId, "COPYRIGHT");
    assert.equal(filed.statusCode, 202, filed.body);
    const reportId = filed.json().data.reportId as string;

    assertError(await get("/admin/reports"), 401, "UNAUTHENTICATED");
    assertError(await get("/admin/reports", member.cookie), 403, "FORBIDDEN");
    assertError(await get("/admin/reports", reporter.cookie), 403, "FORBIDDEN");
    for (const cookie of [member.cookie, reporter.cookie]) {
      assertError(await send("POST", `/admin/reports/${reportId}/resolve`, { resolution: "DISMISSED", note: "Yetkisiz deneme" }, cookie), 403, "FORBIDDEN");
      assertError(await send("POST", `/admin/reports/${reportId}/warn`, { reason: "Yetkisiz deneme" }, cookie), 403, "FORBIDDEN");
    }
    // Topluluğa atanmamış moderatör, topluluksuz içeriğin raporunu sonuçlandıramaz.
    assertError(await send("POST", `/admin/reports/${reportId}/resolve`, { resolution: "DISMISSED", note: "Kapsam dışı deneme" }, moderator.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", `/admin/polls/${pollId}/moderation`, { action: "HIDE", reason: "Kapsam dışı deneme" }, moderator.cookie), 403, "FORBIDDEN");

    // Hiçbir yetkisiz deneme kaydı değiştirmedi.
    const row = await db.report.findUniqueOrThrow({ where: { id: reportId } });
    assert.equal(row.status, "OPEN");
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "ACTIVE");
  });
});
