/**
 * KV-40 (#42) sistem ayarları ve acil durum anahtarları: config.get, admin.settings.list|update, admin.emergency.put.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Ayar satırları her testten önce temizlenir;
 * ayar servisi gerçek (`realSettings`), saat donuk olduğu için önbellek süresi saati ilerleterek sınanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { buildPublicConfig, ErrorBody, PublicConfig, Setting, settingKeys } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createSettingsService, DEFAULT_UPDATED_AT, effectiveDefaults, SAFE_DEFAULTS } from "../src/modules/settings/service.ts";
import type { SettingsStore, StoredSetting } from "../src/modules/settings/store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("sistem ayarları servisi (önbellek ve fail-safe)", () => {
  const rows = (value: unknown): StoredSetting[] => [{ key: "polls.dailyLimit", value, version: 2, updatedAt: new Date(1), updatedBy: null }];
  const unusedStore = (load: () => Promise<StoredSetting[]>): SettingsStore => ({
    loadStored: load,
    update: async () => assert.fail("kullanılmamalı"),
    putEmergency: async () => assert.fail("kullanılmamalı"),
  });

  test("varsayılanlar: bütün kayıt defteri anahtarlarında değer var; resmî değeri olmayanlar güvenli varsayılanla dolu", () => {
    const defaults = effectiveDefaults();
    for (const key of settingKeys) assert.ok(key in defaults, key);
    assert.equal(defaults["features.registration"], true);
    assert.equal(defaults["maintenance.enabled"], false);
    // Hız sınırı (limits.*) varsayılanları KV-19 politikasından gelir.
    assert.equal(defaults["limits.loginFailuresPerEmail"], 5);
    assert.deepEqual(Object.keys(SAFE_DEFAULTS).sort(), [
      "feed.explorationPercent",
      "feed.maxSameAuthorPerWindow",
      "feed.maxSameCategoryPerWindow",
      "features.comments",
      "features.pollCreation",
      "features.registration",
      "features.uploads",
      "maintenance.enabled",
      "polls.voteChangeAllowed",
    ].sort());
    // Varsayılanlar PublicConfig sözleşmesini üretir.
    PublicConfig.parse(buildPublicConfig(defaults));
  });

  test("önbellek: TTL dolana kadar eski değer, sonra yeni; invalidate anında yeniler", async () => {
    let now = new Date("2026-10-08T10:00:00.000Z");
    let stored = rows(5);
    let loads = 0;
    const service = createSettingsService(unusedStore(async () => (loads++, stored)), { now: () => now, ttlMs: 5_000 });

    assert.equal((await service.values())["polls.dailyLimit"], 5);
    stored = rows(7); // başka bir süreç değiştirdi
    now = new Date(now.getTime() + 4_000);
    assert.equal((await service.values())["polls.dailyLimit"], 5, "TTL dolmadı");
    now = new Date(now.getTime() + 2_000);
    assert.equal((await service.values())["polls.dailyLimit"], 7, "TTL doldu");
    assert.equal(loads, 2);

    stored = rows(9);
    service.invalidate();
    assert.equal((await service.values())["polls.dailyLimit"], 9, "invalidate anında yeniler");
    // Eşzamanlı okuma tek yükleme yapar.
    service.invalidate();
    await Promise.all([service.values(), service.values(), service.values()]);
    assert.equal(loads, 4);
  });

  test("fail-safe: DB okunamazsa son bilinen değerler, hiç yoksa güvenli varsayılanlar; 1 sn sonra yeniden dener", async () => {
    let now = new Date("2026-10-08T10:00:00.000Z");
    let fail = false;
    const errors: unknown[] = [];
    const service = createSettingsService(
      unusedStore(async () => {
        if (fail) throw new Error("db yok");
        return rows(5);
      }),
      { now: () => now, ttlMs: 5_000, onError: (e) => errors.push(e) },
    );
    // Hiç yüklenmeden hata: varsayılanlar (platform kapanmaz).
    fail = true;
    assert.equal((await service.values())["polls.dailyLimit"], 10);
    assert.equal(await service.isRegistrationEnabled(), true);
    assert.equal(await service.isMaintenance(), false);
    assert.equal(errors.length, 1);

    // Kısa süre sonra yeniden dener ve toparlanır.
    fail = false;
    now = new Date(now.getTime() + 1_500);
    assert.equal((await service.values())["polls.dailyLimit"], 5);

    // Yüklüyken hata: son bilinen değer korunur.
    fail = true;
    now = new Date(now.getTime() + 6_000);
    assert.equal((await service.values())["polls.dailyLimit"], 5);
    assert.equal(errors.length, 2);
  });

  test("list: satırı olmayan ayar sürüm 1 ve varsayılanla, tüm anahtarlar sıralı", async () => {
    const service = createSettingsService(unusedStore(async () => rows(5)), { now: () => new Date() });
    const list = await service.list();
    assert.deepEqual(list.map((s) => s.key), [...settingKeys].sort());
    const untouched = list.find((s) => s.key === "polls.cooldownMinutes")!;
    assert.deepEqual([untouched.version, untouched.value, untouched.updatedAt, untouched.updatedBy], [1, 10, DEFAULT_UPDATED_AT, null]);
    assert.deepEqual([list.find((s) => s.key === "polls.dailyLimit")!.value, list.find((s) => s.key === "polls.dailyLimit")!.version], [5, 2]);
  });
});

describe("sistem ayarları ve acil durum (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let superAdmin: User;
  let admin: User;

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `ayar-${randomUUID().slice(0, 8)}`, name: "Ayar Testi" } })).id;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: superAdmin.id } });
  });
  beforeEach(async () => {
    await db.systemSetting.deleteMany();
    h.settings!.invalidate();
  });
  after(async () => {
    await db?.systemSetting.deleteMany();
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
    const account = { email: `set_${id}@example.test`, username: `set_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const update = (cookie: string | undefined, key: string, value: unknown, version: number, reason = "Operasyon kararı") =>
    send("PATCH", `/admin/settings/${key}`, { value, version, reason }, cookie);
  const emergency = (cookie: string | undefined, switches: Record<string, boolean>, reason = "Acil durum") => send("PUT", "/admin/emergency", { switches, reason }, cookie);
  const audit = (targetId: string, action: string) => db.auditLog.findMany({ where: { targetId, action }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const auditCount = async (targetId: string, action: string) => (await audit(targetId, action)).length;
  const setting = async (key: string) => ((await get("/admin/settings", superAdmin.cookie)).json().data as { key: string; value: unknown; version: number }[]).find((s) => s.key === key)!;

  function pollBody(over: Record<string, unknown> = {}) {
    return {
      kind: "POLL",
      title: `Bu karar doğru mu? ${randomUUID().slice(0, 8)}`,
      categoryId,
      durationHours: 24,
      resultsVisibility: "ALWAYS",
      options: [{ label: "Evet" }, { label: "Hayır" }],
      ...over,
    };
  }
  const createPoll = (user: User, over: Record<string, unknown> = {}) => send("POST", "/polls", pollBody(over), user.cookie, `p-${randomUUID()}`);

  // ─── Okuma ve yetki ─────────────────────────────────────────

  test("liste: bütün anahtarlar, satırı olmayanlar sürüm 1 / varsayılanla; sözleşmeye uyar; yalnız ADMIN+", async () => {
    const res = await get("/admin/settings", admin.cookie);
    assert.equal(res.statusCode, 200, res.body);
    const items = (res.json().data as unknown[]).map((x) => Setting.parse(x));
    assert.deepEqual(items.map((s) => s.key), [...settingKeys].sort());
    const daily = items.find((s) => s.key === "polls.dailyLimit")!;
    assert.deepEqual([daily.value, daily.version, daily.updatedBy], [10, 1, null]);
    assert.equal(items.find((s) => s.key === "maintenance.enabled")!.value, false);

    assertError(await get("/admin/settings"), 401, "UNAUTHENTICATED");
    assertError(await get("/admin/settings", (await signUp()).cookie), 403, "FORBIDDEN");
  });

  test("config.get: public, kısa cache; ayar değişince anında yeni değer", async () => {
    const first = await get("/config");
    assert.equal(first.statusCode, 200, first.body);
    PublicConfig.parse(first.json().data);
    assert.match(String(first.headers["cache-control"]), /^public, max-age=\d+$/);
    assert.ok(Number(/max-age=(\d+)/.exec(String(first.headers["cache-control"]))![1]) <= 60, "sözleşme: ≤ 60 sn");
    assert.equal(first.json().data.polls.maxDurationHours, 720);
    assert.equal(first.json().data.maintenance, false);

    assert.equal((await update(superAdmin.cookie, "polls.maxDurationHours", 168, 1)).statusCode, 200);
    assert.equal((await get("/config")).json().data.polls.maxDurationHours, 168);
  });

  // ─── Değiştirme ─────────────────────────────────────────────

  test("güncelleme: sürüm artar, audit önce/sonra + gerekçe + güncelleyen; listeye ve config'e yansır", async () => {
    const base = await auditCount("polls.dailyLimit", "settings.update");
    const res = await update(superAdmin.cookie, "polls.dailyLimit", 25, 1, "Yoğunluk nedeniyle");
    assert.equal(res.statusCode, 200, res.body);
    const out = Setting.parse(res.json().data);
    assert.deepEqual([out.key, out.value, out.version, out.updatedBy?.id], ["polls.dailyLimit", 25, 2, superAdmin.id]);

    const rows = await audit("polls.dailyLimit", "settings.update");
    assert.equal(rows.length, base + 1);
    const last = rows.at(-1)!;
    assert.deepEqual([last.actorId, last.operation, last.targetType, last.reason], [superAdmin.id, "update", "SETTING", "Yoğunluk nedeniyle"]);
    assert.deepEqual(last.before, { value: 10, version: 1 });
    assert.deepEqual(last.after, { value: 25, version: 2 });
    assert.ok(last.requestId);

    assert.deepEqual(await setting("polls.dailyLimit").then((s) => [s.value, s.version]), [25, 2]);
    // Üst üste değişiklik: sürüm 3.
    assert.equal((await update(superAdmin.cookie, "polls.dailyLimit", 30, 2)).json().data.version, 3);
  });

  test("yetki: yalnız SUPER_ADMIN; ADMIN, kullanıcı ve misafir reddedilir ve değer değişmez", async () => {
    const auditBefore = await auditCount("polls.dailyLimit", "settings.update");
    assertError(await update(undefined, "polls.dailyLimit", 25, 1), 401, "UNAUTHENTICATED");
    assertError(await update((await signUp()).cookie, "polls.dailyLimit", 25, 1), 403, "FORBIDDEN");
    assertError(await update(admin.cookie, "polls.dailyLimit", 25, 1), 403, "FORBIDDEN");
    assertError(await emergency(admin.cookie, { comments: false }), 403, "FORBIDDEN");
    assertError(await emergency(undefined, { comments: false }), 401, "UNAUTHENTICATED");
    assert.equal((await setting("polls.dailyLimit")).value, 10);
    assert.equal((await get("/config")).json().data.features.comments, true);
    assert.equal(await auditCount("polls.dailyLimit", "settings.update"), auditBefore);
  });

  test("doğrulama: bilinmeyen anahtar 404; tip ve aralık 400; alanlar arası kural 400; gerekçe zorunlu; hiçbiri iz bırakmaz", async () => {
    const minAudit = await auditCount("polls.minDurationHours", "settings.update");
    assertError(await update(superAdmin.cookie, "polls.yok", 1, 1), 404, "NOT_FOUND");
    assertError(await update(superAdmin.cookie, "polls.dailyLimit", "çok", 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "polls.dailyLimit", 0, 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "polls.dailyLimit", 2.5, 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "polls.maxDurationHours", 721, 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "features.comments", "evet", 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "media.allowedTypes", ["image/gif"], 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "polls.dailyLimit", 25, 1, "ab"), 400, "VALIDATION_ERROR");
    // minDuration > maxDuration (diğer ayarla çakışma)
    assertError(await update(superAdmin.cookie, "polls.minDurationHours", 800, 1), 400, "VALIDATION_ERROR");
    assert.equal((await update(superAdmin.cookie, "polls.maxDurationHours", 48, 1)).statusCode, 200);
    const conflict = await update(superAdmin.cookie, "polls.minDurationHours", 72, 1);
    assertError(conflict, 400, "VALIDATION_ERROR");
    assert.equal(await db.systemSetting.count({ where: { key: "polls.minDurationHours" } }), 0);
    assert.equal(await auditCount("polls.minDurationHours", "settings.update"), minAudit);
  });

  test("iyimser kilit: eski sürüm 409 VERSION_CONFLICT (güncel sürüm detayda); aynı değer tekrarı idempotent ve iz bırakmaz", async () => {
    const base = await auditCount("polls.dailyLimit", "settings.update");
    assert.equal((await update(superAdmin.cookie, "polls.dailyLimit", 25, 1)).statusCode, 200);
    const stale = await update(superAdmin.cookie, "polls.dailyLimit", 40, 1);
    assertError(stale, 409, "VERSION_CONFLICT");
    assert.match(stale.json().error.details[0].message, /Güncel sürüm: 2/);
    assert.equal((await setting("polls.dailyLimit")).value, 25);

    // Aynı istek tekrarı (ağ yeniden denemesi): 200, sürüm ve audit değişmez.
    const again = await update(superAdmin.cookie, "polls.dailyLimit", 25, 1);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().data.version, 2);
    assert.equal(await auditCount("polls.dailyLimit", "settings.update"), base + 1);
    // Varsayılanla aynı değeri hiç değiştirilmemiş ayara göndermek de iz bırakmaz.
    const noop = await update(superAdmin.cookie, "polls.cooldownMinutes", 10, 1);
    assert.equal(noop.json().data.version, 1);
    assert.equal(await db.systemSetting.count({ where: { key: "polls.cooldownMinutes" } }), 0);
  });

  test("eşzamanlı iki değişiklik: aynı sürümden gelen ikisinden yalnız biri uygulanır", async () => {
    const base = await auditCount("polls.dailyLimit", "settings.update");
    const results = await Promise.all([update(superAdmin.cookie, "polls.dailyLimit", 21, 1), update(superAdmin.cookie, "polls.dailyLimit", 22, 1)]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal((await setting("polls.dailyLimit")).version, 2);
    assert.equal(await auditCount("polls.dailyLimit", "settings.update"), base + 1);
  });

  // ─── Acil durum anahtarları ─────────────────────────────────

  test("acil durum: kayıt kapanır (503 FEATURE_DISABLED); mevcut hesap giriş yapıp çalışmaya devam eder; tek audit; tekrar iz bırakmaz", async () => {
    const existing = await signUp();
    const base = await auditCount("emergency", "emergency.update");
    const res = await emergency(superAdmin.cookie, { registration: false }, "Spam dalgası");
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { registration: false, pollCreation: true, comments: true, uploads: true, maintenance: false });

    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    assertError(await send("POST", "/auth/register", { email: `x_${id}@example.test`, username: `x_${id}`, displayName: "Yeni", password: "guclu-bir-sifre-1" }), 503, "FEATURE_DISABLED");
    // Devam eden oturum etkilenmez; yeni giriş de çalışır.
    assert.equal((await get("/me", existing.cookie)).statusCode, 200);
    assert.equal((await get("/config")).json().data.features.registration, false);

    const rows = await audit("emergency", "emergency.update");
    assert.equal(rows.length, base + 1);
    const last = rows.at(-1)!;
    assert.deepEqual(
      [last.actorId, last.reason, last.before, last.after],
      [superAdmin.id, "Spam dalgası", { "features.registration": true }, { "features.registration": false }],
    );
    assert.equal((await setting("features.registration")).version, 2);

    // Aynı durumu tekrar göndermek (idempotent): iz ve sürüm yok.
    assert.equal((await emergency(superAdmin.cookie, { registration: false })).statusCode, 200);
    assert.equal(await auditCount("emergency", "emergency.update"), base + 1);
    assert.equal((await setting("features.registration")).version, 2);

    assert.equal((await emergency(superAdmin.cookie, { registration: true }, "Normale dönüş")).statusCode, 200);
    assert.equal((await send("POST", "/auth/register", { email: `y_${id}@example.test`, username: `y_${id}`, displayName: "Yeni", password: "guclu-bir-sifre-1" })).statusCode, 202);
  });

  test("acil durum: yorumlar, anket açma ve görsel yükleme kapanır; okuma ve devam eden oturum çalışır; tek istekte çoklu anahtar tek audit", async () => {
    const author = await signUp();
    const poll = (await createPoll(author)).json().data;
    assert.ok(poll.id);
    const base = await auditCount("emergency", "emergency.update");

    const res = await emergency(superAdmin.cookie, { comments: false, pollCreation: false, uploads: false }, "Kötüye kullanım");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await auditCount("emergency", "emergency.update"), base + 1);

    assertError(await send("POST", `/polls/${poll.id}/comments`, { body: "Merhaba" }, author.cookie), 503, "FEATURE_DISABLED");
    assertError(await createPoll(author), 503, "FEATURE_DISABLED");
    assertError(await send("POST", "/media/uploads", { purpose: "POLL", mimeType: "image/webp", sizeBytes: 1000 }, author.cookie), 503, "FEATURE_DISABLED");
    // Okuma ve oturum etkilenmez.
    assert.equal((await get(`/polls/${poll.id}`, author.cookie)).statusCode, 200);
    assert.equal((await get("/me", author.cookie)).statusCode, 200);

    assert.equal((await emergency(superAdmin.cookie, { comments: true, pollCreation: true, uploads: true }, "Normale dönüş")).statusCode, 200);
    assert.equal((await send("POST", `/polls/${poll.id}/comments`, { body: "Merhaba" }, (await signUp()).cookie)).statusCode, 201);
    // Yayın bekleme süresi (cooldown) aynı yazarı sınırlar; yeniden açılmayı başka bir hesapla doğrula.
    assert.equal((await createPoll(await signUp())).statusCode, 201);
  });

  test("bakım modu: yazma istekleri 503 MAINTENANCE; okuma, giriş ve /admin açık; yönetici modu kapatır", async () => {
    const user = await signUp();
    assert.equal((await emergency(superAdmin.cookie, { maintenance: true }, "Planlı bakım")).statusCode, 200);

    assertError(await createPoll(user), 503, "MAINTENANCE");
    assertError(await send("POST", "/reports", { target: { type: "POLL", id: randomUUID() }, reason: "SPAM" }, user.cookie), 503, "MAINTENANCE");
    assert.equal((await get("/me", user.cookie)).statusCode, 200);
    assert.equal((await get("/feed?tab=new")).statusCode, 200);
    assert.equal((await get("/config")).json().data.maintenance, true);
    // Giriş açık: mevcut kullanıcı girebilir.
    const email = (await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } })).email;
    assert.equal((await send("POST", "/auth/login", { email, password: "guclu-bir-sifre-1" })).statusCode, 200);
    // Yönetici bakım sırasında da çalışır ve modu kapatabilir.
    assert.equal((await update(superAdmin.cookie, "polls.dailyLimit", 12, 1)).statusCode, 200);
    assert.equal((await emergency(superAdmin.cookie, { maintenance: false }, "Bakım bitti")).statusCode, 200);
    assert.equal((await createPoll(user)).statusCode, 201);
  });

  // ─── Tüketiciler ayarı kullanıyor ───────────────────────────

  test("anket ayarları deploy'suz etkili: süre, seçenek sayısı, başlık ve açıklama sınırları", async () => {
    const user = await signUp();
    assert.equal((await update(superAdmin.cookie, "polls.minDurationHours", 5, 1)).statusCode, 200);
    const short = await createPoll(user, { durationHours: 2 });
    assertError(short, 400, "VALIDATION_ERROR");
    assert.equal(short.json().error.details[0].field, "durationHours");

    assert.equal((await update(superAdmin.cookie, "polls.maxOptions", 3, 1)).statusCode, 200);
    const many = await createPoll(user, { options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] });
    assertError(many, 400, "VALIDATION_ERROR");
    assert.equal(many.json().error.details[0].field, "options");

    assert.equal((await update(superAdmin.cookie, "polls.titleMaxLength", 20, 1)).statusCode, 200);
    assertError(await createPoll(user, { title: "Bu başlık yirmi karakterden uzun" }), 400, "VALIDATION_ERROR");
    assert.equal((await update(superAdmin.cookie, "polls.descriptionMaxLength", 10, 1)).statusCode, 200);
    assertError(await createPoll(user, { title: "Kısa başlık burada", description: "Bu açıklama on karakterden uzun" }), 400, "VALIDATION_ERROR");

    // Sınır içi istek geçer.
    assert.equal((await createPoll(user, { title: "Kısa başlık burada", durationHours: 6, options: [{ label: "A" }, { label: "B" }, { label: "C" }] })).statusCode, 201);
  });

  test("yorum üst sınırı ve puan ayarları: comments.bodyMaxLength, points.publishCost, points.initialGrant", async () => {
    const author = await signUp();
    const poll = (await createPoll(author)).json().data;
    assert.equal((await update(superAdmin.cookie, "comments.bodyMaxLength", 10, 1)).statusCode, 200);
    const long = await send("POST", `/polls/${poll.id}/comments`, { body: "Bu yorum on karakterden uzun" }, author.cookie);
    assertError(long, 400, "VALIDATION_ERROR");
    assert.equal(long.json().error.details[0].field, "body");
    const ok = await send("POST", `/polls/${poll.id}/comments`, { body: "Kısa" }, author.cookie);
    assert.equal(ok.statusCode, 201, ok.body);
    assertError(await send("PATCH", `/comments/${ok.json().data.id}`, { body: "Bu yorum on karakterden uzun" }, author.cookie), 400, "VALIDATION_ERROR");

    // Yayın maliyeti: /points yeni değeri gösterir ve yayın o kadar düşer.
    assert.equal((await update(superAdmin.cookie, "points.publishCost", 4, 1)).statusCode, 200);
    const before = (await get("/me/points", author.cookie)).json().data;
    assert.equal(before.publishCost, 4);
    const spender = await signUp();
    const spenderBefore = (await get("/me/points", spender.cookie)).json().data.balance;
    assert.equal((await createPoll(spender)).statusCode, 201);
    assert.equal((await get("/me/points", spender.cookie)).json().data.balance, spenderBefore - 4);

    // İlk giriş puanı: ayar değişince yeni hesabın ledger'ı o kadar yazar.
    assert.equal((await update(superAdmin.cookie, "points.initialGrant", 7, 1)).statusCode, 200);
    const fresh = await signUp();
    assert.equal((await get("/me/points", fresh.cookie)).json().data.balance, 7);
  });

  test("görsel risk eşikleri (KV-38): sınırlar, orta ≤ yüksek kuralı, gerekçeli audit", async () => {
    const base = await auditCount("media.riskHighPercent", "settings.update");
    // Üst sınır: yüksek eşik 95'i, orta eşik 60'ı aşamaz (fail-closed taban).
    assertError(await update(superAdmin.cookie, "media.riskHighPercent", 96, 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "media.riskMediumPercent", 61, 1), 400, "VALIDATION_ERROR");
    assertError(await update(superAdmin.cookie, "media.riskMediumPercent", 5, 1), 400, "VALIDATION_ERROR");
    // Orta eşik yüksek eşiği aşamaz.
    assert.equal((await update(superAdmin.cookie, "media.riskHighPercent", 45, 1, "Daha sıkı tarama")).statusCode, 200);
    assertError(await update(superAdmin.cookie, "media.riskMediumPercent", 50, 1), 400, "VALIDATION_ERROR");
    assert.equal((await update(superAdmin.cookie, "media.riskMediumPercent", 30, 1)).statusCode, 200);

    const rows = await audit("media.riskHighPercent", "settings.update");
    assert.equal(rows.length, base + 1);
    const last = rows.at(-1)!;
    assert.deepEqual([last.actorId, last.reason, last.before, last.after], [superAdmin.id, "Daha sıkı tarama", { value: 65, version: 1 }, { value: 45, version: 2 }]);
    // ADMIN değiştiremez.
    assertError(await update(admin.cookie, "media.riskHighPercent", 50, 2), 403, "FORBIDDEN");
  });

  test("medya ayarı: media.maxBytes düşünce daha büyük dosya reddedilir", async () => {
    const user = await signUp();
    assert.equal((await send("POST", "/media/uploads", { purpose: "POLL", mimeType: "image/webp", sizeBytes: 2_000_000 }, user.cookie)).statusCode, 201);
    assert.equal((await update(superAdmin.cookie, "media.maxBytes", 1_000_000, 1)).statusCode, 200);
    assertError(await send("POST", "/media/uploads", { purpose: "POLL", mimeType: "image/webp", sizeBytes: 2_000_000 }, user.cookie), 413, "MEDIA_TOO_LARGE");
    assert.equal((await get("/config")).json().data.media.maxBytes, 1_000_000);
  });

  test("çok süreçli önbellek: başka sürecin yazdığı değer TTL sonrası görünür (saat ilerletilir)", async () => {
    // Başka bir API süreci DB'ye doğrudan yazar; bu süreçte invalidate çağrılmaz.
    await get("/config"); // önbelleği ısıt
    await db.systemSetting.create({ data: { key: "polls.dailyLimit", value: 77, version: 2 } });
    assert.equal((await setting("polls.dailyLimit")).value, 10, "TTL dolmadı: eski değer");
    h.clock.advance(6_000);
    assert.equal((await setting("polls.dailyLimit")).value, 77, "TTL doldu: yeni değer");
  });
});
