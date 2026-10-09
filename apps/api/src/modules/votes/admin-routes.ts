// Oy geçersiz sayma / geri alma — KV-43 (#45). Sözleşme: contracts/domains/moderation.ts (admin.votes.invalidate,
// admin.votes.restore). Yetki vote.invalidate (ADMIN+), router kapısında. Kurallar: DATA_MODEL §5.4.
//
// - Sayaçlar ve sonuç aynı transaction'da düzelir. Günlük snapshot'lar ve trendler worker'da yeniden üretilir
//   (polls.snapshots_stale_since; trends.refresh en geç 5 dk).
// - Ban/askı tek başına oyları geçersiz saymaz: bu endpoint her zaman ayrı ve gerekçeli işlemdir.
// - İz: vote_events (INVALIDATE/RESTORE, oy başına aktör + gerekçe + zaman, append-only) ve aynı transaction'da
//   audit_logs (KV-39): etkilenen her anket için bir kayıt (vote.invalidate → invalidate | restore).
// Bilinen açık: vote.invalidated olayı (olay outbox'ı henüz yok).
import type { Route } from "../../http/route.ts";
import type { InvalidationTarget, VoteStore } from "./store.ts";

export type VoteAdminDeps = { store: VoteStore; now: () => Date };

export function registerVoteAdminRoutes(route: Route, deps: VoteAdminDeps): void {
  route("admin.votes.invalidate", async ({ body, viewer, request }) => {
    const result = await deps.store.invalidateVotes(body.target as InvalidationTarget, {
      reason: body.reason,
      actorId: viewer!.id,
      requestId: request.id,
      now: deps.now(),
    });
    return { status: 200, body: { data: result } };
  });

  route("admin.votes.restore", async ({ body, viewer, request }) => {
    const result = await deps.store.restoreVotes(body.voteIds, { reason: body.reason, actorId: viewer!.id, requestId: request.id, now: deps.now() });
    return { status: 200, body: { data: result } };
  });
}
