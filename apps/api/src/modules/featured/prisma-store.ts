import { Prisma, type PrismaClient } from "@kararver/db";
import { runIdempotent } from "../../http/idempotency.ts";
import { writeAudit } from "../audit/write.ts";
import type {
  AnnouncementInput,
  AnnouncementRow,
  FeaturedAdminStore,
  FeaturedInput,
  FeaturedRow,
} from "./store.ts";

type Tx = Prisma.TransactionClient;

const featuredSelect = {
  id: true,
  pollId: true,
  surface: true,
  scopeId: true,
  priority: true,
  badge: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
} as const satisfies Prisma.FeaturedPlacementSelect;

const announcementSelect = {
  id: true,
  title: true,
  body: true,
  level: true,
  audience: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
} as const satisfies Prisma.AnnouncementSelect;

async function pollAvailable(tx: Tx, pollId: string): Promise<boolean> {
  return (await tx.poll.count({ where: { id: pollId, status: { not: "REMOVED" } } })) === 1;
}

const featuredAudit = (row: FeaturedRow | FeaturedInput) => ({
  pollId: row.pollId,
  surface: row.surface,
  scopeId: row.scopeId,
  priority: row.priority,
  badge: row.badge,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
});
const announcementAudit = (row: AnnouncementRow | AnnouncementInput) => ({
  title: row.title,
  body: row.body,
  level: row.level,
  audience: row.audience,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
});

function featuredNaturalKey(input: FeaturedInput) {
  return ["featured", input.pollId, input.surface, input.scopeId ?? "-", input.startsAt.toISOString(), input.endsAt.toISOString()].join(":");
}

