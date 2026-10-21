import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { API, MATRIX, WEB, checkEnv, combine, main, maskUrl, mediaHostMatches, mergeEvidence, newRunId, preflight, redact, syntheticPng, validateMediaHost } from "./kv44-staging-runner.mjs";

const SHA = "a".repeat(40);
const MEDIA_HOST = "kv-staging-private.example-bucket.test";
const START = Date.parse("2026-10-20T10:00:00.000Z");
const uuid = n => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** In-memory staging double: only the endpoints the runner uses. Every request is logged for assertions. */
function fakeStaging(over = {}) {
  let seq = 0x1000;
  const s = { now: START + 60_000, requests: [], users: new Map(), sessions: new Map(), approvals: new Map(), comments: new Map(), polls: new Map(), media: new Map(), stepUps: new Set(), registered: 0 };
  const staff = { initiator: ["ADMIN"], approver: ["ADMIN"], owner: ["SUPER_ADMIN"], "media-operator": ["ADMIN"] };
  for (const [name, roles] of Object.entries(staff)) s.users.set(`${name}@staff.test`, { id: uuid(seq++), username: name, roles, password: `pw-${name}` });
  const json = (status, body, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": `req-${seq++}`, ...headers } });
  const err = (status, code, detail) => json(status, { error: { code, message: "x", details: detail ? [{ code: detail }] : [] } });
  const viewer = init => s.sessions.get((init.headers?.cookie ?? "").replace("kv_session=", ""));
  const byId = id => [...s.users.values()].find(u => u.id === id);
  s.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    s.requests.push({ host: u.host, path: u.pathname, method, cookie: init.headers?.cookie ?? "", body: init.body });
    if (over[`${method} ${u.pathname}`]) { const r = over[`${method} ${u.pathname}`](s, body, init); if (r) return r; }
    if (u.host === MEDIA_HOST) return new Response(null, { status: 200 });
    if (u.origin === API && u.pathname === "/health") return json(200, { status: "ok", release: { sha: SHA.slice(0, 12), env: "staging" } });
    if (u.origin === API && u.pathname === "/v1/config") return json(200, { data: { features: { registration: true } } });
    if (u.origin === API && u.pathname.startsWith("/media-public/")) return err(404, "NOT_FOUND");
    assert.equal(u.origin, WEB, `unexpected host ${u.host}`);
    const path = u.pathname.replace(/^\/api\/v1/, "");
    const me = viewer(init);
    if (path === "/auth/register") {
      if (++s.registered > 5) return err(429, "RATE_LIMITED");
      s.users.set(body.email, { id: uuid(seq++), username: body.username, roles: ["USER"], password: body.password });
      return json(202, { data: { status: "VERIFICATION_SENT" } });
    }
    if (path === "/auth/login") {
      const user = s.users.get(body.email);
      if (!user || user.password !== body.password) return err(401, "UNAUTHENTICATED");
      const sid = `sid${seq++}`; s.sessions.set(sid, user);
      return json(200, { data: { id: user.id, roles: user.roles } }, { "set-cookie": `kv_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax` });
    }
    if (path === "/auth/logout") return json(204);
    if (path === "/categories") return json(200, { data: [{ id: uuid(9) }] });
    if (!me) return err(401, "UNAUTHENTICATED");
    if (path === "/me") return json(200, { data: { id: me.id, roles: me.roles } });
    if (path === "/admin/users") return json(200, { data: [...s.users.values()].filter(x => x.username.startsWith(u.searchParams.get("q"))).map(x => ({ id: x.id, username: x.username, roles: x.roles })) });
    if (path === "/polls" && method === "POST") { const id = uuid(seq++); s.polls.set(id, "ACTIVE"); return json(201, { data: { id } }); }
    let m;
    if ((m = path.match(/^\/polls\/([^/]+)\/comments$/))) { const id = uuid(seq++); s.comments.set(id, "VISIBLE"); return json(201, { data: { id } }); }
    if (path === "/admin/moderation/comments/bulk/preview") return json(200, { data: { digest: "d".repeat(64), summary: { willChange: u.searchParams.get("ids").split(",").length }, approval: { required: true } } });
    if (path === "/admin/moderation/comments/bulk") {
      const id = uuid(seq++);
      s.approvals.set(id, { id, initiator: me.id, status: "PENDING", createdAt: new Date(s.now).toISOString(), expiresAt: new Date(s.now + 30 * 60_000).toISOString(), ids: body.ids });
      return json(202, { data: { id, status: "PENDING", createdAt: s.approvals.get(id).createdAt, expiresAt: s.approvals.get(id).expiresAt } });
    }
    const status = a => (a.status === "PENDING" && Date.parse(a.expiresAt) <= s.now ? "EXPIRED" : a.status);
    if (path === "/admin/moderation/bulk-approvals") return json(200, { data: [...s.approvals.values()].filter(a => status(a) === u.searchParams.get("status")).map(a => ({ id: a.id, createdAt: a.createdAt, status: status(a), initiator: { id: a.initiator } })) });
    if ((m = path.match(/^\/admin\/moderation\/bulk-approvals\/([^/]+)(\/(approve|cancel))?$/))) {
      const a = s.approvals.get(m[1]);
      if (!m[3]) return json(200, { data: { id: a.id, status: status(a) } });
      if (status(a) !== "PENDING") return err(409, "CONFLICT", "closed");
      if (m[3] === "cancel") { a.status = "CANCELLED"; return json(200, { data: { id: a.id, status: a.status } }); }
      if (a.initiator === me.id) return err(403, "FORBIDDEN", "self_approval");
      if (!s.stepUps.delete(me.id)) return err(403, "FORBIDDEN", "stepup_required");
      a.status = "APPROVED"; for (const id of a.ids) s.comments.set(id, "HIDDEN");
      return json(200, { data: { approval: { id: a.id, status: "APPROVED" }, result: { summary: { applied: a.ids.length } } } });
    }
    if (path === "/me/mfa/step-up") { if (body.code !== "123456") return err(403, "FORBIDDEN"); s.stepUps.add(me.id); return json(200, { data: { stepUpExpiresAt: new Date(s.now + 300_000).toISOString() } }); }
    if ((m = path.match(/^\/admin\/users\/([^/]+)\/role$/))) {
      if (m[1] === me.id) return err(409, "CONFLICT");
      if (body.role === "SUPER_ADMIN") return err(403, "FORBIDDEN", "super_admin_reserved");
      byId(m[1]).roles = [body.role]; return json(200, { data: { userId: m[1], roles: [body.role] } });
    }
    if (path === "/admin/role-approvals") return err(403, "FORBIDDEN", "super_admin_reserved");
    if ((m = path.match(/^\/admin\/(comments|polls)\/([^/]+)\/moderation$/))) { (m[1] === "comments" ? s.comments : s.polls).set(m[2], "REMOVED"); return json(200, { data: {} }); }
    if ((m = path.match(/^\/admin\/users\/([^/]+)\/sanctions$/))) { byId(m[1]).banned = true; return json(201, { data: {} }); }
    if (path === "/media/uploads") {
      const id = uuid(seq++); s.media.set(id, "PENDING");
      return json(201, { data: { mediaId: id, upload: { method: "PUT", url: `https://${MEDIA_HOST}/quarantine/${id}.png?X-Amz-Algorithm=AWS4&X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=deadbeef&X-Amz-Expires=600`, headers: { "content-type": "image/png" }, expiresAt: new Date(s.now + 600_000).toISOString() } } });
    }
    if ((m = path.match(/^\/media\/([^/]+)(\/complete)?$/))) return json(m[2] ? 202 : 200, { data: { id: m[1], status: "QUARANTINED", url: null, preview: null } });
    if ((m = path.match(/^\/admin\/media\/([^/]+)\/decision$/))) { s.media.set(m[1], "REJECTED"); return json(200, { data: {} }); }
    return err(404, "NOT_FOUND");
  };
  return s;
}

