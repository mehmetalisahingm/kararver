// Bütün domainlerin paylaştığı wire şemaları (docs/API_CONTRACTS.md §4).
import { z } from "zod";
import { errorCodes } from "./errors.ts";

// ─── Temel tipler ─────────────────────────────────────────────

/** UUIDv7 (DATA_MODEL.md §2.1). Sürüm kontrolü sağlayıcıdadır; istemci herhangi bir UUID'yi kabul eder. */
export const Id = z.uuid();
/** UTC ISO-8601, `Z` ile biter. */
export const Timestamp = z.iso.datetime({ offset: false });
/** Europe/Istanbul takvim günü (YYYY-MM-DD). */
export const LocalDate = z.iso.date();
export const Url = z.url();
export const Username = z.string().regex(/^[a-z0-9_]{3,30}$/, "3-30 karakter: küçük harf, rakam, alt çizgi");
export const Percent = z.number().min(0).max(100);
export const Count = z.number().int().min(0);

export const ContentStatus = z.enum(["ACTIVE", "HIDDEN", "UNDER_REVIEW", "LOCKED", "REMOVED"]);
export const UserStatus = z.enum(["ACTIVE", "RESTRICTED", "SUSPENDED", "BANNED"]);
export const Role = z.enum(["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"]);

// ─── Zarf ─────────────────────────────────────────────────────

export const PageInfo = z.strictObject({ nextCursor: z.string().min(1).nullable(), hasMore: z.boolean() });

export const dataOf = <T extends z.ZodType>(item: T) => z.strictObject({ data: item });
export const pageOf = <T extends z.ZodType>(item: T) => z.strictObject({ data: z.array(item), page: PageInfo });

export const ErrorDetail = z.strictObject({
  field: z.string().optional(),
  code: z.string(),
  message: z.string().optional(),
});
export const ErrorBody = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes as [string, ...string[]]),
    message: z.string().min(1),
    details: z.array(z.unknown()),
  }),
  requestId: z.string().min(1),
});

// ─── Sorgu parametreleri ──────────────────────────────────────

/** Cursor pagination (§4.3). Query değerleri string gelir; limit sayıya çevrilir. */
export const CursorQuery = z.strictObject({
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/, "opak base64url cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** KV-07 ölçüm kaynağı; feed ve detay isteklerinde isteğe bağlı. */
export const DiscoverySource = z.enum([
  "direct",
  "organic",
  "featured",
  "search",
  "category",
  "community",
  "notification",
  "share",
]);

export const IdParams = z.strictObject({ id: Id });

// ─── Başlıklar ────────────────────────────────────────────────

export const headers = Object.freeze({
  requestId: "X-Request-Id",
  idempotencyKey: "Idempotency-Key",
  retryAfter: "Retry-After",
  deprecation: "Deprecation",
  sunset: "Sunset",
});

/** Idempotency-Key biçimi: istemci her mantıksal işlem için bir UUID üretir. */
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

// ─── Paylaşılan görünümler ────────────────────────────────────

/** Herkese açık kullanıcı özeti. E-posta ve durum bilgisi asla içermez. */
export const PublicUser = z.strictObject({
  id: Id,
  username: Username,
  displayName: z.string().min(1).max(60),
  avatarUrl: Url.nullable(),
});

export const CategoryRef = z.strictObject({ id: Id, slug: z.string(), name: z.string() });
export const CommunityRef = z.strictObject({ id: Id, slug: z.string(), name: z.string() });

/** Public cevaplarda sadece APPROVED görseller yer alır (KV-08). */
export const MediaRef = z.strictObject({
  id: Id,
  url: Url,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const ReactionValue = z.enum(["LIKE", "DISLIKE"]);
/** Gönderi ve yorum tepkisi özeti (#66, KV-17). `viewer` misafirde null. */
export const ReactionSummary = z.strictObject({
  likes: Count,
  dislikes: Count,
  viewer: ReactionValue.nullable(),
});

export const Empty = z.null();
