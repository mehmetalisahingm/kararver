// media.process kuyruğu (TECH_DECISIONS §3.5). İşi apps/worker/src/jobs/media tüketir.
import { PgBoss } from "pg-boss";

/** Kuyruk adı ve seçenekleri worker'daki tanımla aynı olmalı. */
export const MEDIA_PROCESS_QUEUE = "media.process";

export interface MediaQueue {
  /** Aynı görsel için en fazla bir bekleyen ve bir çalışan iş olur; tekrar çağrı zararsızdır. */
  enqueueProcessing(mediaId: string): Promise<void>;
}

export async function startPgBossMediaQueue(
  connectionString: string,
  onError: (err: Error) => void,
  /** pg-boss tablolarının şeması; testler ayrı şema kullanır. */
  schema = "pgboss",
): Promise<MediaQueue & { stop(): Promise<void> }> {
  const boss = new PgBoss({ connectionString, schema });
  // Dinlenmeyen 'error' olayı süreci düşürür (EventEmitter).
  boss.on("error", onError);
  await boss.start();
  await boss.createQueue(MEDIA_PROCESS_QUEUE, { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true });
  return {
    async enqueueProcessing(mediaId) {
      await boss.send(MEDIA_PROCESS_QUEUE, { mediaId }, { singletonKey: mediaId });
    },
    stop: () => boss.stop(),
  };
}
