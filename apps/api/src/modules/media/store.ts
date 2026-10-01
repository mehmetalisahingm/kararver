// Medya modülünün veri erişim arayüzü — KV-16 (#18). Üretim uygulaması: prisma-store.ts.
import { defaultSettings } from "@kararver/contracts";
import type { ModerationScope } from "../rbac/access.ts";

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

export type ReviewStatus = "QUARANTINED" | "REJECTED" | "PENDING";
/** Moderatör kararı için okunan kayıt; communityId yetki kapsamını belirler (yoksa yalnız ADMIN+). */
export type ReviewableMedia = MediaRecord & { communityId: string | null };

export type MediaDecisionInput = {
  id: string;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
  now: Date;
};
export type MediaDecisionResult =
  | { kind: "applied" | "unchanged"; media: MediaRecord }
  | { kind: "conflict"; status: MediaStatus; reason: "not_reviewable" | "no_processed_copy" }
  | { kind: "not_found" };

export interface MediaStore {
  createUpload(upload: NewUpload, scope: IdempotencyScope | null): Promise<IdempotentResult>;
  findMedia(id: string): Promise<MediaRecord | null>;
  /** Sadece hâlâ PENDING ise reddeder; worker'ın işlediği kayda dokunmaz. */
  rejectPending(id: string, reason: "TOO_LARGE" | "TYPE_NOT_ALLOWED"): Promise<void>;

  /** Moderasyon kuyruğu (en eski önce). Moderatör yalnız atandığı toplulukların görsellerini görür. */
  listForReview(
    filter: { status: ReviewStatus; scope: ModerationScope; after: { createdAt: Date; id: string } | null },
    limit: number,
  ): Promise<MediaRecord[]>;
  findForReview(id: string): Promise<ReviewableMedia | null>;
  /**
   * Kararı kilitli okumayla uygular ve `moderation_actions`'a yazar. APPROVE: QUARANTINED/REJECTED → APPROVED
   * (işlenmiş kopya gerekir). REJECT: QUARANTINED/APPROVED → REJECTED, public anahtar aynı UPDATE'te boşalır ve
   * görselin açık raporları ACTIONED olur. Zaten o durumdaysa "unchanged" (idempotent).
   */
  applyDecision(input: MediaDecisionInput): Promise<MediaDecisionResult>;
}
