import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/lib/api-client.ts";

const me = {
  id: "019b1234-5678-7abc-8def-0123456789ab",
  username: "puan_test",
  displayName: "Puan Test",
  email: "puan@example.test",
  emailVerified: true,
  avatarUrl: null,
  bio: null,
  status: "ACTIVE",
  roles: ["USER"],
  createdAt: "2026-10-03T18:00:00.000Z",
};

test("gerçek login sonrası bakiye ve yayın maliyeti points.get ile hydrate edilir", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/auth/login")) {
      return new Response(JSON.stringify({ data: me }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/v1/me/points")) {
      return new Response(JSON.stringify({ data: { balance: 20, publishCost: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "yok", details: [] } }), { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const client = new ApiClient("https://api.example.test", fetcher);
  const user = await client.login(me.email, "guclu-bir-sifre-1");

  assert.equal(user.balance, 20);
  assert.equal(user.publishCost, 10);
  assert.equal(client.current()?.balance, 20);
  assert.deepEqual(calls, [
    "https://api.example.test/v1/auth/login",
    "https://api.example.test/v1/me/points",
  ]);
});
