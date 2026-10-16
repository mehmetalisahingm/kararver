import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { ErrorBody } from "@kararver/contracts";
import { registerErrorHandling } from "../src/http/errors.ts";
import { registerSecurity } from "../src/http/security.ts";
import { registerPublicMediaRoutes } from "../src/modules/media/public-routes.ts";

const id = "018f1234-1234-7123-8123-123456789abc";
const key = `m/${id}.webp`;
const path = `/media-public/${key}`;

async function fixture(options: { key?: string | null; read?: () => Promise<Buffer | null> } = {}) {
  const app = Fastify({ logger: false });
  registerSecurity(app, ["https://web.test"]);
  registerErrorHandling(app);
  const state = { key: options.key === undefined ? key : options.key, dbReads: 0, storageReads: 0 };
  registerPublicMediaRoutes(app, {
    store: { async findPublicKey(actualId) { assert.equal(actualId, id); state.dbReads++; return state.key; } },
    storage: { async readPublic(actualKey) { assert.equal(actualKey, key); state.storageReads++; return options.read ? options.read() : Buffer.from("RIFFtestWEBP"); } },
  });
  return { app, state };
}

test("guest reads only approved WebP bytes; no signed URL/cookie, no-store, HEAD is safe", async t => {
  const { app, state } = await fixture(); t.after(() => app.close());
  const r = await app.inject({ url: path });
  assert.equal(r.statusCode, 200); assert.equal(r.headers["content-type"], "image/webp");
  assert.match(String(r.headers["cache-control"]), /no-store/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["set-cookie"], undefined); assert.equal(r.headers.location, undefined);
  assert.equal(r.body, "RIFFtestWEBP"); assert.equal(state.dbReads, 2);
  const head = await app.inject({ method: "HEAD", url: path });
  assert.equal(head.statusCode, 200); assert.equal(head.body, "");
});

test("pending/rejected/removed or erased media is 404 without reading storage", async t => {
  const { app, state } = await fixture({ key: null }); t.after(() => app.close());
  const r = await app.inject({ url: path });
  assert.equal(r.statusCode, 404); assert.match(String(r.headers["cache-control"]), /no-store/);
  assert.equal(state.storageReads, 0); ErrorBody.parse(r.json());
});

test("original/export keys, malformed ids, other object keys never reach storage", async t => {
  const { app, state } = await fixture(); t.after(() => app.close());
  for (const url of ["/media-public/m/original", "/media-public/uploads/x/original", "/media-public/m/../private", path + ".svg", path.replace(".webp", ".png")]) {
    assert.equal((await app.inject({ url })).statusCode, 404);
  }
  assert.equal(state.dbReads, 0); assert.equal(state.storageReads, 0);
});

test("DB key mismatch cannot read a private object", async t => {
  const { app, state } = await fixture({ key: "exports/private.enc" }); t.after(() => app.close());
  assert.equal((await app.inject({ url: path })).statusCode, 404);
  assert.equal(state.storageReads, 0);
});

test("concurrent moderation removal is rechecked after storage read", async t => {
  const f = await fixture({ read: async () => { f.state.key = null; return Buffer.from("RIFFtestWEBP"); } });
  t.after(() => f.app.close());
  assert.equal((await f.app.inject({ url: path })).statusCode, 404);
  assert.equal(f.state.dbReads, 2);
});

test("storage outage returns sanitized retryable response; next request can recover", async t => {
  let failing = true;
  const { app } = await fixture({ read: async () => { if (failing) throw new Error("https://private/?X-Amz-Signature=secret"); return Buffer.from("RIFFtestWEBP"); } });
  t.after(() => app.close());
  const r = await app.inject({ url: path });
  assert.equal(r.statusCode, 503); assert.equal(r.headers["retry-after"], "5");
  assert.match(String(r.headers["cache-control"]), /no-store/); assert.doesNotMatch(r.body, /secret|Signature|private/);
  ErrorBody.parse(r.json());
  failing = false; assert.equal((await app.inject({ url: path })).statusCode, 200);
});

test("missing approved copy returns 404", async t => {
  const { app } = await fixture({ read: async () => null }); t.after(() => app.close());
  assert.equal((await app.inject({ url: path })).statusCode, 404);
});
