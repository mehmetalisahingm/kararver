import { randomUUID } from "node:crypto";
import type { PrismaClient, Role } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { consumeFreshStepup } from "./stepup-guard.ts";

export type RoleApprovalView = {
  id: string; targetUserId: string; requestedRole: Role;
  status: "PENDING" | "APPROVED"; expiresAt: Date;
};
type Outcome = { kind: "ok"; data: RoleApprovalView } | { kind: "rejected"; reason: "forbidden" | "invalid" | "stale" };
export interface RoleApprovalStore {
  request(input: { actorId: string; sessionId: string; targetUserId: string; role: Role; reason: string; requestId: string; now: Date }): Promise<Outcome>;
  approve(input: { actorId: string; sessionId: string; approvalId: string; reason: string; requestId: string; now: Date }): Promise<Outcome>;
}

const TTL_MS = 10 * 60_000;
type ApprovalRow = {
  id: string; target_user_id: string; initiator_id: string; approved_by_id: string | null;
  expected_role: Role; requested_role: Role; reason: string; status: "PENDING" | "APPROVED" | "EXPIRED" | "CONSUMED" | "REJECTED";
  created_at: Date; expires_at: Date; expected_updated_at: Date | null;
};

export function createPrismaRoleApprovalStore(prisma: PrismaClient): RoleApprovalStore {
  return {
    async request(input) {
      return prisma.$transaction(async (tx) => {
        const actors = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
          WHERE u.id = ${input.actorId}::uuid AND ur.role = 'SUPER_ADMIN'
            AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`;
        if (actors.length !== 1 || input.actorId === input.targetUserId) return { kind: "rejected" as const, reason: "forbidden" as const };
        const subjects = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE id = ${input.targetUserId}::uuid
            AND deleted_at IS NULL FOR NO KEY UPDATE`;
        if (!subjects.length) return { kind: "rejected" as const, reason: "invalid" as const };
        const existing = await tx.userRole.findUnique({ where: { userId: input.targetUserId }, select: { role: true, updatedAt: true } });
        const oldRole = existing?.role ?? "USER";
        if (oldRole === input.role || (oldRole !== "SUPER_ADMIN" && input.role !== "SUPER_ADMIN"))
          return { kind: "rejected" as const, reason: "invalid" as const };
        if (!(await consumeFreshStepup(tx, input.actorId, input.sessionId, input.now)))
          return { kind: "rejected" as const, reason: "forbidden" as const };
        const id = randomUUID(), expiresAt = new Date(input.now.getTime() + TTL_MS);
        await tx.$executeRaw`
          INSERT INTO role_change_approvals
            (id, target_user_id, initiator_id, expected_role, expected_updated_at, requested_role,
              reason, created_at, expires_at, status)
          VALUES (${id}::uuid, ${input.targetUserId}::uuid, ${input.actorId}::uuid,
            ${oldRole}, ${existing?.updatedAt ?? null}::timestamptz, ${input.role}, ${input.reason},
            ${input.now}::timestamptz, ${expiresAt}::timestamptz, 'PENDING')`;
        await writeAudit(tx, { source: "API", actorId: input.actorId, action: "user.role.assign",
          operation: "request", target: { type: "USER", id: input.targetUserId },
          reason: input.reason, before: { role: oldRole }, after: { requestedRole: input.role, approvalId: id },
          requestId: input.requestId, at: input.now });
        return { kind: "ok" as const, data: { id, targetUserId: input.targetUserId, requestedRole: input.role as Role, status: "PENDING" as const, expiresAt } };
      });
    },
    async approve(input) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<ApprovalRow[]>`
          SELECT * FROM role_change_approvals WHERE id = ${input.approvalId}::uuid FOR UPDATE`;
        const approval = rows[0];
        if (!approval || approval.status !== "PENDING" || approval.expires_at <= input.now)
          return { kind: "rejected" as const, reason: "stale" as const };
        if (approval.initiator_id === input.actorId || approval.target_user_id === input.actorId)
          return { kind: "rejected" as const, reason: "forbidden" as const };
        const actors = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
          WHERE u.id = ${input.actorId}::uuid AND ur.role = 'SUPER_ADMIN'
            AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`;
        if (!actors.length || !(await consumeFreshStepup(tx, input.actorId, input.sessionId, input.now)))
          return { kind: "rejected" as const, reason: "forbidden" as const };
        await tx.$executeRaw`UPDATE role_change_approvals
          SET approved_by_id = ${input.actorId}::uuid, approved_at = ${input.now}::timestamptz, status = 'APPROVED'
          WHERE id = ${approval.id}::uuid AND status = 'PENDING'`;
        await writeAudit(tx, { source: "API", actorId: input.actorId, action: "user.role.assign",
          operation: "approve", target: { type: "USER", id: approval.target_user_id },
          reason: input.reason, before: { approvalId: approval.id, status: "PENDING" },
          after: { approvalId: approval.id, status: "APPROVED", requestedRole: approval.requested_role },
          requestId: input.requestId, at: input.now });
        return { kind: "ok" as const, data: { id: approval.id, targetUserId: approval.target_user_id,
          requestedRole: approval.requested_role, status: "APPROVED" as const, expiresAt: approval.expires_at } };
      });
    },
  };
}