function harness(over) {
  const s = fakeStaging(over);
  const root = mkdtempSync(join(tmpdir(), "kv44-"));
  const lines = [];
  const prompts = [];
  const run = (role, staffName, argv) => main(argv, {
    http: s.fetch, root, now: () => new Date(s.now), pause: async ms => { s.now += ms; }, log: l => lines.push(String(l)),
    promptSecret: async label => { prompts.push(label); return "123456"; },
    env: { KV44_EXPECTED_SHA: SHA, KV44_EMAIL: `${staffName}@staff.test`, KV44_PASSWORD: `pw-${staffName}`, KV44_MEDIA_HOST: MEDIA_HOST },
  });
  return { s, root, lines, prompts, run };
}
const evidence = (root, runId, role) => readFileSync(join(root, runId, `${role}.jsonl`), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const handoff = (lines, key) => lines.join("\n").match(new RegExp(`${key} ([0-9a-f]{8}|sec_kv44_[0-9a-f]{10})`))[1];

test("matrix: every row has a file:line ref and the line holds the actual code", () => {
  const repo = join(import.meta.dirname, "..");
  for (const row of MATRIX) {
    const [, file, line] = row.ref.match(/^(.+):(\d+)$/) ?? [];
    assert.ok(file, `${row.id} has no file:line`);
    const text = readFileSync(join(repo, file), "utf8").split("\n")[Number(line) - 1] ?? "";
    assert.ok(text.includes(row.needle), `${row.id}: ${row.ref} does not contain ${row.needle}`);
  }
  for (const code of ['"self"', '"last_super_admin"', '"closed"', '"self_approval"', '"stepup_required"'])
    assert.ok(MATRIX.some(r => r.needle.includes(code)), code);
});

test("masking: signed URL keeps only host and 8 path chars; redact removes e-mail, cookie and UUID", () => {
  const masked = maskUrl(`https://${MEDIA_HOST}/quarantine/abc.png?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA1`);
  assert.equal(masked, `https://${MEDIA_HOST}/quaranti…?******`);
  assert.doesNotMatch(masked, /deadbeef|AKIA|Signature|Credential/);
  const r = redact(`mail a.b@x.test kv_session=abc id ${uuid(77)} https://h.test/p?X-Amz-Signature=s`);
  assert.doesNotMatch(r, /a\.b@x|kv_session=abc|-0000-4000|X-Amz-Signature=s/);
});

test("media host: exact match only", () => {
  assert.ok(mediaHostMatches(`https://${MEDIA_HOST}/k?sig=1`, MEDIA_HOST));
  for (const bad of [`http://${MEDIA_HOST}/k`, `https://${MEDIA_HOST}.evil.test/k`, `https://evil.${MEDIA_HOST}/k`, `https://${MEDIA_HOST}:8443/k`, `https://u:p@${MEDIA_HOST}/k`, "not a url"])
    assert.equal(mediaHostMatches(bad, MEDIA_HOST), false, bad);
  assert.throws(() => validateMediaHost("https://x.test"));
  assert.throws(() => validateMediaHost(undefined));
  assert.equal(syntheticPng().subarray(1, 4).toString(), "PNG");
});

test("check-env: offline, names and status only, window milestones", async () => {
  const secret = "hunter2-do-not-print", email = "mert@staff.test";
  const lines = [];
  const http = () => assert.fail("check-env must not touch the network");
  const env = { KV44_EMAIL: email, KV44_PASSWORD: secret, KV44_EXPECTED_SHA: "abc", KV44_MEDIA_HOST: "" };
  const code = await main(["--check-env", "--as", "media-operator", "--window-start", "2026-10-20T10:00:00Z"], { env, http, log: l => lines.push(l) });
  assert.equal(code, 1);
  const out = lines.join("\n");
  assert.match(out, /KV44_EXPECTED_SHA=invalid/);
  assert.match(out, /KV44_MEDIA_HOST=missing/);
  assert.match(out, /KV44_PASSWORD=ok/);
  assert.match(out, /T0 en geç 2026-10-20T10:19:00\.000Z  yazma sınırı 2026-10-20T10:50:00\.000Z  bitiş 2026-10-20T11:00:00\.000Z/);
  assert.ok(!out.includes(secret) && !out.includes(email) && !out.includes("abc"));
  const ok = { KV44_EMAIL: email, KV44_PASSWORD: secret, KV44_EXPECTED_SHA: SHA, KV44_MEDIA_HOST: MEDIA_HOST };
  assert.equal(await main(["--check-env", "--as", "approver"], { env: ok, http, log: () => {} }), 0);
  assert.deepEqual(checkEnv({}, ["approver"])[0].vars.map(v => v.status), ["missing", "missing", "missing"]);
  await assert.rejects(main(["--check-env", "--as", "nobody"], { env: ok, http, log: () => {} }));
});

test("preflight: only two GETs, no credentials", async () => {
  const s = fakeStaging();
  const r = await preflight(s.fetch);
  assert.equal(r.pass, true);
  assert.deepEqual(s.requests.map(q => `${q.method} ${q.path}`), ["GET /health", "GET /v1/config"]);
  assert.ok(s.requests.every(q => !q.cookie && q.host === new URL(API).host));
});

test("full run in order R0 → T0 → R1/R3 → R2 → T+31 → R4 → R5: PASS, cleanup TAMAM, no secret in evidence", async () => {
  const h = harness();
  const runId = newRunId(new Date(START));
  const common = ["--run", runId, "--window-start", new Date(START).toISOString()];
  assert.equal(await h.run("initiator", "initiator", ["--as", "initiator", "--phase", "open", ...common]), 0);
  const t0 = h.s.now;
  const target = handoff(h.lines, "--target"), marker = handoff(h.lines, "--marker");
  const [approveId, expiryId] = [...h.lines.join("\n").matchAll(/--approval ([0-9a-f]{8})/g)].map(m => m[1]);
  assert.equal(await h.run("owner", "owner", ["--as", "owner", "--target", target, "--marker", marker, ...common]), 0);
  assert.equal(await h.run("media-operator", "media-operator", ["--as", "media-operator", "--phase", "run", ...common]), 0);
  assert.equal(await h.run("approver", "approver", ["--as", "approver", "--phase", "approve", "--approval", approveId, ...common]), 0);
  assert.equal(await h.run("approver", "approver", ["--as", "approver", "--phase", "expiry", "--approval", expiryId, ...common]), 0);
  assert.ok(h.s.now - t0 >= 31 * 60_000 && h.s.now - START < 50 * 60_000, "T+31 inside the write window");
  assert.equal(await h.run("initiator", "initiator", ["--as", "initiator", "--phase", "cleanup", ...common]), 0);
  assert.equal(await h.run("media-operator", "media-operator", ["--as", "media-operator", "--phase", "cleanup", ...common]), 0);
  assert.equal(await main(["--merge", "--run", runId], { root: h.root, log: () => {} }), 0);

  const report = JSON.parse(readFileSync(join(h.root, runId, "R5-report.json"), "utf8"));
  assert.equal(report.verdict, "PASS");
  assert.equal(report.cleanup, "TAMAM");
  const row = id => report.matrix.find(m => m.id === id);
  assert.equal(row("R1.last_super_admin").result, "UYGULANAMAZ-staging");
  assert.match(row("R1.legacy_approval").note, /role-approvals\.test\.ts/);
  assert.match(row("R1.self").note, /details=boş/);
  assert.ok([...h.s.comments.values()].every(v => v === "REMOVED") && [...h.s.polls.values()].every(v => v === "REMOVED"));
  assert.ok([...h.s.users.values()].filter(u => u.username.startsWith("sec_kv44_")).every(u => u.banned && u.roles.join() === "USER"));
  assert.equal(h.s.registered, 2, "only author and media USER are created");
  // contracts Username (common.ts) + #268 QA exclusion pattern
  const synthetic = [...h.s.users.values()].filter(u => u.username.startsWith("sec_kv44_"));
  assert.equal(synthetic.length, 2);
  assert.ok(synthetic.every(u => /^[a-z0-9_]{3,30}$/.test(u.username) && /^(e2e|wk_a|wk_b|sec)_/.test(u.username)));
  assert.equal(h.prompts.length, 1);

  const all = readdirSync(join(h.root, runId)).filter(f => f.endsWith(".jsonl") || f.startsWith("R5-")).map(f => readFileSync(join(h.root, runId, f), "utf8")).join("\n") + h.lines.join("\n");
  assert.doesNotMatch(all, /123456|pw-|@staff\.test|@example\.test|kv_session=sid|X-Amz|AKIAEXAMPLE|deadbeef/);
  assert.doesNotMatch(all, /[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/, "no full id in evidence or console");
  assert.match(all, /code \*\*\*\*\*\*/);
  // Every request went to WEB, API or the configured media host.
  assert.ok(h.s.requests.every(q => [new URL(WEB).host, new URL(API).host, MEDIA_HOST].includes(q.host)));
});

test("media host mismatch: FAIL and stop, no PUT to the bucket", async () => {
  const h = harness({ "POST /api/v1/media/uploads": () => new Response(JSON.stringify({ data: { mediaId: uuid(5), upload: { method: "PUT", url: `https://${MEDIA_HOST}.attacker.test/x?X-Amz-Signature=s`, headers: {}, expiresAt: "" } } }), { status: 201 }) });
  const runId = newRunId(new Date(START));
  assert.equal(await h.run("media-operator", "media-operator", ["--as", "media-operator", "--phase", "run", "--run", runId, "--window-start", new Date(START).toISOString()]), 1);
  const rows = evidence(h.root, runId, "media-operator");
  assert.equal(rows.find(r => r.step === "R3.upload.host").result, "FAIL");
  assert.ok(!rows.some(r => r.step === "R3.upload.put"));
  assert.ok(!h.s.requests.some(q => q.method === "PUT" && q.host.includes("attacker")));
});

test("window: writes in the last 10 minutes and a late T0 are BLOCKED-window", async () => {
  const h = harness();
  const runId = newRunId(new Date(START));
  h.s.now = START + 20 * 60_000;
  assert.equal(await h.run("initiator", "initiator", ["--as", "initiator", "--phase", "open", "--run", runId, "--window-start", new Date(START).toISOString()]), 1);
  assert.equal(evidence(h.root, runId, "initiator").find(r => r.step === "R2.open.expiring").result, "BLOCKED-window");
  assert.equal(h.s.registered, 0);
  h.s.now = START + 51 * 60_000;
  const before = h.s.requests.length;
  assert.equal(await h.run("owner", "owner", ["--as", "owner", "--target", "00000000", "--marker", "sec_kv44_0000000000", "--run", runId, "--window-start", new Date(START).toISOString()]), 1);
  assert.ok(!h.s.requests.slice(before).some(q => q.path.endsWith("/role") || q.path.endsWith("/role-approvals")));
});

test("registration limit: BLOCKED-ratelimit (not NO-GO), cleanup still runs", async () => {
  const h = harness({ "POST /api/v1/auth/register": () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), { status: 429, headers: { "retry-after": "3600" } }) });
  const runId = newRunId(new Date(START));
  assert.equal(await h.run("initiator", "initiator", ["--as", "initiator", "--phase", "open", "--run", runId, "--window-start", new Date(START).toISOString()]), 1);
  const rows = evidence(h.root, runId, "initiator");
  assert.equal(rows.find(r => r.step === "ACC.register").result, "BLOCKED-ratelimit");
  assert.equal(rows.at(-1).step, "R4.residue");
  assert.equal(combine(["PASS", "BLOCKED-ratelimit"]), "BLOCKED-ratelimit");
});

