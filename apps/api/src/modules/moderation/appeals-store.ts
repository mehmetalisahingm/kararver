/**
 * #290 private moderation appeal filing.
 *
 * Only first confirmed owner-inbox delivery starts the 30 x 24 h clock.
 * The model's deliveredAt and deadlineAt are DB-created/immutable, never
 * supplied by the browser. An appealed decision may be evaluated after the
 * filing deadline. Filing is NOT a public poll restoration.
 */
import type { PrismaClient } from "@kararver/db";
import type { AppealRejectionReason } from "@kararver/contracts";
import type { z } from "zod";
import { writeAudit } from "../audit/write.ts";

type ReasonCode = z.infer<typeof AppealRejectionReason>;
type RejectedReceipt = { rejectionActionId: string; resolvedAt: Date; reason: ReasonCode };
type RejectResult = { kind: "ok"; receipt: RejectedReceipt } | { kind: "not_found" | "forbidden" | "conflict" };

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

export type AppealQueueRow = { rejectionActionId: string; pollId: string; filedAt: Date };
export type AppealAcceptedReceipt = { rejectionActionId: string; pollId: string; resolvedAt: Date };
export interface ModerationAppealStore {
  reject(input: { rejectionActionId: string; actorId: string; reason: ReasonCode; requestId: string }): Promise<RejectResult>;
  getRejected(userId: string, rejectionActionId: string): Promise<RejectedReceipt | null>;
  getAccepted(userId: string, rejectionActionId: string): Promise<AppealAcceptedReceipt | null>;
  listPending(input: { after: { at: Date; id: string } | null; limit: number }): Promise<{ rows: AppealQueueRow[]; evaluatedAt: Date }>;
  get(userId: string, rejectionActionId: string): Promise<(Receipt & { evaluatedAt: Date }) | null>;
  file(input: { userId: string; rejectionActionId: string; reason: string }): Promise<AppealFileResult>;
}

export function appealStatus(r: Receipt, now: Date): "OPEN" | "FILED" | "EXPIRED" {
  if (r.filedAt) return "FILED";
  return now.getTime() <= r.deadlineAt.getTime() ? "OPEN" : "EXPIRED";
}

