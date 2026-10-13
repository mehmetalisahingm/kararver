// KV-186 (#186) operasyon yoklaması: veritabanı gecikmesi/sürümü, worker'ın son canlılık izi ve pg-boss kuyrukları.
// Worker izi, worker'ın aldığı son işin başlama/bitiş zamanıdır (API iş almaz, yalnız kuyruğa yazar). Dakikalık cron
// işleri (ör. sanctions.expire) olduğu için sağlıklı worker en geç birkaç dakikada bir iz bırakır. Bağlantı adresi dönmez.
import type { PrismaClient } from "@kararver/db";

export type QueueRow = { name: string; waiting: number; active: number; failed24h: number; completed24h: number; oldestWaitingSeconds: number | null };

export type OpsProbe = {
  database(): Promise<{ latencyMs: number; version: string | null }>;
  /** Worker'ın son iz zamanı; hiç iş almadıysa null. pg-boss şeması yoksa hata fırlatır. */
  workerLastSeen(): Promise<Date | null>;
  queues(): Promise<QueueRow[]>;
};

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const TABLE = /^[a-z_][a-z0-9_]{0,62}.[a-z_][a-z0-9_]{0,62}$/;

export function createPrismaOpsProbe(prisma: PrismaClient, options: { schema?: string; contentJobsTable?: string } = {}): OpsProbe {
  const schema = options.schema ?? "pgboss";
  const contentJobsTable = options.contentJobsTable ?? "public.content_jobs";
  // Şema/tablo adları SQL'e tanımlayıcı olarak girer; yalnız sabit/yapılandırma değeri, kullanıcı girdisi değil.
  if (!SCHEMA.test(schema)) throw new Error(`geçersiz pg-boss şeması: ${schema}`);
  if (!TABLE.test(contentJobsTable)) throw new Error(`geçersiz tablo: ${contentJobsTable}`);
  const job = `"${schema}".job`;
  const queue = `"${schema}".queue`;

  return {
    async database() {
      const started = performance.now();
      const [row] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT current_setting('server_version') AS version`;
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      // "18.6 (Debian ...)" gibi derleme ayrıntısı atılır.
      return { latencyMs, version: row?.version.split(" ")[0] ?? null };
    },
    async workerLastSeen() {
      const [row] = await prisma.$queryRawUnsafe<Array<{ at: Date | null }>>(
        `SELECT max(COALESCE(completed_on, started_on)) AS at FROM ${job} WHERE started_on > now() - interval '1 day'`,
      );
      return row?.at ?? null;
    },
    async queues() {
      const rows = await prisma.$queryRawUnsafe<
        Array<{ name: string; waiting: number; active: number; failed24h: number; completed24h: number; oldest: number | null }>
      >(
        `SELECT q.name,
           count(j.id) FILTER (WHERE j.state IN ('created', 'retry') AND j.start_after <= now())::int AS waiting,
           count(j.id) FILTER (WHERE j.state = 'active')::int AS active,
           count(j.id) FILTER (WHERE j.state = 'failed' AND j.completed_on > now() - interval '24 hours')::int AS "failed24h",
           count(j.id) FILTER (WHERE j.state = 'completed' AND j.completed_on > now() - interval '24 hours')::int AS "completed24h",
           floor(EXTRACT(EPOCH FROM now() - min(j.start_after) FILTER (WHERE j.state IN ('created', 'retry') AND j.start_after <= now())))::float8 AS oldest
         FROM ${queue} q LEFT JOIN ${job} j ON j.name = q.name
         GROUP BY q.name ORDER BY q.name`,
      );
      const contentJobs = await contentJobsQueue(prisma, contentJobsTable);
      return [...rows, ...(contentJobs ? [contentJobs] : [])].map((r) => ({
        name: r.name,
        waiting: r.waiting,
        active: r.active,
        failed24h: r.failed24h,
        completed24h: r.completed24h,
        oldestWaitingSeconds: r.oldest === null ? null : Math.max(0, r.oldest),
      }));
    },
  };
}

/** Toplu içerik işleri (#181) pg-boss değil, kendi DB kuyruğunu kullanır; çalıştırıcı API sürecindedir. */
export const CONTENT_JOBS_QUEUE = "content.jobs";
/** Çalıştırıcının takılmış işi yeniden aldığı süre (content-jobs/runner.ts STALE_CLAIM_MS ile aynı). */
const CONTENT_JOBS_STALE_SECONDS = 300;

/**
 * Tablo yoksa (migration henüz uygulanmadı) null: kuyruk listede görünmez, diğer kuyrukları bozmaz.
 * Bekleme, işin son durum değişikliğinden (`updated_at`) ölçülür: tur bütçesiyle kuyruğa dönen büyük iş ilerlerken
 * oluşturulma zamanı yüzünden "takılmış" görünmez. Sahiplenmesi 5 dakikayı aşan PROCESSING iş de bekleyen sayılır.
 */
async function contentJobsQueue(prisma: PrismaClient, table: string) {
  const [exists] = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${table}) IS NOT NULL AS ok`;
  if (!exists?.ok) return null;
  const [row] = await prisma.$queryRawUnsafe<
    Array<{ waiting: number; active: number; failed24h: number; completed24h: number; oldest: number | null }>
  >(`
    SELECT
      count(*) FILTER (WHERE status = 'QUEUED')::int AS waiting,
      count(*) FILTER (WHERE status = 'PROCESSING')::int AS active,
      count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours')::int AS "failed24h",
      count(*) FILTER (WHERE status = 'DONE' AND finished_at > now() - interval '24 hours')::int AS "completed24h",
      floor(EXTRACT(EPOCH FROM now() - min(
        CASE
          WHEN status = 'QUEUED' THEN updated_at
          WHEN status = 'PROCESSING' AND claimed_at < now() - interval '${CONTENT_JOBS_STALE_SECONDS} seconds' THEN claimed_at
        END)))::float8 AS oldest
    FROM ${table}
    WHERE status IN ('QUEUED', 'PROCESSING') OR finished_at > now() - interval '24 hours'`);
  return { name: CONTENT_JOBS_QUEUE, ...row! };
}
