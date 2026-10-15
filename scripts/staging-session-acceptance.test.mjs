import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStagingSession } from "./staging-session-acceptance.mjs";

const credentials = { email: "operator@example.test", password: "never-log-this-password" };
function server({ role = "SUPER_ADMIN", unsafeCsrf = false, badCookie = false, brokenOps = false } = {}) {
  let revoked = false;
  const calls = [];
  const reply = (status, body, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "cache-control": "private, no-store", ...headers } });
  const http = async (input, init = {}) => {
    const url = new URL(input); calls.push({ path: url.pathname, ...init });
    assert.equal(init.redirect, "manual");
    if (url.pathname === "/health") return reply(200, { status: "ok", worker: { status: "ready" }, release: { env: "staging", sha: "012345abcdef" } });
    assert.equal(url.origin, "https://kararver-staging.vercel.app");
    if (url.pathname.endsWith("/auth/login")) return reply(200, {}, { "set-cookie": `kv_session=secret-session-value; Path=/; HttpOnly; SameSite=Lax${badCookie ? "" : "; Secure"}` });
    assert.equal(init.headers.cookie, "kv_session=secret-session-value");
    if (url.pathname.endsWith("/auth/logout")) {
      if (init.headers.origin === "https://attacker.invalid" && !unsafeCsrf) return reply(403, {});
      revoked = true; return reply(204);
    }
    if (revoked) return reply(401, {}, { "set-cookie": "kv_session=; Max-Age=0" });
    if (url.pathname.endsWith("/me")) return reply(200, { data: { id: "operator-id", roles: [role] } });
    if (url.pathname.endsWith("/admin/users")) return reply(role === "USER" ? 403 : 200, {});
    if (url.pathname.endsWith("/admin/ops")) {
      if (brokenOps) throw new Error("provider error containing secret-session-value");
      return reply(role === "SUPER_ADMIN" ? 200 : 403, {});
    }
    throw new Error("Unexpected path");
  };
  return { http, calls, get revoked() { return revoked; } };
}

for (const role of ["USER", "SUPER_ADMIN"]) test(`own-session acceptance: ${role}, real statuses and redacted report`, async () => {
  const fake = server({ role });
  const result = await checkStagingSession(credentials, fake.http);
  assert.equal(result.totals.fail, 0);
  assert.equal(fake.revoked, true);
  assert.equal(result.release, "012345abcdef");
  assert.doesNotMatch(JSON.stringify(result), /operator@example|never-log|secret-session-value|operator-id/);
  assert.deepEqual(fake.calls.filter(x => x.method === "POST").map(x => x.path), ["/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/logout"]);
});

for (const options of [{ unsafeCsrf: true }, { badCookie: true }, { brokenOps: true }]) test(`a failed gate stops and revokes only its own session: ${JSON.stringify(options)}`, async () => {
  const fake = server(options);
  const result = await checkStagingSession(credentials, fake.http);
  assert.ok(result.totals.fail > 0);
  assert.equal(fake.revoked, true);
  assert.equal(result.checks.at(-1).id, "session.cleanup");
  assert.equal(result.checks.at(-1).result, "PASS");
  assert.doesNotMatch(JSON.stringify(result), /secret-session-value|never-log/);
});

test("missing credentials never cause a request", async () => {
  await assert.rejects(checkStagingSession({}, () => { throw new Error("must not call"); }), /required/);
});
