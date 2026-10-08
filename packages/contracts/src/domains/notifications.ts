// Bildirimler — sağlayıcı Utku · KV-21 (#23), KV-34 (#36); tüketici Mehmet KV-35 (#37)
import { z } from "zod";
import { ContentStatus, Count, CursorQuery, dataOf, Id, pageOf, PublicUser, Timestamp } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";
import { SanctionType } from "./admin.ts";
import { TrendFormat } from "./discovery.ts";
import { ModerationAction } from "./moderation.ts";

/** Açık enum (API_CONTRACTS §5): istemci bilinmeyen tipi genel gösterir. Yeni değer sona eklenir (DB enum'u aynı sırada). */
export const NotificationType = z.enum([
  "COMMENT_ON_POLL",
  "REPLY_TO_COMMENT",
  "ALTERNATIVE_ON_POLL",
  "POLL_MILESTONE",
  "POLL_TRENDING",
  "POLL_CLOSED",
  "DECISION_UPDATED",
  "MODERATION_APPLIED",
  "COMMUNITY_FEATURED",
  "SANCTION_APPLIED",
  "ANNOUNCEMENT_PUBLISHED",
]);
export type NotificationType = z.infer<typeof NotificationType>;

/** Kullanıcının kapatamayacağı tipler (KV-34 tercihleri ve anket sessizi bunlara uygulanmaz). */
export const MANDATORY_NOTIFICATION_TYPES: readonly NotificationType[] = Object.freeze(["MODERATION_APPLIED", "SANCTION_APPLIED"]);

/** Oy kilometre taşları (KV-21 §4): yalnız anket sahibine. Üretici (poll.milestone) ve bildirim tüketicisi aynı listeyi kullanır. */
export const POLL_MILESTONES: readonly number[] = Object.freeze([10, 50, 100, 500, 1000, 5000, 10000]);

/**
 * Tipe göre `NotificationView.data` (KV-21 PR-3). Küçük, düz alanlar; oy seçimi, serbest metin (gerekçe, yorum) ve kişisel
 * veri yoktur. `NotificationView.data` genel kayıt olarak kalır; istemci tipe göre bu şemalarla okur.
 */
export const notificationData = Object.freeze({
  COMMENT_ON_POLL: z.strictObject({}),
  REPLY_TO_COMMENT: z.strictObject({ parentId: Id }),
  ALTERNATIVE_ON_POLL: z.strictObject({}),
  POLL_MILESTONE: z.strictObject({ metric: z.enum(["VOTES"]), milestone: z.number().int().positive() }),
  POLL_TRENDING: z.strictObject({ format: TrendFormat, rank: z.number().int().min(1) }),
  POLL_CLOSED: z.strictObject({ reason: z.enum(["EXPIRED", "OWNER"]) }),
  DECISION_UPDATED: z.strictObject({ first: z.boolean() }),
  MODERATION_APPLIED: z.strictObject({ action: ModerationAction, toStatus: ContentStatus }),
  COMMUNITY_FEATURED: z.strictObject({ communityId: Id }),
  ANNOUNCEMENT_PUBLISHED: z.strictObject({ level: z.enum(["INFO", "WARNING"]) }),
  SANCTION_APPLIED: z.strictObject({ sanctionType: SanctionType.extract(["WARNING", "RESTRICT_COMMENTS", "RESTRICT_POSTING"]), endsAt: Timestamp.nullable() }),
} satisfies Record<NotificationType, z.ZodObject>);

