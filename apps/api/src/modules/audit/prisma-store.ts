// AuditStore'un PostgreSQL/Prisma uygulaması. Tablo: audit_logs (DATA_MODEL §9.2); sorgular hedef, aktör,
// işlem/tür ve zaman index'lerinden okunur.
import type { AuditAction, AuditSummary, AuditTargetType } from "@kararver/contracts";
import type { Prisma, PrismaClient } from "@kararver/db";
import { consumeFreshStepup } from "../security/stepup-guard.ts";
import type { AuditQuery, AuditRecord, AuditStore } from "./store.ts";
import { writeAudit } from "./write.ts";

/** LIKE/ILIKE joker karakterlerini düz karaktere çevirir (PostgreSQL varsayılan kaçış karakteri \). */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const actorSelect = {
  actor: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
} as const;

function whereOf(q: AuditQuery): Prisma.AuditLogWhereInput {
  return {
    actorId: q.actorId,
    targetType: q.targetType,
    targetId: q.targetId,
    action: q.action,
    operation: q.operation,
    source: q.source,
    requestId: q.requestId,
    // ILIKE; aralık sözleşmede ≤ 31 gün olduğundan created_at index'inden okunur.
    reason: q.reasonContains !== undefined ? { contains: escapeLike(q.reasonContains), mode: "insensitive" } : undefined,
    createdAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
    ...(q.after
      ? { OR: [{ createdAt: { lt: q.after.createdAt } }, { createdAt: q.after.createdAt, id: { lt: q.after.id } }] }
      : {}),
  };
}

type Row = Prisma.AuditLogGetPayload<{ include: typeof actorSelect }>;

/** created_at ↓, id ↓ (admin.audit.list ve export aynı sıra). */
const read = (db: Pick<Prisma.TransactionClient, "auditLog">, q: AuditQuery, take: number): Promise<Row[]> =>
  db.auditLog.findMany({ where: whereOf(q), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, include: actorSelect });

/** Export'ta sınır aşılınca transaction'ı (step-up tüketimi dahil) geri almak için. */
class TooMany extends Error {}

export function createPrismaAuditStore(prisma: PrismaClient): AuditStore {
  return {
    async list(q, limit) {
      return (await read(prisma, q, limit)).map(toRecord);
    },

    async exportWithAudit(input) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            // Önce step-up: ağır okuma yalnız doğrulanmış oturumda yapılır.
            if (!(await consumeFreshStepup(tx, input.actorId, input.sessionId, input.at))) return { kind: "stepup_required" as const };
            const rows = await read(tx, { ...input.query, after: null }, input.maxRows + 1);
            if (rows.length > input.maxRows) throw new TooMany();
            await writeAudit(tx, {
              actorId: input.actorId,
              source: "API",
              action: "audit.export",
              operation: "export",
              target: { type: "AUDIT", id: "audit_logs" },
              reason: input.reason,
              before: null,
              after: { ...input.summary, count: rows.length },
              requestId: input.requestId,
              at: input.at,
            });
            return { kind: "ok" as const, rows: rows.map(toRecord) };
          },
          { maxWait: 10_000, timeout: 30_000 },
        );
      } catch (err) {
        if (err instanceof TooMany) return { kind: "too_many" };
        throw err;
      }
    },
  };
}

const toRecord = (r: Row): AuditRecord => ({
  id: r.id,
  source: r.source,
  actorId: r.actorId,
  action: r.action as AuditAction,
  operation: r.operation,
  target: { type: r.targetType as AuditTargetType, id: r.targetId },
  reason: r.reason,
  before: (r.before as AuditSummary | null) ?? null,
  after: (r.after as AuditSummary | null) ?? null,
  requestId: r.requestId,
  createdAt: r.createdAt,
  actor: r.actor
    ? {
        id: r.actor.id,
        username: r.actor.username,
        displayName: r.actor.displayName,
        avatarPublicKey: r.actor.avatarMedia?.status === "APPROVED" ? r.actor.avatarMedia.publicObjectKey : null,
      }
    : null,
});
