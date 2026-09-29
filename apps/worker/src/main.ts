// Worker giriş noktası: pnpm --filter @kararver/worker dev (TECH_DECISIONS §3.5).
// Şimdilik sadece media.process (Mert). Diğer job'lar (trends, snapshots, notifications) kendi
// klasörlerinde eklenir ve burada kaydedilir.
import path from "node:path";
import { defaultSettings } from "@kararver/contracts";
import { createPrismaClient } from "@kararver/db";
import { PgBoss } from "pg-boss";
import { loadWorkerConfig } from "./config.ts";
import { MEDIA_PROCESS_QUEUE, MEDIA_QUEUE_OPTIONS, processMedia } from "./jobs/media/job.ts";
import { createSubprocessModerator } from "./jobs/media/moderator.ts";
import { createS3WorkerStorage } from "./jobs/media/storage.ts";
import { createPrismaMediaJobStore } from "./jobs/media/store.ts";

if (!process.env.APP_ENV) {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
  } catch {
    // .env yok: ortam değişkenleri kullanılır
  }
}

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }));
}

const config = loadWorkerConfig();
if (!config.jobsEnabled) {
  log("warn", "JOBS_ENABLED=false: worker job almıyor");
  process.exit(0);
}

const prisma = createPrismaClient(config.databaseUrl);
const boss = new PgBoss(config.databaseUrl);
boss.on("error", (err) => log("error", "pg-boss hatası", { error: err.message }));
const moderator = createSubprocessModerator({
  command: config.moderation.python,
  args: [config.moderation.script],
  timeoutMs: 8_000,
  startupTimeoutMs: 60_000,
  onStderr: (line) => log("warn", "moderasyon stderr", { line: line.slice(0, 500) }),
});
const maxBytes = defaultSettings().values["media.maxBytes"] as number;

await boss.start();
await boss.createQueue(MEDIA_PROCESS_QUEUE, MEDIA_QUEUE_OPTIONS);
await boss.work<{ mediaId: string }>(MEDIA_PROCESS_QUEUE, { batchSize: 1, localConcurrency: config.mediaConcurrency }, async ([job]) => {
  const mediaId = job!.data.mediaId;
  const started = Date.now();
  const result = await processMedia(mediaId, {
    store: createPrismaMediaJobStore(prisma),
    storage: createS3WorkerStorage(config.storage),
    moderator,
    now: () => new Date(),
    // Sistem ayarları servisi gelene kadar (KV-40) sözleşmedeki varsayılan.
    maxBytes: async () => maxBytes,
    log: (msg, fields) => log("warn", msg, fields),
  });
  log("info", "media.process", { mediaId, result, ms: Date.now() - started, attempt: job!.retryCount });
});
log("info", "worker hazır", { queues: [MEDIA_PROCESS_QUEUE], concurrency: config.mediaConcurrency });

async function shutdown(signal: string): Promise<void> {
  log("info", "kapanıyor", { signal });
  await boss.stop({ graceful: true });
  await moderator.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