export const NotificationView = z.strictObject({
  id: Id,
  type: NotificationType,
  subject: z.strictObject({ type: z.enum(["POLL", "COMMENT", "COMMUNITY", "USER", "ANNOUNCEMENT"]), id: Id }),
  actor: PublicUser.nullable(),
  /** Tipe göre küçük özet alanlar (ör. milestone: 100). Oy seçimi veya özel veri içermez. */
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  readAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const NotificationPreferences = z.strictObject({
  // Gönderilmeyen tip varsayılan (açık) kabul edilir.
  types: z.partialRecord(NotificationType, z.boolean()),
});

const notifications = { owner: "Utku", module: "notifications" } as const;
const center = ["Mehmet (bildirim merkezi, KV-35)"];
const PollParams = z.strictObject({ pollId: Id });

export const notificationEndpoints = [
  defineEndpoint({
    id: "notifications.list",
    domain: "notifications",
    method: "GET",
    path: "/notifications",
    summary: "Bildirimler (yeniden eskiye)",
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#23", "#37"],
    availability: { status: "ready" },
    request: { query: z.strictObject({ ...CursorQuery.shape, unreadOnly: z.stringbool().default(false) }) },
    responses: { 200: pageOf(NotificationView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
  }),
  defineEndpoint({
    id: "notifications.unreadCount",
    domain: "notifications",
    method: "GET",
    path: "/notifications/unread-count",
    summary: "Okunmamış sayısı (rozet)",
    auth: "user",
    provider: notifications,
    consumers: [...center, "Ümit (app shell)"],
    unblocks: ["#23", "#37"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(z.strictObject({ count: Count })) },
    errors: [],
    idempotency: "none",
    cache: "private",
  }),
  defineEndpoint({
    id: "notifications.markRead",
    domain: "notifications",
    method: "POST",
    path: "/notifications/read",
    summary: "Okundu işaretle (seçili veya hepsi)",
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#23", "#37"],
    availability: { status: "ready" },
    request: {
      body: z.union([
        z.strictObject({ ids: z.array(Id).min(1).max(100) }),
        z.strictObject({ all: z.literal(true) }),
      ]),
    },
    responses: { 200: dataOf(z.strictObject({ updated: Count })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "notifications.preferences.get",
    domain: "notifications",
    method: "GET",
    path: "/notifications/preferences",
    summary: "Bildirim tercihleri",
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#36", "#37"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(NotificationPreferences) },
    errors: [],
    idempotency: "none",
    cache: "private",
  }),
  defineEndpoint({
    id: "notifications.preferences.update",
    domain: "notifications",
    method: "PATCH",
    path: "/notifications/preferences",
    summary: "Tip bazında aç/kapat",
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#36", "#37"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ types: z.partialRecord(NotificationType, z.boolean()) }) },
    responses: { 200: dataOf(NotificationPreferences) },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: ["MODERATION_APPLIED ve SANCTION_APPLIED kapatılamaz (MANDATORY_NOTIFICATION_TYPES); gönderilirse 400 VALIDATION_ERROR."],
  }),
  defineEndpoint({
    id: "notifications.mutes.put",
    domain: "notifications",
    method: "PUT",
    path: "/notifications/mutes/:pollId",
    summary: "Bir anketin bildirimlerini sessize al",
    notes: [
      "Yalnız yeni bildirimleri etkiler (teslim anında süzülür); mevcut bildirimler ve okundu durumu değişmez.",
      "Kapatılamayan tipler (MANDATORY_NOTIFICATION_TYPES) sessizde de gelir.",
      "Anket yoksa 404 NOT_FOUND. Tekrar çağrı aynı cevabı verir.",
    ],
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#36"],
    availability: { status: "ready" },
    request: { params: PollParams },
    responses: { 200: dataOf(z.strictObject({ muted: z.literal(true) })) },
    errors: ["NOT_FOUND"],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "notifications.mutes.delete",
    domain: "notifications",
    method: "DELETE",
    path: "/notifications/mutes/:pollId",
    summary: "Sessizi kaldır",
    auth: "user",
    provider: notifications,
    consumers: center,
    unblocks: ["#36"],
    availability: { status: "ready" },
    request: { params: PollParams },
    responses: { 200: dataOf(z.strictObject({ muted: z.literal(false) })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
];
