import { createPrismaDecisionStore } from "../../src/modules/decisions/prisma-store.ts";
// Test düzeneği: uygulamayı sahte saat, mail yakalayıcı ve seçilen store ile kurar.
// Store'a özgü test işlemleri (durum değiştirme, medya ekleme) her iki uygulamada da aynı arayüzle yapılır.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Writable } from "node:stream";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import type { Mail } from "../../src/mail/mailer.ts";
import { createArgon2Hasher } from "../../src/modules/auth/crypto.ts";
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from "../../src/modules/rate-limit/policy.ts";
import { createPrismaRateLimitStore } from "../../src/modules/rate-limit/prisma-store.ts";
import type { RateLimitStore } from "../../src/modules/rate-limit/store.ts";
import { createMemoryRateLimitStore } from "./memory-rate-limit-store.ts";
import { createPrismaAdminUserStore } from "../../src/modules/admin-users/prisma-store.ts";
import { createPrismaAuthStore } from "../../src/modules/auth/prisma-store.ts";
import { createPrismaCategoryAdminStore } from "../../src/modules/categories/prisma-store.ts";
import { createPrismaCommunityStore } from "../../src/modules/communities/prisma-store.ts";
import type { AuthStore, UserStatus } from "../../src/modules/auth/store.ts";
import { createPrismaMediaStore } from "../../src/modules/media/prisma-store.ts";
import { DEFAULT_MEDIA_SETTINGS, type MediaSettings } from "../../src/modules/media/store.ts";
import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "../../src/modules/feed/for-you.ts";
import { createPrismaFeedStore } from "../../src/modules/feed/prisma-store.ts";
import { createPrismaFeaturedAdminStore } from "../../src/modules/featured/prisma-store.ts";
import { createPrismaCommentStore } from "../../src/modules/comments/prisma-store.ts";
import { createPrismaNotificationStore } from "../../src/modules/notifications/prisma-store.ts";
import { createPrismaOnboardingStore } from "../../src/modules/onboarding/prisma-store.ts";
import { createPrismaPointAdminStore } from "../../src/modules/points/admin-store.ts";
import { createPrismaPollStore } from "../../src/modules/polls/prisma-store.ts";
import { createPrismaSearchStore } from "../../src/modules/search/prisma-store.ts";
import { DEFAULT_POLL_SETTINGS, type PollSettings } from "../../src/modules/polls/store.ts";
import { createPrismaRbacStore } from "../../src/modules/rbac/prisma-store.ts";
import type { RbacStore } from "../../src/modules/rbac/store.ts";
import { createPrismaModerationStore } from "../../src/modules/moderation/prisma-store.ts";
import { createPrismaReportStore } from "../../src/modules/reports/prisma-store.ts";
import { createPrismaTrendStore } from "../../src/modules/trends/prisma-store.ts";
import { createPrismaRevisionStore } from "../../src/modules/revisions/prisma-store.ts";
import { createPrismaVoteStore } from "../../src/modules/votes/prisma-store.ts";
import { createFakeQueue, createFakeStorage, type FakeStorage } from "./fake-storage.ts";
import { createMemoryRbacStore } from "./memory-rbac-store.ts";
import { createMemoryAuthStore } from "./memory-store.ts";
import { resolveTestDatabaseUrl } from "./test-db.ts";

export const WEB_ORIGIN = "http://localhost:3000";
export const PEPPER = "test-pepper-0123456789-abcdefghijklmnop";

export type MediaSeed = { purpose: "AVATAR" | "POLL"; status: "PENDING" | "APPROVED" | "REJECTED" };

type Backend = {
  store: AuthStore;
  setStatus(userId: string, status: UserStatus): Promise<void>;
  addMedia(uploaderId: string, seed: MediaSeed): Promise<{ id: string; publicKey: string | null }>;
  activeSessions(userId: string): Promise<number>;
  /** Rol/yaptırım okuma (KV-12). Test verisi yardımcıları: ./rbac-probe.ts */
  rbac: RbacStore;
  close(): Promise<void>;
  /** Sadece PostgreSQL backend'inde; anket testleri seed ve doğrulama için kullanır. */
  prisma?: PrismaClient;
};

