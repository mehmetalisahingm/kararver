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

export function createPrismaOpsProbe(prisma: PrismaClient, options: { schema?: string } = {}): OpsProbe {
  const schema = options.schema ?? "pgboss";
  // Şema adı SQL'e tanımlayıcı olarak girer; yalnız sabit/yapılandırma değeri, kullanıcı girdisi değil.
  if (!SCHEMA.test(schema)) throw new Error(`geçersiz pg-boss şeması: ${schema}`);
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
      return rows.map((r) => ({
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
