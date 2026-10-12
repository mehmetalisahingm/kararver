// Staging KVKK auth boundary smoke. Never creates accounts, sends mail or downloads personal data.
// Full privileged request -> worker -> Mailpit -> user download acceptance remains a separate signed-in test.
import assert from "node:assert/strict";

const api = (process.env.STAGING_API_URL || "https://api-staging-45cb.up.railway.app").replace(/\/$/, "");
const web = (process.env.STAGING_WEB_URL || "https://kararver-staging.vercel.app").replace(/\/$/, "");
const expectedSha = process.env.EXPECTED_RELEASE_SHA || "";
const timeoutMs = 15000;

async function request(base, path, method = "GET", body) {
  const headers = { Accept: "application/json", Origin: web };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, {
    method, headers, redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

function verifyNoStore(result, context) {
  const cache = result.headers.get("cache-control") || "";
  assert.match(cache, /no-store/i, context + " must not be cacheable");
}
function assertUnauthenticated(result, context) {
  assert.equal(result.status, 401, context + ": unauthenticated request must be rejected");
  verifyNoStore(result, context);
  assert.doesNotMatch(result.text, /"tokenHash"|"encKey"|"passwordHash"/, context + ": sensitive fields");
}

const health = await request(api, "/health");
assert.equal(health.status, 200, "/health");
assert.equal(health.json?.status, "ok", "API not healthy");
assert.equal(health.json?.release?.env, "staging", "Do not use this against production");
assert.equal(health.json?.worker?.status, "ready", "KVKK background worker not ready");
assert.ok(Number.isFinite(health.json?.worker?.ageMs) && health.json.worker.ageMs < 120000, "worker heartbeat too old");
if (expectedSha) assert.ok(String(expectedSha).startsWith(health.json?.release?.sha) || String(health.json?.release?.sha).startsWith(expectedSha), "API SHA mismatch");

const target = "01998b9a-0000-7000-8000-000000000020"; // Nonexistent synthetic UUID, not a real user.
assertUnauthenticated(await request(api, "/v1/admin/users/" + target + "/data-exports"), "KVKK admin list");
assertUnauthenticated(await request(api, "/v1/admin/users/" + target + "/data-exports", "POST", { reason: "staging negative smoke" }), "KVKK admin create");
assertUnauthenticated(await request(api, "/v1/me/data-export/download", "POST", { token: "invalid" }), "KVKK personal download");

const page = await request(web, "/veri-indir");
assert.equal(page.status, 200, "KVKK download page unavailable");
assert.match(page.text, /veri-indir|Verilerini indir|__next/i, "KVKK download shell missing");
console.log("PASS: staging release " + health.json.release.sha + "; worker ready; KVKK unauthorized boundaries 401; download page 200.");
