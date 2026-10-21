// spam-score.refresh (#183 / KV-37 S1, gölge mod): 15 dakikada bir. Ayar `spam.shadowScoring.enabled` kapalıyken hiçbir şey
// hesaplamaz ve yazmaz; varsa eski satırları siler. Açıkken: son 30 günde etkinliği olan hesapların sinyallerini tek SQL ile
// toplar, puanı hesaplar, eşik üstünü upsert eder; bu turda yenilenmeyen her satırı (puanı düştü, hesap silindi) siler.
// Kullanıcıya hiçbir etkisi yoktur (bildirim, yaptırım, gizleme yok). Job idempotenttir.
import { Prisma, type PrismaClient } from "@kararver/db";
import type { EventLog } from "../events/consumers.ts";
import {
  scoreSpam,
  SPAM_MIN_STORED_SCORE,
  SPAM_WINDOW_DAYS,
  SPAM_YOUNG_ACCOUNT_DAYS,
  SPAM_YOUNG_BURST_MIN_CONTENT,
  type SpamSignals,
} from "./score.ts";

export const SPAM_SCORE_QUEUE = "spam-score.refresh";
export const SPAM_SCORE_CRON = "*/15 * * * *";
const DAY = 24 * 60 * 60_000;
const WRITE_BATCH = 500;

export type SpamScoreDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: EventLog;
  enabled: () => Promise<boolean>;
};
export type SpamScoreResult = { enabled: boolean; scanned: number; stored: number; removed: number };

type Row = { user_id: string; duplicate_posts: number; comments_24h: number; young_burst: number; actioned_reports: number; hidden_content: number };

/** Hesap başına sinyaller. Yalnız silinmemiş hesaplar ve son 30 günde en az bir sinyal kaynağı olanlar. */
export async function collectSignals(prisma: Pick<PrismaClient, "$queryRaw">, now: Date): Promise<{ userId: string; signals: SpamSignals }[]> {
  const since = new Date(now.getTime() - SPAM_WINDOW_DAYS * DAY).toISOString();
  const since24h = new Date(now.getTime() - DAY).toISOString();
  const youngSince = new Date(now.getTime() - SPAM_YOUNG_ACCOUNT_DAYS * DAY).toISOString();
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH posts AS (
      SELECT author_id AS user_id, count(*)::int AS n,
             (count(*) - count(DISTINCT lower(btrim(title))))::int AS dup
        FROM polls WHERE created_at >= ${since}::timestamptz AND deleted_at IS NULL GROUP BY author_id
    ),
    cmts AS (
      SELECT author_id AS user_id, count(*)::int AS n,
             (count(*) FILTER (WHERE created_at >= ${since24h}::timestamptz))::int AS n24
        FROM comments WHERE created_at >= ${since}::timestamptz AND deleted_at IS NULL GROUP BY author_id
    ),
    rep AS (
      SELECT t.user_id, count(*)::int AS n FROM (
        SELECT p.author_id AS user_id FROM reports r JOIN polls p ON p.id = r.poll_id
         WHERE r.status = 'ACTIONED' AND r.created_at >= ${since}::timestamptz
        UNION ALL
        SELECT c.author_id FROM reports r JOIN comments c ON c.id = r.comment_id
         WHERE r.status = 'ACTIONED' AND r.created_at >= ${since}::timestamptz
        UNION ALL
        SELECT r.reported_user_id FROM reports r
         WHERE r.status = 'ACTIONED' AND r.reported_user_id IS NOT NULL AND r.created_at >= ${since}::timestamptz
      ) t GROUP BY t.user_id
    ),
    hid AS (
      SELECT t.user_id, count(*)::int AS n FROM (
        SELECT p.author_id AS user_id, a.id FROM moderation_actions a JOIN polls p ON p.id = a.poll_id
         WHERE a.action IN ('HIDE', 'REMOVE') AND a.created_at >= ${since}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM moderation_actions u WHERE u.undo_of_id = a.id)
        UNION ALL
        SELECT c.author_id, a.id FROM moderation_actions a JOIN comments c ON c.id = a.comment_id
         WHERE a.action IN ('HIDE', 'REMOVE') AND a.created_at >= ${since}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM moderation_actions u WHERE u.undo_of_id = a.id)
      ) t GROUP BY t.user_id
    ),
    ids AS (
      SELECT user_id FROM posts UNION SELECT user_id FROM cmts UNION SELECT user_id FROM rep UNION SELECT user_id FROM hid
    )
    SELECT i.user_id::text AS user_id,
           coalesce(p.dup, 0)::int AS duplicate_posts,
           coalesce(c.n24, 0)::int AS comments_24h,
           (CASE WHEN u.created_at >= ${youngSince}::timestamptz AND coalesce(p.n, 0) + coalesce(c.n, 0) >= ${SPAM_YOUNG_BURST_MIN_CONTENT} THEN 1 ELSE 0 END)::int AS young_burst,
           coalesce(r.n, 0)::int AS actioned_reports,
           coalesce(h.n, 0)::int AS hidden_content
      FROM ids i
      JOIN users u ON u.id = i.user_id AND u.deleted_at IS NULL
      LEFT JOIN posts p ON p.user_id = i.user_id
      LEFT JOIN cmts c ON c.user_id = i.user_id
      LEFT JOIN rep r ON r.user_id = i.user_id
      LEFT JOIN hid h ON h.user_id = i.user_id
  `);
  return rows.map((r) => ({
    userId: r.user_id,
    signals: {
      duplicatePosts: r.duplicate_posts,
      comments24h: r.comments_24h,
      youngBurst: r.young_burst === 1 ? 1 : 0,
      actionedReports: r.actioned_reports,
      hiddenContent: r.hidden_content,
    },
  }));
}

export async function refreshSpamScores(deps: SpamScoreDeps): Promise<SpamScoreResult> {
  const { prisma } = deps;
  const now = deps.now();
  if (!(await deps.enabled())) {
    // Bayrak kapalıysa saklanan puan kalmaz: açıp kapatmak veriyi geride bırakmaz.
    const removed = await prisma.spamAccountScore.deleteMany({});
    if (removed.count > 0) deps.log("info", "spam-score.refresh kapalı: satırlar silindi", { removed: removed.count });
    return { enabled: false, scanned: 0, stored: 0, removed: removed.count };
  }
  const collected = await collectSignals(prisma, now);
  const scored = collected.map((c) => ({ ...c, score: scoreSpam(c.signals) })).filter((c) => c.score >= SPAM_MIN_STORED_SCORE);
  for (let i = 0; i < scored.length; i += WRITE_BATCH) {
    const chunk = scored.slice(i, i + WRITE_BATCH);
    await prisma.$transaction(
      chunk.map((c) =>
        prisma.spamAccountScore.upsert({
          where: { userId: c.userId },
          create: { userId: c.userId, score: c.score, signals: c.signals, computedAt: now },
          update: { score: c.score, signals: c.signals, computedAt: now },
        }),
      ),
    );
  }
  // Bu turda yenilenmeyen her satır (puanı eşiğin altına indi, hesap silindi) silinir: saklama, hesaplamanın kendisine bağlıdır.
  const removed = await prisma.spamAccountScore.deleteMany({ where: { OR: [{ computedAt: { lt: now } }, { user: { deletedAt: { not: null } } }] } });
  const result = { enabled: true, scanned: collected.length, stored: scored.length, removed: removed.count };
  deps.log("info", "spam-score.refresh bitti", result);
  return result;
}
