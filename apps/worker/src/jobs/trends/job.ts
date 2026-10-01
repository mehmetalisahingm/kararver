// trends.refresh — KV-28 (#30). Her 5 dakikada bir, her format için bir trend_runs satırı ve sıralaması.
// Kurallar: docs/KV-28_TRENDS.md, DATA_MODEL §8.4.
//
// İdempotency: Pencere sonu 5 dakikalık dilime yuvarlanır. Aynı (format, pencere sonu, hesap sürümü) için başarılı
// veya sürmekte olan bir çalıştırma varsa yenisi açılmaz; format başına advisory lock iki worker'ın aynı anda
// açmasını engeller (pg-boss singleton kuyruğuna ek güvence).
// Okuyucular her format için en son SUCCEEDED çalıştırmayı okur: yarım veya başarısız çalıştırma ekrana yansımaz.
import type { PrismaClient } from "@kararver/db";
import { COMPUTED_FORMATS, slotEnd, TREND_CONFIG, type ComputedFormat } from "./config.ts";
import { scoreQuery, windowStart, type ScoreRow } from "./score.ts";

export type TrendJobDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
};

export type FormatResult =
  | { format: ComputedFormat; status: "SUCCEEDED"; runId: string; count: number }
  | { format: ComputedFormat; status: "SKIPPED"; reason: "already_done" | "in_progress" }
  | { format: ComputedFormat; status: "FAILED"; runId: string; error: string };

const MINUTE = 60 * 1000;

async function openRun(deps: TrendJobDeps, format: ComputedFormat, windowEnd: Date): Promise<string | "already_done" | "in_progress"> {
  const now = deps.now();
  const version = TREND_CONFIG.calculationVersion;
  return deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trends.refresh:${format}`}, 0))`;
    // Çöken worker'ın RUNNING bıraktığı çalıştırma: süre dolunca FAILED.
    await tx.trendRun.updateMany({
      where: { format, status: "RUNNING", startedAt: { lt: new Date(now.getTime() - TREND_CONFIG.staleRunMinutes * MINUTE) } },
      data: { status: "FAILED", finishedAt: now, error: "zaman aşımı: çalıştırma tamamlanmadı" },
    });
    const existing = await tx.trendRun.findFirst({
      where: { format, windowEnd, calculationVersion: version, status: { in: ["SUCCEEDED", "RUNNING"] } },
      select: { status: true },
    });
    if (existing) return existing.status === "SUCCEEDED" ? "already_done" : "in_progress";
    const run = await tx.trendRun.create({
      data: { format, calculationVersion: version, windowStart: windowStart(format, windowEnd), windowEnd, startedAt: now },
      select: { id: true },
    });
    return run.id;
  });
}

export async function refreshFormat(deps: TrendJobDeps, format: ComputedFormat, windowEnd: Date): Promise<FormatResult> {
  const opened = await openRun(deps, format, windowEnd);
  if (opened === "already_done" || opened === "in_progress") return { format, status: "SKIPPED", reason: opened };
  const runId = opened;
  try {
    const count = await deps.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<ScoreRow[]>(scoreQuery(format, windowEnd));
        await tx.trendScore.createMany({
          data: rows.map((r) => ({ runId, pollId: r.poll_id, rank: r.rank, score: r.score, components: r.components })),
        });
        // Puanlar ve SUCCEEDED aynı transaction'da: okuyucu yarım sıralama görmez.
        await tx.trendRun.update({ where: { id: runId }, data: { status: "SUCCEEDED", finishedAt: deps.now() } });
        return rows.length;
      },
      { timeout: 60_000 },
    );
    return { format, status: "SUCCEEDED", runId, count };
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    await deps.prisma.trendRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: deps.now(), error } });
    return { format, status: "FAILED", runId, error };
  }
}

/** Saklama süresini aşan çalıştırmaları siler; her formatın güncel (en yeni pencere) başarılı çalıştırması kalır. */
export async function pruneRuns(deps: TrendJobDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - TREND_CONFIG.retentionHours * 60 * MINUTE);
  return deps.prisma.$executeRaw`
    DELETE FROM trend_runs r
    WHERE coalesce(r.finished_at, r.started_at) < ${cutoff.toISOString()}::timestamptz
      AND r.id NOT IN (
        SELECT DISTINCT ON (format) id FROM trend_runs WHERE status = 'SUCCEEDED'
        ORDER BY format, window_end DESC, finished_at DESC, id DESC
      )`;
}

/** Job gövdesi: bütün formatlar sırayla; bir formatın hatası diğerlerini durdurmaz. */
export async function refreshTrends(deps: TrendJobDeps): Promise<FormatResult[]> {
  const windowEnd = slotEnd(deps.now());
  const results: FormatResult[] = [];
  for (const format of COMPUTED_FORMATS) {
    const result = await refreshFormat(deps, format, windowEnd);
    if (result.status === "FAILED") deps.log("error", "trends.refresh formatı başarısız", { format, error: result.error });
    results.push(result);
  }
  const pruned = await pruneRuns(deps);
  deps.log("info", "trends.refresh", { windowEnd: windowEnd.toISOString(), results, pruned });
  return results;
}
