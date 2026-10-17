// Rapor, moderasyon kuyruğu ve içerik işlemleri — sağlayıcı Mert
// KV-24 (#26), KV-37 (#39), KV-38 (#40); içerik sürüm geçmişi sağlayıcısı Faruk (#66)
import { z } from "zod";
import { MediaView } from "./media.ts";
import { CategoryRef, CommunityRef, ContentStatus, Count, CursorQuery, dataOf, Empty, Id, IdParams, pageOf, PublicUser, Timestamp } from "../common.ts";
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
  /** Hedefin özeti: anket başlığı, yorumun ilk 140 karakteri, kullanıcı adı. Görselde null. */
  excerpt: z.string().nullable(),
  /** Hedef içeriğin şimdiki durumu (anket/yorum); diğer hedeflerde null. */
  contentStatus: ContentStatus.nullable(),
  /** Hedefin sahibi (anket/yorum yazarı, görseli yükleyen, raporlanan hesap); silinmişse null. Uyar/yaptırım bu hesaba gider. */
  targetUser: z.strictObject({ id: Id, username: z.string() }).nullable(),
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
  "CLOSE_COMMENTS",
  "OPEN_COMMENTS",
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

/** Yönetici anket listesi satırı (KV-37). Gizli ve kaldırılmış anketler dahildir. */
export const AdminPollItem = z.strictObject({
  id: Id,
  publicId: z.string(),
  slug: z.string(),
  kind: z.enum(["POLL", "DISCUSSION"]),
  title: z.string(),
  status: ContentStatus,
  trendExcluded: z.boolean(),
  /** Moderasyon yorumları kapattı (CLOSE_COMMENTS); sahibin allowComments ayarından bağımsızdır. */
  commentsClosed: z.boolean(),
  /** İlk geçerli oy geldi: başlık, açıklama, seçenekler ve sonuç görünürlüğü artık değişmez (yönetici dahil). */
  contentLocked: z.boolean(),
  author: PublicUser,
  category: CategoryRef,
  community: CommunityRef.nullable(),
  voteCount: Count,
  commentCount: Count,
  openReportCount: Count,
  createdAt: Timestamp,
});

/** Yönetici yorum listesi satırı (KV-37). Gizli ve kaldırılmış yorumlar dahildir. */
export const AdminCommentItem = z.strictObject({
  id: Id,
  pollId: Id,
  pollTitle: z.string(),
  parentId: Id.nullable(),
  body: z.string(),
  status: ContentStatus,
  author: PublicUser,
  openReportCount: Count,
  createdAt: Timestamp,
});

/** moderation_actions.action değerleri (içerik, görsel, kullanıcı işlemleri). */
export const ModerationRecordAction = z.enum([
  "APPROVE",
  "REJECT",
  "HIDE",
  "REMOVE",
  "RESTORE",
  "LOCK",
  "UNLOCK",
  "EXCLUDE_FROM_TRENDS",
  "INCLUDE_IN_TRENDS",
  "CLOSE_COMMENTS",
  "OPEN_COMMENTS",
  "MOVE",
  "WARN_USER",
  "SANCTION_USER",
  "DISMISS_REPORT",
]);

/**
 * İçeriğin rapor + moderasyon geçmişi (KV-37). Raporlayanın kimliği dönmez; rapor kapanışında yalnız sonuçlandıran görünür.
 * Zaman çizgisi: `at` azalan.
 */
export const ContentHistoryItem = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("REPORT"),
    id: Id,
    at: Timestamp,
    reason: ReportReason,
    note: z.string().nullable(),
    status: ReportStatus,
    resolvedAt: Timestamp.nullable(),
    resolvedBy: PublicUser.nullable(),
    resolutionNote: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("ACTION"),
    id: Id,
    at: Timestamp,
    action: ModerationRecordAction,
    actor: PublicUser,
    fromStatus: z.string().nullable(),
    toStatus: z.string().nullable(),
    reason: z.string(),
    reportId: Id.nullable(),
  }),
]);

export const Revision = z.strictObject({
  version: z.number().int().min(1),
  editor: PublicUser,
  editedAt: Timestamp,
  snapshot: z.record(z.string(), z.unknown()),
});

