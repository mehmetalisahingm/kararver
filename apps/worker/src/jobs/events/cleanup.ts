// Outbox saklaması — KV-21 PR-2 (#23), karar: docs/KV-21_NOTIFICATIONS.md §4.
//
// Silinen: bütün teslimleri DONE olan ve son DONE'u (teslimsiz olayda dağıtım anı) 30 günden eski olaylar; teslim
// satırları ON DELETE CASCADE ile gider. Asla silinmeyen: dağıtılmamış olay, ayrıştırılamamış olay (dispatch_error),
// PENDING veya DEAD teslimi olan olay. Olay satırı kilitlenmez; işleme ve dağıtmayla çakışmaz (DONE teslime kimse yazmaz).
// Her çalışmada izleme sayıları loglanır: DEAD teslim, eski PENDING, eski dağıtılmamış ve ayrıştırılamamış olay.
import { Prisma, type PrismaClient } from "@kararver/db";
import type { EventLog } from "./consumers.ts";

export const RETENTION_DAYS = 30;
export const CLEANUP_BATCH = 5000;
/** Bu kadar eski PENDING teslim veya dağıtılmamış olay izleme uyarısıdır. */
export const STALE_MS = 10 * 60_000;

export type CleanupDeps = { prisma: PrismaClient; now: () => Date; log: EventLog; batchSize?: number };
export type CleanupResult = { deleted: number; dead: number; stalePending: number; staleUndispatched: number; unparseable: number };

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
}

export async function cleanupEvents(deps: CleanupDeps): Promise<CleanupResult> {
  const now = deps.now();
  const cutoff = retentionCutoff(now).toISOString();
  const batch = deps.batchSize ?? CLEANUP_BATCH;
  let deleted = 0;
  for (;;) {
    const n = await deps.prisma.$executeRaw(Prisma.sql`
      DELETE FROM domain_events WHERE id IN (
        SELECT e.id FROM domain_events e
        WHERE e.dispatched_at < ${cutoff}::timestamptz AND e.dispatch_error IS NULL
          AND NOT EXISTS (SELECT 1 FROM domain_event_deliveries d
                          WHERE d.event_id = e.id AND (d.status <> 'DONE' OR d.processed_at >= ${cutoff}::timestamptz))
        LIMIT ${batch})`);
    deleted += n;
    if (n < batch) break;
  }

  const stale = new Date(now.getTime() - STALE_MS);
  const [dead, stalePending, staleUndispatched, unparseable] = await Promise.all([
    deps.prisma.eventDelivery.count({ where: { status: "DEAD" } }),
    deps.prisma.eventDelivery.count({ where: { status: "PENDING", createdAt: { lt: stale } } }),
    deps.prisma.domainEvent.count({ where: { dispatchedAt: null, createdAt: { lt: stale } } }),
    deps.prisma.domainEvent.count({ where: { dispatchError: { not: null } } }),
  ]);
  const result = { deleted, dead, stalePending, staleUndispatched, unparseable };
  deps.log(dead + stalePending + staleUndispatched + unparseable > 0 ? "warn" : "info", "events.cleanup bitti", result);
  return result;
}
