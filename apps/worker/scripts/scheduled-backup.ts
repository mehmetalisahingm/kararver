// KV-48 / #51 zamanlanmış yedek giriş noktası. Railway cron servisi: `node apps/worker/scripts/scheduled-backup.ts`.
// Gerekli ortam değişkenleri (değerler yalnız Railway servis değişkenlerinde; repoda yok):
//   DATABASE_URL                yedeklenecek veritabanı (Railway iç adresi; public proxy gerekmez)
//   BACKUP_PUBLIC_KEY           RSA (≥ 3072 bit) açık anahtar, PEM. Özel anahtar ekip dışında, çevrimdışı.
//   BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
//   BACKUP_S3_FORCE_PATH_STYLE  "true" ise path-style (varsayılan false)
//   BACKUP_DESTINATION          ops_backup_runs etiketi (varsayılan "r2")
//   BACKUP_PREFIX               bucket öneki (varsayılan "db/<APP_ENV>")
//   PG_BIN                      pg_dump klasörü (sunucu sürümüyle aynı major; staging PG 18)
// Çıkış kodu 0 = yedek yüklendi ve kaydedildi; 1 = herhangi bir adım başarısız (kayıt yazılmadı).
import { runScheduledBackup } from "../src/jobs/backup/scheduled.ts";
import { createS3BackupUpload } from "../src/jobs/backup/s3-upload.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} tanımlı değil`);
  return value;
}

const log = (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) =>
  console[level === "info" ? "log" : level](JSON.stringify({ level, job: "backup.scheduled", message, ...fields }));

try {
  const env = process.env.APP_ENV ?? "local";
  const result = await runScheduledBackup({
    databaseUrl: required("DATABASE_URL"),
    publicKeyPem: required("BACKUP_PUBLIC_KEY").replaceAll("\\n", "\n"),
    upload: createS3BackupUpload({
      endpoint: required("BACKUP_S3_ENDPOINT"),
      region: process.env.BACKUP_S3_REGION ?? "auto",
      bucket: required("BACKUP_S3_BUCKET"),
      accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === "true",
    }),
    destination: process.env.BACKUP_DESTINATION ?? "r2",
    prefix: process.env.BACKUP_PREFIX ?? `db/${env}`,
    now: () => new Date(),
    log,
  });
  log("info", "çıkış", { key: result.dumpKey });
} catch (err) {
  // Hata mesajında bağlantı adresi yok (pg-tools redact, s3-upload yalnız hata adı/kodu).
  log("error", "zamanlanmış yedek başarısız; ortam değişkenlerini, araç sürümünü ve bucket erişimini denetle", { error: "backup_failed" });
  process.exitCode = 1;
}
