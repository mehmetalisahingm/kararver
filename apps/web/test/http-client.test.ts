import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { ApiClient } from "../src/lib/api-client.ts";
import { HttpClient } from "../src/lib/http-client.ts";
import { emptyDraft, UiError } from "../src/lib/model.ts";

function fixture(endpoint: string, name: string) { return structuredClone(examples.find(e => e.endpoint === endpoint && e.name === name)!); }
function reply(endpoint: string, name: string) { const e = fixture(endpoint, name); return new Response(e.body === null ? null : JSON.stringify(e.body), { status: e.status }); }
const detail = (fixture("polls.get", "guest-hidden").body as {data: {id: string; options: {id: string}[]}}).data;

test("HTTP uses credentialed no-store requests and preserves idempotency across retry", async () => {
  const seen: RequestInit[] = [];
  const client = new ApiClient("http://api.test", async (_url, init) => { seen.push(init!); return reply("polls.create", "poll"); });
  const draft = { ...emptyDraft(), categoryId: "01998b9a-0000-7000-8000-000000000030", title: "Hangi seçenek daha iyi?", options: ["A", "B"] };
  await client.create(draft, "same-key-123"); await client.create(draft, "same-key-123");
  assert.equal(seen.length, 2);
  for (const init of seen) {
    assert.equal(init.credentials, "include"); assert.equal(init.cache, "no-store");
    assert.equal((init.headers as Record<string,string>)["Idempotency-Key"], "same-key-123");
    const body = JSON.parse(init.body as string);
    assert.equal(body.categoryId, draft.categoryId); assert.equal(body.kind, "POLL"); assert.equal(body.durationHours, 72); assert.equal(body.resultsVisibility, "AFTER_VOTE");
    assert.equal("balance" in body, false);
  }
});
test("viewer projection stays hidden and malformed hidden payload is rejected", async () => {
  const client = new ApiClient("http://api.test", async () => reply("polls.get", "guest-hidden"));
  assert.deepEqual((await client.get(detail.id)).results, {visible:false});
  const poisoned = fixture("polls.get", "guest-hidden").body as {data: {results: unknown}};
  poisoned.data.results = {visible:false, total:99};
  const bad = new ApiClient("http://api.test", async () => new Response(JSON.stringify(poisoned)));
  await assert.rejects(bad.get(detail.id), (e: UiError) => e.code === "INVALID_RESPONSE");
});
test("vote calls PUT on server id and accepts first vote and change responses", async () => {
  for (const name of ["first-vote", "change"]) {
    const client = new ApiClient("http://api.test", async (url, init) => {
      if (init?.method === "GET") return reply("polls.get", "guest-hidden");
      assert.equal(String(url), `http://api.test/v1/polls/${detail.id}/vote`); assert.equal(init?.method,"PUT");
      return reply("votes.put", name);
    });
    const result = await client.vote(detail.id, detail.options[0].id);
    assert.equal(result.results.visible,true); assert.ok(result.ownVote);
  }
});
test("session expiration clears current user and notifies subscribers", async () => {
  let expired = false; let changes = 0;
  const client = new ApiClient("http://api.test", async (url) => {
    if (expired) return reply("votes.put", "guest");
    if (String(url).endsWith("/v1/me/points")) {
      return new Response(JSON.stringify({ data: { balance: 20, publishCost: 10 } }), { status: 200 });
    }
    return reply("auth.login", "ok");
  });
  client.subscribe(() => changes++);
  await client.login("umit@example.test", "password"); assert.equal(client.current()?.balance, 20);
  expired = true; assert.equal(await client.restore(), null); assert.equal(changes,3);
});
test("transport rejects unavailable, malformed and aborted responses without demo fallback", async () => {
  await assert.rejects(new HttpClient("").request("me.get"), (e: UiError) => e.code === "API_UNCONFIGURED");
  await assert.rejects(new HttpClient("http://api.test", async () => new Response("missing",{status:404})).request("feed.list"), (e: UiError) => e.code === "ENDPOINT_UNAVAILABLE");
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(new HttpClient("http://api.test", async () => { throw new DOMException("Aborted", "AbortError"); }).request("feed.list",{signal:ctrl.signal}), {name:"AbortError"});
});