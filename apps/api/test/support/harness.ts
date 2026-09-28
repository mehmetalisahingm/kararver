// Test düzeneği: uygulamayı sahte saat, mail yakalayıcı ve seçilen store ile kurar.
// Store'a özgü test işlemleri (durum değiştirme, medya ekleme) her iki uygulamada da aynı arayüzle yapılır.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Writable } from "node:stream";
import { createPrismaClient } from "@kararver/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import type { Mail } from "../../src/mail/mailer.ts";
import { createArgon2Hasher } from "../../src/modules/auth/crypto.ts";
import { createPrismaAuthStore } from "../../src/modules/auth/prisma-store.ts";
import type { AuthStore, UserStatus } from "../../src/modules/auth/store.ts";
import { createMemoryAuthStore } from "./memory-store.ts";

export const WEB_ORIGIN = "http://localhost:3000";
export const PEPPER = "test-pepper-0123456789-abcdefghijklmnop";

export type MediaSeed = { purpose: "AVATAR" | "POLL"; status: "PENDING" | "APPROVED" | "REJECTED" };

type Backend = {
  store: AuthStore;
  setStatus(userId: string, status: UserStatus): Promise<void>;
  addMedia(uploaderId: string, seed: MediaSeed): Promise<{ id: string; publicKey: string | null }>;
  activeSessions(userId: string): Promise<number>;
  close(): Promise<void>;
};

export type Harness = Backend & {
  app: FastifyInstance;
  mails: Mail[];
  logs: string[];
  clock: { now: Date; advance(ms: number): void };
  registrationEnabled: { value: boolean };
};

export type BackendFactory = { name: string; create(): Promise<Backend> };

export const memoryBackend: BackendFactory = {
  name: "memory",
  async create() {
    const store = createMemoryAuthStore();
    return {
      store,
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

/** TEST_DATABASE_URL varsa (CI) gerçek PostgreSQL. Migration'lar `prisma migrate deploy` ile uygulanır. */
export function prismaBackend(): BackendFactory | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test")) throw new Error(`Güvenlik: test veritabanının adı "_test" ile bitmeli (şu an: "${dbName}")`);

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
  const app = buildApp({
    config,
    authStore: backend.store,
    hasher: createArgon2Hasher(),
    mailer: { send: async (mail) => void mails.push(mail) },
    now: () => clock.now,
    isRegistrationEnabled: async () => registrationEnabled.value,
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
