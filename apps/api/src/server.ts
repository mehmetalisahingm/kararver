import { createPrismaDecisionStore } from "./modules/decisions/prisma-store.ts";
// API giriş noktası: pnpm --filter @kararver/api dev
import path from "node:path";
import { createPrismaClient } from "@kararver/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMailer } from "./mail/mailer.ts";
import { createPrismaAdminUserStore } from "./modules/admin-users/prisma-store.ts";
import { createArgon2Hasher } from "./modules/auth/crypto.ts";
import { createPrismaAuthStore } from "./modules/auth/prisma-store.ts";
import { createPrismaCommunityStore } from "./modules/communities/prisma-store.ts";
import { createPrismaCommunityRequestStore } from "./modules/communities/request-routes.ts";
import { createPrismaMediaStore } from "./modules/media/prisma-store.ts";
import { startPgBossMediaQueue } from "./modules/media/queue.ts";
import { createS3MediaStorage } from "./modules/media/storage.ts";
import { createPrismaCategoryAdminStore } from "./modules/categories/prisma-store.ts";
import { createPrismaFeedStore } from "./modules/feed/prisma-store.ts";
import { createPrismaFeaturedAdminStore } from "./modules/featured/prisma-store.ts";
import { createPrismaCommentStore } from "./modules/comments/prisma-store.ts";
import { createPrismaOnboardingStore } from "./modules/onboarding/prisma-store.ts";
import { createPrismaPointAdminStore } from "./modules/points/admin-store.ts";
import { createPrismaPollStore } from "./modules/polls/prisma-store.ts";
import { createPrismaProfileStore } from "./modules/profiles/prisma-store.ts";
import { createPrismaRbacStore } from "./modules/rbac/prisma-store.ts";
import { createPrismaModerationStore } from "./modules/moderation/prisma-store.ts";
import { createPrismaNotificationStore } from "./modules/notifications/prisma-store.ts";
import { createPrismaReportStore } from "./modules/reports/prisma-store.ts";
import { createPrismaSearchStore } from "./modules/search/prisma-store.ts";
import { createSettingsService } from "./modules/settings/service.ts";
import { createPrismaSettingsStore } from "./modules/settings/prisma-store.ts";
import { createPrismaShareStore } from "./modules/shares/prisma-store.ts";
import { createPrismaTrendStore } from "./modules/trends/prisma-store.ts";
import { createPrismaRevisionStore } from "./modules/revisions/prisma-store.ts";
import { createPrismaVoteStore } from "./modules/votes/prisma-store.ts";
import { createPrismaAuditStore } from "./modules/audit/prisma-store.ts";
import { createPrismaRateLimitStore } from "./modules/rate-limit/prisma-store.ts";

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
const settingsService = createSettingsService(createPrismaSettingsStore(prisma), {
  now: () => new Date(),
  onError: (error) => console.error("ayarlar okunamadı, son bilinen/varsayılan değerler kullanılıyor", error),
});
const app = buildApp({
  config,
  settingsService,
  authStore: createPrismaAuthStore(prisma),
  rbacStore: createPrismaRbacStore(prisma),
  pollStore: createPrismaPollStore(prisma),
  profileStore: createPrismaProfileStore(prisma),
  decisionStore: createPrismaDecisionStore(prisma),
  shareStore: createPrismaShareStore(prisma),
  pointAdminStore: createPrismaPointAdminStore(prisma),
  searchStore: createPrismaSearchStore(prisma),
  revisionStore: createPrismaRevisionStore(prisma),
  categoryAdminStore: createPrismaCategoryAdminStore(prisma),
  featuredAdminStore: createPrismaFeaturedAdminStore(prisma),
  feedStore: createPrismaFeedStore(prisma),
  trendStore: createPrismaTrendStore(prisma),
  voteStore: createPrismaVoteStore(prisma),
  auditStore: createPrismaAuditStore(prisma),
  rateLimitStore: config.rateLimitEnabled ? createPrismaRateLimitStore(prisma) : undefined,
  communityStore: createPrismaCommunityStore(prisma),
  communityRequestStore: createPrismaCommunityRequestStore(prisma),
  onboardingStore: createPrismaOnboardingStore(prisma),
  reportStore: createPrismaReportStore(prisma),
  moderationStore: createPrismaModerationStore(prisma),
  notificationStore: createPrismaNotificationStore(prisma),
  adminUserStore: createPrismaAdminUserStore(prisma),
  commentStore: createPrismaCommentStore(prisma),
  hasher: createArgon2Hasher(),
  mailer: createMailer(config.mail),
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