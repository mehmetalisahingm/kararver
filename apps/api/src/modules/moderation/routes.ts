// Anket ve yorum üzerinde gerekçeli moderasyon işlemi — KV-37 (#39). Sözleşme: contracts/domains/moderation.ts
// (admin.moderation.polls, admin.moderation.comments). Yetki KV-04: moderation.poll.apply / moderation.comment.apply
// (hedefin topluluğu DB'den okunur; MODERATOR yalnız atandığı topluluğun içeriğine işlem yapar). Kaldırılmış içeriği
// yalnız ADMIN+ geri yükler (DATA_MODEL §7.1).
//
// Sayaç ve görünürlük etkileri store'da, işlemle aynı transaction'dadır. Her işlem `moderation_actions`'a önce/sonra
// durumuyla, audit_logs'a (moderation.poll.apply / moderation.comment.apply) ve olay outbox'ına (`moderation.applied`,
// kapanan raporlar için `report.resolved`) yazılır; yayını kısıtlayan işlem (HIDE/LOCK/REMOVE) hedefin açık raporlarını
// ACTIONED yapar.
//
// KV-37 genişlemesi: yönetici anket/yorum arama listeleri (admin.content.*), içerik başına rapor + moderasyon geçmişi
// (admin.moderation.history.*), kategori/topluluk taşıma (admin.moderation.polls.move), yalnız yorumları kapatma
// (CLOSE_COMMENTS/OPEN_COMMENTS) ve rapor kuyruğundan uyarı (admin.reports.warn). Etiket değiştirme kapsam dışıdır (#39 kararı).
//
// Kapsam dışı / bilinen açıklar:
// - Yorumda LOCK/UNLOCK ve yorum kapatma desteklenmez (409): KV-17 yalnız ACTIVE yorumu listeler, kilit anket düzeyindedir.
// - Soru metni, açıklama ve seçenek düzenleme yönetici için de yoktur; ilk oydan sonra anlam değiştirme zaten DB'de kilitlidir.
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { toPublicUser } from "../admin-users/view.ts";
import type { AdminCommentRow, AdminPollRow, ContentKind, HistoryRow, ModerationActionName, ModerationStore } from "./store.ts";

export type ModerationDeps = { store: ModerationStore; now: () => Date; mediaPublicBaseUrl: string };

const CONFLICTS = {
  invalid_transition: "Bu içerik mevcut durumundan bu işleme geçemez.",
  unsupported_action: "Bu işlem bu içerik türünde desteklenmiyor.",
  removed: "Kaldırılmış içerik üzerinde bu işlem yapılamaz; önce geri yükleyin.",
  community_changed: "İçerik bu sırada başka bir topluluğa taşındı; sayfayı yenileyip tekrar deneyin.",
} as const;

const pollView = (p: AdminPollRow, base: string) => ({
  id: p.id,
  publicId: p.publicId,
  slug: p.slug,
  kind: p.kind,
  title: p.title,
  status: p.status,
  trendExcluded: p.trendExcluded,
  commentsClosed: p.commentsClosed,
  contentLocked: p.contentLocked,
  author: toPublicUser(p.author, base),
  category: p.category,
  community: p.community,
  voteCount: p.voteCount,
  commentCount: p.commentCount,
  openReportCount: p.openReportCount,
  createdAt: p.createdAt.toISOString(),
});

const commentView = (c: AdminCommentRow, base: string) => ({
  id: c.id,
  pollId: c.pollId,
  pollTitle: c.pollTitle,
  parentId: c.parentId,
  body: c.body,
  status: c.status,
  author: toPublicUser(c.author, base),
  openReportCount: c.openReportCount,
  createdAt: c.createdAt.toISOString(),
});

const historyView = (h: HistoryRow, base: string) =>
  h.kind === "REPORT"
    ? {
        kind: h.kind,
        id: h.id,
        at: h.at.toISOString(),
        reason: h.reason,
        note: h.note,
        status: h.status,
        resolvedAt: h.resolvedAt?.toISOString() ?? null,
        resolvedBy: h.resolvedBy ? toPublicUser(h.resolvedBy, base) : null,
        resolutionNote: h.resolutionNote,
      }
    : {
        kind: h.kind,
        id: h.id,
        at: h.at.toISOString(),
        action: h.action,
        actor: toPublicUser(h.actor, base),
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        reportId: h.reportId,
      };

