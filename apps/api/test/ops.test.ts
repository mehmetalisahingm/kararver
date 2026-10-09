/**
 * KV-49 (#51) operasyon: /health çalışan sürümü (deploy SHA) gösterir; istek logu IP/port içermez.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createHarness, memoryBackend, type Harness } from "./support/harness.ts";

describe("operasyon: sağlık ve log", () => {
  let h: Harness;
  const previous = process.env.GIT_COMMIT_SHA;
  before(async () => {
    process.env.GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    h = await createHarness(memoryBackend);
  });
  after(async () => {
    if (previous === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = previous;
    await h?.close();
  });

  test("/health çalışan sürümü ve ortamı gösterir (SHA 12 hane)", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().release, { sha: "0123456789ab", env: "test" });
    assert.equal(res.json().status, "ok");
  });

  test("istek logu IP, port ve başlık içermez; istek kimliği, yöntem ve yol vardır", async () => {
    const ip = "203.0.113.77";
    const before = h.logs.length;
    const res = await h.app.inject({ method: "GET", url: "/v1/categories", remoteAddress: ip, headers: { "user-agent": "izleme-testi/1.0" } });
    const lines = h.logs.slice(before).join("\n");
    assert.ok(lines.includes(`"method":"GET"`) && lines.includes(`"url":"/v1/categories"`), lines.slice(0, 300));
    assert.ok(lines.includes(String(res.headers["x-request-id"])), "istek kimliği logda");
    for (const secret of [ip, "remoteAddress", "remotePort", "izleme-testi", "user-agent"]) assert.ok(!lines.includes(secret), `logda ${secret}`);
  });
});
