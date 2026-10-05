// polls.expire — KV-21 PR-4a (#23). Süresi dolan anketler için poll.closed (EXPIRED) olayı. Kurallar:
// docs/KV-21_NOTIFICATIONS.md §7.
//
// Anket closes_at geçince pasif olarak kapalı sayılır (polls/view.ts isClosed); closed_at yalnız elle kapatmada dolar ve bu
// job da onu doldurmaz (DATA_MODEL: "etkin kapanış = LEAST(closes_at, closed_at)"). Job yalnız olayı üretir.
//
// - Aday: POLL, closed_at NULL, closes_at ≤ şimdi ve alt sınırdan sonra, olayı henüz yok (natural key poll.closed:<anket>,
//   domain_events_natural_key_key). Index: polls_closes_at_idx. Tur başına en fazla BATCH_SIZE; kalanlar sonraki turda.
// - Alt sınır: olaylar 30 gün saklanır, geriye bakış 7 gün (NOT EXISTS yeniden üretmeyi engeller). Deploy anında eski
//   kapanışlar için bildirim yağmuru olmasın diye: hiç EXPIRED olay yoksa son 1 saat; varsa max(şimdi − 7 gün, en eski
//   EXPIRED olayın zamanı). Böylece deploy öncesi kapanışlar hiçbir zaman olay üretmez (index domain_events_poll_expired_idx).
// - Her anket ayrı transaction: anket satırı FOR UPDATE (elle kapatma, oy ve yorumla aynı kilit), koşul kilitten sonra
//   okunur. Elle kapatma ile aynı anda olursa ya biri kapatır ya diğeri; natural key ayrıca tek olay garantisi verir.
import { createEvent, newEventId } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import type { EventLog } from "../events/consumers.ts";
import { writeWorkerEvent } from "../events/write.ts";

export const POLLS_EXPIRE_QUEUE = "polls.expire";
/** Her dakika (sanctions.expire emsali): olay en geç ~90 sn içinde. */
export const POLLS_EXPIRE_CRON = "* * * * *";
export const BATCH_SIZE = 500;
export const LOOKBACK_MS = 7 * 24 * 60 * 60_000;
export const FIRST_RUN_LOOKBACK_MS = 60 * 60_000;

export type PollExpiryDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: EventLog;
  batchSize?: number;
  /** Sadece test: anket satırı kilitlendikten sonra, koşul okunmadan önce. */
  afterLock?: (pollId: string) => Promise<void>;
};

export type PollExpiryResult = { since: string; candidates: number; emitted: number; skipped: number; failed: number };

/** Adayların alt sınırı: first = en eski süre dolumu olayının zamanı (yoksa null, ilk tur). */
export function boundFrom(first: Date | null, now: Date): Date {
  if (!first) return new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  return new Date(Math.max(now.getTime() - LOOKBACK_MS, first.getTime()));
}

export async function lowerBound(prisma: PrismaClient, now: Date): Promise<Date> {
  const [row] = await prisma.$queryRaw<{ first: Date | null }[]>`
    SELECT min(occurred_at) AS first FROM domain_events WHERE type = 'poll.closed' AND actor_id IS NULL`;
  return boundFrom(row?.first ?? null, now);
}

export async function findExpired(prisma: PrismaClient, since: Date, now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id::text AS id FROM polls p
    WHERE p.kind = 'POLL' AND p.closed_at IS NULL
      AND p.closes_at <= ${now.toISOString()}::timestamptz AND p.closes_at >= ${since.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM domain_events e WHERE e.natural_key = 'poll.closed:' || p.id::text)
    ORDER BY p.closes_at, p.id
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** Tek anket: kilitle, hâlâ süresi dolmuş ve elle kapatılmamışsa olayı yaz. Olay yazıldıysa true. */
export async function emitExpired(deps: PollExpiryDeps, pollId: string): Promise<boolean> {
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const [poll] = await tx.$queryRaw<{ closesAt: Date | null; closedAt: Date | null }[]>`
      SELECT closes_at AS "closesAt", closed_at AS "closedAt" FROM polls WHERE id = ${pollId}::uuid FOR UPDATE`;
    await deps.afterLock?.(pollId);
    if (!poll || poll.closedAt !== null || poll.closesAt === null || poll.closesAt > now) return false;
    const at = poll.closesAt;
    const { written } = await writeWorkerEvent(
      tx,
      createEvent({ id: newEventId(at), type: "poll.closed", occurredAt: at.toISOString(), actorId: null, subject: { type: "POLL", id: pollId }, payload: { reason: "EXPIRED", closedAt: at.toISOString() } }),
    );
    return written;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function expirePolls(deps: PollExpiryDeps): Promise<PollExpiryResult> {
  const now = deps.now();
  const since = await lowerBound(deps.prisma, now);
  const ids = await findExpired(deps.prisma, since, now, deps.batchSize ?? BATCH_SIZE);
  const result: PollExpiryResult = { since: since.toISOString(), candidates: ids.length, emitted: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      if (await emitExpired(deps, id)) result.emitted++;
      else result.skipped++;
    } catch (err) {
      // Bir anketteki hata turu durdurmaz; sonraki turda yeniden denenir.
      result.failed++;
      deps.log("error", "polls.expire anket olayı yazılamadı", { pollId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
