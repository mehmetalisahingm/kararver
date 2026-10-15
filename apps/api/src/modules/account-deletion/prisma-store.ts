// AccountDeletionStore'un PostgreSQL/Prisma uygulaması — #181, KV-33 §12.
//
// Kilit: hedef users satırı FOR NO KEY UPDATE (lockTarget; yaptırım, rol, anonimleştirme, e-posta değişimi ile aynı kilit).
// Silme talebinin açık olduğunun doğrulanması (`isOpen`) ve kapatılması (`markCompleted`) account-erasure `anonymize`
// transaction'ının içinde, o kilit altında çalışır: iptal ile onay yarışırsa kilidi kazanan belirler, silinmiş hesapta iptal
// görünmez, iptal edilmiş talep silmez.
import type { Prisma, PrismaClient } from "@kararver/db";
import { lockTarget } from "../admin-users/prisma-store.ts";
import { writeAudit } from "../audit/write.ts";
import { consumeFreshStepup } from "../security/stepup-guard.ts";
import type { AccountDeletionStore, CancelByTokenResult, DeletionRow, RequestResult } from "./store.ts";

type Tx = Prisma.TransactionClient;
const HOUR_MS = 60 * 60 * 1000;

const rowSelect = { id: true, status: true, expiresAt: true, createdAt: true, finishedAt: true, failure: true } as const;

const finish = (tx: Tx, id: string, status: "COMPLETED" | "CANCELLED" | "EXPIRED" | "FAILED", now: Date, failure: string | null = null) =>
  tx.accountDeletionRequest.updateMany({ where: { id, status: "OPEN" }, data: { status, finishedAt: now, failure } });

export function createPrismaAccountDeletionStore(prisma: PrismaClient): AccountDeletionStore {
  return {
    async latest(userId) {
      return (await prisma.accountDeletionRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: rowSelect })) as DeletionRow | null;
    },

    async request(input) {
      const { userId, now } = input;
      return prisma.$transaction(async (tx): Promise<RequestResult> => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" };
        if (target.deleted) return { kind: "rejected", reason: "user_deleted" };
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, email: true } });
        const typed = input.confirmUsername.trim().replace(/^@/, "").toLowerCase();
        if (typed !== user.username.toLowerCase()) return { kind: "rejected", reason: "confirmation_mismatch" };

        // Süresi geçmiş açık talep kapanır (kısmi unique index yeni talebi engellemesin).
        await tx.accountDeletionRequest.updateMany({ where: { userId, status: "OPEN", expiresAt: { lte: now } }, data: { status: "EXPIRED", finishedAt: now } });

        const recent = await tx.accountDeletionRequest.findMany({
          where: { userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const last = recent.at(-1);
        if (last && now.getTime() - last.createdAt.getTime() < input.cooldownMs) {
          return { kind: "limited", retryAfterMs: input.cooldownMs - (now.getTime() - last.createdAt.getTime()) };
        }
        if (recent.length >= input.hourlyLimit) {
          return { kind: "limited", retryAfterMs: recent[recent.length - input.hourlyLimit]!.createdAt.getTime() + HOUR_MS - now.getTime() };
        }

        // Taze MFA step-up en son (yan etkili) ve talebin yazıldığı transaction'da tüketilir; tekrar kullanılamaz.
        if (input.mfaEnabled && !(await consumeFreshStepup(tx, userId, input.sessionId, now))) return { kind: "rejected", reason: "mfa_required" };

        const open = await tx.accountDeletionRequest.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } });
        if (open) await finish(tx, open.id, "CANCELLED", now, "replaced");
        const row = await tx.accountDeletionRequest.create({
          data: { userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, createdAt: now },
          select: rowSelect,
        });
        await writeAudit(tx, {
          source: "API",
          actorId: userId,
          action: "account.deletion.manage",
          operation: "request",
          target: { type: "USER", id: userId },
          reason: null,
          before: null,
          after: { requestId: row.id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "created", row: row as DeletionRow, email: user.email };
      });
    },

    async prepare(tokenHash, now) {
      const row = await prisma.accountDeletionRequest.findUnique({ where: { tokenHash }, select: { id: true, userId: true, status: true, expiresAt: true } });
      if (!row) return { kind: "rejected", reason: "invalid" };
      if (row.status === "COMPLETED") return { kind: "done" };
      if (row.status !== "OPEN") return { kind: "rejected", reason: "invalid" };
      if (row.expiresAt <= now) {
        await prisma.accountDeletionRequest.updateMany({ where: { id: row.id, status: "OPEN" }, data: { status: "EXPIRED", finishedAt: now } });
        return { kind: "rejected", reason: "invalid" };
      }
      const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
      if (!user) return { kind: "rejected", reason: "invalid" };
      return { kind: "ready", deletionId: row.id, userId: row.userId, email: user.email };
    },

    async isOpen(tx, deletionId, now) {
      const row = await tx.accountDeletionRequest.findUnique({ where: { id: deletionId }, select: { status: true, expiresAt: true } });
      return row?.status === "OPEN" && row.expiresAt > now;
    },

    async markCompleted(tx, deletionId, now) {
      await finish(tx, deletionId, "COMPLETED", now);
    },

    async fail(deletionId, reason, now) {
      await prisma.accountDeletionRequest.updateMany({ where: { id: deletionId, status: "OPEN" }, data: { status: "FAILED", finishedAt: now, failure: `blocked:${reason}` } });
    },

    async cancelOwn(input) {
      const { userId, now } = input;
      return prisma.$transaction(async (tx) => {
        if (!(await lockTarget(tx, userId))) return { cancelled: false };
        const open = await tx.accountDeletionRequest.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } });
        if (!open) return { cancelled: false };
        await finish(tx, open.id, "CANCELLED", now, "user");
        await writeAudit(tx, {
          source: "API",
          actorId: input.actorId,
          action: "account.deletion.manage",
          operation: "cancel",
          target: { type: "USER", id: userId },
          reason: null,
          before: null,
          after: { requestId: open.id },
          requestId: input.requestId,
          at: now,
        });
        return { cancelled: true };
      });
    },

    async cancelByToken(input) {
      const { tokenHash, now } = input;
      const found = await prisma.accountDeletionRequest.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
      if (!found) return { kind: "rejected", reason: "invalid" };
      return prisma.$transaction(async (tx): Promise<CancelByTokenResult> => {
        if (!(await lockTarget(tx, found.userId))) return { kind: "rejected", reason: "invalid" };
        const row = await tx.accountDeletionRequest.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, userId: true, status: true, failure: true } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId }, select: { email: true } });
        if (row.status === "COMPLETED") return { kind: "rejected", reason: "already_deleted" };
        if (row.status === "CANCELLED" && row.failure === "link") return { kind: "cancelled", fresh: false, email: user.email };
        if (row.status !== "OPEN") return { kind: "rejected", reason: "invalid" };
        await finish(tx, row.id, "CANCELLED", now, "link");
        // Talebi sahibi açmadıysa hesap ele geçirilmiş olabilir: bütün oturumlar kapanır, bekleyen bağlantılar geçersiz olur.
        await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.authToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
        await writeAudit(tx, {
          source: "API",
          actorId: row.userId,
          action: "account.deletion.confirm",
          operation: "deny",
          target: { type: "USER", id: row.userId },
          reason: null,
          before: null,
          after: { requestId: row.id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "cancelled", fresh: true, email: user.email };
      });
    },
  };
}
