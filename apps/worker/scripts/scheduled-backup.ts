// KV-48 / #51 zamanlanmış yedek giriş noktası. Railway cron servisi: `node apps/worker/scripts/scheduled-backup.ts`.
// Gerekli ortam değişkenleri (değerler yalnız Railway servis değişkenlerinde; repoda yok):
//   DATABASE_URL                yedeklenecek veritabanı (Railway iç adresi; public proxy gerekmez)
//   BACKUP_PUBLIC_KEY           RSA (≥ 3072 bit) açık anahtar, PEM. Özel anahtar ekip dışında, çevrimdışı.
//   BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
//   ya da BACKUP_OUTPUT_DIR     bucket yerine klasör (#186: GitHub Actions artifact'ı; dosya üzerine yazılmaz)
//   BACKUP_S3_FORCE_PATH_STYLE  "true" ise path-style (varsayılan false)
//   BACKUP_DESTINATION          ops_backup_runs etiketi (varsayılan "r2")
//   BACKUP_PREFIX               bucket öneki (varsayılan "db/<APP_ENV>")
//   PG_BIN                      pg_dump klasörü (sunucu sürümüyle aynı major; staging PG 18)
//   BACKUP_FROM_FILE            yeni döküm almak yerine, ÖNCE restore ile doğrulanmış mevcut dökümü (<ad>.dump + yanında
//                               <ad>.dump.manifest.json) şifrele (#186: saklanan dosya = doğrulanan dosya). sha256 manifestle
//                               eşleşmezse durur. Düz döküm şifrelemeden sonra silinir.
//   BACKUP_ENCRYPT_MANIFEST     "true": manifest de şifrelenir (<ad>.manifest.json.enc); düz manifest yalnız yerelde kalır
//   BACKUP_SKIP_RECORD          "true": ops_backup_runs kaydı YAZILMAZ; dosya gerçekten yayımlandıktan sonra
//                               scripts/record-backup-run.ts yazar (artifact yüklenmeden "başarılı yedek" görünmesin).
// Çıkış kodu 0 = yedek yüklendi ve kaydedildi; 1 = herhangi bir adım başarısız (kayıt yazılmadı).
import { readFile } from "node:fs/promises";
import { sha256File, type Manifest } from "@kararver/db/ops/backup";
import { runScheduledBackup } from "../src/jobs/backup/scheduled.ts";
import { createDirectoryBackupUpload } from "../src/jobs/backup/directory-upload.ts";
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
    upload: process.env.BACKUP_OUTPUT_DIR
      ? createDirectoryBackupUpload(process.env.BACKUP_OUTPUT_DIR)
      : createS3BackupUpload({
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
    ...(process.env.BACKUP_FROM_FILE
      ? {
          backup: async () => {
            const file = process.env.BACKUP_FROM_FILE!;
            const manifest = JSON.parse(await readFile(`${file}.manifest.json`, "utf8")) as Manifest;
            if ((await sha256File(file)) !== manifest.sha256) throw new Error("doğrulanan döküm manifestle eşleşmiyor (sha256)");
            return { file, manifest };
          },
        }
      : {}),
    ...(process.env.BACKUP_SKIP_RECORD === "true" ? { record: async () => {} } : {}),
    encryptManifest: process.env.BACKUP_ENCRYPT_MANIFEST === "true",
  });
  log("info", "çıkış", { key: result.dumpKey });
} catch (err) {
  // Hata mesajında bağlantı adresi yok (pg-tools redact, s3-upload yalnız hata adı/kodu).
  log("error", "zamanlanmış yedek başarısız; ortam değişkenlerini, araç sürümünü ve bucket erişimini denetle", { error: "backup_failed" });
  process.exitCode = 1;
}
