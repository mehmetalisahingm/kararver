// AuditStore'un PostgreSQL/Prisma uygulaması. Tablo: audit_logs (DATA_MODEL §9.2); sorgular hedef, aktör,
// işlem/tür ve zaman index'lerinden okunur.
import type { AuditAction, AuditSummary, AuditTargetType } from "@kararver/contracts";
import type { Prisma, PrismaClient } from "@kararver/db";
import type { AuditRecord, AuditStore } from "./store.ts";

export function createPrismaAuditStore(prisma: PrismaClient): AuditStore {
  return {
    async list(q, limit) {
      const where: Prisma.AuditLogWhereInput = {
        actorId: q.actorId,
        targetType: q.targetType,
        targetId: q.targetId,
        action: q.action,
        operation: q.operation,
        source: q.source,
        createdAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
        ...(q.after
          ? { OR: [{ createdAt: { lt: q.after.createdAt } }, { createdAt: q.after.createdAt, id: { lt: q.after.id } }] }
          : {}),
      };
      const rows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        include: {
          actor: { select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } } },
        },
      });
      return rows.map(
        (r): AuditRecord => ({
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
        }),
      );
    },
  };
}
