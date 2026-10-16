import assert from "node:assert/strict";
import { test } from "node:test";
import { API, WEB, checkPublicMediaReadOnly } from "./public-media-readonly.mjs";

const safeHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "content-type": "application/json",
};
function fixture(override = () => null) {
  return async (url, init) => {
    const u = new URL(url);
    assert.ok([API, WEB].includes(u.origin), "staging origins only");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    assert.ok(!init.headers.cookie && !init.headers.authorization);
    assert.ok(u.pathname.includes("/media-public/m/"));
    return override(url, init) || Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: safeHeaders });
  };
}

test("staging media guest deny gate stays read-only and checks both API and web rewrite", async () => {
  const calls = [];
  const mock = fixture(async (url, init) => {
    calls.push(url);
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: safeHeaders });
  });
  const r = await checkPublicMediaReadOnly(mock);
  assert.deepEqual(r.totals, { pass: 24, fail: 0 });
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(x => x.startsWith(WEB + "/api/")).length, 2);
  assert.equal(calls.filter(x => x.startsWith(API + "/media-public/")).length, 2);
  assert.ok(r.releaseGate.startsWith("NO_GO"));
});

test("missing no-store/noindex, accidental content exposure or redirect fail closed", async () => {
  const report = await checkPublicMediaReadOnly(fixture((url) => {
    if (!url.includes("invalid-media-id")) return null;
    return Response.json({ url: "https://bucket.amazonaws.com/foo?X-Amz-Signature=secret" }, {
      status: 200,
      headers: { location: "https://some-bucket.invalid", "x-powered-by": "Express" },
    });
  }));
  const failed = report.checks.filter(x => x.result === "FAIL").map(x => x.id);
  for (const suffix of [".not_found", ".no_store", ".noindex", ".no_redirect", ".no_fingerprint", ".no_signed_data"]) {
    assert.ok(failed.some(x => x.endsWith(suffix)), "missing expected FAIL for " + suffix);
  }
  assert.ok(report.totals.fail >= 12);
});

test("network error doesn't leak the underlying URL or count as PASS", async () => {
  const report = await checkPublicMediaReadOnly(async () => {
    throw new Error("Secret in URL https://user:password@bucket");
  });
  assert.equal(report.totals.pass, 0);
  assert.equal(report.totals.fail, 4);
  assert.ok(!JSON.stringify(report).includes("password"));
  assert.ok(!JSON.stringify(report).includes("user:"));
});
