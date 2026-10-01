// CommunityStore'un PostgreSQL uygulaması — communities, community_memberships (DATA_MODEL.md §9).
import type { PrismaClient } from "@kararver/db";
import type { CommunityRecord, CommunityRole, CommunityStore, MemberRecord } from "./store.ts";

const approvedKey = (media: { status: string; publicObjectKey: string | null } | null) =>
  media?.status === "APPROVED" ? media.publicObjectKey : null;

const communitySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  memberCount: true,
  membersVisibility: true,
  createdAt: true,
  imageMedia: { select: { status: true, publicObjectKey: true } },
} as const;

type SelectedCommunity = Omit<CommunityRecord, "imagePublicKey"> & {
  imageMedia: { status: string; publicObjectKey: string | null } | null;
};

function toRecord({ imageMedia, ...community }: SelectedCommunity): CommunityRecord {
  return { ...community, imagePublicKey: approvedKey(imageMedia) };
}

export function createPrismaCommunityStore(prisma: PrismaClient): CommunityStore {
  return {
    async listActive(after, limit) {
      const rows = await prisma.community.findMany({
        where: {
          status: "ACTIVE",
          ...(after
            ? { OR: [{ memberCount: { lt: after.memberCount } }, { memberCount: after.memberCount, id: { gt: after.id } }] }
            : {}),
        },
        orderBy: [{ memberCount: "desc" }, { id: "asc" }],
        take: limit,
        select: communitySelect,
      });
      return rows.map(toRecord);
    },

    async findActiveBySlug(slug) {
      const row = await prisma.community.findFirst({ where: { slug, status: "ACTIVE" }, select: communitySelect });
      return row ? toRecord(row) : null;
    },

    async findActiveById(id) {
      const row = await prisma.community.findFirst({ where: { id, status: "ACTIVE" }, select: communitySelect });
      return row ? toRecord(row) : null;
    },

    async exists(id) {
      return (await prisma.community.count({ where: { id } })) === 1;
    },

    async roleOf(communityId, userId) {
      const row = await prisma.communityMembership.findUnique({
        where: { communityId_userId: { communityId, userId } },
        select: { role: true },
      });
      return row?.role ?? null;
    },

    async listMembers(communityId, after, limit) {
      const rows = await prisma.communityMembership.findMany({
        where: {
          communityId,
          user: { deletedAt: null },
          ...(after
            ? { OR: [{ createdAt: { lt: after.joinedAt } }, { createdAt: after.joinedAt, userId: { gt: after.userId } }] }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { userId: "asc" }],
        take: limit,
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
        },
      });
      return rows.map(
        (r): MemberRecord => ({
          role: r.role,
          joinedAt: r.createdAt,
          user: { id: r.user.id, username: r.user.username, displayName: r.user.displayName, avatarPublicKey: approvedKey(r.user.avatarMedia) },
        }),
      );
    },

    // ON CONFLICT DO NOTHING: eşzamanlı ikinci katılım ilkinin commit'ini bekler ve satır eklemez;
    // sayaç sadece gerçekten eklenen satır için artar (DATA_MODEL §2.5).
    async join(communityId, userId, now) {
      return prisma.$transaction(async (tx): Promise<CommunityRole> => {
        const inserted = await tx.$executeRaw`
          INSERT INTO community_memberships (community_id, user_id, role, created_at, updated_at)
          VALUES (${communityId}::uuid, ${userId}::uuid, 'MEMBER', ${now}, ${now})
          ON CONFLICT DO NOTHING`;
        if (inserted === 1) {
          await tx.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } });
          return "MEMBER";
        }
        const existing = await tx.communityMembership.findUniqueOrThrow({
          where: { communityId_userId: { communityId, userId } },
          select: { role: true },
        });
        return existing.role;
      });
    },

    async leave(communityId, userId) {
      await prisma.$transaction(async (tx) => {
        const deleted = await tx.$executeRaw`
          DELETE FROM community_memberships WHERE community_id = ${communityId}::uuid AND user_id = ${userId}::uuid`;
        if (deleted === 1) {
          await tx.community.update({ where: { id: communityId }, data: { memberCount: { decrement: 1 } } });
        }
      });
    },
  };
}
