// Medya modülünün veri erişim arayüzü — KV-16 (#18). Üretim uygulaması: prisma-store.ts.
import { defaultSettings } from "@kararver/contracts";

export type MediaPurpose = "POLL" | "AVATAR" | "COMMUNITY";
export type MediaStatus = "PENDING" | "APPROVED" | "QUARANTINED" | "REJECTED";

export type MediaRecord = {
  id: string;
  uploaderId: string;
  purpose: MediaPurpose;
  status: MediaStatus;
  originalObjectKey: string;
  processedObjectKey: string | null;
  publicObjectKey: string | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
};

/** Sistem ayarları (KV-40, #42); ayar servisi gelene kadar DEFAULT_MEDIA_SETTINGS. */
export type MediaSettings = { uploadsEnabled: boolean; maxBytes: number; allowedTypes: readonly string[] };

const defaults = defaultSettings().values;
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  // features.uploads'ın resmî varsayılanı yok (KV-04 §5); acil durum anahtarı kapatana kadar açık.
  uploadsEnabled: true,
  maxBytes: defaults["media.maxBytes"] as number,
  allowedTypes: defaults["media.allowedTypes"] as string[],
};

/** Idempotency-Key kapsamı (API_CONTRACTS.md §4.5). */
export type IdempotencyScope = { userId: string; route: string; key: string; requestHash: string; now: Date; ttlMs: number };

export type IdempotentResult =
  | { kind: "created"; resourceId: string }
  | { kind: "replayed"; resourceId: string }
  | { kind: "key_reused" };

export type NewUpload = { uploaderId: string; purpose: MediaPurpose; originalObjectKey: string };

export interface MediaStore {
  createUpload(upload: NewUpload, scope: IdempotencyScope | null): Promise<IdempotentResult>;
  findMedia(id: string): Promise<MediaRecord | null>;
  /** Sadece hâlâ PENDING ise reddeder; worker'ın işlediği kayda dokunmaz. */
  rejectPending(id: string, reason: "TOO_LARGE" | "TYPE_NOT_ALLOWED"): Promise<void>;
}
