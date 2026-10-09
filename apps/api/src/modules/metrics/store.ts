import type { PrismaClient } from "@kararver/db";

export type MetricsRange = "7d" | "30d";
export type AdminMetrics = {
  range: MetricsRange;
  generatedAt: string;
  totals: {
    users: number; polls: number; votes: number; comments: number; openReports: number;
    activeUsers24h: number; registrations24h: number; activeCommunities: number;
    removedPolls: number; removedComments: number;
  };
  series: Array<{ localDate: string; activeUsers: number; registrations: number; polls: number; votes: number; comments: number }>;
};

export function createPrismaMetricsStore(prisma: PrismaClient) {
  return {
    async get(range: MetricsRange): Promise<AdminMetrics> {
      const days = range === "30d" ? 30 : 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [totals, rows, activeRows] = await Promise.all([
        prisma.$transaction([
          prisma.user.count({ where: { deletedAt: null } }),
          prisma.poll.count({ where: { deletedAt: null } }),
          prisma.vote.count(),
          prisma.comment.count({ where: { deletedAt: null } }),
          prisma.report.count({ where: { status: "OPEN" } }),
          prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since24h } } }),
          prisma.community.count({ where: { status: "ACTIVE" } }),
          prisma.poll.count({ where: { OR: [{ status: "REMOVED" }, { deletedAt: { not: null } }] } }),
          prisma.comment.count({ where: { OR: [{ status: "REMOVED" }, { deletedAt: { not: null } }] } }),
        ]),
        prisma.$queryRaw<Array<{ localDate: string; activeUsers: bigint; registrations: bigint; polls: bigint; votes: bigint; comments: bigint }>>`
          SELECT d::date::text AS "localDate",
            (SELECT count(DISTINCT s.user_id) FROM sessions s WHERE s.created_at >= d AND s.created_at < d + interval '1 day') AS "activeUsers",
            (SELECT count(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day' AND u.deleted_at IS NULL) AS registrations,
            (SELECT count(*) FROM polls p WHERE p.created_at >= d AND p.created_at < d + interval '1 day' AND p.deleted_at IS NULL) AS polls,
            (SELECT count(*) FROM votes v WHERE v.created_at >= d AND v.created_at < d + interval '1 day') AS votes,
            (SELECT count(*) FROM comments c WHERE c.created_at >= d AND c.created_at < d + interval '1 day' AND c.deleted_at IS NULL) AS comments
          FROM generate_series(${since}::timestamptz, now()::timestamptz, interval '1 day') d
          ORDER BY d::date ASC
        `,
        // Active in the last rolling 24 h, not merely a user with an unexpired cookie.
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(DISTINCT s.user_id)::bigint AS count
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.revoked_at IS NULL AND s.expires_at > now()
            AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
            AND (s.created_at >= ${since24h}::timestamptz OR s.last_seen_at >= ${since24h}::timestamptz)
        `,
      ]);
      return {
        range,
        generatedAt: new Date().toISOString(),
        totals: {
          users: totals[0], polls: totals[1], votes: totals[2], comments: totals[3], openReports: totals[4],
          registrations24h: totals[5], activeCommunities: totals[6], removedPolls: totals[7], removedComments: totals[8],
          activeUsers24h: Number(activeRows[0]?.count ?? 0n),
        },
        series: rows.map((row) => ({ localDate: row.localDate, activeUsers: Number(row.activeUsers), registrations: Number(row.registrations), polls: Number(row.polls), votes: Number(row.votes), comments: Number(row.comments) })),
      };
    },
  };
}

export type MetricsStore = ReturnType<typeof createPrismaMetricsStore>;
