// Audit kaydı yazımı — KV-39 (#41). Kritik işlem bunu kendi transaction'ının içinden çağırır (KV-04 §4.4):
// işlem commit olursa kayıt vardır, geri alınırsa yoktur. Olay tüketicisi veya ayrı transaction kullanılmaz.
//
// Kayıt yazılmadan önce contracts `assertAuditEntry` ile doğrulanır: işlem KV-04 kataloğunda (veya sistem işlemi),
// operation izinli, gerekçe zorunluysa var, before/after hassas alansız nesne. İhlal TypeError'dur (kod hatası);
// çağıranın transaction'ı onunla birlikte geri alınır, yani gerekçesiz kritik işlem yazılamaz.
import { assertAuditEntry, type CheckedAuditEntry } from "@kararver/contracts";
import { Prisma } from "@kararver/db";
import type { AuditTx, AuditWrite } from "./store.ts";

const json = (value: CheckedAuditEntry["before"]) => (value === null ? Prisma.DbNull : (value as Prisma.InputJsonObject));

export async function writeAudit(tx: AuditTx, entry: AuditWrite): Promise<void> {
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
      ...(entry.at ? { createdAt: entry.at } : {}),
    },
  });
}
