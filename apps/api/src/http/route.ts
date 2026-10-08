// Endpoint'ler @kararver/contracts registry'sinden kaydedilir: method, path, istek şemaları,
// yetki seviyesi ve cache politikası sözleşmeden gelir; modül sadece handler'ı yazar.
// Böylece uygulama ile docs/API_CONTRACTS.md birbirinden kopamaz.
import { getEndpoint, permissionForEndpoint, type ActionId, type ResourceContext } from "@kararver/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { SessionUser } from "../modules/auth/session.ts";
import { createAccess, LEGACY_RESOURCE_CHECKS, needsResource, type ModerationScope } from "../modules/rbac/access.ts";
import type { RbacStore } from "../modules/rbac/store.ts";
import { ApiError, validationError } from "./errors.ts";

export type RouteContext = {
  request: FastifyRequest;
  reply: FastifyReply;
  body: any;
  params: any;
  query: any;
  /** public endpoint'te oturum yoksa null; user/verified endpoint'te her zaman dolu. */
  viewer: SessionUser | null;
  /**
   * KV-04 tam yetki kararı (KV-12): kaynağın sahibi/topluluğu/hedefi DB'den okunduktan sonra çağrılır.
   * `action` verilmezse endpoint'in işlemi. Kaynak bağlamı gereken endpoint bunu çağırmadan dönemez.
   */
  authorize(resource: ResourceContext, action?: ActionId): Promise<void>;
  /** Moderasyon kuyruğu filtresi: ADMIN+ tümü, MODERATOR atandığı topluluklar (DB'den). */
  moderationScope(): Promise<ModerationScope>;
};

export type RouteResult = { status: number; body: unknown };

export type Authenticator = {
  /** Cookie'deki oturumu çözer; geçersizse null (ve cookie'yi temizler). */
  resolve(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
};

type RouteOptions = {
  validateResponses: boolean;
  /** true: kaynak bağlamı gereken endpoint ctx.authorize çağırmadan dönerse hata; false: sadece loglanır. */
  enforceResourceChecks: boolean;
  authenticator: Authenticator;
  rbac: RbacStore;
  now: () => Date;
  /** Bakım modu (maintenance.enabled, KV-40): açıkken yazma istekleri 503 MAINTENANCE; okuma, giriş/çıkış ve /admin açık kalır. */
  maintenance?: () => Promise<boolean>;
};

/** Bakım modunda da çalışan yazma endpoint'leri: yönetici (modu kapatabilsin) ve oturum açma/kapama. */
const MAINTENANCE_EXEMPT = (id: string) => id.startsWith("admin.") || id === "auth.login" || id === "auth.logout";

function toFastifyPath(path: string): string {
  return `/v1${path}`;
}

function parse(schema: z.ZodType | undefined, value: unknown, location: "body" | "query" | "params"): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value ?? (location === "body" ? undefined : {}));
  if (!result.success) throw validationError(result.error, location);
  return result.data;
}

export function createRouter(app: FastifyInstance, options: RouteOptions) {
  return function route(id: string, handler: (ctx: RouteContext) => Promise<RouteResult>): void {
    const endpoint = getEndpoint(id);
    // Yetki KV-04 kuralıyla verilir (modules/rbac/access.ts); eşlemesi olmayan endpoint kayıtta patlar.
    const action = permissionForEndpoint(id);
    const mustCheckResource = needsResource(action) && !LEGACY_RESOURCE_CHECKS.has(id);

    app.route({
      method: endpoint.method,
      url: toFastifyPath(endpoint.path),
      handler: async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        if (options.maintenance && endpoint.method !== "GET" && !MAINTENANCE_EXEMPT(id) && (await options.maintenance())) {
          throw new ApiError("MAINTENANCE", "Bakım çalışması nedeniyle şu an yeni işlem yapılamıyor. Birazdan tekrar deneyin.");
        }
        const viewer = await options.authenticator.resolve(request, reply);
        const access = createAccess(options.rbac, viewer, action, options.now());
        await access.gate();
        const ctx: RouteContext = {
          request,
          reply,
          params: parse(endpoint.request.params, request.params, "params"),
          query: parse(endpoint.request.query, request.query, "query"),
          body: parse(endpoint.request.body, request.body, "body"),
          viewer,
          authorize: access.authorize,
          moderationScope: access.moderationScope,
        };
        const result = await handler(ctx);
        if (mustCheckResource && !access.resourceChecked && result.status < 400) {
          // Unutulan kaynak kontrolü sessiz izin demektir.
          const message = `${id}: '${action}' kaynak bağlamı ister, handler ctx.authorize çağırmadan döndü`;
          if (options.enforceResourceChecks) throw new Error(message);
          request.log.error({ endpoint: id, action }, message);
        }
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
