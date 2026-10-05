// Bildirim saklaması — KV-21 PR-3 (#23), kararlar: docs/KV-21_NOTIFICATIONS.md §4.
// - Okunmuş bildirim okunduktan 90 gün sonra silinir; okunmamış silinmez (index notifications_read_at_idx).
// - Silinmiş hesabın bütün bildirimleri (okunmuş ve okunmamış) hesap silindikten 30 gün sonra silinir: artık okunmayacak
//   kişisel veridir, 90 gün kuralı onlara hiç uygulanmaz. Yeni bildirim zaten yazılmaz (ortak süzgeç, write.ts).
import { Prisma, type PrismaClient } from "@kararver/db";
import type { EventLog } from "../events/consumers.ts";

export const NOTIFICATIONS_CLEANUP_QUEUE = "notifications.cleanup";
export const NOTIFICATIONS_CLEANUP_CRON = "0 4 * * *";
export const READ_RETENTION_DAYS = 90;
export const DELETED_ACCOUNT_RETENTION_DAYS = 30;
const BATCH = 5000;
const DAY = 24 * 60 * 60_000;

export type NotificationCleanupDeps = { prisma: PrismaClient; now: () => Date; log: EventLog; batchSize?: number };
export type NotificationCleanupResult = { read: number; deletedAccounts: number };

async function deleteInBatches(prisma: PrismaClient, where: Prisma.Sql, batch: number): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await prisma.$executeRaw(Prisma.sql`DELETE FROM notifications WHERE id IN (SELECT n.id FROM notifications n WHERE ${where} LIMIT ${batch})`);
    total += n;
    if (n < batch) return total;
  }
}

export async function cleanupNotifications(deps: NotificationCleanupDeps): Promise<NotificationCleanupResult> {
  const now = deps.now().getTime();
  const batch = deps.batchSize ?? BATCH;
  const readCutoff = new Date(now - READ_RETENTION_DAYS * DAY).toISOString();
  const deletedCutoff = new Date(now - DELETED_ACCOUNT_RETENTION_DAYS * DAY).toISOString();
  const read = await deleteInBatches(deps.prisma, Prisma.sql`n.read_at < ${readCutoff}::timestamptz`, batch);
  const deletedAccounts = await deleteInBatches(
    deps.prisma,
    Prisma.sql`n.recipient_id IN (SELECT u.id FROM users u WHERE u.deleted_at < ${deletedCutoff}::timestamptz)`,
    batch,
  );
  const result = { read, deletedAccounts };
  deps.log("info", "notifications.cleanup bitti", result);
  return result;
}
