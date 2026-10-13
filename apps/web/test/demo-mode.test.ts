// #187 demo sınırı: build (next.config.ts) ve sunucu açılışı (instrumentation.ts) aynı kuralı kullanır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoModeViolation } from "../src/lib/demo-mode.ts";
import { DEMO_MODE_FORBIDDEN, register } from "../src/instrumentation.ts";

const demo = { NEXT_PUBLIC_KV_DATA_MODE: "demo" };

test("demo yalnız APP_ENV=local veya preview ile açılır", () => {
  assert.equal(demoModeViolation({ ...demo, APP_ENV: "local" }), null);
  assert.equal(demoModeViolation({ ...demo, APP_ENV: "preview" }), null);
  assert.equal(demoModeViolation({ ...demo, APP_ENV: "preview", VERCEL_ENV: "preview" }), null);
});

test("staging, production, tanımsız ve bilinmeyen APP_ENV demo'yu reddeder", () => {
  for (const APP_ENV of ["staging", "production", undefined, "", "Production", "prod", "test"]) {
    const violation = demoModeViolation({ ...demo, APP_ENV });
    assert.ok(violation, `APP_ENV=${APP_ENV}`);
    assert.match(violation, /NEXT_PUBLIC_KV_DATA_MODE=demo APP_ENV=.* ortamında kullanılamaz/);
  }
  assert.match(demoModeViolation(demo)!, /APP_ENV=\(tanımsız\)/);
});

test("Vercel production dağıtımı APP_ENV ne olursa olsun demo'yu reddeder", () => {
  for (const APP_ENV of ["local", "preview", undefined]) {
    assert.match(demoModeViolation({ ...demo, APP_ENV, VERCEL_ENV: "production" })!, /VERCEL_ENV=production/);
  }
});

test("demo modu kapalıyken hiçbir ortam reddedilmez", () => {
  for (const NEXT_PUBLIC_KV_DATA_MODE of [undefined, "api", "DEMO"]) {
    assert.equal(demoModeViolation({ NEXT_PUBLIC_KV_DATA_MODE, APP_ENV: "production", VERCEL_ENV: "production" }), null);
  }
});

test("sunucu açılışı: staging/production demo'da register() demo_mode_forbidden loglar ve hata fırlatır", (t) => {
  const saved = { mode: process.env.NEXT_PUBLIC_KV_DATA_MODE, app: process.env.APP_ENV, vercel: process.env.VERCEL_ENV };
  const set = (key: string, value: string | undefined) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  const logged = t.mock.method(console, "error", () => {});
  try {
    set("VERCEL_ENV", undefined);
    set("NEXT_PUBLIC_KV_DATA_MODE", "demo");
    set("APP_ENV", "staging");
    assert.throws(() => register(), /Web sunucusu başlatılmadı → NEXT_PUBLIC_KV_DATA_MODE=demo APP_ENV=staging/);
    assert.equal(logged.mock.callCount(), 1);
    const line = JSON.parse(String(logged.mock.calls[0]!.arguments[0]));
    assert.deepEqual(
      { event: line.event, level: line.level, appEnv: line.appEnv, vercelEnv: line.vercelEnv, dataMode: line.dataMode },
      { event: DEMO_MODE_FORBIDDEN, level: "fatal", appEnv: "staging", vercelEnv: null, dataMode: "demo" },
    );
    assert.equal(DEMO_MODE_FORBIDDEN, "demo_mode_forbidden");

    set("APP_ENV", "local");
    assert.doesNotThrow(() => register());
    set("NEXT_PUBLIC_KV_DATA_MODE", "api");
    set("APP_ENV", "production");
    assert.doesNotThrow(() => register());
    assert.equal(logged.mock.callCount(), 1, "izinli ortamda log yok");
  } finally {
    set("NEXT_PUBLIC_KV_DATA_MODE", saved.mode);
    set("APP_ENV", saved.app);
    set("VERCEL_ENV", saved.vercel);
  }
});
