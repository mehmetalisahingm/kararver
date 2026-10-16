// Tekil moderasyon kararının güvenli geri alınması — #183 (KV-37 §10). Sözleşme: contracts/domains/moderation.ts
// (admin.moderation.actions.undoPreview / .undo).
//
// Telafi kararı yeni bir moderation_actions satırıdır (undo_of_id) ve normal moderasyon yolundan (ModerationStore.apply) geçer; geçmiş
// kayıtlar (audit dahil) değişmez. Toplu geri almayla (undo-routes.ts) aynı güvenceler:
//  1. Yalnız önceden tanımlı çiftler (inverseDecision): kararın önceki durumuna tam dönüş sağlayanlar.
//  2. Sürüm koşulu apply içinde, satır kilidi altında doğrulanır: şimdiki durum kararın bıraktığı durum ve hedefin son kararı bu karar.
//  3. İçerik sahibi silinmişse içerik asla geri getirilmez (author_erased).
//  4. Yetki geri alma anındaki aktörle verilir; moderatör yalnız KENDİ kararını, ADMIN+ herhangi birini geri alır.
//  5. Bir karar en çok bir kez geri alınır (UNIQUE undo_of_id); geri almanın geri alması yok (tekil veya toplu geri alma ürünü satırlar).
import { createHash } from "node:crypto";
import { ApiError } from "../../http/errors.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import type { ActionRecord, BulkItemState } from "./bulk.ts";
import type { BulkModerationDeps } from "./bulk-routes.ts";
import type { ContentStatus, ModerationActionName } from "./store.ts";

type Blocked = "forbidden" | "admin_required" | "not_reversible" | "is_undo" | "status_changed" | "superseded" | "author_erased";

/**
 * Kararın tek işlemle önceki duruma döndüren telafisi; yoksa null.
 * HIDE/REMOVE (önceki ACTIVE) → RESTORE; RESTORE (önceki HIDDEN) → HIDE, (önceki REMOVED) → REMOVE; anketlerde LOCK (ACTIVE) ↔ UNLOCK,
 * EXCLUDE_FROM_TRENDS ↔ INCLUDE_IN_TRENDS, CLOSE_COMMENTS ↔ OPEN_COMMENTS. Uyarı, yaptırım, rapor reddi, taşıma ve görsel kararları geri alınmaz.
 */
export function inverseDecision(rec: Pick<ActionRecord, "kind" | "action" | "fromStatus">): ModerationActionName | null {
  const poll = rec.kind === "polls";
  switch (rec.action) {
    case "HIDE":
    case "REMOVE":
      return rec.fromStatus === "ACTIVE" ? "RESTORE" : null;
    case "RESTORE":
      return rec.fromStatus === "HIDDEN" ? "HIDE" : rec.fromStatus === "REMOVED" ? "REMOVE" : null;
    case "LOCK":
      return poll && rec.fromStatus === "ACTIVE" ? "UNLOCK" : null;
    case "UNLOCK":
      return poll && rec.fromStatus === "LOCKED" ? "LOCK" : null;
    case "EXCLUDE_FROM_TRENDS":
      return poll ? "INCLUDE_IN_TRENDS" : null;
    case "INCLUDE_IN_TRENDS":
      return poll ? "EXCLUDE_FROM_TRENDS" : null;
    case "CLOSE_COMMENTS":
      return poll ? "OPEN_COMMENTS" : null;
    case "OPEN_COMMENTS":
      return poll ? "CLOSE_COMMENTS" : null;
    default:
      return null;
  }
}

/** Önizleme özeti: karar, şimdiki durum, hedefin son kararı ve geri alınma durumu; farklıysa uygulama preview_stale olur. */
export function actionUndoDigest(rec: ActionRecord, state: BulkItemState, latestActionId: string | null): string {
  return createHash("sha256")
    .update(`undo-action\n${rec.id}\n${state.status}|${state.communityId ?? "-"}|${latestActionId ?? "-"}|${rec.undoneByActionId ?? "-"}`)
    .digest("hex");
}

const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

const BLOCKED_MESSAGES: Record<Blocked, string> = {
  forbidden: "Bu içerik için yetkin yok.",
  admin_required: "Kaldırılmış içeriği yalnız yönetici geri yükleyebilir.",
  not_reversible: "Bu karar tek işlemle önceki duruma döndürülemez.",
  is_undo: "Geri alma kararı tekrar geri alınamaz; gerekirse yeni bir karar ver.",
  status_changed: "İçeriğin durumu karardan sonra değişti; geri alınamaz.",
  superseded: "Araya daha yeni bir karar girdi; bu karar geri alınamaz.",
  author_erased: "İçerik sahibinin hesabı silinmiş; içerik geri getirilmez.",
};

