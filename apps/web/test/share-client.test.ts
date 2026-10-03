import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createShareLink } from "../src/lib/share-client.ts";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe("KV-25 share client", () => {
  test("shares.create endpointine yalnız poll id ve kanal gönderir", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    const pollId = "019b1234-5678-7abc-8def-0123456789ab";
    const shareId = "019b2234-5678-7abc-8def-0123456789ab";
    let seen: { url: string; init?: RequestInit } | null = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(input), init };
      return new Response(JSON.stringify({
        data: {
          shareId,
          url: `https://kararver.example/karar/ornek-anket-abcd1234?src=${shareId}`,
        },
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const result = await createShareLink(pollId, "whatsapp");
    assert.equal(result.shareId, shareId);
    assert.equal(result.url, `https://kararver.example/karar/ornek-anket-abcd1234?src=${shareId}`);
    assert.ok(seen);
    assert.equal(seen!.url, `https://api.example.test/v1/polls/${pollId}/shares`);
    assert.equal(seen!.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(seen!.init?.body)), { channel: "whatsapp" });
  });
});
