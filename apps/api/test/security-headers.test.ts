/**
 * API güvenlik başlıkları: her cevapta (başarılı, hata, 404, geçersiz JSON, CORS preflight, CSRF reddi)
 * aynı katı set bulunur. HSTS yalnız güvenli cookie (HTTPS ortamı) açıkken gönderilir.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Fastify from "fastify";
import { HSTS, registerSecurity, SECURITY_HEADERS } from "../src/http/security.ts";
import { createHarness, memoryBackend, WEB_ORIGIN, type Harness } from "./support/harness.ts";

type Res = { statusCode: number; headers: Record<string, unknown>; body: string };

function assertSecurityHeaders(res: Res, label: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers[name.toLowerCase()], value, `${label}: ${name}`);
  }
}

describe("API güvenlik başlıkları", () => {
  let h: Harness;
  before(async () => {
    h = await createHarness(memoryBackend);
  });
  after(async () => {
    await h.close();
  });

  test("beklenen değerler", () => {
    assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
    assert.match(SECURITY_HEADERS["Content-Security-Policy"]!, /default-src 'none'/);
    assert.match(SECURITY_HEADERS["Content-Security-Policy"]!, /frame-ancestors 'none'/);
  });

  test("başarılı, hata, 404, geçersiz JSON, preflight ve CSRF cevaplarının hepsinde var", async () => {
    const cases: [string, Res, number][] = [
      ["health", await h.app.inject({ method: "GET", url: "/health" }), 200],
      ["401", await h.app.inject({ method: "GET", url: "/v1/me" }), 401],
      ["404", await h.app.inject({ method: "GET", url: "/v1/yok" }), 404],
      [
        "geçersiz JSON",
        await h.app.inject({ method: "POST", url: "/v1/auth/login", headers: { "content-type": "application/json" }, payload: "{" }),
        400,
      ],
      [
        "preflight",
        await h.app.inject({
          method: "OPTIONS",
          url: "/v1/auth/login",
          headers: { origin: WEB_ORIGIN, "access-control-request-method": "POST" },
        }),
        204,
      ],
      [
        "reddedilen preflight",
        await h.app.inject({
          method: "OPTIONS",
          url: "/v1/auth/login",
          headers: { origin: "https://kotu.example", "access-control-request-method": "POST" },
        }),
        403,
      ],
      ["CSRF", await h.app.inject({ method: "POST", url: "/v1/auth/logout", headers: { origin: "https://kotu.example" } }), 403],
    ];
    for (const [label, res, status] of cases) {
      assert.equal(res.statusCode, status, `${label}: ${res.body}`);
      assertSecurityHeaders(res, label);
      // Test ortamında güvenli cookie kapalı: HSTS yok.
      assert.equal(res.headers["strict-transport-security"], undefined, label);
    }
  });
});

describe("HSTS", () => {
  async function probe(hsts: boolean) {
    const app = Fastify();
    registerSecurity(app, [WEB_ORIGIN], { hsts });
    app.get("/x", async () => ({ ok: true }));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/x" });
    const missing = await app.inject({ method: "GET", url: "/yok" });
    await app.close();
    return [res, missing];
  }

  test("güvenli ortamda her cevapta, değilse hiç", async () => {
    for (const res of await probe(true)) {
      assert.equal(res.headers["strict-transport-security"], HSTS);
      assertSecurityHeaders(res, "hsts");
    }
    for (const res of await probe(false)) assert.equal(res.headers["strict-transport-security"], undefined);
  });
});
