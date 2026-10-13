// account-erasure.cleanup — #181 hesap anonimleştirme. Kurallar: docs/KV-33_ADMIN_USERS.md §10.
//
// API anonimleştirmeyi tek DB transaction'ında yapar; depodaki dosyalar o transaction'ın dışındadır. Avatar görselleri DB'de
// hemen yayından kalkar (REJECTED, public anahtar boş); bu iş onların nesnelerini (public kopya, işlenmiş ve orijinal özel
// kopya) siler. `account_erasures.storage_cleaned_at` boş olan kayıtlar her turda yeniden denenir; silme idempotenttir
// (olmayan nesne hata vermez), tamamı başarılı olunca kayıt işaretlenir. Bir nesne silinemezse kayıt işaretlenmez ve
// sonraki turda yeniden denenir.
import type { PrismaClient } from "@kararver/db";
import { publicKey } from "../media/job.ts";

export const ACCOUNT_ERASURE_QUEUE = "account-erasure.cleanup";
export const ACCOUNT_ERASURE_CRON = "* * * * *";
/** Bir turda işlenen en çok hesap (kalanlar sonraki turda). */
export const BATCH_SIZE = 20;

export type ErasureStorage = {
  deletePublic(key: string): Promise<void>;
  deletePrivate(key: string): Promise<void>;
};

export type AccountErasureDeps = {
  prisma: PrismaClient;
  storage: ErasureStorage;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
};

export type AccountErasureResult = { cleaned: number; failed: number };

export async function cleanupAccountErasures(deps: AccountErasureDeps): Promise<AccountErasureResult> {
  const { prisma, storage } = deps;
  const pending = await prisma.accountErasure.findMany({
    where: { storageCleanedAt: null },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, userId: true },
  });
  const result: AccountErasureResult = { cleaned: 0, failed: 0 };
  for (const row of pending) {
    try {
      const assets = await prisma.mediaAsset.findMany({
        where: { uploaderId: row.userId, purpose: "AVATAR" },
        select: { id: true, originalObjectKey: true, processedObjectKey: true },
      });
      for (const asset of assets) {
        await storage.deletePublic(publicKey(asset.id));
        await storage.deletePrivate(asset.originalObjectKey);
        if (asset.processedObjectKey) await storage.deletePrivate(asset.processedObjectKey);
      }
      // Koşullu işaret: iki worker aynı kaydı işlerse ikincisi sayılmaz.
      const done = await prisma.accountErasure.updateMany({ where: { id: row.id, storageCleanedAt: null }, data: { storageCleanedAt: deps.now() } });
      result.cleaned += done.count;
    } catch {
      result.failed += 1;
      deps.log("warn", "account-erasure avatar nesneleri silinemedi", { id: row.id, failure: "delete_failed" });
    }
  }
  return result;
}
