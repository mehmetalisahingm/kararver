// Trend listesine giriş olayları — KV-21 PR-4a (#23). trends.refresh'in başarılı çalıştırma transaction'ında çağrılır
// (job.ts refreshFormat): puanlar, SUCCEEDED ve olaylar birlikte commit olur; çalıştırma başarısız olursa olay da yoktur.
//
// Giriş: bu çalıştırmada rank ≤ TRENDING_TOP_RANK olup aynı formatın bir önceki başarılı çalıştırmasında rank ≤
// TRENDING_TOP_RANK olmayan anket. Formatın önceki başarılı çalıştırması yoksa (deploy sonrası ilk tur) olay üretilmez:
// o tur tabandır. Olay her girişte üretilir (düşüp yeniden giren için yeni olay); bildirim tüketicisi anket + format
// başına ömür boyu tek bildirim yazar (KV-21 §6.1). Natural key (katalog): poll.trending:<anket>:<format>:<çalıştırma>.
// Sıra, kategori filtresi uygulanmamış genel sıradır (trend_scores.rank).
import { createEvent, newEventId } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";
import { writeWorkerEvent } from "../events/write.ts";
import type { ComputedFormat } from "./config.ts";

/** Bildirim için "listeye giriş" eşiği (KV-21 PR-4 karar 1; istemcinin ilk sayfası 20). */
export const TRENDING_TOP_RANK = 10;

export async function emitTrendEntries(tx: Prisma.TransactionClient, input: { format: ComputedFormat; runId: string; now: Date }): Promise<number> {
  // Önceki: penceresi bu çalıştırmanınkinden önce biten en yeni başarılı çalıştırma (yeniden çalıştırmada daha yeni pencereli
  // bir çalıştırma varsa onunla karşılaştırılmaz).
  const [previous] = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id::text AS id FROM trend_runs r, trend_runs cur
    WHERE cur.id = ${input.runId}::uuid AND r.format = cur.format AND r.status = 'SUCCEEDED' AND r.window_end < cur.window_end
    ORDER BY r.window_end DESC, r.finished_at DESC, r.id DESC
    LIMIT 1`;
  if (!previous) return 0;
  const entries = await tx.$queryRaw<{ pollId: string; rank: number }[]>`
    SELECT s.poll_id::text AS "pollId", s.rank FROM trend_scores s
    WHERE s.run_id = ${input.runId}::uuid AND s.rank <= ${TRENDING_TOP_RANK}
      AND NOT EXISTS (
        SELECT 1 FROM trend_scores p WHERE p.run_id = ${previous.id}::uuid AND p.poll_id = s.poll_id AND p.rank <= ${TRENDING_TOP_RANK})
    ORDER BY s.rank`;
  for (const { pollId, rank } of entries) {
    await writeWorkerEvent(
      tx,
      createEvent({
        id: newEventId(input.now),
        type: "poll.trending",
        occurredAt: input.now.toISOString(),
        actorId: null,
        subject: { type: "POLL", id: pollId },
        payload: { format: input.format, rank, trendRunId: input.runId },
      }),
    );
  }
  return entries.length;
}
