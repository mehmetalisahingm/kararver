// snapshots.daily — KV-29 (#31). Kurallar: docs/DATA_MODEL.md §8 (Europe/Istanbul takvim günü), docs/KV-29_SNAPSHOTS_MOVERS.md.
//
// Bir anketin bir İstanbul günü için satırı, o günün sonundaki (cutoff_at = ertesi gün 00:00 İstanbul) geçerli oy
// dağılımıdır. Kaynak vote_events'tir: her kullanıcının cutoff_at'ten önceki son olayı alınır; CAST/CHANGE/RESTORE
// ise to_option_id'ye sayılır, INVALIDATE ise sayılmaz. Şu an geçersiz sayılmış oylar hiç sayılmaz (§5.4).
// - Kullanıcı başına son olay alındığı için oy değiştiren kişi bir kez sayılır.
// - Job geç veya tekrar çalışsa sonuç aynıdır: (poll_id, local_date) üzerine upsert.
// - Eksik geçmiş uydurulmaz: satır sadece vote_events'ten hesaplanabilen, bitmiş günler için yazılır.
import { Prisma, type PrismaClient } from "@kararver/db";

export const SNAPSHOTS_QUEUE = "snapshots.daily";
/** DATA_MODEL §8.2 "Zamanlama" (DAILY_SNAPSHOT_CRON), TECH_DECISIONS §3.5. */
export const SNAPSHOTS_CRON = "5 0 * * *";
export const SNAPSHOT_TIME_ZONE = "Europe/Istanbul";
/** Hesap kuralı değişirse (ör. KV-43 geçersiz oy) artar; satırlar yeniden üretilir. */
export const SNAPSHOT_CALCULATION_VERSION = 1;
/** Her çalıştırmada bugünden geriye kaç bitmiş gün yeniden hesaplanır (kaçırılan çalıştırmayı telafi). */
export const CATCH_UP_DAYS = 3;

export type SnapshotJobDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
};

/** `now` anındaki İstanbul takvim günü (YYYY-MM-DD). */
export function istanbulDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SNAPSHOT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(localDate: string, days: number): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Bir İstanbul günü için snapshot'ları yazar ve yazılan anket sayısını döner. Gün bitmemişse (cutoff > now)
 * hiçbir şey yazılmaz. İşlenen anketler: gün sonuna kadar açılmış ve gün başında hâlâ açık olanlar (açık
 * olanlar ve o gün kapananlar). pollIds verilirse sadece o anketler (KV-43 düzeltmesi).
 */
export async function snapshotDay(deps: SnapshotJobDeps, localDate: string, pollIds?: string[]): Promise<number> {
  const now = deps.now().toISOString();
  const only = (column: Prisma.Sql) => (pollIds ? Prisma.sql`AND ${column} = ANY(${pollIds}::uuid[])` : Prisma.empty);
  return deps.prisma.$transaction(async (tx) => {
    const days = await tx.$executeRaw`
      WITH bounds AS (
        SELECT ${localDate}::date AS local_date,
          ((${localDate}::date + 1)::timestamp AT TIME ZONE ${SNAPSHOT_TIME_ZONE}) AS cutoff_at,
          (${localDate}::date::timestamp AT TIME ZONE ${SNAPSHOT_TIME_ZONE}) AS day_start
      ),
      polls_in AS (
        SELECT p.id, (p.opens_at AT TIME ZONE ${SNAPSHOT_TIME_ZONE})::date AS open_local_date
        FROM polls p, bounds b
        WHERE b.cutoff_at <= ${now}::timestamptz
          AND p.opens_at < b.cutoff_at
          AND coalesce(p.closed_at, p.closes_at) > b.day_start
          ${only(Prisma.sql`p.id`)}
      ),
      last_event AS (
        SELECT DISTINCT ON (e.poll_id, e.user_id) e.poll_id, e.vote_id, e.type, e.to_option_id
        FROM vote_events e JOIN polls_in pi ON pi.id = e.poll_id, bounds b
        WHERE e.occurred_at < b.cutoff_at
        ORDER BY e.poll_id, e.user_id, e.occurred_at DESC, e.id DESC
      ),
      totals AS (
        SELECT l.poll_id, count(*)::int AS total
        FROM last_event l JOIN votes v ON v.id = l.vote_id
        WHERE l.type IN ('CAST', 'CHANGE', 'RESTORE') AND v.invalidated_at IS NULL
        GROUP BY l.poll_id
      )
      INSERT INTO poll_daily_snapshots (poll_id, local_date, poll_day, cutoff_at, total_valid_votes, calculation_version, computed_at)
      SELECT pi.id, b.local_date, (b.local_date - pi.open_local_date)::smallint, b.cutoff_at, coalesce(t.total, 0),
        ${SNAPSHOT_CALCULATION_VERSION}::smallint, ${now}::timestamptz
      FROM polls_in pi CROSS JOIN bounds b LEFT JOIN totals t ON t.poll_id = pi.id
      ON CONFLICT (poll_id, local_date) DO UPDATE SET
        total_valid_votes = EXCLUDED.total_valid_votes,
        cutoff_at = EXCLUDED.cutoff_at,
        calculation_version = EXCLUDED.calculation_version,
        computed_at = EXCLUDED.computed_at`;

    await tx.$executeRaw`
      WITH bounds AS (
        SELECT ${localDate}::date AS local_date, ((${localDate}::date + 1)::timestamp AT TIME ZONE ${SNAPSHOT_TIME_ZONE}) AS cutoff_at
      ),
      day_rows AS (SELECT s.poll_id FROM poll_daily_snapshots s, bounds b WHERE s.local_date = b.local_date ${only(Prisma.sql`s.poll_id`)}),
      last_event AS (
        SELECT DISTINCT ON (e.poll_id, e.user_id) e.poll_id, e.vote_id, e.type, e.to_option_id
        FROM vote_events e JOIN day_rows d ON d.poll_id = e.poll_id, bounds b
        WHERE e.occurred_at < b.cutoff_at
        ORDER BY e.poll_id, e.user_id, e.occurred_at DESC, e.id DESC
      ),
      counts AS (
        SELECT l.poll_id, l.to_option_id AS option_id, count(*)::int AS n
        FROM last_event l JOIN votes v ON v.id = l.vote_id
        WHERE l.type IN ('CAST', 'CHANGE', 'RESTORE') AND v.invalidated_at IS NULL
        GROUP BY l.poll_id, l.to_option_id
      )
      INSERT INTO poll_option_daily_snapshots (poll_id, option_id, local_date, valid_vote_count)
      SELECT o.poll_id, o.id, b.local_date, coalesce(c.n, 0)
      FROM day_rows d JOIN poll_options o ON o.poll_id = d.poll_id CROSS JOIN bounds b
      LEFT JOIN counts c ON c.poll_id = o.poll_id AND c.option_id = o.id
      ON CONFLICT (poll_id, option_id, local_date) DO UPDATE SET valid_vote_count = EXCLUDED.valid_vote_count`;
    return days;
  }, { timeout: 120_000 });
}