export function registerSingleUndoRoutes(route: Route, deps: BulkModerationDeps): void {
  const { store, batches, now } = deps;

  async function plan(ctx: RouteContext, actionId: string) {
    const rec = await batches.loadAction(actionId);
    const admin = (await ctx.moderationScope()).all;
    // Moderatör başkasının kararını göremez (varlığı da ele verilmez); görsel/kullanıcı hedefli kararlar bu yolun dışındadır.
    if (!rec || (!admin && rec.actorId !== ctx.viewer!.id)) throw new ApiError("NOT_FOUND", "Karar bulunamadı.");
    const [states, latest, erased] = await Promise.all([batches.inspect(rec.kind, [rec.targetId]), batches.latestActions(rec.kind, [rec.targetId]), batches.erasedAuthors(rec.kind, [rec.targetId])]);
    const state = states.get(rec.targetId);
    if (!state) throw new ApiError("NOT_FOUND", "Kararın hedefi bulunamadı.");
    const latestActionId = latest.get(rec.targetId) ?? null;

    let allowed = true;
    try {
      // Uç noktanın kendi işlemi (kaynak kontrolü işareti) ve yorum kararlarında yorum işlemi; kurallar aynı kapsamı ister.
      await ctx.authorize({ communityId: state.communityId });
      if (rec.kind === "comments") await ctx.authorize({ communityId: state.communityId }, "moderation.comment.apply");
    } catch (err) {
      if (err instanceof ApiError && err.code === "FORBIDDEN") allowed = false;
      else throw err;
    }

    const undoAction = inverseDecision(rec);
    let outcome: "WILL_UNDO" | "BLOCKED" | "ALREADY_UNDONE" = "BLOCKED";
    let blocked: Blocked | null = null;
    if (rec.undoneByActionId) outcome = "ALREADY_UNDONE";
    else if (!allowed) blocked = "forbidden";
    else if (rec.undoOfId || rec.viaUndoBatch) blocked = "is_undo";
    else if (!undoAction) blocked = "not_reversible";
    else if (undoAction === "RESTORE" && state.status === "REMOVED" && !admin) blocked = "admin_required";
    else if (erased.has(rec.targetId)) blocked = "author_erased";
    else if (state.status !== rec.toStatus) blocked = "status_changed";
    else if (latestActionId !== rec.id) blocked = "superseded";
    else outcome = "WILL_UNDO";

    return { rec, state, latestActionId, undoAction, outcome, blocked, allowed, admin, digest: actionUndoDigest(rec, state, latestActionId) };
  }

  route("admin.moderation.actions.undoPreview", async (ctx) => {
    const p = await plan(ctx, ctx.params.id);
    return {
      status: 200,
      body: {
        data: {
          actionId: p.rec.id,
          kind: p.rec.kind,
          targetId: p.rec.targetId,
          label: p.allowed ? p.state.label : null,
          originalAction: p.rec.action as never,
          undoAction: p.undoAction as never,
          currentStatus: p.state.status,
          outcome: p.outcome,
          blocked: p.blocked,
          digest: p.digest,
        },
      },
    };
  });

  route("admin.moderation.actions.undo", async (ctx) => {
    const { body, viewer, request } = ctx;
    const at = now();
    const p = await plan(ctx, ctx.params.id);
    if (p.outcome === "ALREADY_UNDONE") throw conflict("Bu karar zaten geri alınmış.", "already_undone");
    if (p.blocked === "forbidden" || p.blocked === "admin_required") throw new ApiError("FORBIDDEN", BLOCKED_MESSAGES[p.blocked]);
    if (p.blocked) throw conflict(BLOCKED_MESSAGES[p.blocked], p.blocked);
    if (p.digest !== body.digest) throw conflict("Kayıt önizlemeden sonra değişti; önizlemeyi yenile.", "preview_stale");

    // Sürüm koşulu (durum + son karar + sahip silinmemiş) ve tekillik apply içinde kilit altında yeniden doğrulanır.
    const result = await store.apply({
      kind: p.rec.kind,
      id: p.rec.targetId,
      actorId: viewer!.id,
      action: p.undoAction!,
      reason: body.reason,
      now: at,
      requestId: request.id,
      actorIsAdmin: p.admin,
      communityId: p.state.communityId,
      expect: { actionId: p.rec.id, status: p.rec.toStatus as ContentStatus },
      undoOf: p.rec.id,
    });
    switch (result.kind) {
      case "applied":
        return { status: 200, body: { data: { actionId: result.trail.actionId, undoOfId: p.rec.id, outcome: result.outcome } } };
      case "unchanged":
        throw conflict("Geri alınacak bir değişiklik kalmadı.", "status_changed");
      case "forbidden":
        throw new ApiError("FORBIDDEN", BLOCKED_MESSAGES.admin_required);
      case "not_found":
        throw new ApiError("NOT_FOUND", "Kararın hedefi bulunamadı.");
      default:
        throw conflict(result.reason === "community_changed" ? "İçerik başka topluluğa taşındı; önizlemeyi yenile." : (BLOCKED_MESSAGES[result.reason as Blocked] ?? "Karar geri alınamadı."), result.reason === "invalid_transition" || result.reason === "unsupported_action" || result.reason === "removed" ? "not_reversible" : result.reason);
    }
  });
}
