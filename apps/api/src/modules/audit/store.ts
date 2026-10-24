// Audit modülünün veri erişim arayüzü — KV-39 (#41). Yazma: write.ts (çağıranın transaction'ında), okuma: prisma-store.ts.
// Kurallar: contracts audit.ts (assertAuditEntry), DATA_MODEL §9.2. Okuma endpoint'i: routes.ts (admin.audit.list).
import type { AuditEntryInput, AuditOutcomeValue, AuditSummary, CheckedAuditEntry } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

/** Mutation'ın transaction'ında yazılacak kayıt. `at` verilmezse DB saati (CLI). */
export type AuditWrite = AuditEntryInput & { at?: Date };

/** Aktörün görünen bilgisi (admin.audit.list). Silinmiş hesap da gösterilir: hesap verebilirlik için kim yaptı bilinmeli. */
export type AuditActorRef = { id: string; username: string; displayName: string; avatarPublicKey: string | null };

/** `actor`: Prisma store doldurur; bellek store'u (testler) yalnız actorId verir. */
export type AuditRecord = CheckedAuditEntry & { id: string; createdAt: Date; actor?: AuditActorRef | null };

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
  /** X-Request-Id, tam eşleşme. */
  requestId?: string;
  /** Gerekçede büyük/küçük harf duyarsız alt dize; % _ \ düz karakterdir. Sözleşme from/to'yu (≤ 31 gün) zorunlu kılar. */
  reasonContains?: string;
  /** #185: (action, operation) çiftinden türetilen sonuç (contracts auditOutcomeOf); ayrı sütun yok. */
  outcome?: AuditOutcomeValue;
  /** Keyset: en yeni önce (created_at, id) azalan. */
  after: { createdAt: Date; id: string } | null;
};

/** admin.audit.export (#185): okuma, step-up tüketimi ve export kaydı tek transaction'dadır. */
export type AuditExportInput = {
  query: Omit<AuditQuery, "after">;
  /** Bundan fazla eşleşme varsa too_many: transaction geri alınır, step-up tüketilmez, kayıt yazılmaz. */
  maxRows: number;
  actorId: string;
  sessionId: string;
  requestId: string;
  reason: string;
  at: Date;
  /** Export kaydının after özeti; store kayıt sayısını (`count`) ekler. */
  summary: AuditSummary;
};
export type AuditExportResult = { kind: "ok"; rows: AuditRecord[] } | { kind: "too_many" } | { kind: "stepup_required" };

export interface AuditStore {
  list(query: AuditQuery, limit: number): Promise<AuditRecord[]>;
  exportWithAudit(input: AuditExportInput): Promise<AuditExportResult>;
}

/**
 * writeAudit'in transaction'dan istediği tek yetenek. Prisma transaction istemcisi bunu sağlar; bellek
 * uygulaması (test/support/memory-audit-store.ts) kendi sahte transaction'ında aynı arayüzü verir.
 */
export type AuditTx = {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
};
