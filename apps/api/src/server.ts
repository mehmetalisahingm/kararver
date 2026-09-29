// API giriş noktası: pnpm --filter @kararver/api dev
import path from "node:path";
import { createPrismaClient } from "@kararver/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMailer } from "./mail/mailer.ts";
import { createArgon2Hasher } from "./modules/auth/crypto.ts";
import { createPrismaAuthStore } from "./modules/auth/prisma-store.ts";
import { createPrismaMediaStore } from "./modules/media/prisma-store.ts";
import { startPgBossMediaQueue } from "./modules/media/queue.ts";
import { createS3MediaStorage } from "./modules/media/storage.ts";
import { createPrismaCommentStore } from "./modules/comments/prisma-store.ts";
import { createPrismaPollStore } from "./modules/polls/prisma-store.ts";
import { createPrismaRbacStore } from "./modules/rbac/prisma-store.ts";
import { createPrismaVoteStore } from "./modules/votes/prisma-store.ts";

// Local'de repo kökündeki .env okunur; staging/production'da değerler ortamdan gelir.
if (!process.env.APP_ENV) {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
  } catch {
    // .env yok: ortam değişkenleri kullanılır
  }
}

const config = loadConfig();
const prisma = createPrismaClient();
const mediaQueue = config.storage
  ? await startPgBossMediaQueue(process.env.DATABASE_URL!, (err) => console.error("media kuyruğu hatası", err))
  : null;
const app = buildApp({
  config,
  authStore: createPrismaAuthStore(prisma),
  rbacStore: createPrismaRbacStore(prisma),
  pollStore: createPrismaPollStore(prisma),
  voteStore: createPrismaVoteStore(prisma),
  commentStore: createPrismaCommentStore(prisma),
  hasher: createArgon2Hasher(),
  mailer: createMailer(config.mail.transport, config.mail.from),
  media:
    config.storage && mediaQueue
      ? { store: createPrismaMediaStore(prisma), storage: createS3MediaStorage(config.storage), queue: mediaQueue }
      : undefined,
});
if (!config.storage) app.log.warn("S3_* tanımlı değil: medya endpoint'leri kapalı");

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "kapanıyor");
  await app.close();
  await mediaQueue?.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "0.0.0.0", port: config.port });
