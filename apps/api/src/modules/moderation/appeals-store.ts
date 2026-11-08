/**
 * #290 private moderation appeal filing.
 *
 * Only first confirmed owner-inbox delivery starts the 30 x 24 h clock.
 * The model's deliveredAt and deadlineAt are DB-created/immutable, never
 * supplied by the browser. An appealed decision may be evaluated after the
 * filing deadline. Filing is NOT a public poll restoration.
 */
import type { PrismaClient } from "@kararver/db";

type Receipt = {
  rejectionActionId: string;
  deliveredAt: Date;
  deadlineAt: Date;
  filedAt: Date | null;
};
export type AppealFileResult =
  | { kind: "ok"; receipt: Receipt }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "not_reviewable" };

export interface ModerationAppealStore {
  get(userId: string, rejectionActionId: string): Promise<Receipt | null>;
  file(input: { userId: string; rejectionActionId: string; reason: string; now: Date }): Promise<AppealFileResult>;
}

export function appealStatus(r: Receipt, now: Date): "OPEN" | "FILED" | "EXPIRED" {
  if (r.filedAt) return "FILED";
  return now.getTime() <= r.deadlineAt.getTime() ? "OPEN" : "EXPIRED";
}

export function createPrismaModerationAppealStore(prisma: PrismaClient): ModerationAppealStore {
  return {
    async get(userId, rejectionActionId) {
      // Do not leak existence, reason or identity to unrelated accounts.
      const result = await prisma.moderationAppealWindow.findFirst({
        where: { rejectionActionId, recipientId: userId },
        select: { rejectionActionId: true, deliveredAt: true, deadlineAt: true, filedAt: true },
      });
      return result;
    },
    async file({ userId, rejectionActionId, reason, now }) {
      return prisma.$transaction(async (tx): Promise<AppealFileResult> => {
        // Serialize repeated user submissions with a row-level lock. A
        // competing retry can never overwrite the first filing timestamp.
        const [receipt] = await tx.$queryRaw<Array<{
          rejection_action_id: string;
          delivered_at: Date;
          deadline_at: Date;
          filed_at: Date | null;
        }>>`
          SELECT rejection_action_id::text, delivered_at, deadline_at, filed_at
            FROM moderation_appeal_windows
           WHERE rejection_action_id = ${rejectionActionId}::uuid AND recipient_id = ${userId}::uuid
             FOR UPDATE`;
        if (!receipt) return { kind: "not_found" };
        const original: Receipt = {
          rejectionActionId, deliveredAt: receipt.delivered_at,
          deadlineAt: receipt.deadline_at, filedAt: receipt.filed_at,
        };
        if (original.filedAt) return { kind: "ok", receipt: original };
        if (now.getTime() > original.deadlineAt.getTime()) return { kind: "expired" };
        if (now.getTime() < original.deliveredAt.getTime()) return { kind: "not_reviewable" };

        // A user can only appeal the rejection of their OWN still-removed
        // poll; deleted accounts and superseded ret decisions fail closed.
        const action = await tx.moderationAction.findUnique({
          where: { id: rejectionActionId },
          select: {
            action: true, fromStatus: true, toStatus: true,
            pollId: true, undoOfId: true,
            poll: { select: { authorId: true, status: true, author: { select: { deletedAt: true } } } },
          },
        });
        if (!action || action.poll?.authorId !== userId ||
            action.action !== "REMOVE" || action.fromStatus !== "UNDER_REVIEW" ||
            action.toStatus !== "REMOVED" || action.undoOfId !== null ||
            action.poll.status !== "REMOVED" || action.poll.author.deletedAt !== null) {
          return { kind: "not_reviewable" };
        }
        const latest = await tx.moderationAction.findFirst({
          where: { pollId: action.pollId! },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (latest?.id !== rejectionActionId) return { kind: "not_reviewable" };

        const saved = await tx.moderationAppealWindow.update({
          where: { rejectionActionId },
          data: { filedAt: now, filedReason: reason },
          select: { rejectionActionId: true, deliveredAt: true, deadlineAt: true, filedAt: true },
        });
        return { kind: "ok", receipt: saved };
      });
    },
  };
}
