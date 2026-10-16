// moderation.bulk-approvals.expire — #183 yüksek hacimli toplu işlemin ikinci onay talepleri (docs/KV-37_BULK_MODERATION.md §8).
//
// Talep 30 dakika geçerlidir. API süresi dolmuş talebi okunurken EXPIRED gösterir ve onay/ret/geri çekmeyi reddeder; bu iş talebi
// KALICI olarak EXPIRED yapar ve sistem audit kaydını yazar (kimse dokunmasa da iz kalır). Satır kilitli ve koşullu: onay anında
// API'nin kilidiyle yarışırsa ikisinden biri kazanır (durum PENDING değilse bu iş dokunmaz); iki worker aynı talebi ikinci kez
// sonlandıramaz.
import type { PrismaClient } from "@kararver/db";
import { writeWorkerAudit } from "../sanctions/audit.ts";

export const BULK_APPROVALS_EXPIRE_QUEUE = "moderation.bulk-approvals.expire";
export const BULK_APPROVALS_EXPIRE_CRON = "*/10 * * * *";
export const BULK_APPROVALS_EXPIRE_BATCH = 200;

export type BulkApprovalExpiryDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  batchSize?: number;
};

export async function expireBulkApproval(deps: BulkApprovalExpiryDeps, id: string): Promise<boolean> {
  const at = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; will_change: number }[]>`
      SELECT id::text AS id, will_change FROM moderation_bulk_approvals
       WHERE id = ${id}::uuid AND status = 'PENDING' AND expires_at <= ${at}::timestamptz FOR UPDATE`;
    const row = rows[0];
    if (!row) return false;
    await tx.moderationBulkApproval.update({ where: { id }, data: { status: "EXPIRED", decidedAt: at } });
    await writeWorkerAudit(tx, {
      source: "WORKER",
      actorId: null,
      action: "moderation.bulk.expire",
      target: { type: "BULK_APPROVAL", id },
      before: { status: "PENDING" },
      after: { status: "EXPIRED", itemCount: row.will_change },
      requestId: null,
      at,
    });
    return true;
  });
}

export async function expireBulkApprovals(deps: BulkApprovalExpiryDeps): Promise<{ candidates: number; expired: number; skipped: number; failed: number }> {
  const rows = await deps.prisma.moderationBulkApproval.findMany({
    where: { status: "PENDING", expiresAt: { lte: deps.now() } },
    orderBy: { expiresAt: "asc" },
    select: { id: true },
    take: deps.batchSize ?? BULK_APPROVALS_EXPIRE_BATCH,
  });
  const result = { candidates: rows.length, expired: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    try {
      if (await expireBulkApproval(deps, row.id)) result.expired++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      deps.log?.("error", "Toplu işlem onay süresi dolumu hatası", { approvalId: row.id, error: String(error) });
    }
  }
  return result;
}
