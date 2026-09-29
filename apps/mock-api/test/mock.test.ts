// KV-06 mock API testleri: sözleşme uyumu, senaryo seçimi, error:<KOD>, X-Mock başlığı,
// production reddi. Port açmaz (inject); production testi sunucuyu ayrı süreçte dener.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  allErrors,
  endpoints,
  ErrorBody,
  errorCodes,
  errorStatuses,
  getEndpoint,
  permissionForEndpoint,
  type EndpointContract,
} from "@kararver/contracts";
import { examples, type Example } from "@kararver/contracts/fixtures";
import { buildMockApp } from "../src/app.ts";

const app = buildMockApp({ env: {}, logger: false });
after(() => app.close());

const IDEMPOTENCY_KEY = "mock-test-key-0001";

function url(endpoint: EndpointContract, example?: Example): string {
  const params = (example?.request?.params ?? {}) as Record<string, string>;
  const pathname = endpoint.path.replace(/:(\w+)/g, (_, name: string) => {
    assert.ok(params[name], `${endpoint.id}: örnekte :${name} yok`);
    return encodeURIComponent(params[name]);
  });
  const query = new URLSearchParams((example?.request?.query ?? {}) as Record<string, string>).toString();
  return `/v1${pathname}${query ? `?${query}` : ""}`;
}

