import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSecurityGate, validateApiUrl } from "./security-acceptance.mjs";

const ORIGIN = "https://api-staging-45cb.up.railway.app";
const headers = { "strict-transport-security": "max-age=31536000" };
const api = (override = () => null) => async (url, init) => {
  assert.equal(init.method, "GET", "only read-only requests permitted");
  assert.equal(init.redirect, "manual");
  assert.equal(init.credentials, "omit");
  assert.ok(!init.headers.cookie && !init.headers.authorization);
  const path = new URL(url).pathname;
  const o = override(path, init);
  if (o) return o;
  if (path === "/health") return Response.json({ status: "ok" }, { headers });
  if (path === "/v1/config") return Response.json({ data: { features: { registration: true } } }, { headers });
  return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401, headers });
};

test("rejects URLs with credentials, proxy bypass, user-selected public hosts or HTTP", () => {
  for (const value of [
    "http://api-staging-45cb.up.railway.app", "https://example.com",
    "https://evil.up.railway.app.attacker.invalid", "https://user:pass@api-staging-45cb.up.railway.app",
    "https://api-staging-45cb.up.railway.app/v1/config",
    "https://api-staging-45cb.up.railway.app/?secret=abc",
    "https://127.0.0.1", "file:///etc/passwd",
  ]) assert.throws(() => validateApiUrl(value));
  assert.equal(validateApiUrl(ORIGIN), ORIGIN);
});

test("requires public health/config and anonymous denial across admin+user routes", async () => {
  const report = await checkSecurityGate(ORIGIN, api());
  assert.equal(report.totals.fail, 0, JSON.stringify(report.checks));
  assert.ok(report.totals.pass >= 20);
  assert.equal(report.betaGate, "NO_GO_NEEDS_AUTHENTICATED_STAGING_TESTS_AND_SIGNOFF");
});

test("fails closed on missing HSTS, X-Powered-By disclosure, private user data, reflected hostile CORS", async () => {
  const report = await checkSecurityGate(ORIGIN, api((path, init) => {
    if (path === "/health") return Response.json({ status: "ok" }); // no HSTS
    if (path === "/v1/config") return Response.json({ data: { SMTP_PASSWORD: "redacted" } }, { headers });
    if (path === "/v1/admin/users") {
      const cross = init.headers.origin === "https://attacker.invalid";
      return Response.json({ data: [{ email: "private" }] }, {
        status: 200, headers: cross ? { ...headers, "access-control-allow-origin": "*" } : headers,
      });
    }
    if (path === "/v1/me") return Response.json({ error: {} }, { status: 401, headers: { ...headers, "x-powered-by": "Express" } });
    return null;
  }));
  const failed = report.checks.filter(x => x.result === "FAIL").map(x => x.id);
  for (const id of ["health.hsts","public-config.no-secrets","guest-admin-users","guest-account.no_server_fingerprint","cross-origin-admin.auth","cross-origin-admin.cors"]) {
    assert.ok(failed.includes(id), "missing expected failure: " + id);
  }
});

test("network unreachable is a FAIL, not a simulated PASS or beta GO", async () => {
  const report = await checkSecurityGate(ORIGIN, async () => { throw new Error("do not leak https://user:password@host"); });
  assert.ok(report.totals.fail > 0);
  assert.ok(!JSON.stringify(report).includes("password@host"));
  assert.equal(report.betaGate, "NO_GO_NEEDS_AUTHENTICATED_STAGING_TESTS_AND_SIGNOFF");
});
