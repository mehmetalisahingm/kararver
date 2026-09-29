// MediaView (packages/contracts/src/domains/media.ts). Erişim kuralları: docs/MEDIA_MODERATION.md §7.
import type { MediaStorage } from "./storage.ts";
import type { MediaRecord } from "./store.ts";

/**
 * Public URL sadece APPROVED görselde. Sahibi, incelemedeki görselinin işlenmiş (EXIF'siz) kopyasını
 * kısa ömürlü signed URL ile önizler; orijinal dosya hiçbir zaman URL almaz. REJECTED görsel önizlenmez.
 */
export async function toMediaView(media: MediaRecord, storage: MediaStorage, mediaPublicBaseUrl: string, now: Date) {
  const previewable = (media.status === "PENDING" || media.status === "QUARANTINED") && media.processedObjectKey !== null;
  const preview = previewable ? await storage.presignPrivateRead(media.processedObjectKey!, now) : null;
  return {
    id: media.id,
    purpose: media.purpose,
    status: media.status,
    url: media.status === "APPROVED" && media.publicObjectKey ? `${mediaPublicBaseUrl}/${media.publicObjectKey}` : null,
    preview: preview ? { url: preview.url, expiresAt: preview.expiresAt.toISOString() } : null,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt.toISOString(),
  };
}