function call(endpoint: EndpointContract, example: Example | undefined, scenario?: string) {
  const body = example?.request?.body;
  return app.inject({
    method: endpoint.method,
    url: url(endpoint, example),
    headers: {
      "idempotency-key": IDEMPOTENCY_KEY,
      ...(scenario !== undefined ? { "x-mock-scenario": scenario } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

const firstOk = (id: string) => examples.find((x) => x.endpoint === id && x.status < 300)!;

function assertErrorBody(label: string, res: { json(): unknown; headers: Record<string, unknown> }) {
  const parsed = ErrorBody.safeParse(res.json());
  assert.ok(parsed.success, `${label}: hata gövdesi sözleşmeye uymuyor`);
  assert.equal(parsed.data.requestId, res.headers["x-request-id"], `${label}: requestId = X-Request-Id`);
  return parsed.data;
}

describe("varsayılan senaryo (ilk başarılı örnek)", () => {
  for (const endpoint of endpoints.filter((e) => e.availability.status === "ready")) {
    test(`${endpoint.method} ${endpoint.path} · ${endpoint.id}`, async () => {
      const example = firstOk(endpoint.id);
      const res = await call(endpoint, example);
      assert.equal(res.statusCode, example.status);
      assert.equal(res.headers["x-mock"], "true");
      const schema = endpoint.responses[res.statusCode];
      assert.ok(schema, `${endpoint.id}: ${res.statusCode} sözleşmede yok`);
      // Gövdesiz başarı (204, ayrıca şeması z.null() olan 202) boş payload döner.
      const body = res.payload === "" ? null : res.json();
      const parsed = schema.safeParse(body);
      assert.ok(parsed.success, `${endpoint.id}: ${JSON.stringify(parsed.error?.issues)}`);
    });
  }
});

describe("error:<KOD>", () => {
  for (const endpoint of endpoints) {
    test(endpoint.id, async () => {
      const example = firstOk(endpoint.id);
      const allowed = allErrors(endpoint);
      for (const code of allowed) {
        const res = await call(endpoint, example, `error:${code}`);
        const label = `${endpoint.id} error:${code}`;
        assert.equal(res.statusCode, errorStatuses[code], label);
        assert.equal(res.headers["x-mock"], "true", label);
        const body = assertErrorBody(label, res);
        assert.equal(body.error.code, code, label);
        if (code === "RATE_LIMITED") assert.match(String(res.headers["retry-after"]), /^\d+$/, `${label}: Retry-After`);
        if (code === "ACCOUNT_RESTRICTED") {
          assert.deepEqual(body.error.details[0], { code: permissionForEndpoint(endpoint.id) }, `${label}: kısıtlanan işlem`);
        }
      }
      for (const code of errorCodes.filter((c) => !allowed.includes(c))) {
        const res = await call(endpoint, example, `error:${code}`);
        assert.equal(res.statusCode, 400, `${endpoint.id} error:${code} listede yok → 400`);
        const body = assertErrorBody(`${endpoint.id} error:${code}`, res);
        assert.equal(body.error.code, "VALIDATION_ERROR");
        assert.equal((body.error.details[0] as { code: string }).code, "error_not_in_contract");
      }
      const unknown = await call(endpoint, example, "error:NOT_A_CODE");
      assert.equal(unknown.statusCode, 400);
    });
  }
});

describe("adlı senaryolar", () => {
  test("X-Mock-Scenario örnek adına eşlenir", async () => {
    const e = getEndpoint("polls.get");
    const res = await call(e, firstOk(e.id), "voter-visible");
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { data: { results: { visible: boolean } } }).data.results.visible, true);
  });

  test("tarihli trend senaryosu", async () => {
    const e = getEndpoint("trends.list");
    const example = examples.find((x) => x.endpoint === e.id && x.name === "daily-rising")!;
    const res = await call(e, example, "daily-rising");
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { meta: { format: string } }).meta.format, "DAILY_RISING");
  });

  test("hata örneği contracts yardımcısıyla, isteğin requestId'siyle döner", async () => {
    const e = getEndpoint("votes.put");
    const res = await call(e, firstOk(e.id), "unverified");
    assert.equal(res.statusCode, 403);
    const body = assertErrorBody("votes.put unverified", res);
    assert.equal(body.error.code, "EMAIL_NOT_VERIFIED");
    assert.notEqual(body.requestId, "req_01998b9a00007000", "fixture'ın sabit requestId'si sızmamalı");
  });

  test("Retry-After taşıyan örnek (PUBLISH_COOLDOWN)", async () => {
    const e = getEndpoint("polls.create");
    const res = await call(e, firstOk(e.id), "cooldown");
    assert.equal(res.statusCode, 429);
    assert.match(String(res.headers["retry-after"]), /^\d+$/);
  });

  test("bilinmeyen senaryo 400", async () => {
    const e = getEndpoint("polls.get");
    const res = await call(e, firstOk(e.id), "yok-boyle-bir-senaryo");
    assert.equal(res.statusCode, 400);
    const body = assertErrorBody("unknown", res);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(
      [(body.error.details[0] as { field: string }).field, (body.error.details[0] as { code: string }).code],
      ["X-Mock-Scenario", "unknown_scenario"],
    );
  });
});

describe("istek doğrulama", () => {
  test("hatalı gövde sözleşme hata formatıyla 400", async () => {
    const e = getEndpoint("votes.put");
    const example = firstOk(e.id);
    const res = await call(e, { ...example, request: { ...example.request, body: { optionId: "x" } } });
    assert.equal(res.statusCode, 400);
    const body = assertErrorBody("votes.put body", res);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.equal((body.error.details[0] as { field: string }).field, "optionId");
  });

  test("hatalı path parametresi 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/polls/uuid-degil" });
    assert.equal(res.statusCode, 400);
    assert.equal(assertErrorBody("params", res).error.code, "VALIDATION_ERROR");
  });

  test("hatalı query 400 (limit > 100)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/feed?limit=500" });
    assert.equal(res.statusCode, 400);
    assert.equal(assertErrorBody("query", res).error.code, "VALIDATION_ERROR");
  });

  test("bozuk JSON 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { "content-type": "application/json" }, payload: "{" });
    assert.equal(res.statusCode, 400);
    assert.equal(assertErrorBody("json", res).error.code, "VALIDATION_ERROR");
  });

  test("key zorunlu endpoint'te Idempotency-Key yoksa 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const example = firstOk("polls.create");
    const res = await app.inject({ method: "POST", url: "/v1/polls", headers: { "content-type": "application/json" }, payload: JSON.stringify(example.request!.body) });
    assert.equal(res.statusCode, 400);
    assert.equal(assertErrorBody("idempotency", res).error.code, "IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("başlıklar", () => {
  test("X-Mock: true bilinmeyen adreste de var", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/yok" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["x-mock"], "true");
    assert.equal(assertErrorBody("404", res).error.code, "NOT_FOUND");
  });

  test("gelen geçerli X-Request-Id korunur", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/config", headers: { "x-request-id": "req_test_12345" } });
    assert.equal(res.headers["x-request-id"], "req_test_12345");
  });

  test("CORS: izinli origin preflight'ı geçer, diğeri başlık almaz", async () => {
    const ok = await app.inject({ method: "OPTIONS", url: "/v1/polls", headers: { origin: "http://127.0.0.1:3000", "access-control-request-method": "POST" } });
    assert.equal(ok.statusCode, 204);
    assert.equal(ok.headers["access-control-allow-origin"], "http://127.0.0.1:3000");
    assert.match(String(ok.headers["access-control-allow-headers"]), /X-Mock-Scenario/);
    const other = await app.inject({ method: "GET", url: "/v1/config", headers: { origin: "https://kotu.example" } });
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });
});

describe("production reddi", () => {
  test("NODE_ENV=production veya APP_ENV=production ile uygulama kurulmaz", () => {
    assert.throws(() => buildMockApp({ env: { NODE_ENV: "production" }, logger: false }), /production/);
    assert.throws(() => buildMockApp({ env: { APP_ENV: "production" }, logger: false }), /production/);
  });

  test("sunucu NODE_ENV=production ile açılmayı reddeder", () => {
    const server = path.resolve(import.meta.dirname, "../src/server.ts");
    const result = spawnSync(process.execPath, [server], {
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.notEqual(result.status, 0, "süreç hata koduyla çıkmalı");
    assert.match(result.stderr, /production ortamında açılmaz/);
  });
});
