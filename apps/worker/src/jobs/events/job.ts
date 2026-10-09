// Olay outbox'ı job'ları — KV-21 PR-2 (#23). Kayıt: apps/worker/src/main.ts.
//
// events.dispatch: stately kuyruk (en fazla 1 aktif + 1 bekleyen), dakikalık cron. Her job DISPATCH_LOOP_MS boyunca
// dağıt → işle döngüsünü çalıştırır (iş yokken 1 sn bekler). Döngü dakikadan uzun olduğu için sonraki cron job'u
// beklerken hazır durur ve aktif job bitince başlar: dağıtım kesintisizdir, gecikme ≈ 1 sn. pg-boss tek aktif
// dağıtıcıyı ve çökünce yeniden başlatmayı sağlar; SKIP LOCKED birden fazla dağıtıcıyı yine de güvenli kılar.
// events.cleanup: günlük saklama (cleanup.ts).

export const EVENTS_DISPATCH_QUEUE = "events.dispatch";
export const EVENTS_DISPATCH_CRON = "* * * * *";
export const DISPATCH_LOOP_MS = 90_000;
/** retryLimit 0: döngü kendi hatalarını yutar; bir sonraki cron job'u devam eder. expireInSeconds döngüden uzun. */
export const EVENTS_DISPATCH_QUEUE_OPTIONS = { policy: "stately", retryLimit: 0, expireInSeconds: 150 } as const;

export const EVENTS_CLEANUP_QUEUE = "events.cleanup";
export const EVENTS_CLEANUP_CRON = "30 3 * * *";
