import type { PrismaClient } from "@kararver/db";

export type MetricsRange = "7d" | "30d";
export type AdminMetrics = {
  range: MetricsRange;
  generatedAt: string;
  totals: {
    users: number; polls: number; votes: number; comments: number; openReports: number;
    activeUsers24h: number; registrations24h: number; activeCommunities: number;
    removedPolls: number; removedComments: number;
    activeAccounts: number; suspendedAccounts: number; communityMembers: number;
    pendingMedia: number; quarantinedMedia: number; moderationActions24h: number;
  };
  series: Array<{ localDate: string; activeUsers: number; registrations: number; polls: number; votes: number; comments: number }>;
};

export function createPrismaMetricsStore(prisma: PrismaClient, now: () => Date = () => new Date()) {
  return {
    async get(range: MetricsRange): Promise<AdminMetrics> {
      const days = range === "30d" ? 30 : 7;
      const at = now();
      const since24h = new Date(at.getTime() - 24 * 60 * 60 * 1000);
      return prisma.$transaction(async tx => {
        const [totals, rows, activeRows, memberRows] = await Promise.all([
          Promise.all([
            tx.user.count({ where: { deletedAt: null } }),
            tx.poll.count({ where: { deletedAt: null } }),
            tx.vote.count(),
            tx.comment.count({ where: { deletedAt: null } }),
            tx.report.count({ where: { status: "OPEN" } }),
            tx.user.count({ where: { deletedAt: null, createdAt: { gte: since24h, lte: at } } }),
            tx.community.count({ where: { status: "ACTIVE" } }),
            tx.poll.count({ where: { OR: [{ status: "REMOVED" }, { deletedAt: { not: null } }] } }),
            tx.comment.count({ where: { OR: [{ status: "REMOVED" }, { deletedAt: { not: null } }] } }),
            tx.user.count({ where: { deletedAt: null, status: "ACTIVE" } }),
            tx.user.count({ where: { deletedAt: null, status: "SUSPENDED" } }),
            tx.mediaAsset.count({ where: { status: "PENDING" } }),
            tx.mediaAsset.count({ where: { status: "QUARANTINED" } }),
            tx.moderationAction.count({ where: { createdAt: { gte: since24h, lte: at } } }),
          ]),
          tx.$queryRaw<Array<{ localDate: string; activeUsers: bigint; registrations: bigint; polls: bigint; votes: bigint; comments: bigint }>>`
            SELECT (d AT TIME ZONE 'Europe/Istanbul')::date::text AS "localDate",
              (SELECT count(DISTINCT s.user_id) FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.created_at >= d AND s.created_at < d + interval '1 day' AND s.created_at <= ${at} AND u.deleted_at IS NULL) AS "activeUsers",
              (SELECT count(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day' AND u.created_at <= ${at} AND u.deleted_at IS NULL) AS registrations,
              (SELECT count(*) FROM polls p WHERE p.created_at >= d AND p.created_at < d + interval '1 day' AND p.created_at <= ${at} AND p.deleted_at IS NULL) AS polls,
              (SELECT count(*) FROM votes v WHERE v.created_at >= d AND v.created_at < d + interval '1 day' AND v.created_at <= ${at}) AS votes,
              (SELECT count(*) FROM comments c WHERE c.created_at >= d AND c.created_at < d + interval '1 day' AND c.created_at <= ${at} AND c.deleted_at IS NULL) AS comments
            FROM generate_series(
              (date_trunc('day', ${at}::timestamptz AT TIME ZONE 'Europe/Istanbul') - (${days}::int - 1) * interval '1 day') AT TIME ZONE 'Europe/Istanbul',
              date_trunc('day', ${at}::timestamptz AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul',
              interval '1 day'
            ) d
            ORDER BY d ASC
          `,
          // Active in the last rolling 24 h, not merely a user with an unexpired cookie.
          tx.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(DISTINCT s.user_id)::bigint AS count
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.revoked_at IS NULL AND s.expires_at > ${at} AND s.created_at <= ${at}
              AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
              AND (s.created_at >= ${since24h}::timestamptz OR (s.last_seen_at >= ${since24h}::timestamptz AND s.last_seen_at <= ${at}))
          `,
          tx.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(DISTINCT m.user_id)::bigint AS count
            FROM community_memberships m JOIN communities c ON c.id=m.community_id JOIN users u ON u.id=m.user_id
            WHERE c.status='ACTIVE' AND u.deleted_at IS NULL AND u.status='ACTIVE'
          `,
        ]);
        return {
          range,
          generatedAt: at.toISOString(),
          totals: {
            users: totals[0], polls: totals[1], votes: totals[2], comments: totals[3], openReports: totals[4],
            registrations24h: totals[5], activeCommunities: totals[6], removedPolls: totals[7], removedComments: totals[8],
            activeUsers24h: Number(activeRows[0]?.count ?? 0n),
            activeAccounts: totals[9], suspendedAccounts: totals[10], pendingMedia: totals[11], quarantinedMedia: totals[12],
            moderationActions24h: totals[13], communityMembers: Number(memberRows[0]?.count ?? 0n),
          },
          series: rows.map((row) => ({ localDate: row.localDate, activeUsers: Number(row.activeUsers), registrations: Number(row.registrations), polls: Number(row.polls), votes: Number(row.votes), comments: Number(row.comments) })),
        };
      }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
    },
  };
}

export type MetricsStore = ReturnType<typeof createPrismaMetricsStore>;
