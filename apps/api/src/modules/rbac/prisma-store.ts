// RbacStore'un PostgreSQL/Prisma uygulaması. Tablolar: user_roles, sanctions (DATA_MODEL §9.1),
// community_memberships (§9, Mert).
import type { PrismaClient } from "@kararver/db";
import type { RbacStore } from "./store.ts";

export function createPrismaRbacStore(prisma: PrismaClient): RbacStore {
  return {
    async grants(userId, now) {
      // Tek sorgu; aktif yaptırımlar (user_id, lifted_at, ends_at) index'inden okunur.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: { select: { role: true } },
          sanctions: {
            where: { liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            select: { type: true, endsAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!user) return { roles: [], sanctions: [] };
      return {
        roles: user.role ? [user.role.role] : [],
        sanctions: user.sanctions.map((s) => ({ type: s.type, endsAt: s.endsAt?.toISOString() ?? null })),
      };
    },

    async moderatedCommunityIds(userId) {
      const rows = await prisma.communityMembership.findMany({
        where: { userId, role: "MODERATOR" },
        select: { communityId: true },
      });
      return rows.map((r) => r.communityId);
    },
  };
}
