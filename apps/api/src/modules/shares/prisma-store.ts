import { type PrismaClient } from "@kararver/db";
import type { ShareStore } from "./store.ts";

export function createPrismaShareStore(prisma: PrismaClient): ShareStore {
  return {
    async create(pollId, channel) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ slug: string; publicId: string }[]>`
          SELECT slug, public_id AS "publicId"
          FROM polls
          WHERE id = ${pollId}::uuid
            AND status IN ('ACTIVE', 'LOCKED')
          FOR SHARE`;
        const poll = rows[0];
        if (!poll) return null;

        const share = await tx.shareLink.create({
          data: { pollId, channel },
          select: { id: true },
        });
        return {
          id: share.id,
          canonicalPath: `/karar/${poll.slug}-${poll.publicId}`,
        };
      });
    },
  };
}
