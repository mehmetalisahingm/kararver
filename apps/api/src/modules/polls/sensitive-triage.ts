// #327 — salt-okuma envanter: mevcut anket, seçenek, ek açıklama ve yorumları V1 hassas veri kuralından (#326) geçirir.
// Hiçbir şey yazmaz, gizlemez, silmez. Metin ve kullanıcı bilgisi döndürmez; yalnız içerik türü, kimlik, durum, kategori ve alan adı.
// Bulgu = insan incelemesi adayı; otomatik karar değildir (kelime kuralı yanlış pozitif/negatif verebilir).
import type { PrismaClient } from "@kararver/db";
import { detectSensitiveSurvey, type SensitiveRisk } from "./sensitive-policy.ts";

export type TriageKind = "poll" | "addendum" | "comment";
export type TriageHit = { kind: TriageKind; id: string; pollId: string; status: string; category: SensitiveRisk["category"]; field: string };
export type TriageSummary = Record<TriageKind, { scanned: number; flagged: number; byCategory: Record<string, number>; byStatus: Record<string, number> }>;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
const BATCH = 500;

const empty = (): TriageSummary => ({
  poll: { scanned: 0, flagged: 0, byCategory: {}, byStatus: {} },
  addendum: { scanned: 0, flagged: 0, byCategory: {}, byStatus: {} },
  comment: { scanned: 0, flagged: 0, byCategory: {}, byStatus: {} },
});

function tally(summary: TriageSummary, hit: TriageHit): void {
  const s = summary[hit.kind];
  s.flagged += 1;
  s.byCategory[hit.category] = (s.byCategory[hit.category] ?? 0) + 1;
  s.byStatus[hit.status] = (s.byStatus[hit.status] ?? 0) + 1;
}

/** Tüm içeriği kimlik sırasıyla sayfalayarak tarar. `onHit` her bulguda çağrılır (ör. yerel dosyaya yazmak için). */
export async function triageSensitiveContent(tx: Tx, onHit: (hit: TriageHit) => void | Promise<void> = () => {}): Promise<TriageSummary> {
  const summary = empty();
  const record = async (hit: TriageHit) => { tally(summary, hit); await onHit(hit); };

  for (let after: string | undefined; ;) {
    const polls = await tx.poll.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, status: true, title: true, description: true, extraInfo: true, options: { select: { label: true }, orderBy: { position: "asc" } }, addenda: { select: { body: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    for (const p of polls) {
      summary.poll.scanned += 1;
      // One poll hit at most, even if several fields match. A separately risky
      // addendum remains its own hit in the addendum scan below.
      const risk = detectSensitiveSurvey({ title: p.title, description: p.description, extraInfo: p.extraInfo, options: p.options, addenda: p.addenda.map(a => a.body) });
      if (risk) await record({ kind: "poll", id: p.id, pollId: p.id, status: p.status, category: risk.category, field: risk.field });
    }
    if (polls.length < BATCH) break;
    after = polls.at(-1)!.id;
  }

  for (let after: string | undefined; ;) {
    const rows = await tx.pollAddendum.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, pollId: true, body: true, poll: { select: { status: true } } },
    });
    for (const a of rows) {
      summary.addendum.scanned += 1;
      const risk = detectSensitiveSurvey({ body: a.body });
      if (risk) await record({ kind: "addendum", id: a.id, pollId: a.pollId, status: a.poll.status, category: risk.category, field: "body" });
    }
    if (rows.length < BATCH) break;
    after = rows.at(-1)!.id;
  }

  for (let after: string | undefined; ;) {
    const rows = await tx.comment.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, pollId: true, status: true, body: true },
    });
    for (const c of rows) {
      summary.comment.scanned += 1;
      const risk = detectSensitiveSurvey({ body: c.body });
      if (risk) await record({ kind: "comment", id: c.id, pollId: c.pollId, status: c.status, category: risk.category, field: "body" });
    }
    if (rows.length < BATCH) break;
    after = rows.at(-1)!.id;
  }
  return summary;
}

/** fn'i READ ONLY transaction içinde çalıştırır: yanlışlıkla bir yazma olursa PostgreSQL reddeder (SQLSTATE 25006). */
export function withReadOnly<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return fn(tx);
  }, { timeout: 10 * 60 * 1000, maxWait: 10_000 });
}

export function runReadOnlyTriage(prisma: PrismaClient, onHit?: (hit: TriageHit) => void | Promise<void>): Promise<TriageSummary> {
  return withReadOnly(prisma, (tx) => triageSensitiveContent(tx, onHit));
}
