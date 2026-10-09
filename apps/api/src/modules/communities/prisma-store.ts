// CommunityStore'un PostgreSQL uygulaması — communities, community_memberships (DATA_MODEL.md §9).
import type { Prisma, PrismaClient } from "@kararver/db";
import { runIdempotent } from "../../http/idempotency.ts";
import { ApiError } from "../../http/errors.ts";
import { writeAudit } from "../audit/write.ts";
import type { CommunityRecord, CommunityRejection, CommunityRole, CommunityStore, MemberRecord } from "./store.ts";

const isUniqueViolation = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

/** Topluluk görseli: COMMUNITY amaçlı ve yayınlanmış (APPROVED) olmalı; karantinadaki görsel sayfaya bağlanamaz. */
const isUsableImage = async (tx: Prisma.TransactionClient, id: string) =>
  (await tx.mediaAsset.count({ where: { id, purpose: "COMMUNITY", status: "APPROVED" } })) === 1;

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
        // Closing job locks the same community row; joining after expiry must fail.
        const [community] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text AS status FROM communities WHERE id = ${communityId}::uuid FOR UPDATE`;
        if (!community || community.status !== "ACTIVE") throw new ApiError("NOT_FOUND", "Topluluk kapalı veya bulunamadı.");
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

    async findAnyById(id) {
      const row = await prisma.community.findUnique({ where: { id }, select: communitySelect });
      return row ? toRecord(row) : null;
    },

    async createCommunity(scope, input, createdById, trail) {
      try {
        const result = await runIdempotent<CommunityRejection>(prisma, scope, 201, async (tx) => {
          if (input.imageMediaId && !(await isUsableImage(tx, input.imageMediaId))) return { ok: false, reason: "image_unusable" };
          if ((await tx.community.count({ where: { slug: input.slug } })) > 0) return { ok: false, reason: "slug_taken" };
          const created = await tx.community.create({ data: { ...input, createdById }, select: { id: true } });
          await writeAudit(tx, {
            source: "API",
            actorId: trail.actorId,
            action: "community.create",
            operation: "create",
            target: { type: "COMMUNITY", id: created.id },
            before: null,
            after: { slug: input.slug, name: input.name, membersVisibility: input.membersVisibility, imageMediaId: input.imageMediaId },
            requestId: trail.requestId,
            at: trail.now,
          });
          return { ok: true, value: created.id };
        });
        if (result.kind === "created" || result.kind === "replayed") return { kind: result.kind, id: result.resourceId };
        return result;
      } catch (err) {
        // Eşzamanlı aynı slug: kaybeden taraf unique index'te çakışır.
        if (isUniqueViolation(err)) return { kind: "rejected", reason: "slug_taken" };
        throw err;
      }
    },

    async updateCommunity(id, patch, trail) {
      const { slug, name, description, imageMediaId, membersVisibility, status } = patch;
      try {
        return await prisma.$transaction(async (tx) => {
          const current = await tx.community.findUnique({
            where: { id },
            select: { slug: true, name: true, description: true, imageMediaId: true, membersVisibility: true, status: true },
          });
          if (!current) return "NOT_FOUND" as const;
          if (imageMediaId && !(await isUsableImage(tx, imageMediaId))) return "image_unusable" as const;
          if (slug && (await tx.community.count({ where: { slug, id: { not: id } } })) > 0) return "slug_taken" as const;

          // Yalnız gerçekten değişen alanlar yazılır ve audit'e önce/sonra olarak girer; değişiklik yoksa iz de yok.
          const wanted = { slug, name, description, imageMediaId, membersVisibility, status };
          const changes = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => value !== undefined && value !== current[key as keyof typeof current]));
          if (Object.keys(changes).length === 0) return "OK" as const;
          await tx.community.update({ where: { id }, data: changes });
          await writeAudit(tx, {
            source: "API",
            actorId: trail.actorId,
            action: "community.update",
            operation: "update",
            target: { type: "COMMUNITY", id },
            reason: trail.reason,
            before: Object.fromEntries(Object.keys(changes).map((key) => [key, current[key as keyof typeof current] ?? null])),
            after: changes,
            requestId: trail.requestId,
            at: trail.now,
          });
          return "OK" as const;
        });
      } catch (err) {
        if (isUniqueViolation(err)) return "slug_taken";
        throw err;
      }
    },

    // ON CONFLICT DO NOTHING + sayaç: join ile aynı kural; mevcut üyeyse rol yükseltilir, sayaç değişmez.
    async assignModerator(communityId, userId, trail) {
      return prisma.$transaction(async (tx) => {
        if ((await tx.community.count({ where: { id: communityId } })) === 0) return "COMMUNITY_NOT_FOUND" as const;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
        if (!user || user.deletedAt) return "USER_NOT_FOUND" as const;
        const inserted = await tx.$executeRaw`
          INSERT INTO community_memberships (community_id, user_id, role, created_at, updated_at)
          VALUES (${communityId}::uuid, ${userId}::uuid, 'MODERATOR', now(), now())
          ON CONFLICT DO NOTHING`;
        let previous: "MEMBER" | null = null;
        if (inserted === 1) {
          await tx.community.update({ where: { id: communityId }, data: { memberCount: { increment: 1 } } });
        } else {
          const existing = await tx.communityMembership.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } }, select: { role: true } });
          // Zaten moderatör: değişiklik yok, iz de yok (idempotent).
          if (existing.role === "MODERATOR") return "OK" as const;
          previous = "MEMBER";
          await tx.communityMembership.update({ where: { communityId_userId: { communityId, userId } }, data: { role: "MODERATOR" } });
        }
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "community.moderator.assign",
          operation: "assign",
          target: { type: "COMMUNITY", id: communityId },
          reason: trail.reason,
          before: { userId, role: previous },
          after: { userId, role: "MODERATOR" },
          requestId: trail.requestId,
          at: trail.now,
        });
        return "OK" as const;
      });
    },

    async removeModerator(communityId, userId, trail) {
      return prisma.$transaction(async (tx) => {
        if ((await tx.community.count({ where: { id: communityId } })) === 0) return "COMMUNITY_NOT_FOUND" as const;
        const { count } = await tx.communityMembership.updateMany({ where: { communityId, userId, role: "MODERATOR" }, data: { role: "MEMBER" } });
        if (count === 1) {
          await writeAudit(tx, {
            source: "API",
            actorId: trail.actorId,
            action: "community.moderator.assign",
            operation: "remove",
            target: { type: "COMMUNITY", id: communityId },
            before: { userId, role: "MODERATOR" },
            after: { userId, role: "MEMBER" },
            requestId: trail.requestId,
            at: trail.now,
          });
        }
        return "OK" as const;
      });
    },
  };
}
