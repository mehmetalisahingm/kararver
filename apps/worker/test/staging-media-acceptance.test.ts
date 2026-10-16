import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
const script = path.resolve(import.meta.dirname, "../scripts/staging-media-acceptance.ts");
const env = { ...process.env, APP_ENV: "staging", WEB_URL: "https://kararver-staging.vercel.app", MEDIA_PUBLIC_BASE_URL: "https://kararver-staging.vercel.app/api/media-public", DATABASE_URL: "postgres://do-not-use-this/invalid" };
test("media acceptance defaults to a dry plan without connecting to DB or storage", () => {
  const r = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).apply, false);
});
test("media acceptance refuses production, other hosts and a non-proxy base before any writes", () => {
  for (const change of [{ APP_ENV: "production" }, { WEB_URL: "https://unrelated.test" }, { MEDIA_PUBLIC_BASE_URL: "https://bucket.storageapi.dev" }]) {
    const r = spawnSync(process.execPath, [script, "--apply"], { env: { ...env, ...change }, encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /"result":"PASS"/);
    assert.doesNotMatch(r.stderr, /do-not-use-this/);
  }
});
