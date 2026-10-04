// Worker'ın audit yazıcısı — KV-39 kuralları, KV-33 PR-C. API'deki writeAudit ile aynı iş (apps/api/src/modules/audit/write.ts);
// worker apps/api'yi import etmediği için burada küçük bir eşi var. Doğrulama kuralları tek yerdedir: contracts
// `assertAuditEntry` (işlem kataloğu/sistem işlemi, operation, gerekçe, hassas alan, kaynak/aktör tutarlılığı).
// Çağıranın transaction'ında yazar: işlem geri alınırsa kayıt da yoktur (KV-04 §4.4).
import { assertAuditEntry, type AuditEntryInput, type CheckedAuditEntry } from "@kararver/contracts";
import { Prisma } from "@kararver/db";

const json = (value: CheckedAuditEntry["before"]) => (value === null ? Prisma.DbNull : (value as Prisma.InputJsonObject));

export async function writeWorkerAudit(tx: Prisma.TransactionClient, entry: AuditEntryInput & { at: Date }): Promise<void> {
  const e = assertAuditEntry(entry);
  await tx.auditLog.create({
    data: {
      actorId: e.actorId,
      source: e.source,
      action: e.action,
      operation: e.operation,
      targetType: e.target.type,
      targetId: e.target.id,
      reason: e.reason,
      before: json(e.before),
      after: json(e.after),
      requestId: e.requestId,
      createdAt: entry.at,
    },
  });
}
