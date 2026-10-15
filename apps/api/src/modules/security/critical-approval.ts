// SA #182: pure, fail-closed second-approver eligibility policy.
// Controller MUST load roles and approval revision from DB under a transaction.
// Not an endpoint, not a bypass: decisions are only hints until persisted atomically.
export type PendingRoleApproval = Readonly<{
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  initiatorId: string;
  targetUserId: string;
  expectedRole: string;
  requestedRole: string;
  baseRevision: string;
  createdAtMs: number;
  expiresAtMs: number;
  approverIds: readonly string[];
}>;

export type ApprovalContext = Readonly<{
  approverId: string;
  approverHasFreshSuperAdminRole: boolean;
  /** Server-issued MFA step-up for this session, not a client-provided timestamp. */
  stepUpAtMs: number | null;
  targetUserId: string;
  currentRole: string;
  requestedRole: string;
  currentRevision: string;
  nowMs: number;
}>;

export type ApprovalDecision =
  | { allowed: true }
  | { allowed: false; reason: "closed" | "expired" | "invalid_context" | "self_approval" | "duplicate" | "role_required" | "stepup_required" };

export const APPROVAL_TTL_MS = 10 * 60 * 1000;
export const STEPUP_TTL_MS = 5 * 60 * 1000;

export function canApproveRoleChange(approval: PendingRoleApproval, ctx: ApprovalContext): ApprovalDecision {
  if (approval.status !== "PENDING") return { allowed: false, reason: "closed" };
  if (!Number.isFinite(ctx.nowMs) || !Number.isFinite(approval.createdAtMs) ||
      !Number.isFinite(approval.expiresAtMs) || ctx.nowMs < approval.createdAtMs ||
      ctx.nowMs >= approval.expiresAtMs || approval.expiresAtMs - approval.createdAtMs > APPROVAL_TTL_MS)
    return { allowed: false, reason: "expired" };
  if (ctx.targetUserId !== approval.targetUserId || ctx.currentRole !== approval.expectedRole ||
      ctx.requestedRole !== approval.requestedRole || ctx.currentRevision !== approval.baseRevision)
    return { allowed: false, reason: "invalid_context" };
  if (ctx.approverId === approval.initiatorId) return { allowed: false, reason: "self_approval" };
  if (approval.approverIds.includes(ctx.approverId)) return { allowed: false, reason: "duplicate" };
  if (!ctx.approverHasFreshSuperAdminRole) return { allowed: false, reason: "role_required" };
  if (ctx.stepUpAtMs === null || !Number.isFinite(ctx.stepUpAtMs) ||
      ctx.stepUpAtMs < approval.createdAtMs || ctx.stepUpAtMs > ctx.nowMs ||
      ctx.nowMs - ctx.stepUpAtMs > STEPUP_TTL_MS)
    return { allowed: false, reason: "stepup_required" };
  return { allowed: true };
}
