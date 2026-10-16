/**
 * KV-186 (#186) operasyon merkezi sunucu tarafı (admin.ops.status): yalnız SUPER_ADMIN okur; ölçülemeyen bileşen
 * `unknown` döner (0 ya da ok değil); istek metrikleri route kalıbıyla tutulur (kimlik, sorgu dizesi, IP, e-posta yok);
 * hız sınırı ve giriş kilidi sayılır; gerçek pg-boss şemasında kuyruk, backlog ve worker izi okunur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_RATE_LIMIT_SETTINGS } from "../src/modules/rate-limit/policy.ts";
import { ErrorBody, OpsStatus } from "@kararver/contracts";
import { PgBoss } from "pg-boss";
import { createPrismaOpsProbe } from "../src/modules/ops/probe.ts";
import { buildOpsStatus, classifyBackup, classifyQueues, classifyWorker, RESTORE_DRILL } from "../src/modules/ops/status.ts";
import { recordBackupRun, type Manifest } from "../../../packages/db/ops/backup.ts";
import { writeAudit } from "../src/modules/audit/write.ts";
import { createOpsTelemetry, percentile } from "../src/modules/ops/telemetry.ts";
import { createHarness, memoryBackend, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";
import { resolveTestDatabaseUrl } from "./support/test-db.ts";

type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("operasyon telemetrisi (birim)", () => {
  test("yüzdelik en yakın sıra; ölçüm yoksa oran ve gecikme null (0 değil)", () => {
    assert.equal(percentile([10, 20, 30, 40], 50), 20);
    assert.equal(percentile([10, 20, 30, 40], 95), 40);
    const t = createOpsTelemetry({ now: () => 0 });
    const { http, security } = t.snapshot();
    assert.deepEqual([http.requests, http.errorRate, http.latencyMs, http.slowest], [0, null, null, []]);
    assert.deepEqual([security.rateLimited, security.loginLockouts, security.byRule], [0, 0, []]);
  });

  test("5xx oranı, P50/P95/P99, en yavaş route'lar ve kayan pencere", () => {
    let clock = 0;
    const t = createOpsTelemetry({ now: () => clock, windowMs: 60_000 });
    for (let i = 1; i <= 100; i++) t.recordRequest({ method: "GET", route: "/v1/feed", status: i <= 5 ? 503 : 200, ms: i });
    t.recordRequest({ method: "POST", route: "/v1/polls", status: 201, ms: 900 });
    t.recordRateLimit(["vote.min"], false);
    t.recordRateLimit(["login.email", "login.ip"], true);
    let snap = t.snapshot();
    assert.equal(snap.http.requests, 101);
    assert.equal(snap.http.errors5xx, 5);
    assert.ok(Math.abs(snap.http.errorRate! - 5 / 101) < 1e-9);
    assert.deepEqual(snap.http.latencyMs, { p50: 51, p95: 96, p99: 100 });
    assert.deepEqual(snap.http.slowest[0], { method: "POST", route: "/v1/polls", count: 1, p95Ms: 900 });
    assert.deepEqual([snap.security.rateLimited, snap.security.loginLockouts], [1, 1]);
    assert.deepEqual(snap.security.byRule.map((r) => r.rule), ["login.email", "login.ip", "vote.min"]);

    clock = 30_000;
    t.recordRequest({ method: "GET", route: "/v1/me", status: 200, ms: 3 });
    clock = 61_000; // ilk örnekler pencereden çıktı
    snap = t.snapshot();
    assert.deepEqual([snap.http.requests, snap.http.errors5xx, snap.security.rateLimited], [1, 0, 0]);
  });

  test("bellek üst sınırı: en eski örnekler atılır", () => {
    const t = createOpsTelemetry({ now: () => 0, maxSamples: 10 });
    for (let i = 0; i < 50; i++) t.recordRequest({ method: "GET", route: "/v1/feed", status: 200, ms: i });
    assert.equal(t.snapshot().http.requests, 10);
  });

  test("worker ve kuyruk sınıflandırması: iz yoksa unknown, eskidikçe degraded/down; backlog ve başarısız iş degraded", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const ago = (s: number) => new Date(now.getTime() - s * 1000);
    assert.deepEqual(classifyWorker(null, now), { status: "unknown", lastSeenAt: null, ageSeconds: null });
    assert.equal(classifyWorker(ago(30), now).status, "ok");
    assert.equal(classifyWorker(ago(300), now).status, "degraded");
    assert.equal(classifyWorker(ago(3600), now).status, "down");
    const q = { name: "x", waiting: 0, active: 0, failed24h: 0, completed24h: 10, oldestWaitingSeconds: null };
    assert.equal(classifyQueues([]), "unknown");
    assert.equal(classifyQueues([q]), "ok");
    assert.equal(classifyQueues([{ ...q, waiting: 3, oldestWaitingSeconds: 900 }]), "degraded");
    assert.equal(classifyQueues([{ ...q, failed24h: 1 }]), "degraded");
    const h = (n: number) => ago(n * 3600);
    assert.equal(classifyBackup(null, now), "unknown");
    assert.equal(classifyBackup(h(25), now), "ok");
    assert.equal(classifyBackup(h(30), now), "degraded");
    assert.equal(classifyBackup(h(80), now), "down");
  });

  test("yoklama hata verirse bileşen down/unknown; yanıt yine sözleşmeye uyar", async () => {
    const fail = async () => {
      throw new Error("bağlantı yok: postgres://gizli@host/db");
    };
    const status = await buildOpsStatus({
      probe: { database: fail, workerLastSeen: fail, queues: fail, lastBackup: fail, securitySignals: fail },
      loginLimits: async () => ({ email: 5, ip: 20 }),
      telemetry: createOpsTelemetry(),
      env: "test",
      startedAt: new Date(),
      now: () => new Date(),
    });
    OpsStatus.parse(status);
    assert.equal(status.components.database.status, "down");
    assert.equal(status.components.queue.status, "unknown");
    assert.deepEqual([status.backup.status, status.backup.lastBackupAt], ["unknown", null]);
    assert.deepEqual([status.security.lockedLogins, status.security.adminActions24h], [null, null]);
    assert.ok(!JSON.stringify(status).includes("postgres://"), "hata ayrıntısı/bağlantı adresi sızmaz");
  });
});

describe("admin.ops.status (memory)", () => {
  let h: Harness;
  let root: { cookie: string; id: string };
  let admin: { cookie: string; id: string };
  let user: { cookie: string; id: string; email: string };

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string, remoteAddress?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      remoteAddress,
      headers: { origin: WEB_ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  async function signUp(label: string) {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ops_${label}_${id}@example.test`, username: `ops_${label}_${id}`.slice(0, 30), displayName: "Ops", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, email: account.email };
  }

  before(async () => {
    h = await createHarness(memoryBackend);
    root = await signUp("root");
    admin = await signUp("admin");
    user = await signUp("user");
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    await seeds.setRole(admin.id, "ADMIN", root.id);
  });
  after(async () => {
    await h?.close();
  });

  test("yalnız SUPER_ADMIN: misafir 401, USER ve ADMIN 403", async () => {
    assert.equal((await send("GET", "/admin/ops")).statusCode, 401);
    for (const who of [user, admin]) {
      const res = await send("GET", "/admin/ops", undefined, who.cookie);
      assert.equal(res.statusCode, 403, res.body);
      ErrorBody.parse(res.json());
    }
    const ok = await send("GET", "/admin/ops", undefined, root.cookie);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.match(String(ok.headers["cache-control"]), /no-store/);
  });

  test("yoklama yoksa DB/worker/kuyruk unknown; yedek bilinmiyor, restore tatbikatı kanıtı var", async () => {
    const res = await send("GET", "/admin/ops", undefined, root.cookie);
    const data = OpsStatus.parse(res.json().data);
    assert.equal(data.components.api.status, "ok");
    assert.deepEqual(data.components.database, { status: "unknown", latencyMs: null, version: null });
    assert.equal(data.components.queue.status, "unknown");
    assert.deepEqual(data.components.queue.queues, []);
    assert.deepEqual([data.security.lockedLogins, data.security.adminActions24h], [null, null], "DB yoklaması yoksa bilinmiyor (null), 0 değil");
    assert.equal(data.switches, null, "ayar servisi yoksa anahtar durumu bilinmiyor (null)");
    assert.deepEqual(data.backup, { status: "unknown", lastBackupAt: null, restoreDrill: { ...RESTORE_DRILL } });
    assert.equal(data.release.env, "test");
  });

  test("istekler route kalıbıyla sayılır; yanıtta kimlik, sorgu dizesi, IP ve e-posta yok", async () => {
    const ip = "198.51.100.23";
    const secretQuery = "token=ops-gizli-123";
    await send("GET", `/admin/ops?${secretQuery}`, undefined, root.cookie, ip);
    await send("GET", `/admin/users/${user.id}`, undefined, root.cookie, ip);
    await send("GET", `/bilinmeyen/${user.email}`, undefined, undefined, ip);
    const res = await send("GET", "/admin/ops", undefined, root.cookie);
    const data = OpsStatus.parse(res.json().data);
    assert.ok(data.http.requests > 0);
    assert.ok(data.http.latencyMs, "ölçüm var");
    const routes = data.http.slowest.map((r) => r.route);
    assert.ok(routes.includes("/v1/admin/ops") && routes.includes("(eşleşmeyen)"), routes.join(","));
    for (const leak of [user.id, user.email, ip, secretQuery, "ops-gizli", "/bilinmeyen"]) assert.ok(!res.body.includes(leak), `yanıtta ${leak}`);
    for (const r of routes) assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(r) && !r.includes("?"), r);
  });

  test("hız sınırı ve giriş kilidi kural adıyla sayılır", async () => {
    Object.assign(h.rateLimitSettings, { loginFailuresPerEmail: DEFAULT_RATE_LIMIT_SETTINGS.loginFailuresPerEmail });
    const before = OpsStatus.parse((await send("GET", "/admin/ops", undefined, root.cookie)).json().data).security;
    let locked = 0;
    for (let i = 0; i <= DEFAULT_RATE_LIMIT_SETTINGS.loginFailuresPerEmail; i++) {
      const r = await send("POST", "/auth/login", { email: user.email, password: "yanlis-parola-xx" }, undefined, `203.0.113.${10 + i}`);
      if (r.statusCode === 429) locked++;
    }
    assert.equal(locked, 1);
    const after = OpsStatus.parse((await send("GET", "/admin/ops", undefined, root.cookie)).json().data).security;
    assert.equal(after.loginLockouts, before.loginLockouts + 1);
    assert.ok(after.byRule.some((r) => r.rule === "login.email"));
    assert.ok(!JSON.stringify(after).includes(user.email));
  });
});

const backend = prismaBackend();

describe("operasyon yoklaması (postgres + gerçek pg-boss)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  const schema = `pgboss_ops_test_${randomUUID().slice(0, 8)}`;
  let boss: PgBoss;

  before(async () => {
    h = await createHarness(backend!);
    boss = new PgBoss({ connectionString: resolveTestDatabaseUrl(path.resolve(import.meta.dirname, "../../.."))!, schema, schedule: false, supervise: false });
    boss.on("error", (err) => assert.fail(err));
    await boss.start();
  });
  after(async () => {
    await boss?.stop({ graceful: false });
    await h?.prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await h?.close();
  });

  test("şema yoksa worker/kuyruk unknown; DB ok ve sürüm", async () => {
    const status = await buildOpsStatus({
      probe: createPrismaOpsProbe(h.prisma!, { schema: "pgboss_yok_boyle_sema" }),
      telemetry: createOpsTelemetry(),
      env: "test",
      startedAt: new Date(),
      now: () => new Date(),
    });
    OpsStatus.parse(status);
    assert.equal(status.components.database.status, "ok");
    assert.match(status.components.database.version ?? "", /^\d+(\.\d+)?$/);
    assert.equal(status.components.queue.status, "unknown");
    assert.equal(status.components.worker.status, "unknown");
  });

  test("toplu içerik işleri (#181) kendi tablosundan kuyruk olarak; tablo yoksa listede yok", async () => {
    // #211 migration'ının ilgili kolonları; test kendi şemasında çalışır (public.content_jobs'a dokunmaz).
    const table = `${schema}.content_jobs`;
    await h.prisma!.$executeRawUnsafe(
      `CREATE TABLE ${table} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, claimed_at timestamptz,
         finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    );
    await h.prisma!.$executeRawUnsafe(
      `INSERT INTO ${table} (status, claimed_at, finished_at, created_at, updated_at) VALUES
         ('QUEUED', NULL, NULL, now() - interval '2 hours', now() - interval '10 minutes'),
         ('PROCESSING', now() - interval '20 minutes', NULL, now() - interval '1 hour', now() - interval '20 minutes'),
         ('PROCESSING', now() - interval '30 seconds', NULL, now() - interval '1 hour', now() - interval '30 seconds'),
         ('FAILED', NULL, now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 hour'),
         ('DONE', NULL, now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 hour'),
         ('DONE', NULL, now() - interval '2 days', now() - interval '3 days', now() - interval '2 days')`,
    );
    const queues = await createPrismaOpsProbe(h.prisma!, { schema, contentJobsTable: table }).queues();
    const jobs = queues.find((q) => q.name === "content.jobs");
    assert.ok(jobs, queues.map((q) => q.name).join(","));
    assert.deepEqual([jobs.waiting, jobs.active, jobs.failed24h, jobs.completed24h], [1, 2, 1, 1]);
    // En eski bekleme: 20 dakikadır sahiplenmesi tazelenmeyen (takılmış) iş; 2 saatlik oluşturulma zamanı değil.
    assert.ok(jobs.oldestWaitingSeconds! >= 1190 && jobs.oldestWaitingSeconds! < 1300, String(jobs.oldestWaitingSeconds));
    assert.equal(classifyQueues([jobs]), "degraded");

    const without = await createPrismaOpsProbe(h.prisma!, { schema, contentJobsTable: "public.yok_content_jobs" }).queues();
    assert.ok(!without.some((q) => q.name === "content.jobs"));
    assert.throws(() => createPrismaOpsProbe(h.prisma!, { contentJobsTable: "content_jobs; DROP TABLE users" }), /geçersiz tablo/);
  });

  test("son yedek: db:backup kaydı panelde; yanlış hedef etiketi ve sha reddedilir", async () => {
    const url = resolveTestDatabaseUrl(path.resolve(import.meta.dirname, "../../.."))!;
    const probe = createPrismaOpsProbe(h.prisma!, { schema });
    const status = (at: Date) => buildOpsStatus({ probe, telemetry: createOpsTelemetry(), env: "test", startedAt: at, now: () => at });
    const manifest = { sizeBytes: 4096, sha256: "a".repeat(64), dumpMs: 1200, serverVersion: "17.10 (EDB)" } as Manifest;
    const finished = new Date(Date.now() + 365 * 86_400_000); // diğer testlerin kayıtlarından yeni olsun
    await recordBackupRun(url, manifest, "local", finished);
    try {
      const fresh = await status(new Date(finished.getTime() + 3_600_000));
      OpsStatus.parse(fresh);
      assert.deepEqual([fresh.backup.status, fresh.backup.lastBackupAt], ["ok", finished.toISOString()]);
      assert.equal((await status(new Date(finished.getTime() + 100 * 3_600_000))).backup.status, "down");
      const row = await h.prisma!.opsBackupRun.findFirst({ where: { finishedAt: finished } });
      assert.deepEqual([row?.destination, row?.sizeBytes, row?.serverVersion], ["local", 4096n, "17.10"]);
      await assert.rejects(recordBackupRun(url, manifest, "s3://bucket/key", finished), /geçersiz yedek hedefi/);
      // DB CHECK'i de korur (araç dışından yazılsa bile): adres ve geçersiz sha kabul edilmez.
      const insert = (destination: string, sha: string) =>
        h.prisma!.$executeRaw`INSERT INTO ops_backup_runs (finished_at, destination, size_bytes, sha256, duration_ms, server_version)
          VALUES (now(), ${destination}, 1, ${sha}, 1, '17')`;
      await assert.rejects(insert("https://x", "a".repeat(64)));
      await assert.rejects(insert("local", "xyz"));
    } finally {
      await h.prisma!.opsBackupRun.deleteMany({ where: { finishedAt: finished } });
    }
  });

  test("güvenlik sinyalleri bütün süreçlerden (DB): giriş kilidi ve 24 saatlik kritik yönetici işlemleri; ham veri yok", async () => {
    const inject = (method: "POST", url: string, body: unknown, cookie?: string, ip?: string) =>
      h.app.inject({
        method,
        url: `/v1${url}`,
        remoteAddress: ip,
        headers: { origin: WEB_ORIGIN, "content-type": "application/json", "idempotency-key": randomUUID(), ...(cookie ? { cookie } : {}) },
        payload: JSON.stringify(body),
      });
    const signUp = async (label: string) => {
      const id = randomUUID().replaceAll("-", "").slice(0, 10);
      const account = { email: `sig_${label}_${id}@example.test`, username: `sig_${label}_${id}`.slice(0, 30), displayName: "Sig", password: "guclu-bir-sifre-1" };
      const mailCount = h.mails.length;
      assert.equal((await inject("POST", "/auth/register", account)).statusCode, 202);
      assert.equal((await inject("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
      const login = await inject("POST", "/auth/login", { email: account.email, password: account.password });
      return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id as string, email: account.email };
    };
    // Sayaç bitişi ve audit zamanı uygulama saatinden, sorgu penceresi DB saatinden (now()); production'da ikisi aynıdır.
    h.clock.now = new Date();
    const limits = { email: 3, ip: 1000 };
    Object.assign(h.rateLimitSettings, { loginFailuresPerEmail: limits.email });
    const probe = createPrismaOpsProbe(h.prisma!, { schema });
    const read = async () => {
      const s = await buildOpsStatus({ probe, telemetry: createOpsTelemetry(), env: "test", startedAt: new Date(), now: () => new Date(), loginLimits: async () => limits });
      OpsStatus.parse(s);
      return s;
    };
    const before = (await read()).security;
    assert.ok(before.lockedLogins && before.adminActions24h, "DB okunabiliyor: null değil");
    const count = (list: Array<{ action: string; operation: string; count: number }> | null, action: string, operation: string) =>
      list!.find((a) => a.action === action && a.operation === operation)?.count ?? 0;

    const root = await signUp("root");
    const target = await signUp("target");
    await rbacSeeds(h).setRole(root.id, "SUPER_ADMIN", null);
    // Hedef hesap için 3 yanlış parola → e-posta anahtarı kilitlenir (KV-19 login.email).
    for (let i = 0; i < limits.email; i++) await inject("POST", "/auth/login", { email: target.email, password: "yanlis-parola-xx" }, undefined, `198.51.100.${40 + i}`);
    const sanction = await inject("POST", `/admin/users/${target.id}/sanctions`, { type: "WARNING", reason: "Güvenlik sinyali testi" }, root.cookie);
    assert.equal(sanction.statusCode, 201, sanction.body);
    // MFA kilitlenmesi ve başarısız denemesi (#206) brute force izidir; kurulum gibi olağan MFA işlemleri sayılmaz.
    const mfa = (operation: string) =>
      h.prisma!.$transaction((tx) =>
        writeAudit(tx, { source: "API", actorId: target.id, action: "account.mfa", operation, target: { type: "USER", id: target.id }, reason: null, before: null, after: null, requestId: `ops-${randomUUID()}`, at: h.clock.now }),
      );
    await mfa("deny");
    await mfa("lock");
    await mfa("setup");

    const after = (await read()).security;
    assert.equal(count(after.adminActions24h, "account.mfa", "lock"), count(before.adminActions24h, "account.mfa", "lock") + 1);
    assert.equal(count(after.adminActions24h, "account.mfa", "deny"), count(before.adminActions24h, "account.mfa", "deny") + 1);
    assert.equal(count(after.adminActions24h, "account.mfa", "setup"), 0);
    assert.equal(after.lockedLogins!.emails, before.lockedLogins!.emails + 1);
    assert.equal(count(after.adminActions24h, "user.sanction", "apply"), count(before.adminActions24h, "user.sanction", "apply") + 1);
    // Kritik olmayan işlemler listede yok; yanıt ham e-posta, IP ya da anahtar özeti içermez.
    assert.ok(after.adminActions24h!.every((a) => a.action !== "revision.read" && a.action !== "category.manage"));
    const body = JSON.stringify(after);
    for (const leak of [target.email, "198.51.100.", "login.email:"]) assert.ok(!body.includes(leak), leak);
  });

  test("anonimleştirme depo temizliği (#228) kuyruk olarak: bekleyen, geri çekilmede, başarısız, tamamlanan; tablo yoksa yok", async () => {
    const table = `${schema}.account_erasures`;
    await h.prisma!.$executeRawUnsafe(
      `CREATE TABLE ${table} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), storage_cleaned_at timestamptz,
         storage_cleanup_attempts int NOT NULL DEFAULT 0, storage_next_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await h.prisma!.$executeRawUnsafe(
      `INSERT INTO ${table} (storage_cleaned_at, storage_cleanup_attempts, storage_next_attempt_at, created_at) VALUES
         (NULL, 0, NULL, now() - interval '30 seconds'),
         (NULL, 2, now() - interval '1 minute', now() - interval '40 minutes'),
         (NULL, 3, now() + interval '30 minutes', now() - interval '2 hours'),
         (now() - interval '1 hour', 0, NULL, now() - interval '2 hours'),
         (now() - interval '3 days', 1, NULL, now() - interval '4 days')`,
    );
    const queues = await createPrismaOpsProbe(h.prisma!, { schema, erasuresTable: table }).queues();
    const erasure = queues.find((q) => q.name === "account.erasure.storage");
    assert.ok(erasure, queues.map((q) => q.name).join(","));
    // Bekleyen 2 (biri deneme zamanı gelmiş başarısız), geri çekilmede 1, hâlâ temizlenmemiş başarısız 2, son 24 saatte tamamlanan 1.
    assert.deepEqual([erasure.waiting, erasure.active, erasure.failed24h, erasure.completed24h], [2, 1, 2, 1]);
    // En eski: 2 saattir temizlenmeyen kayıt (kişisel veri dosyası depoda duruyor).
    assert.ok(erasure.oldestWaitingSeconds! >= 7190 && erasure.oldestWaitingSeconds! < 7300, String(erasure.oldestWaitingSeconds));
    assert.equal(classifyQueues([erasure]), "degraded");

    const without = await createPrismaOpsProbe(h.prisma!, { schema, erasuresTable: "public.yok_account_erasures" }).queues();
    assert.ok(!without.some((q) => q.name === "account.erasure.storage"));
    assert.throws(() => createPrismaOpsProbe(h.prisma!, { erasuresTable: "account_erasures; --" }), /geçersiz tablo/);
  });

  test("kuyruk sayıları, bekleyen iş ve worker izi gerçek pg-boss tablolarından", async () => {
    await boss.createQueue("ops.ok");
    await boss.createQueue("ops.backlog");
    await boss.send("ops.ok", { n: 1 });
    const [job] = await boss.fetch("ops.ok");
    await boss.complete("ops.ok", job!.id);
    await boss.send("ops.backlog", { n: 2 });
    await boss.send("ops.backlog", { n: 3 });
    // Bekleyen işi 10 dk önce kuyruğa girmiş gibi göster: backlog eşiği (5 dk) aşılır.
    await h.prisma!.$executeRawUnsafe(`UPDATE "${schema}".job SET start_after = now() - interval '10 minutes' WHERE name = 'ops.backlog'`);

    const probe = createPrismaOpsProbe(h.prisma!, { schema });
    const status = await buildOpsStatus({ probe, telemetry: createOpsTelemetry(), env: "test", startedAt: new Date(), now: () => new Date() });
    OpsStatus.parse(status);
    const byName = Object.fromEntries(status.components.queue.queues.map((q) => [q.name, q]));
    assert.deepEqual(
      [byName["ops.ok"]!.completed24h, byName["ops.ok"]!.waiting, byName["ops.ok"]!.oldestWaitingSeconds],
      [1, 0, null],
    );
    assert.equal(byName["ops.backlog"]!.waiting, 2);
    assert.ok(byName["ops.backlog"]!.oldestWaitingSeconds! >= 590, String(byName["ops.backlog"]!.oldestWaitingSeconds));
    assert.equal(status.components.queue.status, "degraded");
    assert.equal(status.components.worker.status, "ok");
    assert.ok(status.components.worker.ageSeconds! < 60);
  });
});

describe("acil durum anahtarları operasyon durumunda (postgres + gerçek ayar servisi)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let root: { cookie: string; id: string };

  const send = (method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string) =>
    h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `sw_${id}@example.test`, username: `sw_${id}`, displayName: "Anahtar", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    root = { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id };
    await rbacSeeds(h).setRole(root.id, "SUPER_ADMIN", null);
  });
  after(async () => {
    await h?.close();
  });

  test("anahtarların etkin değeri, son değişiklik zamanı ve yayılma süresi; değiştiren kişi yanıtta yok", async () => {
    const read = async () => {
      const res = await send("GET", "/admin/ops", undefined, root.cookie);
      assert.equal(res.statusCode, 200, res.body);
      return OpsStatus.parse(res.json().data).switches!;
    };
    const item = (s: Awaited<ReturnType<typeof read>>, name: string) => s.items.find((i) => i.name === name)!;
    const before = await read();
    assert.ok(before, "ayar servisi varken null değil");
    assert.equal(before.propagationSeconds, 5, "harness önbellek ömrü 5 sn");
    assert.deepEqual(before.items.map((i) => i.name).sort(), ["comments", "maintenance", "pollCreation", "registration", "uploads"]);
    assert.equal(item(before, "comments").key, "features.comments");

    const off = await send("PUT", "/admin/emergency", { switches: { comments: false }, reason: "Operasyon paneli testi" }, root.cookie);
    assert.equal(off.statusCode, 200, off.body);
    try {
      h.settings!.invalidate();
      const after = await read();
      assert.equal(item(after, "comments").enabled, false);
      assert.ok(item(after, "comments").changedAt, "değişiklik zamanı var");
      assert.equal(item(after, "maintenance").enabled, item(before, "maintenance").enabled, "diğer anahtarlar değişmedi");
      assert.ok(!JSON.stringify(after).includes(root.id), "değiştiren kişi yanıtta yok (audit'te)");
    } finally {
      // Ayarlar test veritabanında kalıcıdır: sonraki dosyalar için eski haline döndür.
      const back = await send("PUT", "/admin/emergency", { switches: { comments: item(before, "comments").enabled }, reason: "Operasyon paneli testi geri alma" }, root.cookie);
      assert.equal(back.statusCode, 200, back.body);
    }
  });
});