/**
 * #183 toplu moderasyon (KV-37 §bulk): seçilen anket/yorumlara tek gerekçeyle HIDE/REMOVE/RESTORE. Önizleme → gerekçe + özet
 * (digest) ile onay → içerik başına bağımsız işlem (kısmi başarısızlık raporlanır). En çok 50 kayıt.
 */
export const BULK_MAX_ITEMS = 50;
export const BulkModerationAction = z.enum(["HIDE", "REMOVE", "RESTORE"]);
export const BulkBlockedCode = z.enum(["not_found", "forbidden", "invalid_transition", "admin_required"]);
const BulkIds = z
  .array(Id)
  .min(1)
  .max(BULK_MAX_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, "Aynı kayıt iki kez seçilemez");
/** Önizleme GET'tir (salt okuma): kimlikler virgülle ayrılmış tek parametre, en çok ${BULK_MAX_ITEMS} adet, yinelenen yok. */
export const BulkIdsQuery = z
  .string()
  .regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i, "Virgülle ayrılmış kimlik listesi")
  .refine((v) => v.split(",").length <= BULK_MAX_ITEMS, `En çok ${BULK_MAX_ITEMS} kayıt`)
  .refine((v) => new Set(v.split(",")).size === v.split(",").length, "Aynı kayıt iki kez seçilemez");
export const BulkPreviewItem = z.strictObject({
  id: Id,
  /** Anket başlığı veya yorumun ilk 80 karakteri; yetkisiz veya bulunamayan kayıtta null (içerik sızmaz). */
  label: z.string().nullable(),
  status: ContentStatus.nullable(),
  communityId: Id.nullable(),
  outcome: z.enum(["WILL_CHANGE", "NO_CHANGE", "BLOCKED"]),
  blocked: BulkBlockedCode.nullable(),
});
export const BulkPreview = z.strictObject({
  kind: z.enum(["polls", "comments"]),
  action: BulkModerationAction,
  maxItems: z.number().int(),
  /** Onayda aynen geri gönderilir: önizlemeden sonra herhangi bir kaydın durumu/topluluğu değiştiyse 409 preview_stale. */
  digest: z.string().length(64),
  summary: z.strictObject({ willChange: Count, noChange: Count, blocked: Count }),
  /** İkinci onay: bu işlemle birlikte son saatteki onaysız uygulanan kayıt sayısı eşiğe ulaşıyorsa `required` (KV-37 §8). */
  approval: z.strictObject({ required: z.boolean(), threshold: z.number().int(), windowMinutes: z.number().int(), windowApplied: Count }),
  items: z.array(BulkPreviewItem),
});
export const BulkResultItem = z.strictObject({
  id: Id,
  result: z.enum(["APPLIED", "UNCHANGED", "FAILED"]),
  code: z.union([BulkBlockedCode, z.literal("community_changed")]).nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
});
export const BulkResult = z.strictObject({
  batchId: Id,
  summary: z.strictObject({ total: Count, applied: Count, unchanged: Count, failed: Count }),
  items: z.array(BulkResultItem),
});
/**
 * #183 yüksek hacimli toplu işlemde ikinci onay (KV-37 §8). Eşik: başlatanın son saatteki ONAYSIZ uygulanan kayıt sayısı + bu işlemin
 * değişecek kayıt sayısı >= BULK_APPROVAL_THRESHOLD. Eşik aşılınca `bulk` hiçbir şey uygulamaz, bekleyen bir talep açar (202).
 * Başlatandan farklı bir ADMIN+ talebi (kayıt listesini görerek) MFA step-up ile onaylar; parti başlatan adına, mevcut toplu işlem
 * yolundan ve başlatanın yetkisiyle yeniden hesaplanarak uygulanır. Süre dolarsa talep EXPIRED sayılır (okunurken).
 */
