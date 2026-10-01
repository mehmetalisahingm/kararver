// KV-22 (#24) — public profil ve private bookmark PostgreSQL/Prisma uygulaması.
import { Prisma, type PrismaClient } from "@kararver/db";
import type { ProfileCommentRecord, ProfilePageCursor, ProfileStore } from "./store.ts";

const VISIBLE = ["ACTIVE", "LOCKED"] as const;

function createdAtKeyset(after: ProfilePageCursor) {
  if (!after) return {};
  return {
    OR: [
      { createdAt: { lt: after.createdAt } },
      { createdAt: after.createdAt, id: { lt: after.id } },
    ],
  } as const;
}

export function createPrismaProfileStore(prisma: PrismaClient): ProfileStore {
  return {
    async findPublicProfile(username) {
      const user = await prisma.user.findUnique({
        where: { usernameNormalized: username },
        select: {
          id: true,
          username: true,
          displayName: true,
          bio: true,
          status: true,
          deletedAt: true,
          createdAt: true,
          avatarMedia: { select: { status: true, publicObjectKey: true } },
        },
      });
      if (!user || user.deletedAt || !["ACTIVE", "RESTRICTED"].includes(user.status)) return null;

      const [polls, comments] = await Promise.all([
        prisma.poll.aggregate({
          where: { authorId: user.id, status: { in: [...VISIBLE] } },
          _count: { _all: true },
          _sum: { voteCount: true },
        }),
        prisma.comment.count({
          where: {
            authorId: user.id,
            status: "ACTIVE",
            deletedAt: null,
            poll: { status: { in: [...VISIBLE] } },
          },
        }),
      ]);

      const avatar = user.avatarMedia;
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        joinedAt: user.createdAt,
        avatarPublicKey: avatar?.status === "APPROVED" ? avatar.publicObjectKey : null,
        pollCount: polls._count._all,
        votesReceived: polls._sum.voteCount ?? 0,
        commentCount: comments,
      };
    },

    async listPublicPollIds(userId, after, limit) {
      return prisma.poll.findMany({
        where: { authorId: userId, status: { in: [...VISIBLE] }, ...createdAtKeyset(after) },
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },

    async listPublicComments(userId, viewerId, after, limit): Promise<ProfileCommentRecord[]> {
      const rows = await prisma.comment.findMany({
        where: {
          authorId: userId,
          status: "ACTIVE",
          deletedAt: null,
          poll: { status: { in: [...VISIBLE] } },
          ...createdAtKeyset(after),
        },
        select: {
          id: true,
          pollId: true,
          parentId: true,
          kind: true,
          body: true,
          likeCount: true,
          dislikeCount: true,
          replyCount: true,
          editedAt: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarMedia: { select: { status: true, publicObjectKey: true } },
            },
          },
          reactions: {
            where: { userId: viewerId ?? undefined },
            select: { value: true },
            take: viewerId ? 1 : 0,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });

      return rows.map((row) => ({
        id: row.id,
        pollId: row.pollId,
        parentId: row.parentId,
        kind: row.kind,
        body: row.body,
        likeCount: row.likeCount,
        dislikeCount: row.dislikeCount,
        replyCount: row.replyCount,
        editedAt: row.editedAt,
        createdAt: row.createdAt,
        author: {
          id: row.author.id,
          username: row.author.username,
          displayName: row.author.displayName,
          avatarPublicKey:
            row.author.avatarMedia?.status === "APPROVED" ? row.author.avatarMedia.publicObjectKey : null,
        },
        viewerReaction: row.reactions[0]?.value ?? null,
      }));
    },

    async putBookmark(userId, pollId) {
      return prisma.$transaction(async (tx) => {
        // Görünürlük kontrolü ile kayıt aynı transaction'da; moderasyon durum değişimi FOR SHARE bitene kadar bekler.
        const rows = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text FROM polls
          WHERE id = ${pollId}::uuid AND status IN ('ACTIVE', 'LOCKED')
          FOR SHARE`;
        if (rows.length === 0) return "not_found" as const;

        const inserted = await tx.bookmark.createMany({
          data: [{ userId, pollId }],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          await tx.poll.update({ where: { id: pollId }, data: { saveCount: { increment: 1 } } });
        }
        return "saved" as const;
      });
    },

    async deleteBookmark(userId, pollId) {
      await prisma.$transaction(async (tx) => {
        const removed = await tx.bookmark.deleteMany({ where: { userId, pollId } });
        if (removed.count === 1) {
          // İçerik hâlâ varsa sayaç bir kez azalır. Cascade ile anket silindiyse updateMany 0 döner.
          await tx.poll.updateMany({ where: { id: pollId, saveCount: { gt: 0 } }, data: { saveCount: { decrement: 1 } } });
        }
      });
    },

    async listBookmarkPollIds(userId, after, limit) {
      const cursor = after
        ? Prisma.sql`AND (b.created_at < ${after.createdAt.toISOString()}::timestamptz
            OR (b.created_at = ${after.createdAt.toISOString()}::timestamptz AND b.poll_id < ${after.id}::uuid))`
        : Prisma.empty;
      return prisma.$queryRaw<{ id: string; createdAt: Date }[]>(Prisma.sql`
        SELECT b.poll_id::text AS id, b.created_at AS "createdAt"
        FROM bookmarks b
        JOIN polls p ON p.id = b.poll_id
        WHERE b.user_id = ${userId}::uuid
          AND p.status IN ('ACTIVE', 'LOCKED')
          ${cursor}
        ORDER BY b.created_at DESC, b.poll_id DESC
        LIMIT ${limit}`);
    },
  };
}
