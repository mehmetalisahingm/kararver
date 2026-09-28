// CORS allowlist ve CSRF koruması (TECH_DECISIONS.md §3.4, FOUNDATION_CONTRACTS.md "Wire formatı").
// Oturum cookie'si SameSite=Lax'tır; durum değiştiren isteklerde ayrıca Origin doğrulanır.
// Ortak güvenlik katmanı KV-12'de (Utku) genişleyebilir; bu dosya auth'un ihtiyaç duyduğu asgari kısımdır.
import { errorResponse, headers } from "@kararver/contracts";
import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";
const ALLOWED_HEADERS = `Content-Type, ${headers.idempotencyKey}, ${headers.requestId}`;
const EXPOSED_HEADERS = `${headers.requestId}, ${headers.retryAfter}`;

export function registerSecurity(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const originAllowed = origin !== undefined && allowed.has(origin);

    if (originAllowed) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    reply.header("Vary", "Origin");

    if (request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
      if (!originAllowed) return reply.status(403).send();
      reply.header("Access-Control-Allow-Methods", ALLOWED_METHODS);
      reply.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      reply.header("Access-Control-Max-Age", "600");
      return reply.status(204).send();
    }

    if (SAFE_METHODS.has(request.method)) return;
    // Tarayıcılar POST/PUT/PATCH/DELETE isteklerinde Origin gönderir. Origin'i olmayan istekler
    // tarayıcı dışı istemcilerdir (curl, testler); tarayıcı cross-site olduğunu söylüyorsa reddedilir.
    const crossSite = origin !== undefined ? !originAllowed : request.headers["sec-fetch-site"] === "cross-site";
    if (crossSite) {
      return reply
        .status(403)
        .header("Cache-Control", "private, no-store")
        .send(errorResponse("FORBIDDEN", "İstek kaynağı doğrulanamadı.", request.id, [{ field: "origin", code: "origin_not_allowed" }]));
    }
  });
}
