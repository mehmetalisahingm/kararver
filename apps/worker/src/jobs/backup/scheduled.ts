// KV-48 / #51 zamanlanmış veritabanı yedeği. Railway cron servisi günde bir çalıştırır (scripts/scheduled-backup.ts):
//   1) db:backup (tutarlı snapshot + manifest, KV-48),
//   2) dökümü zarf şifrelemesiyle şifrele (envelope.ts; sunucu yalnız açık anahtarı bilir),
//   3) şifreli dökümü ve manifesti yedek bucket'ına yükle (manifest kişisel veri içermez: sayılar, şema kataloğu, sha256),
//   4) ops_backup_runs kaydını yaz (/admin/ops "son yedek"),
//   5) yerel dosyaları sil.
// Yedek anahtarı yalnız yazma yetkilidir: uygulama ya da bu iş yedekleri silemez; saklama kuralı bucket yaşam döngüsündedir.
// Herhangi bir adım başarısızsa kayıt yazılmaz ve iş hata koduyla çıkar (Railway cron'u başarısız gösterir, panel son yedeği eski görür).
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup as dbBackup, DESTINATION, recordBackupRun, type Manifest } from "@kararver/db/ops/backup";
import { encryptFile } from "./envelope.ts";

export type BackupUpload = (key: string, file: string, contentType: string) => Promise<void>;

export type ScheduledBackupDeps = {
  databaseUrl: string;
  publicKeyPem: string;
  upload: BackupUpload;
  /** ops_backup_runs etiketi (ör. "r2"); adres değil. */
  destination: string;
  /** Bucket içindeki önek (ör. "db/staging"); ortam başına ayrı. */
  prefix: string;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  /** Testler için: yedek ve kayıt adımları değiştirilebilir. */
  backup?: typeof dbBackup;
  record?: typeof recordBackupRun;
};

export type ScheduledBackupResult = { dumpKey: string; manifestKey: string; encryptedBytes: number; manifest: Manifest };

const PREFIX = /^[a-z0-9][a-z0-9/_-]{0,79}$/;

export async function runScheduledBackup(deps: ScheduledBackupDeps): Promise<ScheduledBackupResult> {
  if (!DESTINATION.test(deps.destination)) throw new Error("geçersiz yedek hedefi etiketi");
  if (!PREFIX.test(deps.prefix) || deps.prefix.includes("..")) throw new Error("geçersiz yedek öneki");
  const work = await mkdtemp(path.join(tmpdir(), "kv-backup-"));
  const started = Date.now();
  try {
    const { file, manifest } = await (deps.backup ?? dbBackup)(deps.databaseUrl, work, deps.now());
    const encrypted = `${file}.enc`;
    await encryptFile(file, encrypted, deps.publicKeyPem);
    // Şifresiz döküm diske yazıldığı an kadar yaşar; yüklemeden önce silinir.
    await rm(file, { force: true });
    const day = manifest.createdAt.slice(0, 10).replaceAll("-", "/");
    const base = `${deps.prefix}/${day}/${path.basename(file)}`;
    const dumpKey = `${base}.enc`;
    const manifestKey = `${base}.manifest.json`;
    await deps.upload(dumpKey, encrypted, "application/octet-stream");
    await deps.upload(manifestKey, `${file}.manifest.json`, "application/json");
    const encryptedBytes = (await stat(encrypted)).size;
    await (deps.record ?? recordBackupRun)(deps.databaseUrl, manifest, deps.destination, deps.now());
    deps.log("info", "zamanlanmış yedek tamamlandı", {
      key: dumpKey,
      sizeBytes: manifest.sizeBytes,
      encryptedBytes,
      sha256: manifest.sha256.slice(0, 16),
      ms: Date.now() - started,
    });
    return { dumpKey, manifestKey, encryptedBytes, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

