// #186 — yedek dosyası GERÇEKTEN yayımlandıktan sonra (ör. GitHub Actions artifact yüklemesi başarılı) ops_backup_runs
// kaydını yazar; /admin/ops "son yedek" ancak o zaman güncellenir.
//   DATABASE_URL=… BACKUP_DESTINATION=github-actions node apps/worker/scripts/record-backup-run.ts --manifest <ad>.dump.manifest.json
// Çıkış 0 = yazıldı; 1 = hata (manifest okunamadı, etiket geçersiz, DB). Adres ya da sır yazdırılmaz.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { recordBackupRun, type Manifest } from "@kararver/db/ops/backup";

const { values } = parseArgs({ options: { manifest: { type: "string" } } });
try {
  if (!values.manifest) throw new Error("--manifest gerekli");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");
  const manifest = JSON.parse(await readFile(values.manifest, "utf8")) as Manifest;
  if (manifest.kind !== "kararver-db-backup") throw new Error("manifest tanınmadı");
  await recordBackupRun(process.env.DATABASE_URL, manifest, process.env.BACKUP_DESTINATION ?? "github-actions", new Date());
  console.log(JSON.stringify({ level: "info", job: "backup.record", message: "yedek kaydı yazıldı", sha256: manifest.sha256.slice(0, 16) }));
} catch (err) {
  console.error(JSON.stringify({ level: "error", job: "backup.record", message: err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "***") : "hata" }));
  process.exitCode = 1;
}
