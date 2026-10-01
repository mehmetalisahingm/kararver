// Trend puanlarının SQL'i — KV-28 (#30). Formüller: docs/KV-28_TRENDS.md, katsayılar: config.ts.
//
// Ortak kurallar (bütün formatlar):
// - Aday: herkese görünür (ACTIVE/LOCKED), trendden çıkarılmamış (trend_excluded_at NULL), pencere sonuna kadar açılmış.
// - Oy: pencere içinde verilmiş ve şu an geçersiz sayılmamış oy; (poll_id, user_id) tekil olduğu için hesap başına
//   bir. Oy değiştirmek yeni oy değildir (votes.created_at ilk oyun zamanıdır): tek hesabın değiştirme patlaması
//   puanı büyütmez.
// - Yorum: pencere içinde yazılmış, silinmemiş ve ACTIVE yorum/cevap/alternatif. Hesap başına commentCapPerUser ile
//   sınırlıdır; anketin kendi yazarının yorumları sayılmaz.
// - Raporlar puana girmez: ham rapor ceza değildir; içerik ancak moderasyon kararıyla (gizleme/çıkarma) düşer.
// - Eşitlikte yeni anket önce, sonra id (deterministik).
import { Prisma } from "@kararver/db";
import { TREND_CONFIG, type ComputedFormat } from "./config.ts";

export type ScoreRow = { poll_id: string; rank: number; score: number; components: Record<string, number> };

const C = TREND_CONFIG;

export function windowStart(format: ComputedFormat, windowEnd: Date): Date {
  return new Date(windowEnd.getTime() - C.windowHours[format] * 60 * 60 * 1000);
}

/** Formatın sıralama sorgusu: ilk topN satır, rank 1'den. */
export function scoreQuery(format: ComputedFormat, windowEnd: Date): Prisma.Sql {
  // Zaman ISO-8601 metni olarak gider ve açıkça timestamptz'ye çevrilir (DATA_MODEL §2.2).
  const end = Prisma.sql`${windowEnd.toISOString()}::timestamptz`;
  const start = Prisma.sql`${windowStart(format, windowEnd).toISOString()}::timestamptz`;

  const signals = Prisma.sql`
    eligible AS (
      SELECT p.id, p.opens_at, p.author_id
      FROM polls p
      WHERE p.status IN ('ACTIVE', 'LOCKED') AND p.trend_excluded_at IS NULL AND p.opens_at <= ${end}
    ),
    v AS (
      SELECT x.poll_id, count(*)::int AS voters
      FROM votes x
      WHERE x.created_at > ${start} AND x.created_at <= ${end} AND x.invalidated_at IS NULL
      GROUP BY x.poll_id
    ),
    per_user AS (
      SELECT y.poll_id, y.author_id, count(*) AS n
      FROM comments y
      JOIN eligible e ON e.id = y.poll_id AND e.author_id <> y.author_id
      WHERE y.created_at > ${start} AND y.created_at <= ${end} AND y.deleted_at IS NULL AND y.status = 'ACTIVE'
      GROUP BY y.poll_id, y.author_id
    ),
    c AS (
      SELECT poll_id, sum(least(n, ${C.commentCapPerUser}))::int AS comments, count(*)::int AS commenters
      FROM per_user GROUP BY poll_id
    ),
    s AS (
      SELECT e.id, e.opens_at, coalesce(v.voters, 0) AS voters, coalesce(c.comments, 0) AS comments,
        coalesce(c.commenters, 0) AS commenters
      FROM eligible e LEFT JOIN v ON v.poll_id = e.id LEFT JOIN c ON c.poll_id = e.id
      WHERE v.poll_id IS NOT NULL OR c.poll_id IS NOT NULL
    )`;

  let scored: Prisma.Sql;
  switch (format) {
    case "DAILY_RISING": {
      const d = C.daily;
      scored = Prisma.sql`
        SELECT s.id, s.opens_at,
          (s.voters + ${d.commentWeight}::float8 * s.comments + ${d.commenterWeight}::float8 * s.commenters)
            / power(greatest(extract(epoch FROM (${end} - s.opens_at)) / 3600, 0) + ${d.ageOffsetHours}::float8, ${d.gravity}::float8) AS score,
          jsonb_build_object('voters', s.voters, 'comments', s.comments, 'commenters', s.commenters,
            'ageHours', round((extract(epoch FROM (${end} - s.opens_at)) / 3600)::numeric, 2)) AS components
        FROM s
        WHERE s.voters + s.commenters >= ${d.minParticipants}`;
      break;
    }
    case "WEEKLY_RISING": {
      const w = C.weeklyRising;
      scored = Prisma.sql`
        SELECT s.id, s.opens_at,
          s.voters::float8 * s.voters / (b.before + s.voters + ${w.smoothing}::float8) AS score,
          jsonb_build_object('newVoters', s.voters, 'votersBefore', b.before) AS components
        FROM s
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS before FROM votes x
          WHERE x.poll_id = s.id AND x.created_at <= ${start} AND x.invalidated_at IS NULL
        ) b
        WHERE s.voters >= ${w.minNewVoters}`;
      break;
    }
    case "WEEKLY_MOST_VOTED":
      scored = Prisma.sql`
        SELECT s.id, s.opens_at, s.voters::float8 AS score, jsonb_build_object('voters', s.voters) AS components
        FROM s WHERE s.voters >= ${C.mostVoted.minVoters}`;
      break;
    case "WEEKLY_MOST_DISCUSSED": {
      const m = C.mostDiscussed;
      scored = Prisma.sql`
        SELECT s.id, s.opens_at, s.comments + ${m.commenterWeight}::float8 * s.commenters AS score,
          jsonb_build_object('comments', s.comments, 'commenters', s.commenters) AS components
        FROM s WHERE s.commenters >= ${m.minCommenters}`;
      break;
    }
  }

  return Prisma.sql`
    WITH ${signals},
    scored AS (${scored})
    SELECT id::text AS poll_id, (row_number() OVER (ORDER BY score DESC, opens_at DESC, id DESC))::int AS rank,
      score, components
    FROM scored
    ORDER BY rank
    LIMIT ${C.topN}`;
}
