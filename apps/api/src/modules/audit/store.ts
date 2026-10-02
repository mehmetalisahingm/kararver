// Audit modülünün veri erişim arayüzü — KV-39 (#41). Yazma: write.ts (çağıranın transaction'ında), okuma: prisma-store.ts.
// Kurallar: contracts audit.ts (assertAuditEntry), DATA_MODEL §9.2. Okuma endpoint'i (admin.audit.list) ayrı PR'da gelir.
import type { AuditEntryInput, CheckedAuditEntry } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

/** Mutation'ın transaction'ında yazılacak kayıt. `at` verilmezse DB saati (CLI). */
export type AuditWrite = AuditEntryInput & { at?: Date };

export type AuditRecord = CheckedAuditEntry & { id: string; createdAt: Date };

export type AuditQuery = {
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  operation?: string;
  source?: CheckedAuditEntry["source"];
  /** Dahil */
  from?: Date;
  /** Hariç */
  to?: Date;
  /** Keyset: en yeni önce (created_at, id) azalan. */
  after: { createdAt: Date; id: string } | null;
};

export interface AuditStore {
  list(query: AuditQuery, limit: number): Promise<AuditRecord[]>;
}

/**
 * writeAudit'in transaction'dan istediği tek yetenek. Prisma transaction istemcisi bunu sağlar; bellek
 * uygulaması (test/support/memory-audit-store.ts) kendi sahte transaction'ında aynı arayüzü verir.
 */
export type AuditTx = {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
};
