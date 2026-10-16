/**
 * #46 / #48: anonymous, read-only public-media deny test.
 * Only GET against two fixed STAGING origins, never writes data or touches credentials.
 * A 404 is evidence only for missing/invalid IDs; it is NOT an approved-media E2E PASS.
 */
import { pathToFileURL } from "node:url";

export const API = "https://api-staging-45cb.up.railway.app";
export const WEB = "https://kararver-staging.vercel.app";

const PATHS = [
  "/media-public/m/00000000-0000-0000-0000-000000000000.webp",
  "/media-public/m/invalid-media-id.webp",
];

function safeResponseBody(body) {
  // Should never include private-bucket paths, signed URLs or credentials.
  return !/(X-Amz-(?:Algorithm|Credential|Signature)|AWSAccessKeyId|AKIA[0-9A-Z]{16}|(?:secret|access)_?key|s3:\/\/|\.amazonaws\.com\/)/i.test(body);
}

export async function checkPublicMediaReadOnly(fetcher = fetch, timeoutMs = 12_000) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({
    id, result: passed ? "PASS" : "FAIL", detail,
  });
  for (const [target, root, prefix] of [
    ["api", API, ""],
    ["web-proxy", WEB, "/api"],
  ]) {
    for (const path of PATHS) {
      const id = target + "." + (path.includes("invalid") ? "malformed" : "missing");
      let response;
      try {
        response = await fetcher(root + prefix + path, {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "omit",
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        // Never expose a remote exception containing URLs, cookies or credentials.
        add(id + ".network", false, e?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_UNAVAILABLE");
        continue;
      }
      add(id + ".not_found", response.status === 404, "HTTP " + response.status + " (expected 404)");
      const cache = response.headers.get("cache-control") || "";
      add(id + ".no_store", /(?:^|,)\s*no-store(?:\s*,|$)/i.test(cache), "no-store " + (cache.includes("no-store") ? "present" : "absent"));
      const robots = response.headers.get("x-robots-tag") || "";
      add(id + ".noindex", /noindex/i.test(robots), robots ? "noindex checked" : "X-Robots-Tag missing");
      add(id + ".no_redirect", !response.headers.has("location"), response.headers.has("location") ? "Location exposed" : "No redirect");
      add(id + ".no_fingerprint", !response.headers.has("x-powered-by"), response.headers.has("x-powered-by") ? "X-Powered-By exposed" : "not exposed");
      try {
        const body = await response.text();
        add(id + ".no_signed_data", body.length <= 5000 && safeResponseBody(body), "body size/signature check");
      } catch {
        add(id + ".no_signed_data", false, "unreadable error body");
      }
    }
  }
  const fail = checks.filter(x => x.result === "FAIL").length;
  return {
    releaseGate: "NO_GO_NEEDS_APPROVED_MEDIA_UPLOAD_MODERATION_AND_REVOKE_TEST",
    scope: "STAGING_ANONYMOUS_GET_ONLY",
    totals: { pass: checks.length - fail, fail },
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(x => x !== "--json")) {
    console.error("Usage: node scripts/public-media-readonly.mjs [--json]");
    process.exitCode = 2;
  } else {
    const report = await checkPublicMediaReadOnly();
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      for (const c of report.checks) console.log(c.result + " " + c.id + " — " + c.detail);
      console.log(report.releaseGate + "; " + report.totals.pass + " pass / " + report.totals.fail + " fail");
    }
    if (report.totals.fail) process.exitCode = 1;
  }
}
