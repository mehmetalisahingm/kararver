// EmailChangeStore'un PostgreSQL/Prisma uygulaması — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §11.
//
// Kilit sırası: hedef users satırı FOR NO KEY UPDATE (admin-users, anonimleştirme, yaptırım ve rol işlemleriyle aynı kilit),
// ardından talep o kilit altında okunur. Başka kullanıcı satırı kilitlenmez. İki sekme/aynı anda iki onay burada sıraya girer.
//
// E-posta yalnız bu dosyadaki `apply` ile değişir ve yalnız gereken tıklamalar tamamsa: yeni adres her durumda, kullanıcı
// başlatmasında eski adres de. Uygulama anında: e-posta güncellenir ve doğrulanmış sayılır (yeni adrese tıklandığı için),
// bütün oturumlar kapanır, bekleyen doğrulama/sıfırlama bağlantıları geçersiz olur.
import { Prisma, type PrismaClient } from "@kararver/db";
import { decide, lockTarget } from "../admin-users/prisma-store.ts";
import { writeAudit } from "../audit/write.ts";
import type { CancelResult, ConfirmResult, DenyResult, EmailChangeRow, EmailChangeStore, StartResult } from "./store.ts";

type Tx = Prisma.TransactionClient;
const HOUR_MS = 60 * 60 * 1000;

const rowSelect = {
  id: true,
  origin: true,
  status: true,
  newEmail: true,
  requiresOld: true,
  newConfirmedAt: true,
  oldConfirmedAt: true,
  expiresAt: true,
  createdAt: true,
  finishedAt: true,
  failure: true,
} as const;

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Talebi sonlandırır; yeni adres silinir (veri en aza indirme). */
const finish = (tx: Tx, id: string, status: "COMPLETED" | "CANCELLED" | "DENIED" | "EXPIRED" | "FAILED", now: Date, failure: string | null = null, extra: Prisma.EmailChangeRequestUpdateInput = {}) =>
  tx.emailChangeRequest.update({
    where: { id },
    data: { ...extra, status, newEmail: null, newEmailNormalized: null, finishedAt: now, failure },
  });

/** Hesabın güvenliğini ilgilendiren geri alınamaz yan etkiler: oturumlar ve bekleyen bağlantılar. */
async function revokeAccess(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
}