export type Harness = Backend & {
  app: FastifyInstance;
  mails: Mail[];
  logs: string[];
  clock: { now: Date; advance(ms: number): void };
  registrationEnabled: { value: boolean };
  /** Testin değiştirebileceği sistem ayarları (KV-40 gelene kadar). */
  pollSettings: PollSettings;
  /** Acil durum anahtarı features.comments (KV-40 gelene kadar). */
  commentsEnabled: { value: boolean };
  /** "Senin İçin" keşif payı ve tekrar sınırları (KV-40 gelene kadar). */
  feedSettings: FeedSettings;
  mediaSettings: MediaSettings;
  /**
   * KV-19 hız sınırları. Varsayılan gevşektir (diğer testler aynı IP'den çok hesap açar); rate-limit.test.ts
   * gerçek değerleri açar: `Object.assign(h.rateLimitSettings, DEFAULT_RATE_LIMIT_SETTINGS)`.
   */
  rateLimitSettings: RateLimitSettings;
  rateLimitStore: RateLimitStore;
  /** Medya route'ları sadece PostgreSQL backend'inde kayıtlıdır. */
  storage: FakeStorage;
  queue: { enqueued: string[] };
};

export type BackendFactory = { name: string; create(): Promise<Backend> };

export const memoryBackend: BackendFactory = {
  name: "memory",
  async create() {
    const store = createMemoryAuthStore();
    return {
      store,
      rbac: createMemoryRbacStore(),
      async setStatus(userId, status) {
        store.users.get(userId)!.status = status;
      },
      async addMedia(uploaderId, seed) {
        const id = randomUUID();
        const publicKey = seed.status === "APPROVED" ? `m/${id}.webp` : null;
        store.media.set(id, { id, uploaderId, purpose: seed.purpose, status: seed.status, publicKey });
        return { id, publicKey };
      },
      async activeSessions(userId) {
        return [...store.sessions.values()].filter((s) => s.userId === userId && !s.revokedAt).length;
      },
      async close() {},
    };
  },
};

/**
 * Gerçek PostgreSQL: TEST_DATABASE_URL, yoksa .env'deki DATABASE_URL + "_test" (support/test-db.ts).
 * Migration'lar `prisma migrate deploy` ile uygulanır.
 */
export function prismaBackend(): BackendFactory | null {
  const url = resolveTestDatabaseUrl(path.resolve(import.meta.dirname, "../../../.."));
  if (!url) return null;

  return {
    name: "postgres",
    async create() {
      const dbDir = path.resolve(import.meta.dirname, "../../../../packages/db");
      const prismaCli = createRequire(path.join(dbDir, "package.json")).resolve("prisma/build/index.js");
      const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
        cwd: dbDir,
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8",
      });
      if (migrate.status !== 0) throw new Error(`prisma migrate deploy başarısız:\n${migrate.stdout}\n${migrate.stderr}`);

      const prisma = createPrismaClient(url);
      return {
        store: createPrismaAuthStore(prisma),
        rbac: createPrismaRbacStore(prisma),
        async setStatus(userId, status) {
          await prisma.user.update({ where: { id: userId }, data: { status } });
        },
        async addMedia(uploaderId, seed) {
          const key = `test/${randomUUID()}`;
          const approved = seed.status === "APPROVED";
          const media = await prisma.mediaAsset.create({
            data: {
              uploaderId,
              purpose: seed.purpose,
              status: seed.status,
              originalObjectKey: `${key}/original`,
              processedObjectKey: approved ? `${key}/processed.webp` : null,
              publicObjectKey: approved ? `${key}.webp` : null,
            },
            select: { id: true, publicObjectKey: true },
          });
          return { id: media.id, publicKey: media.publicObjectKey };
        },
        async activeSessions(userId) {
          return prisma.session.count({ where: { userId, revokedAt: null } });
        },
        close: () => prisma.$disconnect(),
        prisma,
      };
    },
  };
}