export function createPrismaModerationAppealStore(prisma: PrismaClient, options: { testClock?: () => Date } = {}): ModerationAppealStore {
  // Production always uses PostgreSQL time, the source of the delivery receipt.
  // Test harnesses can explicitly inject a deterministic clock for boundary tests.
  async function dbNow(client: Pick<PrismaClient, "$queryRaw">): Promise<Date> {
    if (options.testClock) return options.testClock();
    const [row] = await client.$queryRaw<Array<{ evaluated_at: Date }>>`SELECT clock_timestamp()::timestamptz(3) AS evaluated_at`;
    if (!row) throw new Error("appeal_db_clock_unavailable");
    return row.evaluated_at;
  }
  return {
    async listPending({ after, limit }) {
      // Metadata only. No user ID, title, reason, or notification data.
      // Only ADMIN+ sees this global queue. A successful audited restore
      // or human rejection removes an item.
      const rows = await prisma.$queryRaw<AppealQueueRow[]>`
        SELECT w.rejection_action_id::text AS "rejectionActionId",
               m.poll_id::text AS "pollId", w.filed_at AS "filedAt"
        FROM moderation_appeal_windows w
        JOIN moderation_actions m ON m.id = w.rejection_action_id
        JOIN polls p ON p.id = m.poll_id AND p.author_id = w.recipient_id
        JOIN users u ON u.id = w.recipient_id AND u.deleted_at IS NULL
        WHERE w.filed_at IS NOT NULL AND w.rejected_at IS NULL AND p.status = 'REMOVED'
          AND m.action = 'REMOVE' AND m.from_status = 'UNDER_REVIEW' AND m.to_status = 'REMOVED'
          AND NOT EXISTS (
            SELECT 1 FROM moderation_actions undo
            WHERE undo.undo_of_id = m.id AND undo.action = 'RESTORE'
              AND undo.from_status = 'REMOVED' AND undo.to_status = 'ACTIVE'
          )
          AND (${after?.at ?? null}::timestamptz IS NULL OR
               (w.filed_at, w.rejection_action_id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
        ORDER BY w.filed_at ASC, w.rejection_action_id ASC
        LIMIT ${limit}`;
      return { rows, evaluatedAt: await dbNow(prisma) };
    },
    async getAccepted(userId, rejectionActionId) {
      // Only an immutable audited RESTORE linked to a timely filed appeal
      // proves acceptance. A later unrelated ACTIVE state is not proof.
      // No staff free text or identities are exposed by this read contract.
      const [row] = await prisma.$queryRaw<AppealAcceptedReceipt[]>`
        SELECT w.rejection_action_id::text AS "rejectionActionId",
          m.poll_id::text AS "pollId", undo.created_at AS "resolvedAt"
        FROM moderation_appeal_windows w
        JOIN users u ON u.id = w.recipient_id AND u.deleted_at IS NULL
        JOIN moderation_actions m ON m.id = w.rejection_action_id
        JOIN polls p ON p.id = m.poll_id AND p.author_id = w.recipient_id
        JOIN moderation_actions undo ON undo.undo_of_id = m.id AND undo.poll_id = m.poll_id
        WHERE w.recipient_id = ${userId}::uuid AND w.rejection_action_id = ${rejectionActionId}::uuid
          AND w.filed_at BETWEEN w.delivered_at AND w.deadline_at AND w.rejected_at IS NULL
          AND m.action = 'REMOVE' AND m.from_status = 'UNDER_REVIEW' AND m.to_status = 'REMOVED'
          AND undo.action = 'RESTORE' AND undo.from_status = 'REMOVED' AND undo.to_status = 'ACTIVE'
          AND undo.created_at >= w.filed_at`;
      return row ?? null;
    },
    async getRejected(userId, rejectionActionId) {
      const [row] = await prisma.$queryRaw<RejectedReceipt[]>`
        SELECT w.rejection_action_id::text AS "rejectionActionId",
               w.rejected_at AS "resolvedAt", w.rejection_reason_code AS reason
        FROM moderation_appeal_windows w
        JOIN users u ON u.id = w.recipient_id AND u.deleted_at IS NULL
        WHERE w.recipient_id = ${userId}::uuid AND w.rejection_action_id = ${rejectionActionId}::uuid
          AND w.rejected_at IS NOT NULL`;
      return row ?? null;
    },
    async reject({ rejectionActionId, actorId, reason, requestId }) {
      return prisma.$transaction(async (tx): Promise<RejectResult> => {
        const initial = await tx.moderationAppealWindow.findUnique({
          where: { rejectionActionId },
          select: { recipientId: true, rejection: { select: { pollId: true } } },
        });
        if (!initial?.rejection.pollId) return { kind: "not_found" };
        if (initial.recipientId === actorId) return { kind: "forbidden" };
        // User -> poll -> appeal window. Same poll lock as the audited undo.
        const [recipient] = await tx.$queryRaw<Array<{ deleted: boolean }>>`
          SELECT deleted_at IS NOT NULL AS deleted FROM users
           WHERE id = ${initial.recipientId}::uuid FOR NO KEY UPDATE`;
        if (!recipient || recipient.deleted) return { kind: "not_found" };
        const [poll] = await tx.$queryRaw<Array<{ status: string; author_id: string }>>`
          SELECT status::text, author_id::text FROM polls
           WHERE id = ${initial.rejection.pollId}::uuid FOR UPDATE`;
        if (!poll || poll.author_id !== initial.recipientId) return { kind: "not_found" };
        const [staff] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id
            WHERE u.id=${actorId}::uuid AND u.deleted_at IS NULL AND u.status='ACTIVE'
              AND r.role IN ('ADMIN','SUPER_ADMIN')) AS allowed`;
        if (!staff?.allowed) return { kind: "forbidden" };
        const [row] = await tx.$queryRaw<Array<{ filed_at: Date | null; delivered_at: Date; deadline_at: Date; rejected_at: Date | null; rejection_reason_code: ReasonCode | null }>>`
          SELECT filed_at, delivered_at, deadline_at, rejected_at, rejection_reason_code
          FROM moderation_appeal_windows WHERE rejection_action_id=${rejectionActionId}::uuid
          AND recipient_id=${initial.recipientId}::uuid FOR UPDATE`;
        if (!row) return { kind: "not_found" };
        if (row.rejected_at && row.rejection_reason_code) {
          if (row.rejection_reason_code !== reason) return { kind: "conflict" };
          return { kind: "ok", receipt: { rejectionActionId, resolvedAt: row.rejected_at, reason } };
        }
        if (!row.filed_at || row.filed_at < row.delivered_at || row.filed_at > row.deadline_at || poll.status !== "REMOVED")
          return { kind: "conflict" };
        const latest = await tx.moderationAction.findFirst({
          where: { pollId: initial.rejection.pollId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, action: true, fromStatus: true, toStatus: true, undoOfId: true },
        });
        if (latest?.id !== rejectionActionId || latest.action !== "REMOVE" ||
          latest.fromStatus !== "UNDER_REVIEW" || latest.toStatus !== "REMOVED" || latest.undoOfId !== null)
          return { kind: "conflict" };
        const now = await dbNow(tx);
        if (now < row.filed_at) return { kind: "conflict" };
        await tx.moderationAppealWindow.update({ where: { rejectionActionId }, data: { rejectedAt: now, rejectionReasonCode: reason } });
        await writeAudit(tx, { source: "API", actorId, action: "moderation.appeal.reject",
          operation: "reject", target: { type: "POLL", id: initial.rejection.pollId },
          reason, before: { appealStatus: "FILED" }, after: { appealStatus: "REJECTED", rejectionActionId },
          requestId, at: now });
        return { kind: "ok", receipt: { rejectionActionId, resolvedAt: now, reason } };
      });
    },
    async get(userId, rejectionActionId) {
      // Do not leak existence, reason or identity to unrelated accounts.
      const result = await prisma.moderationAppealWindow.findFirst({
        where: { rejectionActionId, recipientId: userId, recipient: { deletedAt: null } },
        select: { rejectionActionId: true, deliveredAt: true, deadlineAt: true, filedAt: true },
      });
      return result ? { ...result, evaluatedAt: await dbNow(prisma) } : null;
    },
    async file({ userId, rejectionActionId, reason }) {
      return prisma.$transaction(async (tx): Promise<AppealFileResult> => {
        // Same user-first lock as account erasure. A stale authenticated
        // request cannot reintroduce free text after successful erasure.
        const [recipient] = await tx.$queryRaw<Array<{ deleted: boolean }>>`
          SELECT deleted_at IS NOT NULL AS deleted FROM users
          WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
        if (!recipient || recipient.deleted) return { kind: "not_found" };
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
        // Check the clock after obtaining the receipt lock, not at request start.
        const lockedAt = await dbNow(tx);
        if (lockedAt.getTime() > original.deadlineAt.getTime()) return { kind: "expired" };
        if (lockedAt.getTime() < original.deliveredAt.getTime()) return { kind: "not_reviewable" };

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
        if (!action || !action.poll || action.poll.authorId !== userId ||
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

        // Re-read after eligibility checks so a long lock/query cannot produce
        // a filing timestamp outside the immutable delivery window.
        const now = await dbNow(tx);
        if (now.getTime() > original.deadlineAt.getTime()) return { kind: "expired" };
        if (now.getTime() < original.deliveredAt.getTime()) return { kind: "not_reviewable" };
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
