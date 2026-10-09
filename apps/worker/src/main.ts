// Worker giriş noktası: pnpm --filter @kararver/worker dev (TECH_DECISIONS §3.5).
// media.process (Mert, KV-16), trends.refresh (Faruk, KV-28), snapshots.daily (Faruk, KV-29), sanctions.expire (Utku, KV-33)
// ve olay outbox'ı events.dispatch / events.cleanup, bildirim saklaması notifications.cleanup ve anket süre dolumu olayı polls.expire (Utku, KV-21). Diğer job'lar kendi klasörlerinde eklenir ve burada kaydedilir.
import path from "node:path";
import { createPrismaClient } from "@kararver/db";
import { PgBoss } from "pg-boss";
import { loadWorkerConfig } from "./config.ts";
import { createWorkerSettings } from "./settings.ts";
import { cleanupEvents } from "./jobs/events/cleanup.ts";
import { productionConsumers } from "./jobs/events/registry.ts";
import { cleanupNotifications, NOTIFICATIONS_CLEANUP_CRON, NOTIFICATIONS_CLEANUP_QUEUE } from "./jobs/notifications/cleanup.ts";
import { runDispatchLoop } from "./jobs/events/dispatch.ts";
import {
  DISPATCH_LOOP_MS,
  EVENTS_CLEANUP_CRON,
  EVENTS_CLEANUP_QUEUE,
  EVENTS_DISPATCH_CRON,
  EVENTS_DISPATCH_QUEUE,
  EVENTS_DISPATCH_QUEUE_OPTIONS,
} from "./jobs/events/job.ts";
import { MEDIA_PROCESS_QUEUE, MEDIA_QUEUE_OPTIONS, processMedia } from "./jobs/media/job.ts";
import { createSubprocessModerator } from "./jobs/media/moderator.ts";
import { thresholdsFromPercent } from "./jobs/media/policy.ts";
import { createS3WorkerStorage } from "./jobs/media/storage.ts";
import { createPrismaMediaJobStore } from "./jobs/media/store.ts";
import { activateScheduled, FEATURED_ACTIVATE_CRON, FEATURED_ACTIVATE_QUEUE } from "./jobs/featured/activate.ts";
import { expirePolls, POLLS_EXPIRE_CRON, POLLS_EXPIRE_QUEUE } from "./jobs/polls/expire.ts";
import { expireSanctions, SANCTIONS_EXPIRE_CRON, SANCTIONS_EXPIRE_QUEUE } from "./jobs/sanctions/job.ts";
import { runDailySnapshots, SNAPSHOT_TIME_ZONE, SNAPSHOTS_CRON, SNAPSHOTS_QUEUE } from "./jobs/snapshots/job.ts";
import { TRENDS_CRON, TRENDS_QUEUE } from "./jobs/trends/config.ts";
import { refreshTrends } from "./jobs/trends/job.ts";

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
// Sistem ayarları (KV-40): API ile aynı system_settings tablosu; kısa önbellek, DB okunamazsa varsayılan.
const settings = createWorkerSettings(prisma, { now: () => new Date(), onError: (error) => log("error", "ayarlar okunamadı, son bilinen/varsayılan değerler", { error: String(error) }) });

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
    maxBytes: () => settings.get<number>("media.maxBytes"),
    // Risk eşikleri her işte ayardan okunur (KV-38): panelden değişince deploy gerekmez, ≤ 5 sn'de worker'a ulaşır.
    thresholds: async () =>
      thresholdsFromPercent(await settings.get<number>("media.riskMediumPercent"), await settings.get<number>("media.riskHighPercent")),
    log: (msg, fields) => log("warn", msg, fields),
  });
  log("info", "media.process", { mediaId, result, ms: Date.now() - started, attempt: job!.retryCount });
});
// trends.refresh: singleton kuyruk (üst üste binmez), 5 dakikada bir. Job kendisi de idempotent (job.ts).
await boss.createQueue(TRENDS_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(TRENDS_QUEUE, TRENDS_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(TRENDS_QUEUE, { batchSize: 1 }, async () => {
  const started = Date.now();
  await refreshTrends({
    prisma,
    now: () => new Date(),
    log,
    moversThresholds: async () => ({
      minVotes: await settings.get<number>("trends.moversMinVotes"),
      minActiveAccounts: await settings.get<number>("trends.moversMinActiveAccounts"),
    }),
  });
  log("info", "trends.refresh bitti", { ms: Date.now() - started });
});
// snapshots.daily: her gün 00:05 İstanbul; son günleri upsert eder (tekrar çalışması güvenli).
await boss.createQueue(SNAPSHOTS_QUEUE, { policy: "singleton", retryLimit: 3, retryDelay: 300 });
await boss.schedule(SNAPSHOTS_QUEUE, SNAPSHOTS_CRON, null, { tz: SNAPSHOT_TIME_ZONE });
await boss.work(SNAPSHOTS_QUEUE, { batchSize: 1 }, async () => {
  const started = Date.now();
  await runDailySnapshots({ prisma, now: () => new Date(), log });
  log("info", "snapshots.daily bitti", { ms: Date.now() - started });
});
// sanctions.expire: her dakika; süresi dolan yaptırımlardan sonra users.status senkronu. Job idempotent (kilit + yeniden hesap).
await boss.createQueue(SANCTIONS_EXPIRE_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(SANCTIONS_EXPIRE_QUEUE, SANCTIONS_EXPIRE_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(SANCTIONS_EXPIRE_QUEUE, { batchSize: 1 }, async () => {
  const started = Date.now();
  const result = await expireSanctions({ prisma, now: () => new Date(), log });
  if (result.candidates > 0) log("info", "sanctions.expire bitti", { ...result, ms: Date.now() - started });
});
// events.dispatch: outbox dağıtıcısı; stately kuyruk, dakikalık cron, her job 90 sn boşaltma döngüsü (jobs/events/job.ts).
const stopEvents = new AbortController();
await boss.createQueue(EVENTS_DISPATCH_QUEUE, EVENTS_DISPATCH_QUEUE_OPTIONS);
await boss.schedule(EVENTS_DISPATCH_QUEUE, EVENTS_DISPATCH_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(EVENTS_DISPATCH_QUEUE, { batchSize: 1 }, async () => {
  const result = await runDispatchLoop({ prisma, consumers: productionConsumers, now: () => new Date(), log, signal: stopEvents.signal, maxMs: DISPATCH_LOOP_MS });
  if (result.dispatched > 0) log("info", "events.dispatch turu bitti", result);
});
// events.cleanup: her gün 03:30 İstanbul; işlenmiş olaylar 30 gün sonra silinir, diğerleri asla (jobs/events/cleanup.ts).
await boss.createQueue(EVENTS_CLEANUP_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(EVENTS_CLEANUP_QUEUE, EVENTS_CLEANUP_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(EVENTS_CLEANUP_QUEUE, { batchSize: 1 }, async () => {
  await cleanupEvents({ prisma, now: () => new Date(), log });
});
// polls.expire: her dakika; süresi dolan anketler için poll.closed (EXPIRED) olayı (KV-21, jobs/polls/expire.ts). Job idempotent.
await boss.createQueue(POLLS_EXPIRE_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(POLLS_EXPIRE_QUEUE, POLLS_EXPIRE_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(POLLS_EXPIRE_QUEUE, { batchSize: 1 }, async () => {
  const result = await expirePolls({ prisma, now: () => new Date(), log });
  if (result.candidates > 0) log("info", "polls.expire bitti", result);
});
// featured.activate: scheduled placements and announcements at their start time.
// One-time activated_at claim and outbox are written atomically.
await boss.createQueue(FEATURED_ACTIVATE_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(FEATURED_ACTIVATE_QUEUE, FEATURED_ACTIVATE_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(FEATURED_ACTIVATE_QUEUE, { batchSize: 1 }, async () => {
  const result = await activateScheduled({ prisma, now: () => new Date(), log });
  if (result.featuredCandidates || result.announcementCandidates || result.failed)
    log(result.failed ? "warn" : "info", "featured.activate", result);
});
// notifications.cleanup: her gün 04:00 İstanbul; okunmuş bildirim 90 gün, silinmiş hesabın bildirimleri 30 gün (jobs/notifications/cleanup.ts).
await boss.createQueue(NOTIFICATIONS_CLEANUP_QUEUE, { policy: "singleton", retryLimit: 0 });
await boss.schedule(NOTIFICATIONS_CLEANUP_QUEUE, NOTIFICATIONS_CLEANUP_CRON, null, { tz: "Europe/Istanbul" });
await boss.work(NOTIFICATIONS_CLEANUP_QUEUE, { batchSize: 1 }, async () => {
  await cleanupNotifications({ prisma, now: () => new Date(), log });
});
log("info", "worker hazır", {
  queues: [MEDIA_PROCESS_QUEUE, TRENDS_QUEUE, SNAPSHOTS_QUEUE, SANCTIONS_EXPIRE_QUEUE, EVENTS_DISPATCH_QUEUE, EVENTS_CLEANUP_QUEUE, NOTIFICATIONS_CLEANUP_QUEUE, POLLS_EXPIRE_QUEUE, FEATURED_ACTIVATE_QUEUE],
  concurrency: config.mediaConcurrency,
});

async function shutdown(signal: string): Promise<void> {
  log("info", "kapanıyor", { signal });
  stopEvents.abort(); // dağıtım döngüsü turunu bitirip çıkar; graceful stop onu bekler
  await boss.stop({ graceful: true });
  await moderator.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
