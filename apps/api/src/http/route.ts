// Endpoint'ler @kararver/contracts registry'sinden kaydedilir: method, path, istek şemaları,
// yetki seviyesi ve cache politikası sözleşmeden gelir; modül sadece handler'ı yazar.
// Böylece uygulama ile docs/API_CONTRACTS.md birbirinden kopamaz.
import { getEndpoint, type EndpointContract } from "@kararver/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { SessionUser } from "../modules/auth/session.ts";
import { ApiError, validationError } from "./errors.ts";

export type RouteContext = {
  request: FastifyRequest;
  reply: FastifyReply;
  body: any;
  params: any;
  query: any;
  /** public endpoint'te oturum yoksa null; user/verified endpoint'te her zaman dolu. */
  viewer: SessionUser | null;
};

export type RouteResult = { status: number; body: unknown };

export type Authenticator = {
  /** Cookie'deki oturumu çözer; geçersizse null (ve cookie'yi temizler). */
  resolve(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
};

type RouteOptions = { validateResponses: boolean; authenticator: Authenticator };

const SUPPORTED_AUTH = new Set(["public", "user", "verified"]);
const RESTRICTED = new Set(["BANNED", "SUSPENDED"]);

function toFastifyPath(path: string): string {
  return `/v1${path}`;
}

function parse(schema: z.ZodType | undefined, value: unknown, location: "body" | "query" | "params"): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value ?? (location === "body" ? undefined : {}));
  if (!result.success) throw validationError(result.error, location);
  return result.data;
}

function authorize(endpoint: EndpointContract, viewer: SessionUser | null): void {
  if (endpoint.auth === "public") return;
  if (!viewer) throw new ApiError("UNAUTHENTICATED", "Giriş yapmanız gerekiyor.");
  if (RESTRICTED.has(viewer.status)) {
    throw new ApiError("ACCOUNT_RESTRICTED", "Hesabınız bu işlem için kısıtlı.", [{ code: endpoint.id }]);
  }
  if (endpoint.auth === "verified" && !viewer.emailVerified) {
    throw new ApiError("EMAIL_NOT_VERIFIED", "Önce e-postanızı doğrulayın.");
  }
}

export function createRouter(app: FastifyInstance, options: RouteOptions) {
  return function route(id: string, handler: (ctx: RouteContext) => Promise<RouteResult>): void {
    const endpoint = getEndpoint(id);
    if (!SUPPORTED_AUTH.has(endpoint.auth)) {
      // owner/moderator/admin kontrolleri ortak RBAC katmanıyla gelir (KV-12, #14).
      throw new Error(`${id}: '${endpoint.auth}' yetki seviyesi henüz desteklenmiyor (KV-12)`);
    }

    app.route({
      method: endpoint.method,
      url: toFastifyPath(endpoint.path),
      handler: async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        const viewer = await options.authenticator.resolve(request, reply);
        authorize(endpoint, viewer);
        const ctx: RouteContext = {
          request,
          reply,
          params: parse(endpoint.request.params, request.params, "params"),
          query: parse(endpoint.request.query, request.query, "query"),
          body: parse(endpoint.request.body, request.body, "body"),
          viewer,
        };
        const result = await handler(ctx);
        const schema = endpoint.responses[result.status];
        if (!schema) throw new Error(`${id}: sözleşmede olmayan status ${result.status}`);
        if (options.validateResponses) {
          const check = schema.safeParse(result.body);
          if (!check.success) {
            throw new Error(`${id}: cevap sözleşmeye uymuyor → ${check.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
          }
        }
        if (result.body === null) return reply.status(result.status).send();
        return reply.status(result.status).send(result.body);
      },
    });
  };
}

export type Route = ReturnType<typeof createRouter>;
