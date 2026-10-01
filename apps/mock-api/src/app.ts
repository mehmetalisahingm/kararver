// KV-06 mock API: @kararver/contracts registry'sindeki her endpoint /v1 altında, cevaplar
// @kararver/contracts/fixtures örneklerinden. İstek sözleşme şemasıyla doğrulanır; iş kuralı,
// oturum ve veri saklama yoktur. Senaryo seçimi: src/scenarios.ts. Üretimde açılmaz.
import { randomUUID } from "node:crypto";
import { endpoints, headers, IdempotencyKey, type EndpointContract } from "@kararver/contracts";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { defaultExample, errorReply, renderScenario, resolveScenario, SCENARIO_HEADER, type MockResponse } from "./scenarios.ts";

export type MockOptions = {
  env?: NodeJS.ProcessEnv;
  /** Verilmezse info seviyesinde stdout; testler false verir. */
  logger?: boolean;
};

export const MOCK_HEADER = "X-Mock";
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const DEFAULT_ORIGINS = "http://127.0.0.1:3000,http://localhost:3000";

export function assertNotProduction(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production" || env.APP_ENV === "production") {
    throw new Error("Mock API production ortamında açılmaz (NODE_ENV/APP_ENV=production)");
  }
}

type Location = "params" | "query" | "body";
type Issue = { path: PropertyKey[]; code: string; message: string };

class MockReply extends Error {
  readonly response: MockResponse;
  constructor(response: MockResponse) {
    super("mock reply");
    this.response = response;
  }
}

function validate(endpoint: EndpointContract, location: Location, value: unknown, requestId: string): void {
  const schema = endpoint.request[location];
  if (!schema) return;
  const result = schema.safeParse(value ?? (location === "body" ? undefined : {}));
  if (result.success) return;
  // apps/api http/errors.ts validationError ile aynı biçim: {field, code, message}
  const details = (result.error.issues as Issue[]).map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join(".") : location,
    code: issue.code,
    message: issue.message,
  }));
  throw new MockReply(errorReply("VALIDATION_ERROR", "İstek geçersiz.", requestId, details));
}

function checkIdempotencyKey(endpoint: EndpointContract, request: FastifyRequest): void {
  if (endpoint.idempotency !== "key-required" && endpoint.idempotency !== "key-optional") return;
  const key = request.headers[headers.idempotencyKey.toLowerCase()];
  if (key === undefined && endpoint.idempotency === "key-optional") return;
  if (typeof key === "string" && IdempotencyKey.safeParse(key).success) return;
  if (endpoint.idempotency === "key-required") {
    throw new MockReply(errorReply("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key başlığı gerekli.", request.id));
  }
  const details = [{ field: headers.idempotencyKey, code: "invalid_format" }];
  throw new MockReply(errorReply("VALIDATION_ERROR", "İstek geçersiz.", request.id, details));
}

function send(reply: FastifyReply, response: MockResponse): FastifyReply {
  reply.headers(response.headers);
  reply.status(response.status);
  return response.body === null ? reply.send() : reply.send(response.body);
}

function cacheControl(endpoint: EndpointContract, status: number): string {
  return endpoint.cache === "public" && status < 300 ? "public, max-age=30" : "private, no-store";
}

export function buildMockApp(options: MockOptions = {}): FastifyInstance {
  const env = options.env ?? process.env;
  assertNotProduction(env);

  for (const endpoint of endpoints) {
    if (!defaultExample(endpoint.id)) throw new Error(`${endpoint.id}: fixtures'ta başarılı örnek yok`);
  }

  const allowedOrigins = new Set(
    (env.MOCK_ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );

  const app = Fastify({
    logger: options.logger === false ? false : { level: "info" },
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers[headers.requestId.toLowerCase()];
      return typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  // Gövdesiz POST (logout, resend) Content-Type: application/json ile gelse de geçerli sayılır.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("Geçersiz JSON"), { statusCode: 400, code: "invalid_json" }), undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(headers.requestId, request.id);
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Expose-Headers", [headers.requestId, headers.retryAfter, MOCK_HEADER].join(", "));
      reply.header("Vary", "Origin");
    }
  });

  // Hata ve 404 dahil her cevap mock olduğunu söyler.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header(MOCK_HEADER, "true");
    return payload;
  });

  app.setErrorHandler((error: FastifyError | MockReply, request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (error instanceof MockReply) return send(reply, error.response);
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      const details = [{ field: "body", code: error.code ?? "invalid_request" }];
      return send(reply, errorReply("VALIDATION_ERROR", "İstek geçersiz.", request.id, details));
    }
    request.log.error({ err: error }, "beklenmeyen hata");
    return send(reply, errorReply("INTERNAL_ERROR", "Beklenmeyen bir hata oluştu.", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    send(reply, errorReply("NOT_FOUND", "İstenen adres bulunamadı.", request.id));
  });

  app.options("/v1/*", async (_request, reply) => {
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
    reply.header(
      "Access-Control-Allow-Headers",
      ["Content-Type", headers.idempotencyKey, headers.requestId, SCENARIO_HEADER].join(", "),
    );
    reply.header("Access-Control-Max-Age", "600");
    return reply.status(204).send();
  });

  for (const endpoint of endpoints) {
    app.route({
      method: endpoint.method,
      url: `/v1${endpoint.path}`,
      handler: async (request, reply) => {
        const header = request.headers[SCENARIO_HEADER.toLowerCase()];
        const resolved = resolveScenario(endpoint, Array.isArray(header) ? header[0] : header);
        if (!resolved.ok) {
          const details = [{ field: SCENARIO_HEADER, code: resolved.code, message: resolved.message }];
          throw new MockReply(errorReply("VALIDATION_ERROR", "Mock senaryosu geçersiz.", request.id, details));
        }
        validate(endpoint, "params", request.params, request.id);
        validate(endpoint, "query", request.query, request.id);
        validate(endpoint, "body", request.body, request.id);
        checkIdempotencyKey(endpoint, request);

        const response = renderScenario(endpoint, resolved.scenario, request.id);
        reply.header("Cache-Control", cacheControl(endpoint, response.status));
        return send(reply, response);
      },
    });
  }

  app.get("/health", async (_request, reply) => reply.header("Cache-Control", "no-store").send({ status: "ok", mock: true }));

  return app;
}
