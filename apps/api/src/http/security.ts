// CORS allowlist ve CSRF koruması (TECH_DECISIONS.md §3.4, FOUNDATION_CONTRACTS.md "Wire formatı").
// Oturum cookie'si SameSite=Lax'tır; durum değiştiren isteklerde ayrıca Origin doğrulanır.
// Ortak güvenlik katmanı KV-12'de (Utku) genişleyebilir; bu dosya auth'un ihtiyaç duyduğu asgari kısımdır.
//
// Güvenlik başlıkları (her cevapta: hata ve 404 dahil). API yalnız JSON döner, hiçbir zaman sayfa olarak
// yüklenmez veya çerçevelenmez; bu yüzden en katı set kullanılır. Web'in (Next.js) başlıkları ayrıdır (Ümit).
import { errorResponse, headers } from "@kararver/contracts";
import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";
const ALLOWED_HEADERS = `Content-Type, ${headers.idempotencyKey}, ${headers.requestId}`;
const EXPOSED_HEADERS = `${headers.requestId}, ${headers.retryAfter}`;

/** JSON API için sabit güvenlik başlıkları. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // Tarayıcı içerik türünü tahmin etmesin (JSON'u HTML/script sanmasın).
  "X-Content-Type-Options": "nosniff",
  // Hiçbir sayfa API cevabını çerçeveleyemez (eski tarayıcılar için; yenileri CSP frame-ancestors'a bakar).
  "X-Frame-Options": "DENY",
  // Cevap bir belge olarak açılsa bile hiçbir kaynak yüklenemez, çerçevelenemez, form gönderilemez.
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  // API adresleri (ör. paylaşım/doğrulama token'ı içeren yollar) başka sitelere Referer ile sızmaz.
  "Referrer-Policy": "no-referrer",
});

/** Sadece HTTPS ortamında (güvenli cookie açıkken): 1 yıl, alt alan adları dahil. */
export const HSTS = "max-age=31536000; includeSubDomains";

export function registerSecurity(app: FastifyInstance, allowedOrigins: readonly string[], options: { hsts: boolean } = { hsts: false }): void {
  const allowed = new Set(allowedOrigins);

  app.addHook("onRequest", async (request, reply) => {
    reply.headers(SECURITY_HEADERS);
    if (options.hsts) reply.header("Strict-Transport-Security", HSTS);
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
