// Rapor, moderasyon kuyruğu ve içerik işlemleri — sağlayıcı Mert
// KV-24 (#26), KV-37 (#39), KV-38 (#40); içerik sürüm geçmişi sağlayıcısı Faruk (#66)
import { z } from "zod";
import { MediaView } from "./media.ts";
import { ContentStatus, Count, CursorQuery, dataOf, Empty, Id, IdParams, pageOf, PublicUser, Timestamp } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

export const ReportTargetType = z.enum(["POLL", "COMMENT", "MEDIA", "USER"]);
export const ReportReason = z.enum([
  "SPAM",
  "INAPPROPRIATE",
  "HARASSMENT",
  "HATE",
  "PERSONAL_INFO",
  "MISLEADING",
  "COPYRIGHT",
  "OTHER",
]);
export const ReportStatus = z.enum(["OPEN", "ACTIONED", "DISMISSED"]);

export const ReportView = z.strictObject({
  id: Id,
  target: z.strictObject({ type: ReportTargetType, id: Id }),
  reason: ReportReason,
  note: z.string().nullable(),
  status: ReportStatus,
  reportCount: z.number().int().min(1),
  communityId: Id.nullable(),
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});

/**
 * Yasaklı görsel kaydı (KV-38). Parmak izinin kendisi (sha256/dHash) dönmez; kanıt görsel `sourceMediaId`'dir.
 * `matchesExact` / `matchesSimilar`: kayıtta hangi eşleşme türünün bulunduğu.
 */
export const BannedMediaView = z.strictObject({
  id: Id,
  sourceMediaId: Id,
  reason: z.string(),
  matchesExact: z.boolean(),
  matchesSimilar: z.boolean(),
  createdBy: PublicUser,
  createdAt: Timestamp,
});

export const ModerationAction = z.enum([
  "HIDE",
  "RESTORE",
  "LOCK",
  "UNLOCK",
  "REMOVE",
  "EXCLUDE_FROM_TRENDS",
  "INCLUDE_IN_TRENDS",
]);
const Reason = z.string().trim().min(3).max(500);

/** KV-43: geçersiz sayma hedefi. Tek istekte en fazla 100 oy veya 100 hesap. */
export const InvalidateVotesBody = z.strictObject({
  target: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("VOTES"), voteIds: z.array(Id).min(1).max(100) }),
    z.strictObject({ type: z.literal("ACCOUNTS"), userIds: z.array(Id).min(1).max(100), pollId: Id.optional() }),
  ]),
  reason: Reason,
});
export const RestoreVotesBody = z.strictObject({ voteIds: z.array(Id).min(1).max(100), reason: Reason });
export const VoteCorrectionResult = z.strictObject({
  /** Bu istekle durumu değişen oy sayısı. */
  changed: Count,
  /** Zaten istenen durumda olduğu için dokunulmayan oy sayısı (tekrar istek). */
  unchanged: Count,
  /** Bulunamayan oy kimlikleri (VOTES hedefi ve geri alma). */
  notFound: z.array(Id),
  affectedPollIds: z.array(Id),
});

export const Revision = z.strictObject({
  version: z.number().int().min(1),
  editor: PublicUser,
  editedAt: Timestamp,
  snapshot: z.record(z.string(), z.unknown()),
});

const moderation = { owner: "Mert", module: "moderation" } as const;
const reports = { owner: "Mert", module: "reports" } as const;
const media = { owner: "Mert", module: "media" } as const;
const adminUi = ["Mert (admin moderasyon UI, KV-37)"];

const moderationEndpoint = (target: "polls" | "comments") =>
  defineEndpoint({
    id: `admin.moderation.${target}`,
    domain: "moderation",
    method: "POST",
    path: `/admin/${target}/:id/moderation`,
    summary: `${target === "polls" ? "Anket" : "Yorum"} üzerinde gerekçeli moderasyon işlemi`,
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#39", "#26"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z.strictObject({
        action: target === "polls" ? ModerationAction : ModerationAction.exclude(["EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS"]),
        reason: Reason,
      }),
    },
    responses: { 200: dataOf(z.strictObject({ id: Id, status: ContentStatus, trendExcluded: z.boolean().nullable() })) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Moderatör sadece atandığı topluluktaki içeriğe işlem yapar (KV-04); aksi 403.",
      "Her işlem önce/sonra durumuyla audit'e yazılır (KV-39). Geçersiz geçiş 409 CONFLICT.",
    ],
  });

