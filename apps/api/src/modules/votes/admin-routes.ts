// Oy geçersiz sayma / geri alma — KV-43 (#45). Sözleşme: contracts/domains/moderation.ts (admin.votes.invalidate,
// admin.votes.restore). Yetki vote.invalidate (ADMIN+), router kapısında. Kurallar: DATA_MODEL §5.4.
//
// - Sayaçlar ve sonuç aynı transaction'da düzelir. Günlük snapshot'lar ve trendler worker'da yeniden üretilir
//   (polls.snapshots_stale_since; trends.refresh en geç 5 dk).
// - Ban/askı tek başına oyları geçersiz saymaz: bu endpoint her zaman ayrı ve gerekçeli işlemdir.
// - İz: vote_events (INVALIDATE/RESTORE, aktör + gerekçe + zaman, append-only).
// Bilinen açık: audit_logs (KV-39, #41) ve vote.invalidated olayı (olay outbox'ı henüz yok) gelince buraya eklenecek.
import type { Route } from "../../http/route.ts";
import type { InvalidationTarget, VoteStore } from "./store.ts";

export type VoteAdminDeps = { store: VoteStore; now: () => Date };

export function registerVoteAdminRoutes(route: Route, deps: VoteAdminDeps): void {
  route("admin.votes.invalidate", async ({ body, viewer }) => {
    const result = await deps.store.invalidateVotes(body.target as InvalidationTarget, { reason: body.reason, actorId: viewer!.id, now: deps.now() });
    return { status: 200, body: { data: result } };
  });

  route("admin.votes.restore", async ({ body, viewer }) => {
    const result = await deps.store.restoreVotes(body.voteIds, { reason: body.reason, actorId: viewer!.id, now: deps.now() });
    return { status: 200, body: { data: result } };
  });
}