export function createPrismaEmailChangeStore(prisma: PrismaClient): EmailChangeStore {
  async function markFailed(id: string, failure: string, now: Date): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const row = await tx.emailChangeRequest.findUnique({ where: { id }, select: { status: true } });
      if (row?.status === "OPEN") await finish(tx, id, "FAILED", now, failure);
    });
  }

  async function cancelOpen(tx: Tx, userId: string, now: Date): Promise<string | null> {
    const open = await tx.emailChangeRequest.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } });
    if (!open) return null;
    await finish(tx, open.id, "CANCELLED", now);
    return open.id;
  }

  return {
    async start(input) {
      const { userId, actorId, now } = input;
      return prisma.$transaction(async (tx): Promise<StartResult> => {
        const target = await lockTarget(tx, userId);
        if (!target) return { kind: "rejected", reason: "not_found" };
        if (input.origin === "ADMIN") {
          const role = (await tx.userRole.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
          const decision = await decide(tx, actorId, "user.emailChange.manage", { targetUserId: userId, targetRoles: role ? [role] : [] }, now);
          if (!decision.allowed) return { kind: "rejected", reason: "forbidden" };
        } else if (actorId !== userId) {
          return { kind: "rejected", reason: "forbidden" };
        }
        if (target.deleted) return { kind: "rejected", reason: "user_deleted" };

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailNormalized: true } });
        if (user.emailNormalized === input.newEmailNormalized) return { kind: "rejected", reason: "same_email" };

        // Süresi geçmiş açık talep kapanır (kısmi unique index yeni talebi engellemesin).
        await tx.emailChangeRequest.updateMany({
          where: { userId, status: "OPEN", expiresAt: { lte: now } },
          data: { status: "EXPIRED", newEmail: null, newEmailNormalized: null, finishedAt: now },
        });

        if (input.origin === "USER") {
          const recent = await tx.emailChangeRequest.findMany({
            where: { userId, origin: "USER", createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
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
        }

        const open = await tx.emailChangeRequest.findFirst({ where: { userId, status: "OPEN" }, select: { id: true } });
        if (open) {
          // Yönetici, kullanıcının açık talebini sessizce ezmez; kullanıcı kendi talebini yenisiyle değiştirebilir.
          if (input.origin === "ADMIN") return { kind: "rejected", reason: "request_open" };
          await finish(tx, open.id, "CANCELLED", now, "replaced");
        }

        const owner = await tx.user.findUnique({ where: { emailNormalized: input.newEmailNormalized }, select: { email: true, deletedAt: true } });
        if (owner && !owner.deletedAt) return { kind: "taken", ownerEmail: owner.email };

        const row = await tx.emailChangeRequest.create({
          data: {
            userId,
            origin: input.origin,
            requestedById: actorId,
            reason: input.reason,
            newEmail: input.newEmail,
            newEmailNormalized: input.newEmailNormalized,
            newTokenHash: input.newTokenHash,
            oldTokenHash: input.oldTokenHash,
            requiresOld: input.origin === "USER",
            expiresAt: input.expiresAt,
            // Sıklık sınırı bu zamana göre hesaplanır; uygulama saatiyle yazılır (test saati ile gerçek saat karışmaz).
            createdAt: now,
          },
          select: rowSelect,
        });
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: input.origin === "ADMIN" ? "user.emailChange.manage" : "account.emailChange.manage",
          operation: input.origin === "ADMIN" ? "start" : "request",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: null,
          after: { requestId: row.id, origin: input.origin },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "created", row: row as EmailChangeRow, oldEmail: user.email };
      });
    },

    async latest(userId) {
      return (await prisma.emailChangeRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: rowSelect })) as EmailChangeRow | null;
    },

    async list(userId, limit) {
      if ((await prisma.user.count({ where: { id: userId } })) === 0) return null;
      return (await prisma.emailChangeRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: rowSelect })) as EmailChangeRow[];
    },

    async confirm(input) {
      const { tokenHash, now } = input;
      const found = await prisma.emailChangeRequest.findFirst({
        where: { OR: [{ newTokenHash: tokenHash }, { oldTokenHash: tokenHash }] },
        select: { id: true, userId: true },
      });
      if (!found) return { kind: "rejected", reason: "invalid" };
      try {
        return await prisma.$transaction(async (tx): Promise<ConfirmResult> => {
          const target = await lockTarget(tx, found.userId);
          if (!target) return { kind: "rejected", reason: "invalid" };
          const row = await tx.emailChangeRequest.findUniqueOrThrow({ where: { id: found.id } });
          const step = row.newTokenHash === tokenHash ? "new" : "old";
          if (row.status === "COMPLETED") return { kind: "applied", step, applied: null };
          if (row.status !== "OPEN") return { kind: "rejected", reason: "invalid" };
          if (row.expiresAt <= now) {
            await finish(tx, row.id, "EXPIRED", now);
            return { kind: "rejected", reason: "invalid" };
          }
          if (target.deleted) {
            await finish(tx, row.id, "CANCELLED", now, "account_erased");
            return { kind: "rejected", reason: "invalid" };
          }
          // Yönetici başlatmasında eski adres onayı gerekmez; o bağlantı yalnız "reddet" içindir.
          if (step === "old" && !row.requiresOld) return { kind: "waiting", step };

          const first = step === "new" ? row.newConfirmedAt === null : row.oldConfirmedAt === null;
          const newConfirmedAt = row.newConfirmedAt ?? (step === "new" ? now : null);
          const oldConfirmedAt = row.oldConfirmedAt ?? (step === "old" ? now : null);
          if (first) {
            await writeAudit(tx, {
              source: "API",
              actorId: row.userId,
              action: "account.emailChange.confirm",
              operation: step === "new" ? "verify" : "approve",
              target: { type: "USER", id: row.userId },
              reason: null,
              before: null,
              after: { requestId: row.id, origin: row.origin },
              requestId: input.requestId,
              at: now,
            });
          }
          const ready = newConfirmedAt !== null && (!row.requiresOld || oldConfirmedAt !== null);
          if (!ready) {
            if (first) await tx.emailChangeRequest.update({ where: { id: row.id }, data: { newConfirmedAt, oldConfirmedAt } });
            return { kind: "waiting", step };
          }

          const taken = await tx.user.findFirst({ where: { emailNormalized: row.newEmailNormalized!, id: { not: row.userId } }, select: { id: true } });
          if (taken) {
            await finish(tx, row.id, "FAILED", now, "email_taken");
            return { kind: "rejected", reason: "email_taken" };
          }
          const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId }, select: { email: true } });
          await tx.user.update({ where: { id: row.userId }, data: { email: row.newEmail!, emailNormalized: row.newEmailNormalized!, emailVerifiedAt: now } });
          await revokeAccess(tx, row.userId, now);
          await finish(tx, row.id, "COMPLETED", now, null, { newConfirmedAt, oldConfirmedAt });
          await writeAudit(tx, {
            source: "API",
            actorId: row.userId,
            action: "account.emailChange.confirm",
            operation: "apply",
            target: { type: "USER", id: row.userId },
            reason: null,
            before: null,
            after: { requestId: row.id, origin: row.origin },
            requestId: input.requestId,
            at: now,
          });
          return { kind: "applied", step, applied: { userId: row.userId, oldEmail: user.email, newEmail: row.newEmail! } };
        });
      } catch (err) {
        // Güncelleme anında başka bir kayıt aynı adresi aldı (kontrol ile yazma arasındaki dar yarış): talep FAILED olur.
        if (isUnique(err)) {
          await markFailed(found.id, "email_taken", now);
          return { kind: "rejected", reason: "email_taken" };
        }
        throw err;
      }
    },

    async deny(input) {
      const { tokenHash, now } = input;
      const found = await prisma.emailChangeRequest.findFirst({ where: { oldTokenHash: tokenHash }, select: { id: true, userId: true } });
      if (!found) return { kind: "rejected", reason: "invalid" };
      return prisma.$transaction(async (tx): Promise<DenyResult> => {
        const target = await lockTarget(tx, found.userId);
        if (!target) return { kind: "rejected", reason: "invalid" };
        const row = await tx.emailChangeRequest.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, userId: true, status: true, origin: true } });
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId }, select: { email: true } });
        if (row.status === "DENIED") return { kind: "denied", fresh: false, userId: row.userId, oldEmail: user.email };
        if (row.status === "COMPLETED") return { kind: "rejected", reason: "already_applied" };
        if (row.status !== "OPEN") return { kind: "rejected", reason: "invalid" };
        await finish(tx, row.id, "DENIED", now);
        // Eski adresin gerçek sahibi "ben değilim" dedi: hesap ele geçirilmiş olabilir, bütün oturumlar kapanır.
        await revokeAccess(tx, row.userId, now);
        await writeAudit(tx, {
          source: "API",
          actorId: row.userId,
          action: "account.emailChange.confirm",
          operation: "deny",
          target: { type: "USER", id: row.userId },
          reason: null,
          before: null,
          after: { requestId: row.id, origin: row.origin },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "denied", fresh: true, userId: row.userId, oldEmail: user.email };
      });
    },

    async cancelOwn(input) {
      const { userId, now } = input;
      return prisma.$transaction(async (tx): Promise<CancelResult> => {
        if (!(await lockTarget(tx, userId))) return { kind: "rejected", reason: "not_found" };
        const id = await cancelOpen(tx, userId, now);
        if (!id) return { kind: "unchanged" };
        await writeAudit(tx, {
          source: "API",
          actorId: input.actorId,
          action: "account.emailChange.manage",
          operation: "cancel",
          target: { type: "USER", id: userId },
          reason: null,
          before: null,
          after: { requestId: id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "cancelled" };
      });
    },

    async cancelByAdmin(input) {
      const { userId, actorId, now } = input;
      return prisma.$transaction(async (tx): Promise<CancelResult> => {
        if (!(await lockTarget(tx, userId))) return { kind: "rejected", reason: "not_found" };
        const role = (await tx.userRole.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
        const decision = await decide(tx, actorId, "user.emailChange.manage", { targetUserId: userId, targetRoles: role ? [role] : [] }, now);
        if (!decision.allowed) return { kind: "rejected", reason: "forbidden" };
        const id = await cancelOpen(tx, userId, now);
        if (!id) return { kind: "unchanged" };
        await writeAudit(tx, {
          source: "API",
          actorId,
          action: "user.emailChange.manage",
          operation: "cancel",
          target: { type: "USER", id: userId },
          reason: input.reason,
          before: null,
          after: { requestId: id },
          requestId: input.requestId,
          at: now,
        });
        return { kind: "cancelled" };
      });
    },

    async failSend(requestId, now) {
      await prisma.emailChangeRequest.updateMany({
        where: { id: requestId, status: "OPEN" },
        data: { status: "CANCELLED", failure: "mail_failed", newEmail: null, newEmailNormalized: null, finishedAt: now },
      });
    },
  };
}
