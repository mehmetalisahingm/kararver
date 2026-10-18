/**
 * KV-49 (#51) /health: #262 kesinti testinin bulguları. DB kapalıyken ve worker heartbeat'i bayatken 200 "ok" dönmemeli;
 * "bilinmiyor" (heartbeat henüz yok, worker ayrı serviste, DB yoklaması yok) ise deploy kapısını kapatmamalı.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { buildHealth, cachedDatabaseCheck, HEALTH_DB_TIMEOUT_MS, WORKER_STARTUP_GRACE_MS, type HealthDeps } from "../src/modules/ops/health.ts";
import { createHarness, memoryBackend, type Harness } from "./support/harness.ts";

const NOW = new Date("2026-10-18T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    probe: { database: async () => ({ latencyMs: 1.5, version: "17.10" }) },
    now: () => NOW,
    startedAt: new Date(NOW.getTime() - 10 * 60_000),
    env: "staging",
    sha: "0123456789abcdef",
    workerExpected: true,
    readHeartbeat: () => ({ status: "ready", at: ago(5_000) }),
    ...overrides,
  };
}

describe("/health kuralları", () => {
  test("DB ve taze worker: 200 ok, sürüm 12 hane", async () => {
    const { httpStatus, body } = await buildHealth(deps());
    assert.equal(httpStatus, 200);
    assert.equal(body.status, "ok");
    assert.deepEqual(body.database, { status: "ok", latencyMs: 1.5 });
    assert.equal(body.worker.status, "ready");
    assert.deepEqual(body.release, { sha: "0123456789ab", env: "staging" });
  });

  test("DB hata verirse 503 down; hata ayrıntısı (bağlantı adresi) yanıtta yok", async () => {
    const { httpStatus, body } = await buildHealth(
      deps({ probe: { database: async () => { throw new Error("connect ECONNREFUSED postgres://kv:gizli@db.internal:5432"); } } }),
    );
    assert.equal(httpStatus, 503);
    assert.equal(body.status, "down");
    assert.deepEqual(body.database, { status: "down" });
    assert.ok(!JSON.stringify(body).includes("gizli") && !JSON.stringify(body).includes("db.internal"));
  });

  test("DB yoklaması asılı kalırsa zaman aşımında 503 (istek asılı kalmaz)", async () => {
    const started = Date.now();
    const { httpStatus, body } = await buildHealth(deps({ probe: { database: () => new Promise(() => {}) }, dbTimeoutMs: 50 }));
    assert.equal(httpStatus, 503);
    assert.equal(body.database.status, "down");
    assert.ok(Date.now() - started < 1_000);
    assert.equal(HEALTH_DB_TIMEOUT_MS, 2_000, "varsayılan zaman aşımı kısa");
  });

  test("bayat heartbeat: 5 dk degraded (200, stale), 1 sa down (503, stale)", async () => {
    const five = await buildHealth(deps({ readHeartbeat: () => ({ status: "ready", at: ago(5 * 60_000) }) }));
    assert.equal(five.httpStatus, 200);
    assert.equal(five.body.status, "degraded");
    assert.deepEqual([five.body.worker.status, five.body.worker.health], ["stale", "degraded"]);
    const hour = await buildHealth(deps({ readHeartbeat: () => ({ status: "ready", at: ago(60 * 60_000) }) }));
    assert.equal(hour.httpStatus, 503);
    assert.equal(hour.body.status, "down");
    assert.deepEqual([hour.body.worker.status, hour.body.worker.health], ["stale", "down"]);
    assert.ok("ageMs" in hour.body.worker && hour.body.worker.ageMs === 3_600_000);
  });

  test("heartbeat yoksa: aynı serviste beklenip açılış süresi geçtiyse 503 missing; açılışta ve ayrı serviste bilinmiyor (200)", async () => {
    const none = () => null;
    const missing = await buildHealth(deps({ readHeartbeat: none }));
    assert.equal(missing.httpStatus, 503);
    assert.deepEqual(missing.body.worker, { status: "missing", health: "down" });
    // Yeni deploy: heartbeat henüz yazılmadı; Railway healthcheck geçmeli.
    const startup = await buildHealth(deps({ readHeartbeat: none, startedAt: new Date(NOW.getTime() - (WORKER_STARTUP_GRACE_MS - 1_000)) }));
    assert.equal(startup.httpStatus, 200);
    assert.deepEqual(startup.body.worker, { status: "unknown", health: "unknown" });
    // Production: worker ayrı serviste, bu süreçte heartbeat dosyası beklenmez.
    const separate = await buildHealth(deps({ readHeartbeat: none, workerExpected: false }));
    assert.equal(separate.httpStatus, 200);
    assert.equal(separate.body.status, "ok");
  });

  test("önbellekli DB denetimi: eşzamanlı istekler tek sorgu, süre içinde yeniden kullanım, süre sonunda yeni sorgu", async () => {
    let calls = 0;
    let release!: () => void;
    const probe = {
      database: () =>
        new Promise<{ latencyMs: number; version: string }>((resolve) => {
          calls++;
          release = () => resolve({ latencyMs: 1, version: "17" });
        }),
    };
    let clock = 0;
    const check = cachedDatabaseCheck(probe, { cacheMs: 5_000, nowMs: () => clock });
    const pending = [check(), check(), check()];
    release();
    const results = await Promise.all(pending);
    assert.equal(calls, 1, "eşzamanlı üç istek tek sorgu");
    assert.ok(results.every((r) => r.status === "ok"));
    clock = 4_000;
    await check();
    assert.equal(calls, 1, "5 sn içinde önbellekten");
    clock = 6_000;
    const next = check();
    release();
    await next;
    assert.equal(calls, 2, "süre dolunca yeni sorgu");
    const { body } = await buildHealth(deps({ databaseCheck: check }));
    assert.equal(body.database.status, "ok");
  });

  test("DB yoklaması verilmemişse bilinmiyor ve 200 (testler, yalnız API süreci)", async () => {
    const { httpStatus, body } = await buildHealth(deps({ probe: undefined }));
    assert.equal(httpStatus, 200);
    assert.deepEqual(body.database, { status: "unknown" });
  });
});

describe("/health uç noktası", () => {
  let h: Harness;
  before(async () => {
    h = await createHarness(memoryBackend);
  });
  after(async () => {
    await h?.close();
  });

  test("yoklama yokken 200 ok, no-store; yeni alanlar yanıtta", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["cache-control"]), /no-store/);
    const body = res.json();
    assert.equal(body.status, "ok");
    assert.deepEqual(body.database, { status: "unknown" });
    assert.ok(body.worker && body.release);
  });
});
