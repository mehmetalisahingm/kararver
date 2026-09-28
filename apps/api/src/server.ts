// API giriş noktası: pnpm --filter @kararver/api dev
import path from "node:path";
import { createPrismaClient } from "@kararver/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMailer } from "./mail/mailer.ts";
import { createArgon2Hasher } from "./modules/auth/crypto.ts";
import { createPrismaAuthStore } from "./modules/auth/prisma-store.ts";
import { createPrismaPollStore } from "./modules/polls/prisma-store.ts";

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
const app = buildApp({
  config,
  authStore: createPrismaAuthStore(prisma),
  pollStore: createPrismaPollStore(prisma),
  hasher: createArgon2Hasher(),
  mailer: createMailer(config.mail.transport, config.mail.from),
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "kapanıyor");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "0.0.0.0", port: config.port });
