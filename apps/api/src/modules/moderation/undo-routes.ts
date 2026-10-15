// Toplu işlemin güvenli geri alınması — #183 (KV-37 §bulk). Sözleşme: contracts/domains/moderation.ts
// (admin.moderation.batches.undoPreview / .undo). Kurallar: docs/KV-37_BULK_MODERATION.md §geri alma.
//
// Geri alma yeni bir partidir ve her kayıt için bir TELAFİ KARARIDIR: normal moderasyon yolundan (ModerationStore.apply) geçer,
// kendi moderation_actions + audit + olay kaydını yazar; geçmiş kayıtlar (audit dahil) değişmez. Güvenlik:
//  1. Yalnız önceden tanımlı çiftler (inverseOf): kararın önceki durumuna tam dönüş sağlayanlar.
//  2. Sürüm koşulu apply içinde, satır kilidi altında doğrulanır: içeriğin şimdiki durumu kararın bıraktığı durum ve hedefin
//     son kararı bu karar olmalı (araya daha yeni karar girdiyse superseded). Kontrol ile yazma arasında boşluk yoktur.
//  3. İçerik sahibi silinmiş/anonimleştirilmişse içerik asla geri getirilmez (author_erased).
//  4. Yetki geri alma anındaki aktörle, kayıt başına yeniden verilir (moderatör yalnız kapsamındaki, kaldırılmışı geri yüklemek ADMIN+).
//  5. Öğe başına en çok bir geri alma; geri almanın geri alması yok; moderatör yalnız kendi partisini geri alır.
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { rateLimitError } from "../rate-limit/limiter.ts";
import type { BulkModerationDeps } from "./bulk-routes.ts";
import { BATCH_HOURLY_LIMIT, inverseOf, undoDigest, type BatchItemRecord, type BulkAction, type UndoBatch } from "./bulk.ts";

const HOUR_MS = 60 * 60 * 1000;

type Blocked = "not_found" | "forbidden" | "admin_required" | "not_reversible" | "status_changed" | "superseded" | "author_erased";
type Row = {
  id: string;
  item: UndoBatch["items"][number];
  label: string | null;
  status: string | null;
  communityId: string | null;
  latestActionId: string | null;
  undoAction: BulkAction | null;
  outcome: "WILL_UNDO" | "BLOCKED" | "ALREADY_UNDONE";
  blocked: Blocked | null;
};

