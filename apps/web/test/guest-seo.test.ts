import assert from "node:assert/strict";
import { test } from "node:test";
import { examples } from "@kararver/contracts/fixtures";
import { mapPoll } from "../src/lib/poll-mapper.ts";
import { loadPublicPoll } from "../src/lib/server-public-polls.ts";

// The API's public projection — including AFTER_VOTE redaction — is the
// only information permitted in server-rendered HTML or OG metadata.
const publicExample = examples.find(example => example.endpoint === "polls.get" && example.name === "guest-hidden");
if (!publicExample) throw new Error("missing public poll fixture");
const responseBody = structuredClone(publicExample.body) as { data: any };
const routeId = responseBody.data.id as string;

test("guest SSR projection contains only API-authorized poll content", () => {
  assert.equal(responseBody.data.viewer, null);
  assert.deepEqual(responseBody.data.results, { visible: false });
  const mapped = mapPoll(responseBody.data);
  assert.equal(mapped.id, routeId);
  assert.deepEqual(mapped.results, { visible: false });
  assert.equal(mapped.ownVote, null);
  assert.equal(mapped.title, responseBody.data.title);
});

test("deleted/missing public poll returns null; temporary API failure is NOT converted to false 404", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.API_URL;
  try {
    process.env.API_URL = "https://api.example.test";
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(await loadPublicPoll(routeId, { strict: true }), null);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(loadPublicPoll(routeId, { strict: true }), /public_poll_api_unavailable/);
    assert.equal(await loadPublicPoll(routeId), null, "preview gracefully falls back to demo client");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = originalUrl;
  }
});

test("valid public poll can be rendered without a guest session", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.API_URL;
  try {
    process.env.API_URL = "https://api.example.test";
    let calledUrl = "";
    globalThis.fetch = async input => {
      calledUrl = String(input);
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
    };
    const detail = await loadPublicPoll(routeId, { strict: true });
    assert.equal(detail?.id, routeId);
    assert.equal(detail?.viewer, null);
    assert.deepEqual(detail?.results, { visible: false });
    assert.ok(calledUrl.includes(`/v1/polls/${routeId}`));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = originalUrl;
  }
});
