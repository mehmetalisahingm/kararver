/**
 * KV-44 / #46 — safe, read-only staging security gate.
 * DOES NOT write data, create users, vote, send email or grant beta access.
 * Run: node scripts/security-acceptance.mjs --api https://api-staging-...up.railway.app
 * --json writes JSON-only to stdout for CI artifacts, not secrets.
 */
import { pathToFileURL } from "node:url";

const PRIVATE = [
  ["/v1/me", "guest-account"],
  ["/v1/notifications", "guest-notifications"],
  ["/v1/admin/users", "guest-admin-users"],
  ["/v1/admin/settings", "guest-admin-settings"],
  ["/v1/admin/audit", "guest-admin-audit"],
];

export function validateApiUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Valid HTTPS staging API URL required"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Require bare HTTPS staging API origin without credentials, port or query");
  }
  if (!url.hostname.endsWith(".up.railway.app") || url.hostname === ".up.railway.app") {
    throw new Error("Only explicit Railway staging HTTPS origins are supported");
  }
  return url.origin;
}

export async function checkSecurityGate(origin, http = fetch, timeoutMs = 12_000) {
  const api = validateApiUrl(origin);
  const results = [];
  const emit = (id, ok, detail) => results.push({ id, result: ok ? "PASS" : "FAIL", detail });
  const get = async (path, headers = {}) => {
    try {
      return { response: await http(api + path, {
        method: "GET", headers: { accept: "application/json", ...headers },
        redirect: "manual", credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
      }) };
    } catch (e) {
      // Never report arbitrary proxy response or credential-containing URLs.
      return { error: e?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_UNAVAILABLE" };
    }
  };
  const response = async (name, path, expectedStatus, extras = {}) => {
    const result = await get(path, extras);
    if (result.error) { emit(name, false, result.error); return null; }
    const res = result.response;
    emit(name, res.status === expectedStatus, "HTTP " + res.status + " (expected " + expectedStatus + ")");
    emit(name + ".no_server_fingerprint", !res.headers.has("x-powered-by"), res.headers.has("x-powered-by") ? "X-Powered-By exposed" : "not exposed");
    emit(name + ".hsts", Boolean(res.headers.get("strict-transport-security")), res.headers.get("strict-transport-security") ? "present" : "missing");
    return res;
  };
  const health = await response("health", "/health", 200);
  if (health?.status === 200) {
    let ok = false;
    try { ok = (await health.json())?.status === "ok"; } catch { /* fails closed */ }
    emit("health.schema", ok, ok ? "status ok" : "unexpected response");
  }
  const config = await response("public-config", "/v1/config", 200);
  if (config?.status === 200) {
    let ok = false;
    try {
      const body = await config.json();
      const data = body?.data;
      ok = Boolean(data && typeof data === "object" && !Array.isArray(data));
      // Public config must never contain material like database URLs or SMTP credentials.
      if (ok) ok = !/(?:password|secret|private.?key|smtp|database.?url|access.?key|authorization)/i.test(JSON.stringify(data));
    } catch { /* fails closed */ }
    emit("public-config.no-secrets", ok, ok ? "public config shape and keys safe" : "invalid/unsafe public config");
  }
  for (const [path, name] of PRIVATE) await response(name, path, 401);
  // Malicious origin must never be permitted to read or authenticate as the real site.
  const crossOrigin = await get("/v1/admin/users", { origin: "https://attacker.invalid" });
  if (crossOrigin.error) emit("cross-origin-admin", false, crossOrigin.error);
  else {
    const res = crossOrigin.response;
    emit("cross-origin-admin.auth", res.status === 401, "HTTP " + res.status);
    const allowed = res.headers.get("access-control-allow-origin");
    emit("cross-origin-admin.cors", !allowed || (allowed !== "*" && allowed !== "https://attacker.invalid"), allowed ? "origin rule checked" : "origin not reflected");
  }
  const failed = results.filter(x => x.result === "FAIL").length;
  return {
    environment: api, mode: "READ_ONLY_NO_CREDENTIALS",
    betaGate: "NO_GO_NEEDS_AUTHENTICATED_STAGING_TESTS_AND_SIGNOFF",
    totals: { pass: results.length - failed, fail: failed }, checks: results,
    note: "This checks only unauthenticated public surface; it does not prove CSRF, 20 votes, moderation model, rate limits, account sanctions or emergency overrides.",
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--api" && typeof argv[i + 1] === "string") {
      if (opts.api) throw new Error("Duplicate --api");
      opts.api = argv[++i]; continue;
    }
    throw new Error("Unknown or incomplete argument");
  }
  if (!opts.api) throw new Error("Usage: node scripts/security-acceptance.mjs --api https://api-staging-...up.railway.app [--json]");
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await checkSecurityGate(args.api);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const c of report.checks) console.log(c.result + " " + c.id + " — " + c.detail);
      console.log("Security gate: " + report.betaGate + "; " + report.totals.pass + " pass, " + report.totals.fail + " fail");
    }
    if (report.totals.fail > 0) process.exitCode = 1;
  } catch (e) {
    console.error("security-acceptance: " + (e instanceof Error ? e.message : "unknown error"));
    process.exitCode = 1;
  }
}
