import type { PrismaClient } from "@kararver/db";

export type MetricsRange = "7d" | "30d";
export type AdminMetrics = {
  range: MetricsRange;
  generatedAt: string;
  totals: { users: number; polls: number; votes: number; comments: number; openReports: number };
  series: Array<{ localDate: string; activeUsers: number; registrations: number; polls: number; votes: number; comments: number }>;
};

export function createPrismaMetricsStore(prisma: PrismaClient) {
  return {
    async get(range: MetricsRange): Promise<AdminMetrics> {
      const days = range === "30d" ? 30 : 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [totals, rows] = await Promise.all([
        prisma.$transaction([
          prisma.user.count({ where: { deletedAt: null } }),
          prisma.poll.count({ where: { deletedAt: null } }),
          prisma.vote.count(),
          prisma.comment.count({ where: { deletedAt: null } }),
          prisma.report.count({ where: { status: "OPEN" } }),
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
      ]);
      return {
        range,
        generatedAt: new Date().toISOString(),
        totals: { users: totals[0], polls: totals[1], votes: totals[2], comments: totals[3], openReports: totals[4] },
        series: rows.map((row) => ({ localDate: row.localDate, activeUsers: Number(row.activeUsers), registrations: Number(row.registrations), polls: Number(row.polls), votes: Number(row.votes), comments: Number(row.comments) })),
      };
    },
  };
}

export type MetricsStore = ReturnType<typeof createPrismaMetricsStore>;
