// KV-12 (#14) RBAC test yardımcıları; sadece test/rbac.test.ts kullanır.
// - rbacSeeds: KV-33 rol/yaptırım servisi gelene kadar user_roles, sanctions ve topluluk moderatörlüğü
//   satırlarını doğrudan yazar (memory veya PostgreSQL, harness'in seçtiği backend'e göre).
// - createProbe: aynı store, saat ve oturum ayarlarıyla sadece verilen route'ları kaydeden ayrı bir
//   uygulama. Henüz handler'ı olmayan endpoint'lerde (admin/moderasyon) router'ın yetki kapısını sınar.
//   buildApp'e (app.ts/server.ts) hiçbir route eklemez.
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "../../src/config.ts";
import { registerErrorHandling } from "../../src/http/errors.ts";
import { createRouter, type Route } from "../../src/http/route.ts";
import { createAuthenticator } from "../../src/modules/auth/session.ts";
import type { UserStatus } from "../../src/modules/auth/store.ts";
import type { Harness } from "./harness.ts";
import { PEPPER, WEB_ORIGIN } from "./harness.ts";
import type { MemoryRbacStore, StoredSanction } from "./memory-rbac-store.ts";
import type { MemoryAuthStore } from "./memory-store.ts";

type StaffRole = "MODERATOR" | "ADMIN" | "SUPER_ADMIN";

/** startsAt servis kuralında yazma anıdır (DATA_MODEL §9.1); testler saati açıkça verir. */
export type SanctionSeed = { type: StoredSanction["type"]; createdById: string; startsAt: Date; endsAt?: Date | null };

export type RbacSeeds = {
  /** user_roles satırını yazar; null USER'a düşürür (satırı siler). granted_by null sadece ilk SUPER_ADMIN. */
  setRole(userId: string, role: StaffRole | null, grantedById: string | null): Promise<void>;
  /** Yaptırım ekler ve users.status'u yeniden hesaplar. */
  addSanction(userId: string, seed: SanctionSeed): Promise<string>;
  liftSanction(sanctionId: string, liftedById: string, at: Date): Promise<void>;
  /** Topluluk açar ve kullanıcıyı topluluk moderatörü yapar (community_memberships.role = MODERATOR). */
  addModeratedCommunity(userId: string, createdById: string): Promise<string>;
};

/**
 * users.status servisin yapacağı gibi kaldırılmamış yaptırımlardan yeniden hesaplanır (DATA_MODEL §9.1):
 * BAN > SUSPEND > RESTRICT_* → RESTRICTED > ACTIVE. Süre dolumu job'ı yok (KV-33); status onu beklemez.
 */
function statusFrom(types: StoredSanction["type"][]): UserStatus {
  if (types.includes("BAN")) return "BANNED";
  if (types.includes("SUSPEND")) return "SUSPENDED";
  if (types.includes("RESTRICT_COMMENTS") || types.includes("RESTRICT_POSTING")) return "RESTRICTED";
  return "ACTIVE";
}

export function rbacSeeds(h: Harness): RbacSeeds {
  const prisma = h.prisma;
  if (!prisma) {
    const store = h.store as MemoryAuthStore;
    const rbac = h.rbac as MemoryRbacStore;
    const syncStatus = (userId: string) => {
      const types = rbac.sanctions.filter((s) => s.userId === userId && !s.liftedAt).map((s) => s.type);
      store.users.get(userId)!.status = statusFrom(types);
    };
    return {
      async setRole(userId, role) {
        if (role) rbac.roles.set(userId, role);
        else rbac.roles.delete(userId);
      },
      async addSanction(userId, seed) {
        const id = randomUUID();
        rbac.sanctions.push({ id, userId, type: seed.type, endsAt: seed.endsAt ?? null, liftedAt: null });
        syncStatus(userId);
        return id;
      },
      async liftSanction(sanctionId, _liftedById, at) {
        const sanction = rbac.sanctions.find((s) => s.id === sanctionId)!;
        sanction.liftedAt = at;
        syncStatus(sanction.userId);
      },
      async addModeratedCommunity(userId) {
        const communityId = randomUUID();
        rbac.moderators.add(`${communityId}:${userId}`);
        return communityId;
      },
    };
  }

  const syncStatus = async (userId: string) => {
    const active = await prisma.sanction.findMany({ where: { userId, liftedAt: null }, select: { type: true } });
    await prisma.user.update({ where: { id: userId }, data: { status: statusFrom(active.map((s) => s.type)) } });
  };
  return {
    async setRole(userId, role, grantedById) {
      if (!role) {
        await prisma.userRole.deleteMany({ where: { userId } });
        return;
      }
      await prisma.userRole.upsert({ where: { userId }, create: { userId, role, grantedById }, update: { role, grantedById } });
    },
    async addSanction(userId, seed) {
      // created_at da test saatinden yazılır: lifted_at >= created_at CHECK'i gerçek saatle çakışmasın.
      const sanction = await prisma.sanction.create({
        data: {
          userId,
          type: seed.type,
          reason: "test yaptırımı",
          startsAt: seed.startsAt,
          createdAt: seed.startsAt,
          endsAt: seed.endsAt ?? null,
          createdById: seed.createdById,
        },
        select: { id: true },
      });
      await syncStatus(userId);
      return sanction.id;
    },
    async liftSanction(sanctionId, liftedById, at) {
      const sanction = await prisma.sanction.update({
        where: { id: sanctionId },
        data: { liftedAt: at, liftedById, liftReason: "test kaldırma" },
        select: { userId: true },
      });
      await syncStatus(sanction.userId);
    },
    async addModeratedCommunity(userId, createdById) {
      const community = await prisma.community.create({
        data: { slug: `mod-${randomUUID().slice(0, 8)}`, name: "Moderasyon Topluluğu", createdById },
        select: { id: true },
      });
      await prisma.communityMembership.create({ data: { communityId: community.id, userId, role: "MODERATOR" } });
      return community.id;
    },
  };
}

export type Probe = { app: FastifyInstance; logs: string[] };

/** Oturum cookie'si harness'in uygulamasıyla aynı ayarlarla çözülür (aynı pepper ve cookie adı). */
export async function createProbe(
  h: Harness,
  register: (route: Route) => void,
  options: { enforceResourceChecks?: boolean } = {},
): Promise<Probe> {
  const config = loadConfig({
    APP_ENV: "test",
    WEB_URL: WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    SESSION_COOKIE_SECURE: "false",
    AUTH_TOKEN_PEPPER: PEPPER,
    MAIL_FROM: "KararVer <no-reply@localhost>",
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
  });
  const logs: string[] = [];
  const app = Fastify({
    logger: {
      level: "info",
      stream: new Writable({
        write(chunk, _enc, done) {
          logs.push(String(chunk));
          done();
        },
      }),
    },
  });
  registerErrorHandling(app);
  const now = () => h.clock.now;
  register(
    createRouter(app, {
      validateResponses: false,
      enforceResourceChecks: options.enforceResourceChecks ?? true,
      authenticator: createAuthenticator(h.store, { ...config.session, pepper: config.authTokenPepper }, now),
      rbac: h.rbac,
      now,
    }),
  );
  await app.ready();
  return { app, logs };
}