export function registerUndoRoutes(route: Route, deps: BulkModerationDeps): void {
  const { store, batches, now } = deps;
  const conflict = (message: string, code: string) => new ApiError("CONFLICT", message, [{ code }]);

  async function plan(
    ctx: {
      viewer: { id: string } | null;
      authorize(resource: { communityId: string | null }, action?: "moderation.poll.apply" | "moderation.comment.apply"): Promise<void>;
      moderationScope(): Promise<{ all: boolean }>;
    },
    batchId: string,
  ) {
    const batch = await batches.loadBatch(batchId);
    const admin = (await ctx.moderationScope()).all;
    // Moderatör başkasının partisini göremez (varlığı da ele verilmez).
    if (!batch || (!admin && batch.actorId !== ctx.viewer!.id)) throw new ApiError("NOT_FOUND", "Toplu işlem bulunamadı.");
    if (batch.undoOfId !== null) throw conflict("Geri alma partisi tekrar geri alınamaz; gerekirse yeni bir toplu işlem yapın.", "not_undoable");
    if (!batch.finishedAt) throw conflict("Bu parti henüz bitmedi; bitince geri alınabilir.", "not_undoable");

    const ids = batch.items.map((i) => i.targetId);
    const [states, latest, erased] = ids.length > 0 ? await Promise.all([batches.inspect(batch.kind, ids), batches.latestActions(batch.kind, ids), batches.erasedAuthors(batch.kind, ids)]) : [new Map(), new Map<string, string>(), new Set<string>()];
    const authAction = batch.kind === "polls" ? "moderation.poll.apply" : "moderation.comment.apply";

    const rows: Row[] = [];
    for (const item of batch.items) {
      const state = states.get(item.targetId) ?? null;
      const latestActionId = latest.get(item.targetId) ?? null;
      const undoAction = inverseOf(batch.action, item.fromStatus);
      const base = { id: item.targetId, item, status: state?.status ?? null, communityId: state?.communityId ?? null, latestActionId, undoAction };
      const blocked = (code: Blocked, label: string | null = null): Row => ({ ...base, label, outcome: "BLOCKED", blocked: code });
      if (item.undoneByBatchId) rows.push({ ...base, label: null, outcome: "ALREADY_UNDONE", blocked: null });
      else if (!state) rows.push(blocked("not_found"));
      else if (!undoAction) rows.push(blocked("not_reversible"));
      else {
        let allowed = true;
        try {
          // Uç noktanın kendi işlemi (kaynak kontrolü işareti) ve yorum partilerinde yorum işlemi; kurallar aynı kapsamı ister.
          await ctx.authorize({ communityId: state.communityId });
          if (authAction !== "moderation.poll.apply") await ctx.authorize({ communityId: state.communityId }, authAction);
        } catch (err) {
          if (err instanceof ApiError && err.code === "FORBIDDEN") allowed = false;
          else throw err;
        }
        if (!allowed) rows.push(blocked("forbidden"));
        else if (undoAction === "RESTORE" && state.status === "REMOVED" && !admin) rows.push(blocked("admin_required", state.label));
        else if (erased.has(item.targetId)) rows.push(blocked("author_erased", state.label));
        else if (state.status !== item.toStatus) rows.push(blocked("status_changed", state.label));
        else if (latestActionId !== item.moderationActionId) rows.push(blocked("superseded", state.label));
        else rows.push({ ...base, label: state.label, outcome: "WILL_UNDO", blocked: null });
      }
    }
    const digest = undoDigest(batch.id, rows.map((r) => ({ id: r.id, status: r.status, communityId: r.communityId, latestActionId: r.latestActionId, undone: r.item.undoneByBatchId !== null })));
    return { batch, rows, digest, admin };
  }

  route("admin.moderation.batches.undoPreview", async (ctx) => {
    const { batch, rows, digest } = await plan(ctx, ctx.params.id);
    const count = (o: Row["outcome"]) => rows.filter((r) => r.outcome === o).length;
    if (rows.length === 0 || count("ALREADY_UNDONE") === rows.length) throw conflict("Geri alınacak karar kalmadı.", "nothing_to_undo");
    return {
      status: 200,
      body: {
        data: {
          batchId: batch.id,
          kind: batch.kind,
          originalAction: batch.action,
          digest,
          summary: { willUndo: count("WILL_UNDO"), blocked: count("BLOCKED"), alreadyUndone: count("ALREADY_UNDONE") },
          items: rows.map((r) => ({ id: r.id, label: r.label, status: (r.status as never) ?? null, undoAction: r.undoAction, outcome: r.outcome, blocked: r.blocked })),
        },
      },
    };
  });

  route("admin.moderation.batches.undo", async (ctx) => {
    const { body, viewer, request } = ctx;
    const at = now();
    const { batch, rows, digest, admin } = await plan(ctx, ctx.params.id);
    const candidates = rows.filter((r) => r.outcome !== "ALREADY_UNDONE");
    // Geri alınabilir hiçbir karar yoksa (hepsi engelli veya zaten geri alınmış) boş bir geri alma partisi açılmaz.
    if (!candidates.some((r) => r.outcome === "WILL_UNDO")) throw conflict("Geri alınabilir karar yok.", "nothing_to_undo");
    if (digest !== body.digest) throw conflict("Kayıtlar önizlemeden sonra değişti; önizlemeyi yenile.", "preview_stale");
    if ((await batches.recentBatchCount(viewer!.id, new Date(at.getTime() - HOUR_MS))) >= BATCH_HOURLY_LIMIT) throw rateLimitError(HOUR_MS / 1000 / 4);

    const undoBatchId = await batches.startBatch({ actorId: viewer!.id, kind: batch.kind, action: batch.action, reason: body.reason, digest, requestId: request.id, total: candidates.length, now: at, undoOfId: batch.id });
    const counts = { applied: 0, unchanged: 0, failed: 0 };
    const items: Array<{ id: string; result: "APPLIED" | "UNCHANGED" | "FAILED"; code: string | null; undoAction: BulkAction | null; fromStatus: string | null; toStatus: string | null }> = [];

    for (const r of candidates) {
      let record: BatchItemRecord;
      if (r.outcome === "BLOCKED") {
        counts.failed += 1;
        record = { targetId: r.id, communityId: r.communityId, result: "FAILED", detail: r.blocked, fromStatus: r.status, toStatus: null, moderationActionId: null };
      } else {
        // Sürüm koşulu (durum + son karar + sahip silinmemiş) apply içinde kilit altında yeniden doğrulanır.
        const result = await store.apply({
          kind: batch.kind,
          id: r.id,
          actorId: viewer!.id,
          action: r.undoAction!,
          reason: body.reason,
          now: at,
          requestId: request.id,
          actorIsAdmin: admin,
          communityId: r.communityId,
          expect: { actionId: r.item.moderationActionId, status: r.item.toStatus as never },
        });
        if (result.kind === "applied") {
          counts.applied += 1;
          record = { targetId: r.id, communityId: r.communityId, result: "APPLIED", detail: null, fromStatus: result.trail.from, toStatus: result.trail.to, moderationActionId: result.trail.actionId };
        } else if (result.kind === "unchanged") {
          counts.unchanged += 1;
          record = { targetId: r.id, communityId: r.communityId, result: "UNCHANGED", detail: null, fromStatus: result.outcome.status, toStatus: result.outcome.status, moderationActionId: null };
        } else {
          counts.failed += 1;
          const detail: Blocked | "community_changed" =
            result.kind === "forbidden" ? "admin_required" : result.kind === "not_found" ? "not_found" : result.reason === "superseded" || result.reason === "author_erased" || result.reason === "community_changed" ? result.reason : "not_reversible";
          record = { targetId: r.id, communityId: r.communityId, result: "FAILED", detail, fromStatus: r.status, toStatus: null, moderationActionId: null };
        }
      }
      await batches.recordItem(undoBatchId, record, at);
      // Öğe başına en çok bir geri alma: yalnız telafi gerçekten uygulandıysa işaretlenir.
      if (record.result === "APPLIED") await batches.markUndone(batch.id, r.id, undoBatchId);
      items.push({ id: r.id, result: record.result, code: record.detail, undoAction: r.undoAction, fromStatus: record.fromStatus, toStatus: record.toStatus });
    }
    await batches.finishBatch(undoBatchId, counts, now());
    return { status: 200, body: { data: { batchId: undoBatchId, undoOfId: batch.id, summary: { total: candidates.length, ...counts }, items } } };
  });
}
