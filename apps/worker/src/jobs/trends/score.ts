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
import type { TrendScoringSettings } from "./settings.ts";

export type ScoreRow = { poll_id: string; rank: number; score: number; components: Record<string, number | string> };

const C = TREND_CONFIG;

/** Haftanın Değişkenleri eşikleri (sistem ayarları trends.moversMin*, KV-40); verilmezse kayıt defteri varsayılanı. */
export type MoversThresholds = { minVotes: number; minActiveAccounts: number };

export function windowStart(format: ComputedFormat, windowEnd: Date): Date {
  return new Date(windowEnd.getTime() - C.windowHours[format] * 60 * 60 * 1000);
}

/** Formatın sıralama sorgusu: ilk topN satır, rank 1'den. */
export function scoreQuery(format: ComputedFormat, windowEnd: Date, movers: MoversThresholds = C.movers, config: TrendScoringSettings = TREND_CONFIG): Prisma.Sql {
  const C = config;
  if (format === "WEEKLY_MOVERS") return moversQuery(windowEnd, movers);
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
  return ranked(Prisma.sql`WITH ${signals}, scored AS (${scored})`);
}

/** İlk topN satır, rank 1'den; eşitlikte yeni anket önce, sonra id. */
function ranked(withScored: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    ${withScored}
    SELECT id::text AS poll_id, (row_number() OVER (ORDER BY score DESC, opens_at DESC, id DESC))::int AS rank,
      score, components
    FROM scored
    ORDER BY rank
    LIMIT ${C.topN}`;
}

/**
 * Haftanın Değişkenleri (KV-29): anketin bu hafta biten penceresinin sonu ile bir önceki pencere sonundaki dağılım
 * farkı. Kaynak günlük snapshot'lardır (DATA_MODEL §8.2): pencere k'nın sonu poll_day = 7k−1 snapshot'ı; karşılaştırma
 * snapshot(7k−1) ile snapshot(7(k−1)−1), k ≥ 2. Pencere sonu çalıştırma penceresinin (son 7 gün) içinde olmalı.
 * - Eşikler (DATA_MODEL §8.3): iki uçta da ≥ moversMinVotes geçerli oy; ikinci pencerede ≥ moversMinActiveAccounts
 *   benzersiz aktif hesap (pencere içinde CAST/CHANGE/RESTORE olayı olan farklı user_id).
 * - Sadece sonucu herkese görünen anketler (ALWAYS veya kapanmış): hareket AFTER_VOTE sonucunu sızdırmasın (sözleşme).
 * - Puan: en çok değişen seçeneğin yüzde puan farkının mutlak değeri; eşitlikte seçenek sırası. Yüzde 2 basamak
 *   (contracts helpers.ts ile aynı yuvarlama). Snapshot yoksa satır yoktur: eksik geçmiş uydurulmaz.
 */
function moversQuery(windowEnd: Date, m: MoversThresholds): Prisma.Sql {
  const end = Prisma.sql`${windowEnd.toISOString()}::timestamptz`;
  const start = Prisma.sql`${windowStart("WEEKLY_MOVERS", windowEnd).toISOString()}::timestamptz`;
  return ranked(Prisma.sql`
    WITH eligible AS (
      SELECT p.id, p.opens_at
      FROM polls p
      WHERE p.status IN ('ACTIVE', 'LOCKED') AND p.trend_excluded_at IS NULL
        AND (p.results_visibility = 'ALWAYS' OR p.closed_at IS NOT NULL OR p.closes_at <= ${end})
    ),
    pairs AS (
      SELECT e.id, e.opens_at, s1.local_date AS d1, s2.local_date AS d2, s1.cutoff_at AS from_end, s2.cutoff_at AS to_end,
        s1.total_valid_votes AS sample_from, s2.total_valid_votes AS sample_to
      FROM eligible e
      JOIN poll_daily_snapshots s2 ON s2.poll_id = e.id
      JOIN poll_daily_snapshots s1 ON s1.poll_id = e.id AND s1.poll_day = s2.poll_day - 7
      WHERE s2.poll_day >= 13 AND (s2.poll_day + 1) % 7 = 0
        AND s1.total_valid_votes > 0 AND s2.total_valid_votes > 0
        AND s2.cutoff_at > ${start} AND s2.cutoff_at <= ${end}
        AND s1.total_valid_votes >= ${m.minVotes} AND s2.total_valid_votes >= ${m.minVotes}
    ),
    active AS (
      SELECT pr.id, count(DISTINCT ev.user_id)::int AS n
      FROM pairs pr
      JOIN vote_events ev ON ev.poll_id = pr.id AND ev.occurred_at >= pr.from_end AND ev.occurred_at < pr.to_end
        AND ev.type IN ('CAST', 'CHANGE', 'RESTORE')
      GROUP BY pr.id
    ),
    moves AS (
      SELECT pr.*, a.n AS active_accounts, o.id AS option_id, o.position,
        round(o1.valid_vote_count * 100.0 / pr.sample_from, 2) AS from_pct,
        round(o2.valid_vote_count * 100.0 / pr.sample_to, 2) AS to_pct
      FROM pairs pr
      JOIN active a ON a.id = pr.id AND a.n >= ${m.minActiveAccounts}
      JOIN poll_options o ON o.poll_id = pr.id
      JOIN poll_option_daily_snapshots o1 ON o1.poll_id = pr.id AND o1.option_id = o.id AND o1.local_date = pr.d1
      JOIN poll_option_daily_snapshots o2 ON o2.poll_id = pr.id AND o2.option_id = o.id AND o2.local_date = pr.d2
    ),
    best AS (
      SELECT DISTINCT ON (id) *, to_pct - from_pct AS delta
      FROM moves
      ORDER BY id, abs(to_pct - from_pct) DESC, position ASC
    ),
    scored AS (
      SELECT id, opens_at, abs(delta)::float8 AS score,
        jsonb_build_object('optionId', option_id, 'fromPercent', from_pct, 'toPercent', to_pct, 'deltaPoints', delta,
          'sampleFrom', sample_from, 'sampleTo', sample_to, 'windowFromEnd', from_end, 'windowToEnd', to_end,
          'activeAccounts', active_accounts) AS components
      FROM best
      WHERE delta <> 0
    )`);
}
