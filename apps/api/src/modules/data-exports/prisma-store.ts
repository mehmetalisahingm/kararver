// DataExportStore'un PostgreSQL/Prisma uygulaması — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §8.
//
// Her yönetici işlemi tek transaction'dadır: hedef kullanıcı satırı kilitlenir (admin-users ile aynı kilit; iki istek ve
// iki yönetici burada sıraya girer), yetki taze aktörle yeniden verilir, ardından satır + audit birlikte yazılır.
// Sıklık sınırı kilit altında audit kayıtlarından hesaplanır (admin şifre sıfırlamayla aynı yöntem).
// Audit'te token, bağlantı, e-posta veya paket içeriği yoktur; yalnız talep kimliği ve zamanlar.
import { Prisma, type PrismaClient } from "@kararver/db";
import { decide, lockTarget } from "../admin-users/prisma-store.ts";
import { writeAudit } from "../audit/write.ts";
import type { DataExportStore, ExportRow } from "./store.ts";

const HOUR_MS = 60 * 60 * 1000;

const rowSelect = {
  id: true,
  status: true,
  createdAt: true,
  readyAt: true,
  expiresAt: true,
  sizeBytes: true,
  failure: true,
  deliveredAt: true,
  downloadCount: true,
} as const;

/** BANNED/SUSPENDED hesap giriş yapamaz (ACCOUNT_RESTRICTED); indirme için oturum gerektiğinden talep açılmaz. */
const CANNOT_SIGN_IN = new Set(["BANNED", "SUSPENDED"]);

export function createPrismaDataExportStore(prisma: PrismaClient): DataExportStore {
  return {
    async userExists(userId) {
      return (await prisma.user.count({ where: { id: userId } })) > 0;
    },

    list: (userId, limit) => prisma.dataExport.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: rowSelect }) as Promise<ExportRow[]>,

    async request(input) {
      const { userId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        const decision = await decide(tx, actorId, "privacy.export.manage", {}, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;
        if (target.deleted) return { kind: "rejected", reason: "user_deleted" } as const;
        if (CANNOT_SIGN_IN.has(target.status)) return { kind: "rejected", reason: "account_restricted" } as const;

        // Idempotency: açık talep varsa yenisi açılmaz (kısmi unique index yarışta da korur; kilit zaten sıralar).
        const open = await tx.dataExport.findFirst({ where: { userId, status: { in: ["PENDING", "PROCESSING", "READY"] } }, select: rowSelect });
        if (open) return { kind: "existing", row: open as ExportRow } as const;

        const row = await tx.dataExport.create({ data: { userId, requestedById: actorId }, select: rowSelect });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "privacy.export.manage",
          operation: "request",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: null,
          after: { exportId: row.id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "created", row: row as ExportRow } as const;
      });
    },

    async deliver(input) {
      const { userId, exportId, actorId, now } = input;
      return prisma.$transaction(async (tx) => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" } as const;
        const decision = await decide(tx, actorId, "privacy.export.manage", {}, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" } as const;

        const row = await tx.dataExport.findFirst({ where: { id: exportId, userId }, select: { status: true, expiresAt: true } });
        if (!row) return { kind: "rejected", reason: "not_found" } as const;
        if (row.status === "EXPIRED" || (row.status === "READY" && row.expiresAt! <= now)) return { kind: "rejected", reason: "expired" } as const;
        if (row.status !== "READY") return { kind: "rejected", reason: "not_ready" } as const;

        const recent = await tx.auditLog.findMany({
          where: { action: "privacy.export.manage", operation: "deliver", targetType: "USER", targetId: userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const last = recent.at(-1);
        if (last && now.getTime() - last.createdAt.getTime() < input.cooldownMs) {
          return { kind: "limited", retryAfterMs: input.cooldownMs - (now.getTime() - last.createdAt.getTime()) } as const;
        }
        if (recent.length >= input.hourlyLimit) {
          return { kind: "limited", retryAfterMs: recent[recent.length - input.hourlyLimit]!.createdAt.getTime() + HOUR_MS - now.getTime() } as const;
        }

        // Bağlantı paketten uzun yaşamaz. Yeni token önceki bağlantıyı geçersiz kılar (aynı satırda tek token) ve hakkı sıfırlar.
        const linkExpiresAt = new Date(Math.min(now.getTime() + input.ttlMs, row.expiresAt!.getTime()));
        await tx.dataExport.update({
          where: { id: exportId },
          data: { tokenHash: input.tokenHash, tokenExpiresAt: linkExpiresAt, deliveredAt: now, downloadCount: 0, lastDownloadedAt: null },
        });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "privacy.export.manage",
          operation: "deliver",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: null,
          after: { exportId, linkExpiresAt: linkExpiresAt.toISOString() },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "issued", email: user.email, linkExpiresAt } as const;
      });
    },

    async findDownloadable({ userId, tokenHash, now, maxDownloads }) {
      const row = await prisma.dataExport.findFirst({
        where: { userId, tokenHash, status: "READY", tokenExpiresAt: { gt: now }, expiresAt: { gt: now }, downloadCount: { lt: maxDownloads } },
        select: { id: true, objectKey: true, encKey: true },
      });
      if (!row?.objectKey || !row.encKey) return null;
      return { exportId: row.id, objectKey: row.objectKey, encKey: Buffer.from(row.encKey) };
    },

    async recordDownload({ userId, exportId, requestId, now, maxDownloads }) {
      return prisma.$transaction(async (tx) => {
        const at = now.toISOString();
        const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
          UPDATE data_exports SET download_count = download_count + 1, last_downloaded_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
          WHERE id = ${exportId}::uuid AND user_id = ${userId}::uuid AND status = 'READY' AND download_count < ${maxDownloads}
          RETURNING download_count::int AS n`);
        if (rows.length === 0) return false;
        await writeAudit(tx, {
          source: "API",
          actorId: userId,
          action: "privacy.export.download",
          operation: "download",
          target: { type: "USER", id: userId },
          reason: null,
          before: null,
          after: { exportId, downloadNumber: rows[0]!.n },
          requestId,
          at: now,
        });
        return true;
      });
    },
  };
}