/** Bir çalıştırmada en fazla kaç düzeltme bekleyen anket işlenir (kalanlar sonraki çalıştırmada). */
export const STALE_BATCH = 50;

/**
 * KV-43: Oy geçersiz sayıldı veya geri alındıysa (polls.snapshots_stale_since) etkilenen günler yeniden üretilir:
 * işaretin İstanbul gününden düne kadar. vote_events'ten tam hesap olduğu için geçmiş uydurulmaz; satırın computed_at'i
 * yenilenir, düzeltmenin nedeni vote_events INVALIDATE/RESTORE kaydındadır (aktör, gerekçe, zaman). İşaret, okunduğu
 * değer değişmediyse temizlenir: arada yeni düzeltme geldiyse bir sonraki çalıştırma onu da işler.
 */
export async function recomputeStaleSnapshots(deps: SnapshotJobDeps): Promise<{ pollId: string; days: number }[]> {
  const stale = await deps.prisma.poll.findMany({
    where: { snapshotsStaleSince: { not: null } },
    select: { id: true, snapshotsStaleSince: true, closedAt: true, closesAt: true },
    orderBy: { snapshotsStaleSince: "asc" },
    take: STALE_BATCH,
  });
  const yesterday = addDays(istanbulDate(deps.now()), -1);
  const done = [];
  for (const poll of stale) {
    // Snapshot satırı sadece anketin açık olduğu günler için vardır: kapanış gününden sonrası taranmaz.
    const end = poll.closedAt ?? poll.closesAt;
    const last = end && istanbulDate(end) < yesterday ? istanbulDate(end) : yesterday;
    let days = 0;
    for (let d = istanbulDate(poll.snapshotsStaleSince!); d <= last; d = addDays(d, 1)) {
      days += await snapshotDay(deps, d, [poll.id]);
    }
    await deps.prisma.poll.updateMany({ where: { id: poll.id, snapshotsStaleSince: poll.snapshotsStaleSince }, data: { snapshotsStaleSince: null } });
    done.push({ pollId: poll.id, days });
  }
  if (done.length > 0) deps.log("info", "snapshots: oy düzeltmesi yeniden üretildi", { polls: done });
  return done;
}

/** Job gövdesi: önce oy düzeltmeleri (KV-43), sonra dünden geriye CATCH_UP_DAYS bitmiş gün. */
export async function runDailySnapshots(deps: SnapshotJobDeps): Promise<{ localDate: string; polls: number }[]> {
  await recomputeStaleSnapshots(deps);
  const today = istanbulDate(deps.now());
  const results = [];
  for (let back = CATCH_UP_DAYS; back >= 1; back--) {
    const localDate = addDays(today, -back);
    results.push({ localDate, polls: await snapshotDay(deps, localDate) });
  }
  deps.log("info", "snapshots.daily", { results });
  return results;
}