export async function createHarness(factory: BackendFactory): Promise<Harness> {
  const backend = await factory.create();
  const mails: Mail[] = [];
  const logs: string[] = [];
  const clock = {
    now: new Date("2026-10-01T09:00:00.000Z"),
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
  const registrationEnabled = { value: true };
  // Test süreçlerinde "resmî limitler" tekrar yüklendiğinde de puan ekonomisi ilgisiz testleri etkilemesin.
  // #67 points.test.ts maliyeti kendi senaryosunda açıkça 10'a çeker; production varsayılanı kaynakta 10 kalır.
  DEFAULT_POLL_SETTINGS.publishCostPoints = 0;
  // Yayın limitleri (KV-20) varsayılan olarak gevşek: aynı kullanıcıyla peş peşe anket açan senaryolar
  // cooldown'a takılmasın. Puan da 0: yalnız points.test.ts #67 maliyetini 10'a çeker.
  const pollSettings: PollSettings = {
    ...DEFAULT_POLL_SETTINGS,
    publishCostPoints: 0,
    cooldownMinutes: 0,
    newAccountCooldownMinutes: 0,
    dailyLimit: 1000,
    newAccountDailyLimit: 100,
  };
  const commentsEnabled = { value: true };
  const feedSettings: FeedSettings = { ...DEFAULT_FEED_SETTINGS };
  const mediaSettings: MediaSettings = { ...DEFAULT_MEDIA_SETTINGS };
  const storage = createFakeStorage();
  const queue = createFakeQueue();
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "info",
    WEB_URL: WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    SESSION_COOKIE_SECURE: "false",
    AUTH_TOKEN_PEPPER: PEPPER,
    MAIL_FROM: "KararVer <no-reply@localhost>",
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
  });
  const rateLimitSettings: RateLimitSettings = Object.fromEntries(
    Object.keys(DEFAULT_RATE_LIMIT_SETTINGS).map((k) => [k, 1_000_000]),
  ) as RateLimitSettings;
  const rateLimitStore = backend.prisma ? createPrismaRateLimitStore(backend.prisma) : createMemoryRateLimitStore();
  const app = buildApp({
    config,
    rateLimitStore,
    rateLimitSettings: async () => rateLimitSettings,
    authStore: backend.store,
    rbacStore: backend.rbac,
    hasher: createArgon2Hasher(),
    mailer: { send: async (mail) => void mails.push(mail) },
    now: () => clock.now,
    isRegistrationEnabled: async () => registrationEnabled.value,
    decisionStore: backend.prisma ? createPrismaDecisionStore(backend.prisma) : undefined,
    pollStore: backend.prisma ? createPrismaPollStore(backend.prisma) : undefined,
    searchStore: backend.prisma ? createPrismaSearchStore(backend.prisma) : undefined,
    revisionStore: backend.prisma ? createPrismaRevisionStore(backend.prisma) : undefined,
    categoryAdminStore: backend.prisma ? createPrismaCategoryAdminStore(backend.prisma) : undefined,
    pointAdminStore: backend.prisma ? createPrismaPointAdminStore(backend.prisma) : undefined,
    featuredAdminStore: backend.prisma ? createPrismaFeaturedAdminStore(backend.prisma) : undefined,
    feedStore: backend.prisma ? createPrismaFeedStore(backend.prisma) : undefined,
    feedSettings: async () => feedSettings,
    trendStore: backend.prisma ? createPrismaTrendStore(backend.prisma) : undefined,
    voteStore: backend.prisma ? createPrismaVoteStore(backend.prisma) : undefined,
    communityStore: backend.prisma ? createPrismaCommunityStore(backend.prisma) : undefined,
    onboardingStore: backend.prisma ? createPrismaOnboardingStore(backend.prisma) : undefined,
    reportStore: backend.prisma ? createPrismaReportStore(backend.prisma) : undefined,
    moderationStore: backend.prisma ? createPrismaModerationStore(backend.prisma) : undefined,
    adminUserStore: backend.prisma ? createPrismaAdminUserStore(backend.prisma) : undefined,
    notificationStore: backend.prisma ? createPrismaNotificationStore(backend.prisma) : undefined,
    pollSettings: async () => pollSettings,
    commentStore: backend.prisma ? createPrismaCommentStore(backend.prisma) : undefined,
    isCommentsEnabled: async () => commentsEnabled.value,
    media: backend.prisma
      ? { store: createPrismaMediaStore(backend.prisma), storage, queue, settings: async () => mediaSettings }
      : undefined,
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
  await app.ready();
  return {
    ...backend,
    app,
    mails,
    logs,
    clock,
    registrationEnabled,
    pollSettings,
    commentsEnabled,
    feedSettings,
    mediaSettings,
    rateLimitSettings,
    rateLimitStore,
    storage,
    queue,
    async close() {
      await app.close();
      await backend.close();
    },
  };
}

export function tokenFrom(mail: Mail | undefined): string {
  const match = mail?.text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("mailde token bağlantısı yok");
  return match[1]!;
}

export function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const value = header?.match(/^kv_session=([^;]*)/)?.[1];
  if (!value) throw new Error("Set-Cookie'de oturum yok");
  return `kv_session=${value}`;
}
