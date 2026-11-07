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
  /** Son başarılı yedek (KV-48 `db:backup` kaydı); hiç yoksa null. Tablo yoksa hata fırlatır. */
  lastBackup(): Promise<Date | null>;
  /** Bütün süreçlerin ortak tabloları: giriş kilitleri (KV-19 sayaçları) ve 24 saatlik kritik yönetici işlemleri (audit). */
  securitySignals(limits: LoginLimits): Promise<SecuritySignals>;
  /** #185 kritik güvenlik alarmları: açıklar ve son 24 saatte kapananlar, en yeni önce (en çok 50). Tablo yoksa hata fırlatır. */
  securityAlerts(): Promise<SecurityAlertRow[]>;
};

export type SecurityAlertRow = {
  id: string;
  rule: string;
  severity: string;
  status: string;
  actor: { id: string; username: string; displayName: string } | null;
  peakCount: number;
  openedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
};

export type LoginLimits = { email: number; ip: number };
export type SecuritySignals = {
  lockedLogins: { emails: number; ips: number };
  adminActions24h: Array<{ action: string; operation: string; count: number }>;
};

/**
 * Hesap, yetki ve veri üzerinde etkisi büyük yönetici işlemleri (KV-04). Kısa sürede olağandışı artış (ör. toplu yaptırım,
 * art arda rol değişikliği) ele geçirilmiş bir yönetici hesabının ilk izidir; panel sayıları gösterir, eşik koymaz.
 */
export const CRITICAL_ADMIN_ACTIONS = [
  "user.role.assign",
  "user.sanction",
  "user.sanction.lift",
  "user.sessions.manage",
  "user.password.reset",
  "user.content.bulk",
  // #181 / #184 (#228, #222): geri alınamaz anonimleştirme, yasal saklama ve topluluk sahibi ataması.
  "user.anonymize",
  "user.legalHold.manage",
  "community.owner.assign",
  // #232: destek yolu, yöneticinin başkasının e-posta değişimini başlatması (hesap ele geçirmede ilk bakılacak işlem).
  "user.emailChange.manage",
  "privacy.export.manage",
  "settings.update",
  "emergency.update",
  "points.adjust",
] as const;

/** Hesap güvenliği olayları (#206): MFA başarısız denemesi ve kilitlenmesi. Kullanıcının kendi işlemidir, brute force izidir. */
export const SECURITY_EVENT_OPERATIONS = { action: "account.mfa", operations: ["deny", "lock"] } as const;

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const TABLE = /^[a-z_][a-z0-9_]{0,62}.[a-z_][a-z0-9_]{0,62}$/;

