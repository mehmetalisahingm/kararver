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
import { buildOpsStatus, classifyQueues, classifyWorker, RESTORE_DRILL } from "../src/modules/ops/status.ts";
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
  });

  test("yoklama hata verirse bileşen down/unknown; yanıt yine sözleşmeye uyar", async () => {
    const fail = async () => {
      throw new Error("bağlantı yok: postgres://gizli@host/db");
    };
    const status = await buildOpsStatus({
      probe: { database: fail, workerLastSeen: fail, queues: fail },
      telemetry: createOpsTelemetry(),
      env: "test",
      startedAt: new Date(),
      now: () => new Date(),
    });
    OpsStatus.parse(status);
    assert.equal(status.components.database.status, "down");
    assert.equal(status.components.queue.status, "unknown");
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
