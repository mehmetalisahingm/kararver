// Görsel yükleme endpoint'leri — KV-16 (#18). Sözleşme: packages/contracts/src/domains/media.ts
// Akış: POST /media/uploads (presigned PUT, private bucket) → istemci yükler → POST /media/:id/complete
// (nesne yoklanır, media.process kuyruğa alınır) → worker işler → GET /media/:id durum.
// Admin inceleme endpoint'leri (admin.media.list/decide) moderator yetkisi gelince eklenir (KV-12, #14).
import { createHash, randomUUID } from "node:crypto";
import { headers, IdempotencyKey } from "@kararver/contracts";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { MediaQueue } from "./queue.ts";
import type { MediaStorage } from "./storage.ts";
import type { IdempotencyScope, MediaSettings, MediaStore } from "./store.ts";
import { toMediaView } from "./view.ts";

export type MediaDeps = {
  store: MediaStore;
  storage: MediaStorage;
  queue: MediaQueue;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<MediaSettings>;
};

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function idempotencyScope(request: FastifyRequest, userId: string, body: unknown, now: Date): IdempotencyScope | null {
  const raw = request.headers[headers.idempotencyKey.toLowerCase()];
  if (raw === undefined) return null;
  const key = IdempotencyKey.safeParse(raw);
  if (!key.success) {
    throw new ApiError("VALIDATION_ERROR", "Idempotency-Key geçersiz.", [{ field: headers.idempotencyKey, code: "invalid_format" }]);
  }
  const requestHash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  return { userId, route: "media.uploads.create", key: key.data, requestHash, now, ttlMs: IDEMPOTENCY_TTL_MS };
}

function tooLarge(maxBytes: number): ApiError {
  return new ApiError("MEDIA_TOO_LARGE", `Görsel en fazla ${Math.floor(maxBytes / (1024 * 1024))} MB olabilir.`, [
    { field: "sizeBytes", code: "too_large", maxBytes },
  ]);
}

function typeNotAllowed(allowed: readonly string[]): ApiError {
  return new ApiError("MEDIA_TYPE_NOT_ALLOWED", "Bu dosya türü desteklenmiyor.", [{ field: "mimeType", code: "not_allowed", allowed }]);
}

export function registerMediaRoutes(route: Route, deps: MediaDeps): void {
  const { store, storage, queue, now } = deps;

  /** Başkasının görseli 403, olmayan görsel 404 (polls modülüyle aynı kural). */
  async function ownedMedia(id: string, viewerId: string) {
    const media = await store.findMedia(id);
    if (!media) throw new ApiError("NOT_FOUND", "Görsel bulunamadı.");
    if (media.uploaderId !== viewerId) throw new ApiError("FORBIDDEN", "Bu görsel size ait değil.");
    return media;
  }

  const view = (media: Parameters<typeof toMediaView>[0]) => toMediaView(media, storage, deps.mediaPublicBaseUrl, now());

  route("media.uploads.create", async ({ body, viewer, request, authorize }) => {
    // KV-04/KV-12: RESTRICT_POSTING içerik görsellerini (POLL/COMMUNITY) engeller;
    // hesap bakımı olan AVATAR yüklemesi muaf kalır. Amaç request şemasından doğrulanmış değerdir.
    await authorize({ mediaPurpose: body.purpose });

    const settings = await deps.settings();
    if (!settings.uploadsEnabled) throw new ApiError("FEATURE_DISABLED", "Görsel yükleme geçici olarak kapalı.");
    if (!settings.allowedTypes.includes(body.mimeType)) throw typeNotAllowed(settings.allowedTypes);
    if (body.sizeBytes > settings.maxBytes) throw tooLarge(settings.maxBytes);

    const result = await store.createUpload(
      { uploaderId: viewer!.id, purpose: body.purpose, originalObjectKey: `uploads/${randomUUID()}/original` },
      idempotencyScope(request, viewer!.id, body, now()),
    );
    if (result.kind === "key_reused") {
      throw new ApiError("IDEMPOTENCY_KEY_REUSED", "Bu Idempotency-Key farklı bir istekle kullanılmış.");
    }
    const media = (await store.findMedia(result.resourceId))!;
    // Tekrar isteğinde yeni URL sadece yükleme hâlâ beklenirken verilir; işlenmiş orijinalin üzerine yazılamaz.
    if (media.status !== "PENDING" || media.processedObjectKey !== null) {
      throw new ApiError("CONFLICT", "Bu yükleme zaten tamamlandı.", [{ field: headers.idempotencyKey, code: "already_completed" }]);
    }
    const upload = await storage.presignUpload(media.originalObjectKey, { contentType: body.mimeType, sizeBytes: body.sizeBytes }, now());
    return {
      status: 201,
      body: { data: { mediaId: media.id, upload: { method: "PUT", url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } } },
    };
  });

  route("media.complete", async ({ params, viewer, authorize }) => {
    const media = await ownedMedia(params.id, viewer!.id);
    // Tamamlama anında yaptırım değişmiş olabilir; her istekte tekrar DB'den okunan RBAC kararı uygulanır.
    await authorize({ ownerId: media.uploaderId, mediaPurpose: media.purpose });

    if (media.status === "PENDING" && media.processedObjectKey === null) {
      const object = await storage.headPrivate(media.originalObjectKey);
      if (!object) {
        throw new ApiError("VALIDATION_ERROR", "Dosya henüz yüklenmemiş.", [{ field: "upload", code: "not_uploaded" }]);
      }
      // İmzalı URL boyut ve türü zaten sabitler; storage bunu uygulamazsa burada yakalanır.
      const settings = await deps.settings();
      if (object.sizeBytes > settings.maxBytes) {
        await store.rejectPending(media.id, "TOO_LARGE");
        throw tooLarge(settings.maxBytes);
      }
      if (!object.contentType || !settings.allowedTypes.includes(object.contentType)) {
        await store.rejectPending(media.id, "TYPE_NOT_ALLOWED");
        throw typeNotAllowed(settings.allowedTypes);
      }
      await queue.enqueueProcessing(media.id);
    }
    return { status: 202, body: { data: await view((await store.findMedia(media.id))!) } };
  });

  route("media.get", async ({ params, viewer }) => ({
    status: 200,
    body: { data: await view(await ownedMedia(params.id, viewer!.id)) },
  }));
}