export function createPrismaOpsProbe(
  prisma: PrismaClient,
  options: { schema?: string; contentJobsTable?: string; erasuresTable?: string; batchesTable?: string } = {},
): OpsProbe {
  const schema = options.schema ?? "pgboss";
  const contentJobsTable = options.contentJobsTable ?? "public.content_jobs";
  // Şema/tablo adları SQL'e tanımlayıcı olarak girer; yalnız sabit/yapılandırma değeri, kullanıcı girdisi değil.
  if (!SCHEMA.test(schema)) throw new Error(`geçersiz pg-boss şeması: ${schema}`);
  const erasuresTable = options.erasuresTable ?? "public.account_erasures";
  if (!TABLE.test(contentJobsTable)) throw new Error(`geçersiz tablo: ${contentJobsTable}`);
  if (!TABLE.test(erasuresTable)) throw new Error(`geçersiz tablo: ${erasuresTable}`);
  const batchesTable = options.batchesTable ?? "public.moderation_batches";
  if (!TABLE.test(batchesTable)) throw new Error(`geçersiz tablo: ${batchesTable}`);
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
    async securitySignals(limits) {
      // Kilit, KV-19 giriş korumasıyla aynı kuraldır: süresi geçmemiş penceredeki başarısız deneme sayısı ≥ sınır.
      // Anahtar pepper'lı özettir; ham e-posta/IP yoktur, yalnız sayılır.
      const [locked] = await prisma.$queryRaw<Array<{ emails: number; ips: number }>>`
        SELECT
          count(*) FILTER (WHERE key LIKE 'login.email:%' AND count >= ${limits.email})::int AS emails,
          count(*) FILTER (WHERE key LIKE 'login.ip:%' AND count >= ${limits.ip})::int AS ips
        FROM rate_limit_counters WHERE expires_at > now()`;
      const actions = await prisma.$queryRaw<Array<{ action: string; operation: string; count: number }>>`
        SELECT action, operation, count(*)::int AS count FROM audit_logs
        WHERE created_at > now() - interval '24 hours'
          AND (action = ANY(${[...CRITICAL_ADMIN_ACTIONS]}::text[])
            OR (action = ${SECURITY_EVENT_OPERATIONS.action} AND operation = ANY(${[...SECURITY_EVENT_OPERATIONS.operations]}::text[])))
        GROUP BY action, operation ORDER BY count DESC, action, operation`;
      return { lockedLogins: locked ?? { emails: 0, ips: 0 }, adminActions24h: actions };
    },
    async securityAlerts() {
      // scope_key aktör kapsamlı kuralda kullanıcı UUID'si, genel kuralda '*'. Silinmiş hesap da gösterilir (audit gibi).
      const rows = await prisma.$queryRaw<Array<Omit<SecurityAlertRow, "actor"> & { actorId: string | null; username: string | null; displayName: string | null }>>`
        SELECT a.id::text AS id, a.rule, a.severity, a.status, a.peak_count AS "peakCount", a.opened_at AS "openedAt",
               a.last_seen_at AS "lastSeenAt", a.resolved_at AS "resolvedAt",
               u.id::text AS "actorId", u.username, u.display_name AS "displayName"
          FROM security_alerts a
          LEFT JOIN users u ON a.scope_key <> '*' AND u.id::text = a.scope_key
         WHERE a.status = 'OPEN' OR a.resolved_at > now() - interval '24 hours'
         ORDER BY a.opened_at DESC, a.id DESC
         LIMIT 50`;
      return rows.map(({ actorId, username, displayName, ...r }) => ({
        ...r,
        actor: actorId && username && displayName ? { id: actorId, username, displayName } : null,
      }));
    },
    async lastBackup() {
      const [row] = await prisma.$queryRaw<Array<{ at: Date | null }>>`SELECT max(finished_at) AS at FROM ops_backup_runs`;
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
      const extra = [await contentJobsQueue(prisma, contentJobsTable), await erasureStorageQueue(prisma, erasuresTable), await moderationBatchesQueue(prisma, batchesTable)].filter((q) => q !== null);
      return [...rows, ...extra].map((r) => ({
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

/** Toplu moderasyon partileri (#183): ikinci onaydan sonra başlatan adına, onaylayanın isteği içinde işlenir; sunucu yarıda kapanırsa parti bitmemiş kalır. */
export const MODERATION_BATCHES_QUEUE = "moderation.batches";
/** Bitmemiş partinin "süren" sayıldığı süre; aşan parti takılmış (bekleyen) sayılır ve kuyruğu `degraded` yapar. */
const MODERATION_BATCH_STUCK_SECONDS = 300;

/**
 * Tablo yoksa null. Çalışan: son 5 dakikada açılmış bitmemiş parti; bekleyen: 5 dakikadan eski bitmemiş parti (yarıda kalmış, kalan
 * kayıtlar uygulanmadı; oldest = yaşı); tamamlanan: son 24 saatte biten parti. Başarısız sayısı yoktur (kısmi başarısızlık parti sonucudur).
 */
async function moderationBatchesQueue(prisma: PrismaClient, table: string) {
  const [exists] = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${table}) IS NOT NULL AS ok`;
  if (!exists?.ok) return null;
  const [row] = await prisma.$queryRawUnsafe<
    Array<{ waiting: number; active: number; failed24h: number; completed24h: number; oldest: number | null }>
  >(`
    SELECT
      count(*) FILTER (WHERE finished_at IS NULL AND created_at < now() - interval '${MODERATION_BATCH_STUCK_SECONDS} seconds')::int AS waiting,
      count(*) FILTER (WHERE finished_at IS NULL AND created_at >= now() - interval '${MODERATION_BATCH_STUCK_SECONDS} seconds')::int AS active,
      0::int AS "failed24h",
      count(*) FILTER (WHERE finished_at > now() - interval '24 hours')::int AS "completed24h",
      floor(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE finished_at IS NULL AND created_at < now() - interval '${MODERATION_BATCH_STUCK_SECONDS} seconds')))::float8 AS oldest
    FROM ${table}
    WHERE finished_at IS NULL OR finished_at > now() - interval '24 hours'`);
  return { name: MODERATION_BATCHES_QUEUE, ...row! };
}

/** Anonimleştirilen hesapların depo temizliği (#228): pg-boss'taki `account-erasure.cleanup` cron'u turları, bu satır ise işi gösterir. */
export const ERASURE_STORAGE_QUEUE = "account.erasure.storage";

/**
 * Tablo yoksa null. Bekleyen: temizlenmemiş ve deneme zamanı gelmiş kayıt; çalışan: deneme zamanı ileride (geri çekilmede)
 * olan kayıt; başarısız: en az bir kez başarısız olmuş ve hâlâ temizlenmemiş kayıt (kişisel veri dosyası depoda duruyor).
 * Worker dakikada bir çalışır; 5 dakikadan eski bekleme ya da başarısız kayıt kuyruğu `degraded` yapar (KVKK).
 */
async function erasureStorageQueue(prisma: PrismaClient, table: string) {
  const [exists] = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${table}) IS NOT NULL AS ok`;
  if (!exists?.ok) return null;
  const [row] = await prisma.$queryRawUnsafe<
    Array<{ waiting: number; active: number; failed24h: number; completed24h: number; oldest: number | null }>
  >(`
    SELECT
      count(*) FILTER (WHERE storage_cleaned_at IS NULL AND (storage_next_attempt_at IS NULL OR storage_next_attempt_at <= now()))::int AS waiting,
      count(*) FILTER (WHERE storage_cleaned_at IS NULL AND storage_next_attempt_at > now())::int AS active,
      count(*) FILTER (WHERE storage_cleaned_at IS NULL AND storage_cleanup_attempts > 0)::int AS "failed24h",
      count(*) FILTER (WHERE storage_cleaned_at > now() - interval '24 hours')::int AS "completed24h",
      floor(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE storage_cleaned_at IS NULL)))::float8 AS oldest
    FROM ${table}
    WHERE storage_cleaned_at IS NULL OR storage_cleaned_at > now() - interval '24 hours'`);
  return { name: ERASURE_STORAGE_QUEUE, ...row! };
}
