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
// Kapsam dışı / bilinen açıklar:
// - Yorumda LOCK/UNLOCK desteklenmez (409): KV-17 yalnız ACTIVE yorumu listeler, kilit anket düzeyindedir.
// - İçerik düzenleme, kategori/etiket/topluluk değiştirme (KV-37 kapsam metni) için sözleşmede endpoint yok.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { ContentKind, ModerationActionName, ModerationStore } from "./store.ts";

export type ModerationDeps = { store: ModerationStore; now: () => Date };

const CONFLICTS = {
  invalid_transition: "Bu içerik mevcut durumundan bu işleme geçemez.",
  unsupported_action: "Bu işlem bu içerik türünde desteklenmiyor.",
  removed: "Kaldırılmış içerik trend ayarı değiştirilemez; önce geri yükleyin.",
} as const;

export function registerModerationRoutes(route: Route, deps: ModerationDeps): void {
  const { store, now } = deps;

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
}