const revisionsEndpoint = (target: "polls" | "comments") =>
  defineEndpoint({
    id: `admin.revisions.${target}`,
    domain: "moderation",
    method: "GET",
    path: `/admin/${target}/:id/revisions`,
    summary: "İçerik sürüm geçmişi",
    auth: "admin",
    provider: { owner: "Faruk", module: target },
    consumers: ["Mert (moderasyon, KV-37)", "Utku (audit, KV-39)"],
    unblocks: ["#39", "#41"],
    availability: { status: "ready" },
    request: { params: IdParams, query: CursorQuery },
    responses: { 200: pageOf(Revision) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
  });

export const moderationEndpoints = [
  defineEndpoint({
    id: "reports.create",
    domain: "moderation",
    method: "POST",
    path: "/reports",
    summary: "İçerik veya kullanıcı raporu",
    auth: "user",
    provider: reports,
    consumers: ["Ümit (rapor modalı)"],
    unblocks: ["#26"],
    availability: { status: "ready" },
    request: {
      body: z.strictObject({
        target: z.strictObject({ type: ReportTargetType, id: Id }),
        reason: ReportReason,
        note: z.string().trim().max(1000).optional(),
      }),
    },
    responses: { 202: dataOf(z.strictObject({ reportId: Id })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Aynı kullanıcının aynı hedefe açık raporu varsa aynı reportId ile 202 (çift rapor sayılmaz). Rapor içeriği silmez.",
      "Kapanmış (ACTIONED/DISMISSED) raporun sahibi aynı hedefi yeniden raporlarsa aynı reportId OPEN'a döner; önceki karar moderasyon geçmişinde kalır (DB: kullanıcı+hedef başına tek satır).",
    ],
  }),
  defineEndpoint({
    id: "admin.reports.list",
    domain: "moderation",
    method: "GET",
    path: "/admin/reports",
    summary: "Moderasyon kuyruğu",
    auth: "moderator",
    provider: reports,
    consumers: adminUi,
    unblocks: ["#26", "#39"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        status: ReportStatus.default("OPEN"),
        targetType: ReportTargetType.optional(),
        communityId: Id.optional(),
      }),
    },
    responses: { 200: pageOf(ReportView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["Moderatör sadece kendi topluluklarının raporlarını görür."],
  }),
  defineEndpoint({
    id: "admin.reports.resolve",
    domain: "moderation",
    method: "POST",
    path: "/admin/reports/:id/resolve",
    summary: "Raporu sonuçlandır",
    auth: "moderator",
    provider: reports,
    consumers: adminUi,
    unblocks: ["#26"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ resolution: z.enum(["ACTIONED", "DISMISSED"]), note: Reason }) },
    responses: { 200: dataOf(ReportView) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
  }),
  moderationEndpoint("polls"),
  moderationEndpoint("comments"),
  defineEndpoint({
    id: "admin.media.list",
    domain: "moderation",
    method: "GET",
    path: "/admin/media",
    summary: "Görsel inceleme kuyruğu",
    auth: "moderator",
    provider: media,
    consumers: adminUi,
    unblocks: ["#18", "#40"],
    availability: { status: "ready" },
    request: { query: z.strictObject({ ...CursorQuery.shape, status: z.enum(["QUARANTINED", "REJECTED", "PENDING"]).default("QUARANTINED") }) },
    responses: { 200: pageOf(MediaView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["preview signed URL'lerine her erişim audit'e yazılır (KV-08 §7)."],
  }),
  defineEndpoint({
    id: "admin.media.decide",
    domain: "moderation",
    method: "POST",
    path: "/admin/media/:id/decision",
    summary: "Görseli onayla / reddet",
    auth: "moderator",
    provider: media,
    consumers: adminUi,
    unblocks: ["#18", "#40"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ decision: z.enum(["APPROVE", "REJECT"]), reason: Reason }) },
    responses: { 200: dataOf(MediaView) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
  }),
  revisionsEndpoint("polls"),
  revisionsEndpoint("comments"),
  defineEndpoint({
    id: "admin.votes.invalidate",
    domain: "moderation",
    method: "POST",
    path: "/admin/votes/invalidate",
    summary: "Doğrulanmış manipülasyon oylarını gerekçeyle geçersiz sayar (KV-43)",
    auth: "admin",
    provider: { owner: "Faruk", module: "votes" },
    consumers: ["Mert (moderasyon UI, KV-37)", "Utku (admin users, KV-33)"],
    unblocks: ["#45"],
    availability: { status: "ready" },
    request: { body: InvalidateVotesBody },
    responses: { 200: dataOf(VoteCorrectionResult) },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: [
      "target VOTES: tek tek oylar. ACCOUNTS: hesapların oyları; pollId verilirse sadece o ankette, verilmezse bütün anketlerde.",
      "Sadece geçerli oylar işlenir (WHERE invalidated_at IS NULL): tekrar istek çift düşüm yapmaz; zaten geçersiz olanlar unchanged'de sayılır.",
      "Sayaçlar ve sonuç aynı transaction'da düzelir; günlük snapshot'lar ve trendler bir sonraki trend çalıştırmasında (en geç 5 dk) yeniden üretilir.",
      "Ban veya askı tek başına oyları geçersiz saymaz; bu her zaman ayrı ve gerekçeli işlemdir (DATA_MODEL §5.4).",
    ],
  }),
  defineEndpoint({
    id: "admin.votes.restore",
    domain: "moderation",
    method: "POST",
    path: "/admin/votes/restore",
    summary: "Yanlışlıkla geçersiz sayılan oyları gerekçeyle geri alır (KV-43)",
    auth: "admin",
    provider: { owner: "Faruk", module: "votes" },
    consumers: ["Mert (moderasyon UI, KV-37)"],
    unblocks: ["#45"],
    availability: { status: "ready" },
    request: { body: RestoreVotesBody },
    responses: { 200: dataOf(VoteCorrectionResult) },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: ["Sadece geçersiz sayılmış oylar geri gelir; geçerli olanlar unchanged'de sayılır. Anket kapanmış olsa da geri alınır."],
  }),
  defineEndpoint({
    id: "admin.media.bans.list",
    domain: "moderation",
    method: "GET",
    path: "/admin/media/bans",
    summary: "Yasaklı görsel listesi",
    auth: "admin",
    provider: media,
    consumers: adminUi,
    unblocks: ["#40"],
    availability: { status: "ready" },
    request: { query: CursorQuery },
    responses: { 200: pageOf(BannedMediaView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["En yeni önce. Parmak izi değerleri dönmez."],
  }),
  defineEndpoint({
    id: "admin.media.bans.create",
    domain: "moderation",
    method: "POST",
    path: "/admin/media/bans",
    summary: "Reddedilmiş görseli yasakla",
    auth: "admin",
    provider: media,
    consumers: adminUi,
    unblocks: ["#40"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ mediaId: Id, reason: Reason }) },
    responses: { 200: dataOf(BannedMediaView), 201: dataOf(BannedMediaView) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Görsel REJECTED olmalı (önce admin.media.decide ile reddedilir), aksi 409 CONFLICT (details[0].code='not_rejected'). Parmak izi yoksa 409 'no_fingerprint'.",
      "Aynı görsel zaten yasaklıysa 200 ile mevcut kayıt. Worker aynı dosyayı (sha256) REJECTED/BANNED_HASH, çok benzerini (dHash) QUARANTINED/BANNED_SIMILAR yapar.",
      "Yasaklı görsel admin.media.decide ile APPROVE edilemez (409 'banned'); önce yasak kaldırılır.",
    ],
  }),
  defineEndpoint({
    id: "admin.media.bans.delete",
    domain: "moderation",
    method: "DELETE",
    path: "/admin/media/bans/:id",
    summary: "Görsel yasağını kaldır",
    auth: "admin",
    provider: media,
    consumers: adminUi,
    unblocks: ["#40"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: ["Olmayan kayıt 204 (idempotent). Kaldırılan yasak daha önce reddedilmiş yüklemeleri geri getirmez."],
  }),
];