test("P0 FAIL (self approval accepted): R4 runs anyway; failed cleanup → TEMİZLİK EKSİK with masked list", async () => {
  const h = harness();
  const orig = h.s.fetch;
  h.s.fetch = async (url, init) => {
    const p = new URL(url).pathname;
    if (/bulk-approvals\/[^/]+\/approve$/.test(p)) return new Response(JSON.stringify({ data: { approval: { status: "APPROVED" } } }), { status: 200 });
    if (/\/sanctions$/.test(p)) return new Response(JSON.stringify({ error: { code: "INTERNAL" } }), { status: 500 });
    return orig(url, init);
  };
  const runId = newRunId(new Date(START));
  assert.equal(await h.run("initiator", "initiator", ["--as", "initiator", "--phase", "open", "--run", runId, "--window-start", new Date(START).toISOString()]), 1);
  const rows = evidence(h.root, runId, "initiator");
  assert.equal(rows.find(r => r.step === "R2.self_approval").result, "FAIL");
  assert.ok(rows.some(r => r.step === "R4.comment" && r.result === "PASS"));
  const residue = rows.find(r => r.step === "R4.residue");
  assert.equal(residue.result, "TEMİZLİK EKSİK");
  assert.match(residue.note, /user author [0-9a-f]{8}…/);
  const { report, md } = mergeEvidence(join(h.root, runId));
  assert.equal(report.verdict, "NO-GO");
  assert.equal(report.cleanup, "TEMİZLİK EKSİK");
  assert.match(md, /## TEMİZLİK EKSİK/);
});