export const BULK_APPROVAL_THRESHOLD = 20;
export const BULK_APPROVAL_WINDOW_MINUTES = 60;
export const BULK_APPROVAL_TTL_MINUTES = 30;
/** Başlatan başına aynı anda bekleyen (süresi dolmamış) talep sayısı. */
export const BULK_APPROVAL_PENDING_MAX = 3;
export const BulkApprovalStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED", "EXPIRED"]);
export const BulkApprovalView = z.strictObject({
  id: Id,
  kind: z.enum(["polls", "comments"]),
  action: BulkModerationAction,
  reason: z.string(),
  /** Talep anında değişecek kayıt sayısı. */
  itemCount: Count,
  status: BulkApprovalStatus,
  initiator: PublicUser,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  decidedBy: PublicUser.nullable(),
  decidedAt: Timestamp.nullable(),
  decisionReason: z.string().nullable(),
  /** Onaylanınca açılan parti. */
  batchId: Id.nullable(),
});
export const BulkApprovalDetail = BulkApprovalView.extend({
  /** Başlatanın yetkisiyle ŞİMDİ hesaplanan kayıt başına sonuç (onaylayan neyi onayladığını görür). */
  items: z.array(BulkPreviewItem),
  /** Talepten sonra kayıtların durumu değiştiyse true: onay 409 preview_stale verir. */
  stale: z.boolean(),
});
export const BulkApprovalDecision = z.strictObject({ approval: BulkApprovalView, result: BulkResult });
export const BulkApprovalListQuery = z.strictObject({ ...CursorQuery.shape, status: BulkApprovalStatus.optional() });
/**
 * #183 güvenli geri alma (telafi kararı). Yalnız önceden tanımlı çiftler geri alınır: HIDE/REMOVE (önceki durum ACTIVE) → RESTORE,
 * RESTORE (önceki HIDDEN) → HIDE, RESTORE (önceki REMOVED) → REMOVE. Sürüm koşulu: içeriğin şimdiki durumu kararın bıraktığı durum
 * VE hedefin son kararı bu karar olmalı (araya daha yeni karar girdiyse geri alınmaz). Silinmiş/anonimleştirilmiş içerik sahibinin
 * içeriği asla geri getirilmez. Geri alma yeni bir partidir; her telafi kararı normal moderasyon yolundan geçer ve kendi audit
 * kaydını yazar (append-only audit değişmez). Geri almanın geri alması yoktur.
 */
export const UndoBlockedCode = z.enum([
  "not_found",
  "forbidden",
  "admin_required",
  "not_reversible",
  "status_changed",
  "superseded",
  "author_erased",
  "community_changed",
]);
export const UndoPreviewItem = z.strictObject({
  id: Id,
  /** Yetkisiz veya bulunamayan kayıtta null (içerik sızmaz). */
  label: z.string().nullable(),
  status: ContentStatus.nullable(),
  /** Uygulanacak telafi kararı; geri alınamayan kararda null. */
  undoAction: BulkModerationAction.nullable(),
  outcome: z.enum(["WILL_UNDO", "BLOCKED", "ALREADY_UNDONE"]),
  blocked: UndoBlockedCode.nullable(),
});
export const UndoPreview = z.strictObject({
  batchId: Id,
  kind: z.enum(["polls", "comments"]),
  originalAction: BulkModerationAction,
  digest: z.string().length(64),
  summary: z.strictObject({ willUndo: Count, blocked: Count, alreadyUndone: Count }),
  items: z.array(UndoPreviewItem),
});
export const UndoResultItem = z.strictObject({
  id: Id,
  result: z.enum(["APPLIED", "UNCHANGED", "FAILED"]),
  code: UndoBlockedCode.nullable(),
  undoAction: BulkModerationAction.nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
});
export const UndoResult = z.strictObject({
  /** Yeni geri alma partisi. */
  batchId: Id,
  undoOfId: Id,
  summary: z.strictObject({ total: Count, applied: Count, unchanged: Count, failed: Count }),
  items: z.array(UndoResultItem),
});

export const ModerationBatchView = z.strictObject({
  id: Id,
  kind: z.enum(["polls", "comments"]),
  action: BulkModerationAction,
  reason: z.string(),
  actor: PublicUser,
  total: Count,
  applied: Count,
  unchanged: Count,
  failed: Count,
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  /** Dolu ise bu parti başka bir partinin geri almasıdır (işlem alanı geri alınan partinin işlemidir). */
  undoOfId: Id.nullable(),
  /** Bu partinin kararlarından geri alınmış olanların sayısı. */
  undone: Count,
  /** Bitmiş, geri alma olmayan ve geri alınmamış uygulanmış kararı kalan parti. */
  undoable: z.boolean(),
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
        action:
          target === "polls"
            ? ModerationAction
            : ModerationAction.exclude(["EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS", "CLOSE_COMMENTS", "OPEN_COMMENTS"]),
        reason: Reason,
      }),
    },
    responses: {
      200: dataOf(z.strictObject({ id: Id, status: ContentStatus, trendExcluded: z.boolean().nullable(), commentsClosed: z.boolean().nullable() })),
    },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Moderatör sadece atandığı topluluktaki içeriğe işlem yapar (KV-04); aksi 403.",
      "Her işlem önce/sonra durumuyla audit'e yazılır (KV-39). Geçersiz geçiş 409 CONFLICT.",
      "trendExcluded ve commentsClosed yalnız ankette doludur, yorumda null. CLOSE_COMMENTS/OPEN_COMMENTS yalnız ankette: oy açık kalır, yeni yorum ve cevap 409 COMMENTS_DISABLED olur; mevcut yorumlar görünmeye devam eder. LOCK'tan ayrıdır (LOCK oyu da kapatır).",
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

