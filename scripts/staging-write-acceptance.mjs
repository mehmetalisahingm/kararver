/** Bounded #46 staging acceptance. Only creates and changes this run's synthetic accounts/content. */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const WEB = "https://kararver-staging.vercel.app";
const API = "https://api-staging-45cb.up.railway.app";

export async function checkStagingWrites({ email, password, expectedSha, apply }, http = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (apply !== true || !email || !password || !/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("Explicit apply, credentials and a full verified staging SHA are required");
  const checks = [], actors = [], polls = [];
  let root = "", rootId = "", release;
  const marker = `qa46_${randomBytes(6).toString("hex")}`;
  const check = (id, ok, response) => {
    checks.push({ id, result: ok ? "PASS" : "FAIL", ...(response ? { status: response.status, requestId: response.headers.get("x-request-id") } : {}) });
    if (!ok) throw new Error(id);
  };
  const req = async (path, { method = "GET", body, cookie = root, key } = {}) => {
    const response = await http(WEB + "/api/v1" + path, { method, redirect: "manual", signal: AbortSignal.timeout(30_000),
      headers: { origin: WEB, accept: "application/json", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = response.status === 204 ? null : await response.json();
    return { response, data };
  };
  const login = async (email, password) => {
    const result = await req("/auth/login", { method: "POST", body: { email, password }, cookie: "" });
    const header = result.response.headers.getSetCookie?.().find(c => c.startsWith("kv_session=")) ?? result.response.headers.get("set-cookie") ?? "";
    return { ...result, cookie: header.split(";")[0] };
  };
  const own = actor => {
    if (!actors.includes(actor) || actor.id === rootId || !actor.username.startsWith(marker)) throw new Error("Unowned account rejected");
    return actor.id;
  };
  const role = async (actor, value) => {
    const r = await req(`/admin/users/${own(actor)}/role`, { method: "PUT", body: { role: value, reason: "İzole QA46 rol kabulü" } });
    check(`role.${value.toLowerCase()}`, r.response.status === 200, r.response);
    actor.elevated = value !== "USER";
  };
  try {
    const health = await http(API + "/health", { signal: AbortSignal.timeout(15_000) });
    const state = await health.json();
    release = state.release?.sha;
    check("release.staging", health.status === 200 && state.status === "ok" && state.release?.env === "staging" && release?.length >= 12 && expectedSha.startsWith(release), health);
    const signed = await login(email, password);
    root = signed.cookie.startsWith("kv_session=") ? signed.cookie : "";
    check("operator.login", signed.response.status === 200 && Boolean(root), signed.response);
    rootId = signed.data?.data?.id;
    check("operator.super-admin", signed.data?.data?.roles?.includes("SUPER_ADMIN"), signed.response);
    for (const suffix of ["author", "voter"]) {
      const username = `${marker}_${suffix}`, email = `${username}@example.test`, password = randomBytes(24).toString("base64url");
      const registered = await req("/auth/register", { method: "POST", cookie: "", body: { username, email, password, displayName: "İzole güvenlik kontrolü" } });
      check(`fixture.${suffix}.register`, registered.response.status === 202, registered.response);
      const found = await req(`/admin/users?q=${encodeURIComponent(username)}`);
      const record = found.data?.data?.find(a => a.username === username);
      check(`fixture.${suffix}.owned`, record?.id && record.id !== rootId && record.roles.every(r => r === "USER"), found.response);
      const actor = { id: record.id, username, cookie: "", elevated: false };
      actors.push(actor);
      const signed = await login(email, password);
      actor.cookie = signed.cookie.startsWith("kv_session=") ? signed.cookie : "";
      check(`fixture.${suffix}.login`, signed.response.status === 200 && signed.data?.data?.id === actor.id && Boolean(actor.cookie), signed.response);
    }
    const [author, voter] = actors;
    let r = await req("/admin/users", { cookie: voter.cookie });
    check("rbac.user-denied", r.response.status === 403, r.response);
    await role(voter, "ADMIN");
    r = await req("/admin/users", { cookie: voter.cookie });
    check("rbac.existing-session-promoted", r.response.status === 200, r.response);
    r = await req("/admin/ops", { cookie: voter.cookie });
    check("rbac.admin-not-super", r.response.status === 403, r.response);
    await role(voter, "USER");
    r = await req("/admin/users", { cookie: voter.cookie });
    check("rbac.existing-session-demoted", r.response.status === 403, r.response);
    const categories = await req("/categories", { cookie: "" });
    const categoryId = categories.data?.data?.[0]?.id;
    check("fixture.category", categories.response.status === 200 && Boolean(categoryId), categories.response);
    const created = await req("/polls", { method: "POST", cookie: author.cookie, key: marker, body: {
      kind: "POLL", title: `Güvenlik kontrolü ${marker}: hangi seçenek?`, categoryId, durationHours: 24,
      resultsVisibility: "AFTER_VOTE", options: [{ label: "A seçeneği" }, { label: "B seçeneği" }],
    } });
    check("fixture.poll", created.response.status === 201 && Boolean(created.data?.data?.id), created.response);
    const poll = created.data.data;
    polls.push({ id: poll.id, actor: author });
    const vote = (cookie, optionId) => req(`/polls/${poll.id}/vote`, { method: "PUT", cookie, body: { optionId } });
    r = await vote(author.cookie, poll.options[0].id);
    check("vote.self-denied", r.response.status === 403 && r.data?.error?.code === "SELF_VOTE_FORBIDDEN", r.response);
    r = await req(`/polls/${poll.id}`, { cookie: "" });
    check("results.guest-hidden-before", r.data?.data?.results?.visible === false && Object.keys(r.data.data.results).length === 1, r.response);
    const votes = await Promise.all(Array.from({ length: 20 }, () => vote(voter.cookie, poll.options[0].id)));
    const statuses = votes.map(v => v.response.status);
    check("vote.concurrent-20.one-created", statuses.filter(s => s === 201).length === 1 && statuses.every(s => [200, 201, 429].includes(s)));
    checks.push({ id: "vote.concurrent-20.statuses", result: "INFO", statuses });
    r = await req(`/polls/${poll.id}`, { cookie: voter.cookie });
    const results = r.data?.data?.results;
    check("vote.http-totals-consistent", results?.visible === true && results.total === 1 && results.options.reduce((n, o) => n + o.votes, 0) === 1, r.response);
    r = await req(`/polls/${poll.id}`, { cookie: "" });
    check("results.guest-hidden-after", r.data?.data?.results?.visible === false && Object.keys(r.data.data.results).length === 1, r.response);
    const close = await req(`/polls/${poll.id}/close`, { method: "POST", cookie: author.cookie });
    check("poll.owner-close", close.response.status === 200, close.response);
    // A new account is limited to 15 votes/min. Wait for its normal window; never alter limits/IP/age.
    const wait = 60_050 - Date.now() % 60_000;
    await pause(Math.min(wait, 59_000));
    if (wait > 59_000) await pause(wait - 59_000);
    r = await vote(voter.cookie, poll.options[0].id);
    check("vote.closed-denied", r.response.status === 409 && r.data?.error?.code === "POLL_CLOSED", r.response);
    const banned = await req(`/admin/users/${own(voter)}/sanctions`, { method: "POST", body: { type: "BAN", reason: "İzole QA46 yaptırım kabulü" } });
    check("sanction.fixture-ban", banned.response.status === 201, banned.response);
    voter.banned = true;
    r = await vote(voter.cookie, poll.options[0].id);
    check("sanction.existing-session-blocked", [401, 403].includes(r.response.status), r.response);
  } catch {
    if (!checks.some(c => c.result === "FAIL")) checks.push({ id: "transport-or-response", result: "FAIL" });
  } finally {
    for (const poll of polls) {
      try { const r = await req(`/polls/${poll.id}`, { method: "DELETE", cookie: poll.actor.cookie }); check("cleanup.poll", r.response.status === 204, r.response); } catch { checks.push({ id: "cleanup.poll.failed", result: "FAIL" }); }
    }
    for (const actor of actors) {
      try {
        if (actor.elevated) await role(actor, "USER");
        if (!actor.banned) {
          const r = await req(`/admin/users/${own(actor)}/sanctions`, { method: "POST", body: { type: "BAN", reason: "İzole QA46 test hesabı temizliği" } });
          check("cleanup.account-banned", r.response.status === 201, r.response);
        }
      } catch { checks.push({ id: "cleanup.account.failed", result: "FAIL" }); }
      if (actor.cookie) { try { await req("/auth/logout", { method: "POST", cookie: actor.cookie }); } catch {} }
    }
    if (root) {
      try { const r = await req("/auth/logout", { method: "POST" }); check("cleanup.operator-session", r.response.status === 204, r.response); } catch { checks.push({ id: "cleanup.operator.failed", result: "FAIL" }); }
    }
  }
  return { at: new Date().toISOString(), web: WEB, api: API, expectedSha, release, mode: "OWN_SYNTHETIC_FIXTURES", checks,
    totals: { pass: checks.filter(c => c.result === "PASS").length, fail: checks.filter(c => c.result === "FAIL").length },
    limits: ["No direct DB invariant proof, forced email verification, cross-community/model/emergency/MFA/TTL/device/beta acceptance. New accounts use the current staging verification policy; 429 is expected under the real new-account limit. Synthetic accounts remain banned for audit; posts are soft-deleted."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkStagingWrites({ email: process.env.KV_STAGING_EMAIL, password: process.env.KV_STAGING_PASSWORD, expectedSha: process.env.KV_EXPECTED_SHA, apply: process.env.KV_STAGING_WRITE_ACCEPTANCE === "1" });
    console.log(JSON.stringify(report, null, 2));
    if (report.totals.fail) process.exitCode = 1;
  } catch { console.error("Explicit staging write acceptance, credentials and expected SHA are required; no secrets are printed."); process.exitCode = 1; }
}
