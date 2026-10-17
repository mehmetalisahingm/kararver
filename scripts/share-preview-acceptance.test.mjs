import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePageUrl, readHeadTags, verifyPreview, checkSharePreview } from "./share-preview-acceptance.mjs";

const live = "https://kararver-staging.vercel.app/karar/karsilastirma-abcd1234";
const removed = "https://kararver-staging.vercel.app/karar/kaldirilan-bbbb2222";
const body = ({ image = false, robots = "noindex,nofollow", description = "Birlikte düşün." } = {}) =>
  '<head>' +
  '<meta content="' + robots + '" name="robots"/>' +
  '<meta content="Karar &amp; fikir" property="og:title"/>' +
  '<meta property="og:description" content="' + description + '"/>' +
  '<meta property="og:url" content="' + live + '"/>' +
  '<meta name="twitter:title" content="Karar &amp; fikir"/>' +
  '<meta name="twitter:description" content="Birlikte düşün."/>' +
  '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '"/>' +
  (image ? '<meta property="og:image" content="https://cdn.example.com/img.webp"/>' +
    '<meta name="twitter:image" content="https://cdn.example.com/img.webp"/>' : '') +
  '<link href="' + live + '" rel="canonical"/></head>';
const gone = '<head><meta name="robots" content="noindex, nofollow"/><title>İçerik bulunamadı</title></head>';
const verify = (html, overrides = {}) => verifyPreview({
  html, status: 200, url: new URL(live), removed: false, environment: "staging", ...overrides
});
const failed = rows => rows.filter(x => x.result === "FAIL").map(x => x.id);

test("rejects insecure, private, credentialed, tracking and non-poll links", () => {
  assert.equal(validatePageUrl(live).pathname, "/karar/karsilastirma-abcd1234");
  const bad = [
    "http://kararver-staging.vercel.app/karar/x", "https://127.0.0.1/karar/x",
    "https://example.com/karar/x", "https://kararver-staging.vercel.app/admin",
    live + "?token=secret", live + "#hash",
    "https://user:password@kararver-staging.vercel.app/karar/x",
    "https://kararver-staging.vercel.app:9443/karar/x"
  ];
  for (const value of bad) assert.throws(() => validatePageUrl(value));
});

test("parses real head tags in either attribute order and decodes entities", () => {
  const h = readHeadTags(body());
  assert.equal(h.metas.get("og:title"), "Karar & fikir");
  assert.equal(h.links.get("canonical"), live);
  assert.equal(readHeadTags('<body><meta name="robots" content="noindex"/></body>'), null);
});

test("staging live text and approved-image metadata pass", () => {
  assert.deepEqual(failed(verify(body())), []);
  assert.deepEqual(failed(verify(body({ image: true }))), []);
});

test("inconsistent description and image fail closed", () => {
  assert.ok(failed(verify(body({ description: "Başka açıklama" }))).includes("description-match"));
  const missingImage = body().replace("<link ", '<meta name="twitter:image" content="https://cdn.example.com/fake.webp"/><link ');
  assert.ok(failed(verify(missingImage)).includes("image-consistency"));
});

test("canonical, indexing and production robots are checked", () => {
  const moved = body({ robots: "index,follow" }).replace('href="' + live + '"', 'href="https://foreign.example/karar/x"');
  assert.ok(failed(verify(moved)).includes("canonical"));
  assert.ok(failed(verify(moved)).includes("staging-noindex"));
  assert.ok(failed(verify(body(), { environment: "production" })).includes("production-indexable"));
  assert.deepEqual(failed(verify(body({ robots: "index,follow" }), { environment: "production" })), []);
});

test("removed content cannot be indexed or presented as active social share", () => {
  const options = { html: gone, status: 404, url: new URL(removed), removed: true, environment: "staging" };
  assert.deepEqual(failed(verifyPreview(options)), []);
  const generic = gone.replace("</head>", '<meta property="og:url" content="https://kararver-staging.vercel.app/"/></head>');
  assert.deepEqual(failed(verifyPreview({ ...options, html: generic })), []);
  assert.ok(failed(verifyPreview({ ...options, html: body() })).includes("removed-not-shared"));
  assert.ok(failed(verifyPreview({ ...options, html: "<head></head>" })).includes("removed-noindex"));
});

test("both crawler user agents only GET live/removed without cookies, and never claim external cache", async () => {
  const calls = [];
  const report = await checkSharePreview({ live, removed, environment: "staging" }, async (url, init) => {
    calls.push({ url, init });
    return new Response(url === live ? body() : gone, {
      status: url === live ? 200 : 404, headers: { "content-type": "text/html; charset=utf-8" }
    });
  });
  assert.equal(report.totals.fail, 0);
  assert.equal(report.externalCacheVerified, false);
  assert.equal(report.cases.length, 4);
  assert.ok(calls.some(c => c.init.headers["user-agent"] === "Twitterbot/1.0"));
  assert.ok(calls.some(c => c.init.headers["user-agent"].startsWith("WhatsApp")));
  assert.ok(calls.every(c => c.init.method === "GET" && c.init.redirect === "manual" && c.init.credentials === "omit"));
});

test("redirect and network errors are FAIL without leaking exception messages", async () => {
  const redirect = await checkSharePreview({ live, environment: "staging" },
    async () => new Response(null, { status: 302, headers: { location: "/giris" } }));
  assert.equal(redirect.totals.fail, 2);
  const offline = await checkSharePreview({ live, environment: "staging" }, async () => {
    throw Error("credentials-should-not-leak");
  });
  assert.equal(offline.totals.fail, 2);
  assert.doesNotMatch(JSON.stringify(offline), /credentials-should-not-leak/);
});

test("compared pages must have same origin and must be distinct", async () => {
  await assert.rejects(checkSharePreview({ live, removed: live, environment: "staging" }), /distinct/);
  await assert.rejects(checkSharePreview({ live, removed: "https://other.vercel.app/karar/test", environment: "staging" }), /same origin/);
});
