// Toplu içerik işinin uygun içerik kuralı — #181. Önizleme sayacı, onay anındaki yeniden sayım ve çalıştırıcının seçimi aynı
// SQL'i kullanır: sayılan ile işlenen asla ayrışmaz. Uygunluk mevcut moderasyon geçiş tablosundan gelir (eligibleSources).
import { Prisma, type PrismaClient } from "@kararver/db";
import { eligibleSources } from "../moderation/store.ts";
import type { Counts, JobAction, JobScope } from "./store.ts";

type Db = PrismaClient | Prisma.TransactionClient;

export const includes = (scope: JobScope) => ({ polls: scope !== "comments", comments: scope !== "polls" });

const sources = (action: JobAction) => [...eligibleSources(action)] as string[];

/** Hesabın, cutoff'tan önce yazılmış ve bu işleme uygun anket/yorum sayısı (zaten hedef durumda olanlar sayılmaz). */
export async function countEligible(db: Db, userId: string, action: JobAction, scope: JobScope, cutoffAt: Date): Promise<Counts> {
  const want = includes(scope);
  const at = cutoffAt.toISOString();
  const states = sources(action);
  const polls = want.polls
    ? (await db.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM polls WHERE author_id = ${userId}::uuid AND created_at <= ${at}::timestamptz AND status::text = ANY(${states}::text[])`))[0]!.n
    : 0;
  const comments = want.comments
    ? (await db.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM comments WHERE author_id = ${userId}::uuid AND created_at <= ${at}::timestamptz AND status::text = ANY(${states}::text[])`))[0]!.n
    : 0;
  return { polls, comments };
}

export type Candidate = { type: "POLL" | "COMMENT"; id: string };

/** Çalıştırıcının sıradaki grubu: bu işte henüz kaydı olmayan uygun içerik (önce anketler, sonra yorumlar; eskiden yeniye). */
export async function nextCandidates(db: Db, jobId: string, userId: string, action: JobAction, scope: JobScope, cutoffAt: Date, limit: number): Promise<Candidate[]> {
  const want = includes(scope);
  const at = cutoffAt.toISOString();
  const states = sources(action);
  const out: Candidate[] = [];
  if (want.polls) {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id::text AS id FROM polls p
      WHERE p.author_id = ${userId}::uuid AND p.created_at <= ${at}::timestamptz AND p.status::text = ANY(${states}::text[])
        AND NOT EXISTS (SELECT 1 FROM content_job_items i WHERE i.job_id = ${jobId}::uuid AND i.target_type = 'POLL' AND i.target_id = p.id)
      ORDER BY p.created_at, p.id LIMIT ${limit}`);
    out.push(...rows.map((r) => ({ type: "POLL" as const, id: r.id })));
  }
  if (want.comments && out.length < limit) {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT c.id::text AS id FROM comments c
      WHERE c.author_id = ${userId}::uuid AND c.created_at <= ${at}::timestamptz AND c.status::text = ANY(${states}::text[])
        AND NOT EXISTS (SELECT 1 FROM content_job_items i WHERE i.job_id = ${jobId}::uuid AND i.target_type = 'COMMENT' AND i.target_id = c.id)
      ORDER BY c.created_at, c.id LIMIT ${limit - out.length}`);
    out.push(...rows.map((r) => ({ type: "COMMENT" as const, id: r.id })));
  }
  return out;
}

/** Geri alma: asıl işte uygulanmış ve önceki durumu ACTIVE olan (güvenle eski görünürlüğe dönen) öğeler. */
export async function restorableItems(db: Db, originalJobId: string, undoJobId: string, limit: number): Promise<{ type: "POLL" | "COMMENT"; id: string; toStatus: string }[]> {
  const rows = await db.$queryRaw<{ type: string; id: string; to_status: string }[]>(Prisma.sql`
    SELECT o.target_type AS type, o.target_id::text AS id, o.to_status
    FROM content_job_items o
    WHERE o.job_id = ${originalJobId}::uuid AND o.result = 'APPLIED' AND o.from_status = 'ACTIVE' AND o.to_status IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM content_job_items u WHERE u.job_id = ${undoJobId}::uuid AND u.target_type = o.target_type AND u.target_id = o.target_id)
    ORDER BY o.target_type DESC, o.created_at, o.target_id LIMIT ${limit}`);
  return rows.map((r) => ({ type: r.type as "POLL" | "COMMENT", id: r.id, toStatus: r.to_status }));
}

export async function countRestorable(db: Db, originalJobId: string): Promise<Counts> {
  const rows = await db.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
    SELECT target_type AS type, count(*)::int AS n FROM content_job_items
    WHERE job_id = ${originalJobId}::uuid AND result = 'APPLIED' AND from_status = 'ACTIVE' AND to_status IS NOT NULL GROUP BY target_type`);
  return { polls: rows.find((r) => r.type === "POLL")?.n ?? 0, comments: rows.find((r) => r.type === "COMMENT")?.n ?? 0 };
}
