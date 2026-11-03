// #301: runner hedefleri. Railway adresi kalmadı; yanlış origin ağa çıkmadan ve değeri basmadan hata verir.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STAGING_API_ORIGINS, STAGING_WEB_ORIGINS, stagingOrigins } from "./staging-origins.mjs";

const RUNNERS = ["staging-session-acceptance.mjs", "staging-write-acceptance.mjs", "kv44-staging-runner.mjs"];
const path = (name) => fileURLToPath(new URL(name, import.meta.url));

test("varsayılan güncel staging; boş değer varsayılana düşer; izinli origin sondaki / ile de kabul", () => {
  const defaults = { web: STAGING_WEB_ORIGINS[0], api: STAGING_API_ORIGINS[0] };
  assert.deepEqual(stagingOrigins({}), defaults);
  assert.deepEqual(stagingOrigins({ STAGING_API_URL: "", STAGING_WEB_URL: "" }), defaults);
  assert.deepEqual(stagingOrigins({ STAGING_API_URL: `${defaults.api}/`, STAGING_WEB_URL: defaults.web }), defaults);
});

test("yanlış origin reddedilir: eski Railway, http, benzer alan adı, port, kimlik bilgisi, yol, sorgu", () => {
  const api = STAGING_API_ORIGINS[0];
  const host = new URL(api).host;
  for (const bad of [
    "https://api-staging-45cb.up.railway.app",
    `http://${host}`,
    `https://${host}.attacker.invalid`,
    `https://${host}:8443`,
    `https://user:pass@${host}`,
    `${api}/v1`,
    `${api}/?x=1`,
    `${api}/#x`,
    "kararver-api-free-preview.onrender.com",
  ]) {
    assert.throws(() => stagingOrigins({ STAGING_API_URL: bad }), /STAGING_API_URL/, bad);
  }
  assert.throws(() => stagingOrigins({ STAGING_WEB_URL: "https://evil.vercel.app" }), /STAGING_WEB_URL/);
  assert.throws(() => stagingOrigins({ STAGING_WEB_URL: STAGING_API_ORIGINS[0] }), /STAGING_WEB_URL/, "API origin'i web yerine geçmez");
});

test("hata mesajı verilen değeri içermez", () => {
  assert.throws(() => stagingOrigins({ STAGING_API_URL: "https://user:gizli-parola@evil.invalid" }), (e) => !e.message.includes("gizli-parola"));
  assert.throws(() => stagingOrigins({ STAGING_API_URL: "gizli-parola" }), (e) => !e.message.includes("gizli-parola"));
});

test("üç runner'da Railway adresi yok ve hedefi ortak modülden alıyor", () => {
  for (const name of RUNNERS) {
    const source = readFileSync(path(name), "utf8");
    assert.ok(!/railway/i.test(source), `${name}: Railway kalmış`);
    assert.match(source, /stagingOrigins\(\)/, name);
  }
});

test("kapsam dışı kalan betiklerde de eski Railway varsayılanı yok", () => {
  for (const name of ["release-status.mjs", "staging-kvkk-smoke.mjs", "security-acceptance.mjs"]) {
    assert.ok(!/railway/i.test(readFileSync(path(name), "utf8")), `${name}: Railway kalmış`);
  }
});

test("yanlış origin'le runner başlamaz (ağa çıkmadan, sıfırdan farklı çıkış)", () => {
  for (const name of RUNNERS) {
    const r = spawnSync(process.execPath, [path(name)], {
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, STAGING_API_URL: "https://api-staging-45cb.up.railway.app", KV_STAGING_EMAIL: "x@example.test", KV_STAGING_PASSWORD: "gizli-parola" },
    });
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /STAGING_API_URL: izin verilen/, name);
    assert.ok(!r.stderr.includes("gizli-parola"), name);
  }
});
