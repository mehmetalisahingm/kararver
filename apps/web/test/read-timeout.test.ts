import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { HttpClient } from "../src/lib/http-client.ts";
import { UiError } from "../src/lib/model.ts";

const success = (id: string) => examples.find(e => e.endpoint === id && e.status >= 200 && e.status < 300)!;

test("a stalled session read times out without logout or automatic retry; explicit retry can recover", async () => {
  let calls = 0, logouts = 0;
  const client = new HttpClient("http://api.test", async (_url, init) => {
    if (++calls > 1) return new Response(JSON.stringify(success("me.get").body));
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {once:true}));
  }, 10);
  client.onUnauthorized = () => logouts++;
  await assert.rejects(client.request("me.get"), (e: UiError) => e.code === "REQUEST_TIMEOUT");
  assert.equal(calls, 1); assert.equal(logouts, 0);
  await client.request("me.get");
  assert.equal(calls, 2); assert.equal(logouts, 0);
});

test("the deadline covers a response body stalled after HTTP 200", async () => {
  const client = new HttpClient("http://api.test", async (_url, init) => new Response(new ReadableStream({
    start(controller) { init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), {once:true}); },
  })), 10);
  await assert.rejects(client.request("me.get"), (e: UiError) => e.code === "REQUEST_TIMEOUT");
});

test("caller cancellation retains its reason and is not presented as a read timeout", async () => {
  const controller = new AbortController();
  const reason = new DOMException("Leaving this screen", "AbortError");
  const client = new HttpClient("http://api.test", async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {once:true});
  }), 1000);
  const result = client.request("me.get", {signal:controller.signal});
  controller.abort(reason);
  await assert.rejects(result, e => e === reason);
});

test("writes are not given a read deadline and preserve their idempotency key", async () => {
  let calls = 0;
  const client = new HttpClient("http://api.test", async (_url, init) => {
    calls++; assert.equal(init!.signal, undefined);
    assert.equal((init!.headers as Record<string,string>)["Idempotency-Key"], "same-write");
    await new Promise(resolve => setTimeout(resolve, 30));
    const example = success("polls.create");
    return new Response(JSON.stringify(example.body), {status:example.status});
  }, 10);
  await client.request("polls.create", {key:"same-write",body:{}});
  assert.equal(calls, 1);
});