/** Filtre değeri cursor'a bağlanır; filtre değişince eski cursor 400 INVALID_CURSOR olur. */
const filterKey = (name: string, query: Record<string, unknown>) =>
  `${name}:${Object.entries(query)
    .filter(([key, value]) => key !== "cursor" && key !== "limit" && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&")}`;

const afterOf = (cursor: { keys: (string | number)[]; id: string } | null) => (cursor ? { at: new Date(cursor.keys[0] as string), id: cursor.id } : null);

function pageOf<T extends { id: string; createdAt: Date }>(rows: T[], limit: number, key: string) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(key, [last.createdAt.toISOString()], last.id) : null;
  return { items, page: { nextCursor, hasMore: nextCursor !== null } };
}

export function registerModerationRoutes(route: Route, deps: ModerationDeps): void {
  const { store, now } = deps;
  const base = deps.mediaPublicBaseUrl;

  const register = (kind: ContentKind) =>
    route(`admin.moderation.${kind}`, async ({ params, body, viewer, authorize, moderationScope, request }) => {
      const target = await store.findTarget(kind, params.id);
      if (!target) throw new ApiError("NOT_FOUND", kind === "polls" ? "Anket bulunamadı." : "Yorum bulunamadı.");
      await authorize({ communityId: target.communityId });

      const result = await store.apply({
        kind,
        id: params.id,
        actorId: viewer!.id,
        action: body.action as ModerationActionName,
        reason: body.reason,
        now: now(),
        requestId: request.id,
        actorIsAdmin: (await moderationScope()).all,
        communityId: target.communityId,
      });
      switch (result.kind) {
        case "not_found":
          throw new ApiError("NOT_FOUND", kind === "polls" ? "Anket bulunamadı." : "Yorum bulunamadı.");
        case "forbidden":
          throw new ApiError("FORBIDDEN", "Kaldırılmış içeriği yalnız yönetici geri yükleyebilir.");
        case "conflict":
          throw new ApiError("CONFLICT", CONFLICTS[result.reason], [{ code: result.reason }]);
        default:
          return { status: 200, body: { data: result.outcome } };
      }
    });

  register("polls");
  register("comments");

  // ── Yönetici arama listeleri: gizli ve kaldırılmış içerik dahil; moderatör yalnız kendi toplulukları ──
  route("admin.content.polls", async ({ query, moderationScope }) => {
    const key = filterKey("admin.content.polls", query);
    const rows = await store.listPolls(
      {
        q: query.q,
        status: query.status,
        communityId: query.communityId,
        categoryId: query.categoryId,
        authorId: query.authorId,
        reported: query.reported,
        trendExcluded: query.trendExcluded,
        scope: await moderationScope(),
        after: afterOf(decodeCursor(query.cursor, key)),
      },
      query.limit + 1,
    );
    const { items, page } = pageOf(rows, query.limit, key);
    return { status: 200, body: { data: items.map((p) => pollView(p, base)), page } };
  });

  route("admin.content.comments", async ({ query, moderationScope }) => {
    const key = filterKey("admin.content.comments", query);
    const rows = await store.listComments(
      {
        q: query.q,
        status: query.status,
        pollId: query.pollId,
        communityId: query.communityId,
        authorId: query.authorId,
        reported: query.reported,
        scope: await moderationScope(),
        after: afterOf(decodeCursor(query.cursor, key)),
      },
      query.limit + 1,
    );
    const { items, page } = pageOf(rows, query.limit, key);
    return { status: 200, body: { data: items.map((c) => commentView(c, base)), page } };
  });

  // ── İçerik başına rapor + moderasyon geçmişi ──
  const registerHistory = (kind: ContentKind) =>
    route(`admin.moderation.history.${kind}`, async ({ params, query, authorize }) => {
      const target = await store.findTarget(kind, params.id);
      if (!target) throw new ApiError("NOT_FOUND", kind === "polls" ? "Anket bulunamadı." : "Yorum bulunamadı.");
      await authorize({ communityId: target.communityId });
      const key = `admin.moderation.history.${kind}:${params.id}`;
      const rows = await store.history(kind, params.id, afterOf(decodeCursor(query.cursor, key)), query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = rows.length > query.limit && last ? encodeCursor(key, [last.at.toISOString()], last.id) : null;
      return { status: 200, body: { data: page.map((h) => historyView(h, base)), page: { nextCursor, hasMore: nextCursor !== null } } };
    });
  registerHistory("polls");
  registerHistory("comments");

  // ── Kategori / topluluk taşıma ──
  route("admin.moderation.polls.move", async ({ params, body, viewer, authorize, request }) => {
    const target = await store.findTarget("polls", params.id);
    if (!target) throw new ApiError("NOT_FOUND", "Anket bulunamadı.");
    await authorize({ communityId: target.communityId });
    // Başka topluluğa (veya topluluktan çıkarmaya) taşımak için hedefte de yetki gerekir; null yalnız ADMIN+.
    if (body.communityId !== undefined && body.communityId !== target.communityId) await authorize({ communityId: body.communityId });

    const result = await store.movePoll({
      id: params.id,
      actorId: viewer!.id,
      communityId: target.communityId,
      categoryId: body.categoryId,
      toCommunityId: body.communityId,
      reason: body.reason,
      now: now(),
      requestId: request.id,
    });
    switch (result.kind) {
      case "not_found":
        throw new ApiError("NOT_FOUND", "Anket bulunamadı.");
      case "conflict":
        throw new ApiError("CONFLICT", CONFLICTS[result.reason], [{ code: result.reason }]);
      case "invalid":
        throw new ApiError("VALIDATION_ERROR", result.field === "categoryId" ? "Kategori bulunamadı veya kapalı." : "Topluluk bulunamadı veya kapalı.", [
          { field: result.field, code: result.code },
        ]);
      default:
        return { status: 200, body: { data: pollView(result.item, base) } };
    }
  });

  // ── Rapor kuyruğundan uyarı ──
  route("admin.reports.warn", async ({ params, body, viewer, authorize, moderationScope, request }) => {
    const target = await store.findWarnTarget(params.id);
    if (!target) throw new ApiError("NOT_FOUND", "Rapor bulunamadı.");
    // Önce raporun topluluğu (rapor çözme yetkisiyle), sonra hedef kullanıcıya göre tam karar (sanctionTarget).
    await authorize({ communityId: target.communityId }, "report.resolve");
    if (target.userId === null) throw new ApiError("CONFLICT", "Raporun hedefinin sahibi bulunamadı.", [{ code: "no_target_user" }]);
    await authorize({ communityId: target.communityId, targetUserId: target.userId, targetRoles: target.roles });
    // Moderatör yalnız sıradan hesabı uyarır; kadro (moderatör, admin) yönetici işidir.
    if (!(await moderationScope()).all && target.roles.some((role) => role !== "USER")) {
      throw new ApiError("FORBIDDEN", "Moderatör yönetici kadrosundaki hesabı uyaramaz.");
    }
    if (target.status !== "OPEN") throw new ApiError("CONFLICT", "Rapor zaten sonuçlandırılmış.", [{ code: "already_resolved" }]);

    const result = await store.warnReportTarget({ reportId: params.id, actorId: viewer!.id, reason: body.reason, now: now(), requestId: request.id });
    switch (result.kind) {
      case "not_found":
        throw new ApiError("NOT_FOUND", "Rapor bulunamadı.");
      case "conflict":
        throw new ApiError(
          "CONFLICT",
          result.reason === "no_target_user" ? "Raporun hedefinin sahibi bulunamadı." : "Rapor zaten sonuçlandırılmış.",
          [{ code: result.reason }],
        );
      default:
        return { status: 200, body: { data: { sanctionId: result.sanctionId, userId: result.userId, closedReports: result.closedReports } } };
    }
  });
}
