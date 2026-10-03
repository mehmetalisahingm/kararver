// Real Fastify auth handlers + Argon2 + cookie/session store. Memory persistence,
// no SMTP or PostgreSQL assertion; production database smoke remains separate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness, memoryBackend, tokenFrom, WEB_ORIGIN } from "../../api/test/support/harness.ts";
import { ApiClient } from "../src/lib/api-client.ts";

test("frontend adapter integrates register, email token, login, cookie restore, reset and logout with auth backend", async () => {
  const h = await createHarness(memoryBackend);
  let cookie = "";
  const fetcher = async (url, init) => {
    const headers = { ...init?.headers, origin:WEB_ORIGIN, ...(cookie ? {cookie} : {}) };
    const response = await h.app.inject({ method: init?.method, url: new URL(String(url)).pathname, headers, payload: init?.body });
    const setCookie = response.headers["set-cookie"];
    if (setCookie) cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return new Response(response.statusCode === 204 || !response.body ? null : response.body, {status:response.statusCode});
  };
  const client = new ApiClient("http://api.test",fetcher);
  try {
    assert.equal(await client.restore(),null);
    await client.register("Ümit", "umit.integration@example.test", "a-secure-password", "umit_integration");
    await client.verify("",tokenFrom(h.mails.at(-1)));
    const user = await client.login("umit.integration@example.test","a-secure-password");
    assert.equal(user.verified,true); assert.equal(user.balance,20); assert.equal(user.publishCost,10); assert.ok(cookie.startsWith("kv_session="));
    const restored = await new ApiClient("http://api.test",fetcher).restore();
    assert.equal(restored?.id,user.id); assert.equal(restored?.balance,20); assert.equal(restored?.publishCost,10);
    await client.requestReset("umit.integration@example.test");
    await client.reset("",tokenFrom(h.mails.at(-1)),"a-new-secure-password");
    assert.equal(client.current(),null); assert.equal(await client.restore(),null);
    const relogged = await client.login("umit.integration@example.test","a-new-secure-password");
    assert.equal(relogged.balance,20);
    await client.logout(); assert.equal(await client.restore(),null);
  } finally { await h.close(); }
});