async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function createPrismaFeaturedAdminStore(prisma: PrismaClient): FeaturedAdminStore {
  return {
    async listFeatured({ after, limit }) {
      const rows = await prisma.featuredPlacement.findMany({
        where: after
          ? {
              OR: [
                { createdAt: { lt: new Date(String(after.keys[0])) } },
                { createdAt: new Date(String(after.keys[0])), id: { lt: after.id } },
              ],
            }
          : {},
        select: featuredSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows as FeaturedRow[];
    },

    async activeFeatured(surface, scopeId, now) {
      return (await prisma.featuredPlacement.findMany({
        where: {
          surface,
          scopeId,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        select: featuredSelect,
        orderBy: [{ priority: "desc" }, { startsAt: "desc" }, { id: "desc" }],
        take: 20,
      })) as FeaturedRow[];
    },

    async getFeatured(id) {
      return (await prisma.featuredPlacement.findUnique({ where: { id }, select: featuredSelect })) as FeaturedRow | null;
    },

    createFeatured(scope, input, trail) {
      return runIdempotent<"POLL_NOT_AVAILABLE">(prisma, scope, 201, async (tx) => {
        await lock(tx, featuredNaturalKey(input));
        const duplicate = await tx.featuredPlacement.findFirst({
          where: {
            pollId: input.pollId,
            surface: input.surface,
            scopeId: input.scopeId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          select: { id: true },
        });
        if (duplicate) return { ok: true, value: duplicate.id };
        if (!(await pollAvailable(tx, input.pollId))) return { ok: false, reason: "POLL_NOT_AVAILABLE" };
        const created = await tx.featuredPlacement.create({ data: { ...input, createdBy: trail.actorId }, select: { id: true } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "featured.manage",
          operation: "create",
          target: { type: "FEATURED", id: created.id },
          reason: trail.reason,
          before: null,
          after: featuredAudit(input),
          requestId: trail.requestId,
          at: trail.now,
        });
        return { ok: true, value: created.id };
      });
    },

    updateFeatured(id, patch, trail) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.featuredPlacement.findUnique({ where: { id }, select: featuredSelect });
        if (!current) return "NOT_FOUND" as const;
        if (patch.pollId !== undefined && !(await pollAvailable(tx, patch.pollId))) return "POLL_NOT_AVAILABLE" as const;
        if (Object.keys(patch).length === 0) return "OK" as const;
        await tx.featuredPlacement.update({ where: { id }, data: patch });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "featured.manage",
          operation: "update",
          target: { type: "FEATURED", id },
          reason: trail.reason,
          before: featuredAudit(current as FeaturedRow),
          after: { ...patch, ...(patch.startsAt ? { startsAt: patch.startsAt.toISOString() } : {}), ...(patch.endsAt ? { endsAt: patch.endsAt.toISOString() } : {}) },
          requestId: trail.requestId,
          at: trail.now,
        });
        return "OK" as const;
      });
    },

    deleteFeatured(id, trail) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.featuredPlacement.findUnique({ where: { id }, select: featuredSelect });
        if (!current) return false;
        await tx.featuredPlacement.delete({ where: { id } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "featured.manage",
          operation: "delete",
          target: { type: "FEATURED", id },
          reason: trail.reason,
          before: featuredAudit(current as FeaturedRow),
          after: null,
          requestId: trail.requestId,
          at: trail.now,
        });
        return true;
      });
    },

    async listAnnouncements({ after, limit }) {
      return (await prisma.announcement.findMany({
        where: after
          ? {
              OR: [
                { createdAt: { lt: new Date(String(after.keys[0])) } },
                { createdAt: new Date(String(after.keys[0])), id: { lt: after.id } },
              ],
            }
          : {},
        select: announcementSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      })) as AnnouncementRow[];
    },

    async activeAnnouncements(now, authenticated) {
      return (await prisma.announcement.findMany({
        where: {
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          ...(authenticated ? {} : { audience: "ALL" }),
        },
        select: announcementSelect,
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        take: 20,
      })) as AnnouncementRow[];
    },

    async getAnnouncement(id) {
      return (await prisma.announcement.findUnique({ where: { id }, select: announcementSelect })) as AnnouncementRow | null;
    },

    async createAnnouncement(scope, input, trail) {
      const result = await runIdempotent(prisma, scope, 201, async (tx) => {
        const created = await tx.announcement.create({ data: { ...input, createdBy: trail.actorId }, select: { id: true } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "announcement.manage",
          operation: "create",
          target: { type: "ANNOUNCEMENT", id: created.id },
          reason: trail.reason,
          before: null,
          after: announcementAudit(input),
          requestId: trail.requestId,
          at: trail.now,
        });
        return { ok: true, value: created.id };
      });
      if (result.kind === "rejected") throw new Error("announcement create unexpectedly rejected");
      return result;
    },

    updateAnnouncement(id, patch, trail) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.announcement.findUnique({ where: { id }, select: announcementSelect });
        if (!current) return "NOT_FOUND" as const;
        if (Object.keys(patch).length === 0) return "OK" as const;
        await tx.announcement.update({ where: { id }, data: patch });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "announcement.manage",
          operation: "update",
          target: { type: "ANNOUNCEMENT", id },
          reason: trail.reason,
          before: announcementAudit(current as AnnouncementRow),
          after: { ...patch, ...(patch.startsAt ? { startsAt: patch.startsAt.toISOString() } : {}), ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt?.toISOString() ?? null } : {}) },
          requestId: trail.requestId,
          at: trail.now,
        });
        return "OK" as const;
      });
    },

    deleteAnnouncement(id, trail) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.announcement.findUnique({ where: { id }, select: announcementSelect });
        if (!current) return false;
        await tx.announcement.delete({ where: { id } });
        await writeAudit(tx, {
          source: "API",
          actorId: trail.actorId,
          action: "announcement.manage",
          operation: "delete",
          target: { type: "ANNOUNCEMENT", id },
          reason: trail.reason,
          before: announcementAudit(current as AnnouncementRow),
          after: null,
          requestId: trail.requestId,
          at: trail.now,
        });
        return true;
      });
    },
  };
}
