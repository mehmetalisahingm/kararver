// Görsel yükleme — sağlayıcı Mert · KV-16 (#18); akış KV-08 (docs/MEDIA_MODERATION.md)
import { z } from "zod";
import { dataOf, Id, IdParams, Timestamp, Url } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

/** KV-08: sadece bu türler; dosya imzası (magic bytes) sunucuda ayrıca kontrol edilir. */
export const AllowedMimeType = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const MediaStatus = z.enum(["PENDING", "APPROVED", "QUARANTINED", "REJECTED"]);
/** COMMUNITY: admin.communities.create/update → imageMediaId için yüklenen görsel. */
export const MediaPurpose = z.enum(["POLL", "AVATAR", "COMMUNITY"]);

/** Sahibine görünen durum. Public URL sadece APPROVED'da; bekleyen görsel 5 dk'lık signed URL ile önizlenir. */
export const MediaView = z.strictObject({
  id: Id,
  purpose: MediaPurpose,
  status: MediaStatus,
  url: Url.nullable(),
  preview: z.strictObject({ url: Url, expiresAt: Timestamp }).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: Timestamp,
});

const media = { owner: "Mert", module: "media" } as const;
const web = ["Ümit (web, KV-18)"];

export const mediaEndpoints = [
  defineEndpoint({
    id: "media.uploads.create",
    domain: "media",
    method: "POST",
    path: "/media/uploads",
    summary: "Presigned upload URL'i (private karantina bucket'ı)",
    auth: "verified",
    provider: media,
    consumers: web,
    unblocks: ["#18", "#20"],
    availability: { status: "ready" },
    request: {
      body: z.strictObject({
        purpose: MediaPurpose,
        mimeType: AllowedMimeType,
        /** Varsayılan üst sınır 8 MB; gerçek sınır /config → media.maxBytes. */
        sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
      }),
    },
    responses: {
      201: dataOf(
        z.strictObject({
          mediaId: Id,
          upload: z.strictObject({
            method: z.literal("PUT"),
            url: Url,
            headers: z.record(z.string(), z.string()),
            expiresAt: Timestamp,
          }),
        }),
      ),
    },
    errors: ["MEDIA_TYPE_NOT_ALLOWED", "MEDIA_TOO_LARGE", "FEATURE_DISABLED", "CONFLICT"],
    idempotency: "key-optional",
    cache: "private",
    notes: [
      "image/gif ve image/svg+xml V1'de 415 MEDIA_TYPE_NOT_ALLOWED (KV-08 §5).",
      "Aynı Idempotency-Key ile tekrar: yükleme hâlâ bekleniyorsa aynı mediaId için yeni URL; işlenmeye başlamışsa 409 CONFLICT (orijinalin üzerine yazılmaz).",
      "Upload URL'i 10 dk geçerlidir; Content-Type ve Content-Length imzaya dahildir, istemci upload.headers'ı aynen gönderir.",
    ],
  }),
  defineEndpoint({
    id: "media.complete",
    domain: "media",
    method: "POST",
    path: "/media/:id/complete",
    summary: "Yükleme bitti; doğrulama ve moderasyon kuyruğa alınır",
    auth: "owner",
    provider: media,
    consumers: web,
    unblocks: ["#18"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 202: dataOf(MediaView) },
    errors: ["MEDIA_TYPE_NOT_ALLOWED", "MEDIA_TOO_LARGE"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Moderasyon hatası/zaman aşımı QUARANTINED sayılır (fail-closed, KV-08 §6.2).",
      "Dosya henüz yüklenmediyse 400 VALIDATION_ERROR (details.code='not_uploaded'); istemci yükleyip tekrar çağırır.",
      "Tekrar çağrı zararsızdır: işlem kuyruğa bir kez alınır, cevap güncel durumdur.",
    ],
  }),
  defineEndpoint({
    id: "media.get",
    domain: "media",
    method: "GET",
    path: "/media/:id",
    summary: "Kendi görselinin durumu (istemci PENDING bitene kadar yoklar)",
    auth: "owner",
    provider: media,
    consumers: web,
    unblocks: ["#18", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(MediaView) },
    errors: [],
    idempotency: "none",
    cache: "private",
  }),
];
