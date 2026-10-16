// #51/#186: existing pg-boss worker; no additional Railway service or public DB proxy.
import { createPublicKey } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { createS3BackupUpload } from "./s3-upload.ts";
import { runScheduledBackup, type ScheduledBackupDeps } from "./scheduled.ts";

export const BACKUP_QUEUE = "backup.scheduled";
export const BACKUP_CRON = "30 0 * * *"; // UTC; TSİ 03:30. No run until explicitly enabled.

export function loadBackupRunner(env: NodeJS.ProcessEnv = process.env): ScheduledBackupDeps | null {
  if (env.BACKUP_ENABLED === undefined || env.BACKUP_ENABLED === "false") return null;
  if (env.BACKUP_ENABLED !== "true") throw new Error("BACKUP_ENABLED true veya false olmalı");
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} tanımlı değil`);
    return value;
  };
  const environment = required("APP_ENV");
  if (!["staging", "production", "local", "test"].includes(environment)) throw new Error("APP_ENV geçersiz");
  const publicKeyPem = required("BACKUP_PUBLIC_KEY").replaceAll("\\n", "\n");
  try {
    if (!/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(publicKeyPem.trimStart())) throw new Error();
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw new Error();
  } catch { throw new Error("BACKUP_PUBLIC_KEY en az 3072 bit RSA açık anahtarı olmalı"); }
  const endpoint = required("BACKUP_S3_ENDPOINT");
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || !["https:", ...(["test", "local"].includes(environment) ? ["http:"] : [])].includes(url.protocol)) throw new Error();
  } catch { throw new Error("BACKUP_S3_ENDPOINT geçersiz veya güvenli değil"); }
  const bucket = required("BACKUP_S3_BUCKET");
  if ([env.S3_BUCKET_PRIVATE, env.S3_BUCKET_PUBLIC].includes(bucket)) throw new Error("BACKUP_S3_BUCKET uygulama bucket'ından ayrı olmalı");
  if (env.BACKUP_S3_FORCE_PATH_STYLE && !["true", "false"].includes(env.BACKUP_S3_FORCE_PATH_STYLE)) throw new Error("BACKUP_S3_FORCE_PATH_STYLE geçersiz");
  return {
    databaseUrl: required("DATABASE_URL"), publicKeyPem,
    destination: env.BACKUP_DESTINATION ?? "s3",
    prefix: env.BACKUP_PREFIX ?? `db/${environment}`,
    upload: createS3BackupUpload({ endpoint, bucket, region: env.BACKUP_S3_REGION ?? "auto",
      accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY"),
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === "true" }),
    now: () => new Date(), log: () => {},
  };
}

type Scheduler = Pick<PgBoss, "unschedule" | "createQueue" | "schedule" | "work">;

export async function registerBackupRunner(boss: Scheduler, deps: ScheduledBackupDeps | null, log: ScheduledBackupDeps["log"], run = runScheduledBackup): Promise<boolean> {
  if (!deps) {
    // Turning the feature off also removes a previously registered recurring schedule.
    await boss.unschedule(BACKUP_QUEUE);
    return false;
  }
  await boss.createQueue(BACKUP_QUEUE, { policy: "stately", retryLimit: 2, retryDelay: 300, expireInSeconds: 8 * 60 * 60 });
  await boss.schedule(BACKUP_QUEUE, BACKUP_CRON, null, { tz: "UTC" });
  await boss.work(BACKUP_QUEUE, { batchSize: 1 }, async () => {
    try { await run({ ...deps, log }); }
    catch {
      // Prisma/transport exceptions can include connection details. pg-boss persists thrown errors.
      // Keep its retry/failure evidence without persisting arbitrary upstream messages or credentials.
      log("error", "zamanlanmış yedek başarısız", { job: BACKUP_QUEUE });
      throw new Error("backup.scheduled başarısız; araç sürümü, yedek anahtarı ve bucket erişimini denetle");
    }
  });
  return true;
}
