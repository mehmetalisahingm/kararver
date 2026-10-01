// RbacStore'un bellek içi uygulaması. Sadece test içindir; aynı senaryolar DB varken
// PrismaRbacStore ile de koşar (test/rbac.test.ts).
import type { ActorGrants, RbacStore } from "../../src/modules/rbac/store.ts";

type StaffRole = Exclude<ActorGrants["roles"][number], "USER">;
type SanctionType = ActorGrants["sanctions"][number]["type"];
export type StoredSanction = { id: string; userId: string; type: SanctionType; endsAt: Date | null; liftedAt: Date | null };

export type MemoryRbacStore = RbacStore & {
  roles: Map<string, StaffRole>;
  sanctions: StoredSanction[];
  /** community_memberships.role = MODERATOR: `${communityId}:${userId}` */
  moderators: Set<string>;
};

export function createMemoryRbacStore(): MemoryRbacStore {
  const roles = new Map<string, StaffRole>();
  const sanctions: StoredSanction[] = [];
  const moderators = new Set<string>();

  return {
    roles,
    sanctions,
    moderators,

    async grants(userId, now) {
      const role = roles.get(userId);
      return {
        roles: role ? [role] : [],
        sanctions: sanctions
          .filter((s) => s.userId === userId && !s.liftedAt && (s.endsAt === null || s.endsAt > now))
          .map((s) => ({ type: s.type, endsAt: s.endsAt?.toISOString() ?? null })),
      };
    },

    async moderatedCommunityIds(userId) {
      return [...moderators].filter((key) => key.endsWith(`:${userId}`)).map((key) => key.split(":")[0]!);
    },
  };
}
