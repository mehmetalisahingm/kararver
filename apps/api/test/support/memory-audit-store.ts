// AuditStore'un bellek içi uygulaması. Sadece test içindir; aynı senaryolar DB varken PrismaAuditStore ile de koşar
// (test/audit.test.ts). `transaction` Prisma'nınki gibi davranır: fonksiyon hata verirse yazılan kayıtlar atılır.
import { randomUUID } from "node:crypto";
import type { AuditAction, AuditSummary, AuditTargetType } from "@kararver/contracts";
import type { AuditRecord, AuditStore, AuditTx } from "../../src/modules/audit/store.ts";

export type MemoryAuditStore = AuditStore & {
  records: AuditRecord[];
  transaction<T>(fn: (tx: AuditTx) => Promise<T>): Promise<T>;
};

/** Prisma.DbNull ve benzeri işaretler SQL NULL'dur. */
const summary = (value: unknown): AuditSummary | null =>
  value !== null && typeof value === "object" && value.constructor === Object ? (value as AuditSummary) : null;

export function createMemoryAuditStore(now: () => Date = () => new Date()): MemoryAuditStore {
  const records: AuditRecord[] = [];

  return {
    records,

    async transaction(fn) {
      const staged: AuditRecord[] = [];
      const tx: AuditTx = {
        auditLog: {
          async create({ data }) {
            staged.push({
              id: randomUUID(),
              source: data.source,
              actorId: data.actorId ?? null,
              action: data.action as AuditAction,
              operation: data.operation,
              target: { type: data.targetType as AuditTargetType, id: data.targetId },
              reason: data.reason ?? null,
              before: summary(data.before),
              after: summary(data.after),
              requestId: data.requestId ?? null,
              createdAt: data.createdAt ? new Date(data.createdAt) : now(),
            });
          },
        },
      };
      const result = await fn(tx);
      records.push(...staged);
      return result;
    },

    async list(q, limit) {
      const key = (r: AuditRecord) => [r.createdAt.getTime(), r.id] as const;
      return records
        .filter(
          (r) =>
            (q.actorId === undefined || r.actorId === q.actorId) &&
            (q.targetType === undefined || r.target.type === q.targetType) &&
            (q.targetId === undefined || r.target.id === q.targetId) &&
            (q.action === undefined || r.action === q.action) &&
            (q.operation === undefined || r.operation === q.operation) &&
            (q.source === undefined || r.source === q.source) &&
            (q.from === undefined || r.createdAt >= q.from) &&
            (q.to === undefined || r.createdAt < q.to) &&
            (q.after === null ||
              r.createdAt < q.after.createdAt ||
              (r.createdAt.getTime() === q.after.createdAt.getTime() && r.id < q.after.id)),
        )
        .sort((a, b) => {
          const [ta, ia] = key(a);
          const [tb, ib] = key(b);
          return tb - ta || (ib < ia ? -1 : ib > ia ? 1 : 0);
        })
        .slice(0, limit);
    },
  };
}
