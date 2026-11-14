// #186 — yedeği bir klasöre yazan "yükleme" (GitHub Actions artifact'ı gibi, dosyayı başka bir araç taşıyacaksa).
// Anahtar (ör. "db/staging/2026/11/04/<ad>.dump.enc") klasör altında aynı yol olur; mevcut dosyanın üzerine yazılmaz
// (yalnız-ekle, bucket'taki yalnız-yazma anahtarıyla aynı ilke). Yol, klasörün dışına çıkamaz.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import type { BackupUpload } from "./scheduled.ts";

export function createDirectoryBackupUpload(root: string): BackupUpload {
  const base = path.resolve(root);
  return async (key, file) => {
    const target = path.resolve(base, key);
    if (target !== base && !target.startsWith(base + path.sep)) throw new Error("yedek anahtarı hedef klasörün dışına çıkıyor");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target, constants.COPYFILE_EXCL);
  };
}