const SearchText = z.string().trim().min(2).max(100);

const contentEndpoints = [
  defineEndpoint({
    id: "admin.content.polls",
    domain: "moderation",
    method: "GET",
    path: "/admin/polls",
    summary: "Yönetici anket arama ve listesi",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#39", "#45"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        /** Başlık veya açıklamada, Türkçe harf/büyük-küçük farkı gözetmeden. */
        q: SearchText.optional(),
        status: ContentStatus.optional(),
        communityId: Id.optional(),
        categoryId: Id.optional(),
        authorId: Id.optional(),
        /** true: yalnız açık raporu olanlar. */
        reported: z.stringbool().optional(),
        /** true: yalnız trendden çıkarılmış olanlar. */
        trendExcluded: z.stringbool().optional(),
      }),
    },
    responses: { 200: pageOf(AdminPollItem) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: [
      "En yeni önce. Gizli, kilitli, inceleme altındaki ve kaldırılmış anketler dahildir (public listelerden farkı).",
      "Moderatör yalnız atandığı toplulukların anketlerini görür; topluluksuz anketler yalnız ADMIN+ listesindedir. Filtre yetki değildir: işlem endpoint'leri hedefin topluluğunu ayrıca denetler.",
    ],
  }),
  defineEndpoint({
    id: "admin.content.comments",
    domain: "moderation",
    method: "GET",
    path: "/admin/comments",
    summary: "Yönetici yorum arama ve listesi",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#39", "#45"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        /** Yorum metninde, Türkçe harf/büyük-küçük farkı gözetmeden. */
        q: SearchText.optional(),
        status: ContentStatus.optional(),
        pollId: Id.optional(),
        communityId: Id.optional(),
        authorId: Id.optional(),
        reported: z.stringbool().optional(),
      }),
    },
    responses: { 200: pageOf(AdminCommentItem) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["En yeni önce. Gizli ve kaldırılmış yorumlar dahildir. Kapsam kuralı admin.content.polls ile aynıdır."],
  }),
  ...(["polls", "comments"] as const).map((target) =>
    defineEndpoint({
      id: `admin.moderation.history.${target}`,
      domain: "moderation",
      method: "GET",
      path: `/admin/${target}/:id/moderation-history`,
      summary: `${target === "polls" ? "Anketin" : "Yorumun"} rapor ve moderasyon geçmişi`,
      auth: "moderator",
      provider: moderation,
      consumers: adminUi,
      unblocks: ["#39"],
      availability: { status: "ready" },
      request: { params: IdParams, query: CursorQuery },
      responses: { 200: pageOf(ContentHistoryItem) },
      errors: ["INVALID_CURSOR"],
      idempotency: "none",
      cache: "private",
      notes: [
        "Raporlar (kapanmış olanlar dahil) ve moderasyon işlemleri tek zaman çizgisinde, yeniden eskiye. Raporlayan kimliği dönmez.",
        "Moderatör yalnız atandığı topluluğun içeriği için okur (403). Sürüm geçmişi ayrıdır: admin.revisions.*.",
      ],
    }),
  ),
  defineEndpoint({
    id: "admin.moderation.polls.move",
    domain: "moderation",
    method: "PATCH",
    path: "/admin/polls/:id/placement",
    summary: "Anketin kategorisini veya topluluğunu gerekçeyle değiştir",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#39"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z
        .strictObject({
          categoryId: Id.optional(),
          /** null: topluluktan çıkar (yalnız ADMIN+). */
          communityId: Id.nullable().optional(),
          reason: Reason,
        })
        .refine((b) => b.categoryId !== undefined || b.communityId !== undefined, { message: "categoryId veya communityId gerekli", path: ["categoryId"] }),
    },
    responses: { 200: dataOf(AdminPollItem) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Soru metni, açıklama ve seçenekler değişmediği için ilk geçerli oydan sonra da serbesttir (KV-37 kararı); oy, yorum ve sonuçlar taşınmaz, olduğu gibi kalır.",
      "Moderatör hem kaynak hem hedef toplulukta atanmış olmalıdır (403); topluluktan çıkarma ve topluluksuz anketi bir topluluğa alma yalnız ADMIN+.",
      "Hedef kategori etkin, hedef topluluk açık olmalı: aksi 400 VALIDATION_ERROR (unknown_category | unknown_community). Kaldırılmış anket 409 (removed). Değişiklik yoksa 200, audit ve kayıt yazılmaz.",
      "Feed, arama, trend ve topluluk akışı anketi canlı okur: ek yeniden hesaplama gerekmez, taşıma sonrası ilk okumada yeni yerinde görünür.",
      "Audit: moderation.poll.apply / move (önce/sonra kategori ve topluluk). moderation_actions MOVE kaydı yazılır.",
    ],
  }),
  defineEndpoint({
    id: "admin.reports.warn",
    domain: "moderation",
    method: "POST",
    path: "/admin/reports/:id/warn",
    summary: "Raporlanan içeriğin sahibini uyar",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#39", "#26"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ sanctionId: Id, userId: Id, closedReports: Count })) },
    errors: ["CONFLICT"],
    idempotency: "none",
    cache: "private",
    notes: [
      "Hedefin sahibine WARNING yaptırımı yazar (hesap durumu değişmez; Utku'nun sanctions tablosu ve sanction.applied olayı). Hedefin açık raporlarını ACTIONED yapar.",
      "Aynı işlemde moderation_actions WARN_USER (rapor bağlantılı) ve audit report.warn / apply yazılır; audit önce/sonra, rapor, hedef ve yaptırım kimliğini taşır.",
      "Moderatör yalnız USER rolündeki hesabı uyarır (403); admin hedef SUPER_ADMIN ister (KV-04 sanctionTarget). Kendini uyarma 403.",
      "409 CONFLICT details[0].code: no_target_user (hedefin sahibi yok veya hesap silinmiş), already_resolved (rapor zaten kapalı).",
      "Sert yaptırım (kısıt, askı, ban) için admin.sanctions.create body'sine reportId verilir; aynı iz oraya da yazılır.",
    ],
  }),
];

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
  ...contentEndpoints,
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
  ...(["polls", "comments"] as const).flatMap((target) => [
    defineEndpoint({
      id: `admin.moderation.${target}.bulkPreview`,
      domain: "moderation",
      method: "GET",
      path: `/admin/moderation/${target}/bulk/preview`,
      summary: `Toplu ${target === "polls" ? "anket" : "yorum"} moderasyonu önizlemesi (salt okuma)`,
      auth: "moderator",
      provider: moderation,
      consumers: adminUi,
      unblocks: ["#183"],
      availability: { status: "ready" },
      request: { query: z.strictObject({ ids: BulkIdsQuery, action: BulkModerationAction }) },
      responses: { 200: dataOf(BulkPreview) },
      errors: [],
      idempotency: "none",
      cache: "private",
      notes: [
        "Hiçbir şey yazmaz. Her kayıt için sonuç: WILL_CHANGE, NO_CHANGE (zaten o durumda) veya BLOCKED (not_found, forbidden = kapsam dışı topluluk, invalid_transition, admin_required = kaldırılmış içeriği yalnız ADMIN+ geri yükler). Yetki yalnız backend RBAC'tadır: moderatör atandığı topluluğun içeriğine, ADMIN+ hepsine işlem yapar.",
        "digest: (id, durum, topluluk) listesinin özeti; onay isteğinde aynen gönderilir.",
      ],
    }),
    defineEndpoint({
      id: `admin.moderation.${target}.bulk`,
      domain: "moderation",
      method: "POST",
      path: `/admin/moderation/${target}/bulk`,
      summary: `Seçilen ${target === "polls" ? "anketlere" : "yorumlara"} toplu gerekçeli moderasyon (HIDE/REMOVE/RESTORE)`,
      auth: "moderator",
      provider: moderation,
      consumers: adminUi,
      unblocks: ["#183"],
      availability: { status: "ready" },
      request: { body: z.strictObject({ ids: BulkIds, action: BulkModerationAction, reason: Reason, digest: z.string().length(64) }) },
      responses: { 200: dataOf(BulkResult), 202: dataOf(BulkApprovalView) },
      errors: ["CONFLICT", "RATE_LIMITED"],
      idempotency: "natural",
      cache: "private",
      notes: [
        "Önizlenen durumda uygulanır: kayıtların durumu/topluluğu önizlemeden sonra değiştiyse 409 CONFLICT details[0].code=preview_stale ve hiçbir şey yazılmaz (önizlemeyi yenile).",
        "Her kayıt kendi transaction'ında ve mevcut tekil moderasyon yolundan geçer (satır kilidi, geçiş tablosu, sayaçlar, moderation_actions, audit, olay outbox'ı); biri başarısız olursa diğerleri etkilenmez. Sonuç kayıt başınadır (APPLIED / UNCHANGED / FAILED + neden). Kapsam dışı kayıt FAILED forbidden olur ve dokunulmaz.",
        "Aynı istek tekrarında kayıtlar UNCHANGED döner (idempotent). Aktör başına saatte en çok 20 parti (429 RATE_LIMITED). Kaldırılmış içeriği yalnız ADMIN+ geri yükler.",
        "İkinci onay: başlatanın son saatteki onaysız uygulanan kayıt sayısı + değişecek kayıt sayısı >= 20 ise hiçbir şey uygulanmaz, 202 ile bekleyen bir onay talebi döner (aynı anda en çok 3 bekleyen; fazlası 409 too_many_pending). Başlatandan farklı bir ADMIN+ talebi onaylayınca parti uygulanır (admin.moderation.bulkApprovals.*).",
      ],
    }),
  ]),
  defineEndpoint({
    id: "admin.moderation.bulkApprovals.list",
    domain: "moderation",
    method: "GET",
    path: "/admin/moderation/bulk-approvals",
    summary: "Yüksek hacimli toplu moderasyon onay talepleri (en yeni önce)",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { query: BulkApprovalListQuery },
    responses: { 200: pageOf(BulkApprovalView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: [
      "Moderatör yalnız kendi taleplerini, ADMIN+ hepsini görür. `status` süzgeci EXPIRED'ı da destekler (süresi dolmuş bekleyen talepler). Süzgeç değişince eski imleç INVALID_CURSOR olur.",
    ],
  }),
  defineEndpoint({
    id: "admin.moderation.bulkApprovals.get",
    domain: "moderation",
    method: "GET",
    path: "/admin/moderation/bulk-approvals/:id",
    summary: "Onay talebinin ayrıntısı: kayıt başına şimdiki sonuç",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(BulkApprovalDetail) },
    errors: ["NOT_FOUND"],
    idempotency: "none",
    cache: "private",
    notes: [
      "Salt okuma. `items` başlatanın yetkisiyle şimdi yeniden hesaplanır; `stale` talep sonrası kayıt durumu değiştiyse true. Moderatör yalnız kendi talebini görür (başkasınınki 404).",
    ],
  }),
  defineEndpoint({
    id: "admin.moderation.bulkApprovals.approve",
    domain: "moderation",
    method: "POST",
    path: "/admin/moderation/bulk-approvals/:id/approve",
    summary: "Yüksek hacimli toplu moderasyonu ikinci onaycı olarak onayla ve uygula",
    auth: "admin",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(BulkApprovalDecision) },
    errors: ["CONFLICT", "NOT_FOUND"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "ADMIN+ ve başlatandan farklı olmalı (self_approval, 403 FORBIDDEN details[0].code); oturumda taze, tek kullanımlık MFA step-up gerekir (stepup_required, 403 FORBIDDEN). Step-up yalnız doğrulamalar geçtikten sonra tüketilir.",
      "Talep anındaki özet (digest) başlatanın şimdiki yetkisiyle yeniden hesaplanır; kayıtlar değiştiyse 409 CONFLICT preview_stale ve hiçbir şey uygulanmaz. Başlatan artık yetkili/etkin değilse 409 initiator_changed. Kapalı talep (onaylanmış, reddedilmiş, geri çekilmiş, süresi dolmuş) 409 closed.",
      "Parti başlatan adına uygulanır (moderation_actions aktörü başlatan); onaylayan talep ve audit kaydındadır. Kayıt başına kısmi başarısızlık normal toplu işlemdeki gibi raporlanır. Aynı talebin ikinci onayı 409 closed.",
    ],
  }),
  defineEndpoint({
    id: "admin.moderation.bulkApprovals.reject",
    domain: "moderation",
    method: "POST",
    path: "/admin/moderation/bulk-approvals/:id/reject",
    summary: "Yüksek hacimli toplu moderasyon talebini reddet",
    auth: "admin",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(BulkApprovalView) },
    errors: ["CONFLICT", "NOT_FOUND"],
    idempotency: "natural",
    cache: "private",
    notes: ["ADMIN+ ve başlatandan farklı (başlatan geri çeker: cancel). Hiçbir içerik değişmez. Kapalı talep 409 closed."],
  }),
  defineEndpoint({
    id: "admin.moderation.bulkApprovals.cancel",
    domain: "moderation",
    method: "POST",
    path: "/admin/moderation/bulk-approvals/:id/cancel",
    summary: "Kendi bekleyen toplu moderasyon talebini geri çek",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(BulkApprovalView) },
    errors: ["CONFLICT", "NOT_FOUND"],
    idempotency: "natural",
    cache: "private",
    notes: ["Yalnız başlatan; başkasının talebi 404. Kapalı talep 409 closed."],
  }),
  defineEndpoint({
    id: "admin.moderation.batches.undoPreview",
    domain: "moderation",
    method: "GET",
    path: "/admin/moderation/batches/:id/undo/preview",
    summary: "Toplu işlemin güvenli geri alma önizlemesi (salt okuma)",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183", "#185"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(UndoPreview) },
    errors: ["CONFLICT", "NOT_FOUND"],
    idempotency: "none",
    cache: "private",
    notes: [
      "Hiçbir şey yazmaz. Kayıt başına: WILL_UNDO, ALREADY_UNDONE veya BLOCKED (not_reversible, status_changed, superseded, author_erased, forbidden, admin_required, not_found). Moderatör yalnız kendi partisini, ADMIN+ herhangi birini geri alır (başkasının partisi moderatöre 404).",
      "409 CONFLICT details[0].code: not_undoable (geri alma partisi, bitmemiş parti), nothing_to_undo (geri alınacak karar kalmadı).",
    ],
  }),
  defineEndpoint({
    id: "admin.moderation.batches.undo",
    domain: "moderation",
    method: "POST",
    path: "/admin/moderation/batches/:id/undo",
    summary: "Toplu işlemi güvenli geri al (telafi kararları, sürüm kontrollü)",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183", "#185"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason, digest: z.string().length(64) }) },
    responses: { 200: dataOf(UndoResult) },
    errors: ["CONFLICT", "NOT_FOUND", "RATE_LIMITED"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Önizlenen durumda uygulanır (digest); fark varsa 409 preview_stale ve hiçbir şey yazılmaz. Her telafi kararı kendi transaction'ında, tekil moderasyon yolundan ve kilit altında sürüm koşuluyla uygulanır: durum kararın bıraktığı durumdan farklıysa veya hedefte daha yeni karar varsa superseded, içerik sahibi silinmişse author_erased ve içerik dokunulmaz.",
      "Yeni bir geri alma partisi oluşur (undoOfId); öğe başına en çok bir geri alma: tekrar çağrı yalnız henüz geri alınmamış ve şimdi uygun kararları ele alır. Geri alınamayan karar partide FAILED + neden olarak kalır. Aynı saatlik parti sınırı geçerlidir (429).",
      "409 CONFLICT details[0].code: preview_stale, not_undoable, nothing_to_undo.",
    ],
  }),
  defineEndpoint({
    id: "admin.moderation.batches.list",
    domain: "moderation",
    method: "GET",
    path: "/admin/moderation/batches",
    summary: "Toplu moderasyon geçmişi (en yeni önce)",
    auth: "moderator",
    provider: moderation,
    consumers: adminUi,
    unblocks: ["#183"],
    availability: { status: "ready" },
    request: { query: CursorQuery },
    responses: { 200: pageOf(ModerationBatchView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["Moderatör yalnız kendi partilerini, ADMIN+ hepsini görür."],
  }),
];
