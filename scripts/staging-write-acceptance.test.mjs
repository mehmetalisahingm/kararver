import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStagingWrites } from "./staging-write-acceptance.mjs";

const sha = "a".repeat(40);
const options = { email: "operator@example.test", password: "secret-password", expectedSha: sha, apply: true };
const response = (status, data = null, cookie) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...(cookie ? { "set-cookie": `kv_session=${cookie}; Secure; HttpOnly; SameSite=Lax` } : {}) } });

test("staging writes require explicit opt-in and verified SHA before any network access", async () => {
  const never = () => { throw new Error("network forbidden"); };
  for (const invalid of [{ apply: false }, { expectedSha: "main" }, { password: "" }]) {
    await assert.rejects(checkStagingWrites({ ...options, ...invalid }, never), /required/);
  }
});

test("wrong release or non-SUPER_ADMIN stops before creating accounts and logs out only its own session", async () => {
  for (const wrongRelease of [true, false]) {
    const paths = [];
    const report = await checkStagingWrites(options, async (url, init) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === "/health") return response(200, { status: "ok", release: { env: "staging", sha: wrongRelease ? "b".repeat(12) : sha.slice(0, 12) } });
      if (path.endsWith("/auth/login")) return response(200, { data: { id: "root", roles: ["USER"] } }, "operator-secret-cookie");
      if (path.endsWith("/auth/logout")) return response(204);
      throw new Error("unexpected write");
    });
    assert.equal(report.totals.fail, 1);
    assert.ok(!paths.some(p => p.endsWith("/auth/register")));
    assert.equal(paths.includes("/api/v1/auth/logout"), !wrongRelease);
    assert.ok(!JSON.stringify(report).includes("operator-secret-cookie"));
  }
});

function harness({ failGrant = false, leakResults = false } = {}) {
  const calls = [], actors = [];
  let role = "USER", votes = 0, closed = false, banned = false;
  const http = async (url, init = {}) => {
    assert.ok(url.startsWith("https://kararver-staging.vercel.app/api/v1/") || url === "https://api-staging-45cb.up.railway.app/health");
    const path = new URL(url).pathname.replace("/api/v1", ""), method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : undefined;
    const cookie = init.headers?.cookie;
    calls.push({ path, method, body });
    if (path === "/health") return response(200, { status: "ok", release: { env: "staging", sha: sha.slice(0, 12) } });
    if (path === "/auth/register") { actors.push({ id: `actor-${actors.length}`, username: body.username, roles: ["USER"] }); return response(202, {}); }
    if (path === "/auth/login") {
      if (body.email === options.email) return response(200, { data: { id: "root", roles: ["SUPER_ADMIN"] } }, "root-cookie");
      const actor = actors.find(a => `${a.username}@example.test` === body.email);
      return response(200, { data: actor }, `${actor.id}-cookie`);
    }
    if (path === "/auth/logout" || method === "DELETE") return response(204);
    if (path === "/admin/users") {
      const q = new URL(url).searchParams.get("q");
      if (q) return response(200, { data: actors.filter(a => a.username === q) });
      return response(cookie === "kv_session=root-cookie" || role === "ADMIN" ? 200 : 403, { data: [] });
    }
    if (path.endsWith("/role")) { if (failGrant && body.role === "ADMIN") return response(500, {}); role = body.role; return response(200, {}); }
    if (path === "/admin/ops") return response(403, {});
    if (path.endsWith("/sanctions")) { if (path.includes("actor-1")) banned = true; return response(201, {}); }
    if (path === "/categories") return response(200, { data: [{ id: "category" }] });
    if (path === "/polls") return response(201, { data: { id: "owned-poll", options: [{ id: "A" }, { id: "B" }] } });
    if (path.endsWith("/close")) { closed = true; return response(200, {}); }
    if (path.endsWith("/vote")) {
      if (cookie === "kv_session=actor-0-cookie") return response(403, { error: { code: "SELF_VOTE_FORBIDDEN" } });
      if (banned) return response(403, {});
      if (closed) return response(409, { error: { code: "POLL_CLOSED" } });
      votes++;
      return response(votes === 1 ? 201 : votes > 15 ? 429 : 200, {});
    }
    if (path === "/polls/owned-poll") return response(200, { data: { results: cookie ? { visible: true, total: 1, options: [{ votes: 1 }, { votes: 0 }] } : { visible: false, ...(leakResults ? { total: 1 } : {}) } } });
    throw new Error("unexpected request");
  };
  return { calls, http };
}

test("bounded acceptance verifies live-role changes, concurrency and cleanup without changing a human account", async () => {
  const { calls, http } = harness();
  const report = await checkStagingWrites(options, http, async ms => assert.ok(ms <= 59_000));
  assert.equal(report.totals.fail, 0, JSON.stringify(report));
  assert.equal(calls.filter(c => c.path.endsWith("/vote")).length, 23);
  assert.equal(calls.filter(c => c.path.endsWith("/role")).length, 2);
  assert.ok(!calls.some(c => c.path.includes("/users/root/")));
  assert.ok(calls.some(c => c.path === "/polls/owned-poll" && c.method === "DELETE"));
  assert.equal(calls.filter(c => c.path.endsWith("/sanctions")).length, 2);
  for (const secret of [options.password, options.email, "root-cookie", "actor-0-cookie"]) assert.ok(!JSON.stringify(report).includes(secret));
});

test("failed role grant or private result leakage fails acceptance and still cleans up owned fixtures", async () => {
  for (const mode of [{ failGrant: true }, { leakResults: true }]) {
    const { calls, http } = harness(mode);
    const report = await checkStagingWrites(options, http, async () => {});
    assert.equal(report.totals.fail, 1, JSON.stringify(report));
    assert.equal(calls.filter(c => c.path.endsWith("/sanctions")).length, 2);
    assert.ok(calls.some(c => c.path === "/auth/logout"));
  }
});
