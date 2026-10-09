// FeedStore'un PostgreSQL uygulaması. Sorgu planı: docs/KV-27_FOR_YOU_FEED.md.
// Index'ler (migration 20260930203000_mehmet_kv15_user_interests, KV-15 ile birlikte açıldı): adaylar polls (opens_at DESC, id DESC),
// oy sayımı votes (poll_id, created_at, invalidated_at); ikisi de index-only.
import { Prisma, type PrismaClient } from "@kararver/db";
import type { FeedStore } from "./store.ts";

type Row = {
  id: string;
  author_id: string;
  category_id: string;
  opens_at: Date;
  visible: boolean;
  votes_total: number;
  votes_24h: number;
  comments_24h: number;
};

export function createPrismaFeedStore(prisma: PrismaClient): FeedStore {
  return {
    async candidates({ generatedAt, categoryId, communityId, limit }) {
      // Zaman ISO-8601 metni olarak gider ve açıkça timestamptz'ye çevrilir (DATA_MODEL §2.2).
      const at = Prisma.sql`${generatedAt.toISOString()}::timestamptz`;
      const rows = await prisma.$queryRaw<Row[]>`
        WITH c AS (
          SELECT p.id, p.author_id, p.category_id, p.opens_at, p.status
          FROM polls p
          WHERE p.opens_at <= ${at}
            ${categoryId ? Prisma.sql`AND p.category_id = ${categoryId}::uuid` : Prisma.empty}
            ${communityId ? Prisma.sql`AND p.community_id = ${communityId}::uuid` : Prisma.empty}
          ORDER BY p.opens_at DESC, p.id DESC
          LIMIT ${limit}
        )
        SELECT
          c.id::text AS id,
          c.author_id::text AS author_id,
          c.category_id::text AS category_id,
          c.opens_at,
          c.status IN ('ACTIVE', 'LOCKED') AS visible,
          v.total::int AS votes_total,
          v.recent::int AS votes_24h,
          m.recent::int AS comments_24h
        FROM c
        CROSS JOIN LATERAL (
          SELECT count(*) AS total, count(*) FILTER (WHERE x.created_at > ${at} - interval '24 hours') AS recent
          FROM votes x
          WHERE x.poll_id = c.id AND x.created_at <= ${at}
            AND (x.invalidated_at IS NULL OR x.invalidated_at > ${at})
        ) v
        CROSS JOIN LATERAL (
          SELECT count(*) AS recent
          FROM comments y
          WHERE y.poll_id = c.id AND y.created_at <= ${at} AND y.created_at > ${at} - interval '24 hours'
            AND (y.deleted_at IS NULL OR y.deleted_at > ${at})
        ) m`;
      return rows.map((r) => ({
        id: r.id,
        authorId: r.author_id,
        categoryId: r.category_id,
        opensAt: r.opens_at,
        visible: r.visible,
        votesTotal: r.votes_total,
        votes24h: r.votes_24h,
        comments24h: r.comments_24h,
      }));
    },

    async interests(userId) {
      const rows = await prisma.userInterest.findMany({ where: { userId }, select: { categoryId: true } });
      return rows.map((r) => r.categoryId);
    },
  };
}
