/** #46/#48: only the operator's own session is created/revoked. No account/content/config writes. */
import { pathToFileURL } from "node:url";

const WEB = "https://kararver-staging.vercel.app";
const API = "https://api-staging-45cb.up.railway.app";

export async function checkStagingSession({ email, password }, http = fetch) {
  if (!email || !password) throw new Error("KV_STAGING_EMAIL and KV_STAGING_PASSWORD are required");
  const checks = [];
  let cookie = "";
  let loggedOut = false;
  let release = null;
  const check = (id, ok, response) => {
    checks.push({ id, result: ok ? "PASS" : "FAIL", ...(response ? { status: response.status, requestId: response.headers.get("x-request-id") } : {}) });
    if (!ok) throw new Error(id);
  };
  const request = (path, { method = "GET", body, origin = WEB, authenticated = true } = {}) => http(WEB + "/api" + path, {
    method, redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", origin, ...(body ? { "content-type": "application/json" } : {}), ...(authenticated && cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const privateResponse = (id, response) => check(id + ".no-store", /\bno-store\b/i.test(response.headers.get("cache-control") ?? ""), response);
  try {
    const health = await http(API + "/health", { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const state = await health.json();
    release = state.release?.sha ?? null;
    check("health", health.status === 200 && state.status === "ok" && state.worker?.status === "ready" && state.release?.env === "staging", health);
    const login = await request("/v1/auth/login", { method: "POST", body: { email, password }, authenticated: false });
    // Capture before assertions so even a malformed successful response can be cleaned up.
    const setCookie = login.headers.getSetCookie?.().find(value => value.startsWith("kv_session=")) ?? login.headers.get("set-cookie") ?? "";
    cookie = setCookie.split(";")[0];
    if (!cookie.startsWith("kv_session=")) cookie = "";
    check("login", login.status === 200 && Boolean(cookie), login);
    check("session.cookie", /;\s*Secure(?:;|$)/i.test(setCookie) && /;\s*HttpOnly(?:;|$)/i.test(setCookie) && /;\s*SameSite=Lax(?:;|$)/i.test(setCookie) && !/;\s*Domain=/i.test(setCookie), login);
    privateResponse("login", login);
    const me = await request("/v1/me");
    check("session.restore", me.status === 200, me);
    privateResponse("session.restore", me);
    const account = (await me.json()).data;
    const isSuper = account?.roles?.includes("SUPER_ADMIN");
    check("session.identity", typeof account?.id === "string", me);
    for (const [path, id, allowed] of [
      ["/v1/admin/users", "rbac.users", account?.roles?.some(role => ["ADMIN", "SUPER_ADMIN"].includes(role))],
      ["/v1/admin/ops", "rbac.ops", isSuper],
    ]) {
      const response = await request(path);
      check(id, response.status === (allowed ? 200 : 403), response);
      privateResponse(id, response);
    }
    const crossOrigin = await request("/v1/auth/logout", { method: "POST", origin: "https://attacker.invalid" });
    check("csrf.cross-origin-logout", crossOrigin.status === 403 && crossOrigin.headers.get("access-control-allow-origin") !== "https://attacker.invalid", crossOrigin);
    const afterCsrf = await request("/v1/me");
    check("csrf.session-preserved", afterCsrf.status === 200, afterCsrf);
    const logout = await request("/v1/auth/logout", { method: "POST" });
    loggedOut = logout.status === 204;
    check("session.logout", loggedOut, logout);
    const replay = await request("/v1/me");
    check("session.revoked-cookie", replay.status === 401, replay);
    privateResponse("session.revoked-cookie", replay);
    check("session.cookie-cleared", /Max-Age=0/i.test(replay.headers.get("set-cookie") ?? ""), replay);
  } catch (error) {
    // No upstream body, arbitrary error text, credentials, cookies or account data enter the report.
    if (!checks.some(item => item.result === "FAIL")) checks.push({ id: "transport-or-response", result: "FAIL" });
  } finally {
    if (cookie && !loggedOut) {
      try {
        const cleanup = await request("/v1/auth/logout", { method: "POST" });
        loggedOut = cleanup.status === 204 || cleanup.status === 401;
      } catch { /* Explicit failed cleanup below. */ }
      checks.push({ id: "session.cleanup", result: loggedOut ? "PASS" : "FAIL" });
    }
  }
  return { at: new Date().toISOString(), web: WEB, api: API, release, mode: "OWN_SESSION_ONLY", checks,
    totals: { pass: checks.filter(x => x.result === "PASS").length, fail: checks.filter(x => x.result === "FAIL").length },
    limits: ["No TTL expiry, independent-role change, two-admin MFA, concurrent vote, media outage or real email delivery acceptance."] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkStagingSession({ email: process.env.KV_STAGING_EMAIL, password: process.env.KV_STAGING_PASSWORD });
    console.log(JSON.stringify(report, null, 2));
    if (report.totals.fail) process.exitCode = 1;
  } catch { console.error("Set KV_STAGING_EMAIL and KV_STAGING_PASSWORD locally; never pass credentials as CLI arguments."); process.exitCode = 1; }
}
