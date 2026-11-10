/**
 * KararVer V1 #290 — human appeal resolution TARGET, not a legal deadline.
 *
 * Customer filing: 30 days from actual delivery (appeal-window.ts).
 * Internal team resolution target: 14 calendar days from server-recorded
 * submittedAt (not rejection/notification/assignment time).
 * 14 days = 336 hours in UTC to avoid timezone/DST ambiguity.
 *
 * Overdue is for internal escalation ONLY: NEVER auto-reject, auto-approve,
 * reopen public content or charge/revoke application points.
 */
export const APPEAL_RESOLUTION_TARGET_DAYS = 14;
export const APPEAL_RESOLUTION_TARGET_MS = APPEAL_RESOLUTION_TARGET_DAYS * 24 * 60 * 60 * 1000;
export const APPEAL_FIRST_CHECK_DAYS = 7;
export const APPEAL_DUE_SOON_HOURS = 48;

export type AppealCaseStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";
export type ResolutionUrgency = "RESOLVED" | "OVERDUE" | "DUE_SOON" | "OPEN";

export type AppealSlaCase = {
  submittedAt: Date;
  status: AppealCaseStatus;
  resolvedAt: Date | null;
};

export function appealResolutionDueAt(submittedAt: Date): Date {
  if (!Number.isFinite(submittedAt.getTime())) throw new RangeError("invalid appeal submission time");
  return new Date(submittedAt.getTime() + APPEAL_RESOLUTION_TARGET_MS);
}

export function appealResolutionUrgency(input: AppealSlaCase, now: Date): ResolutionUrgency {
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid server time");
  if (input.status === "RESOLVED") return "RESOLVED";
  const left = appealResolutionDueAt(input.submittedAt).getTime() - now.getTime();
  if (left < 0) return "OVERDUE";
  if (left <= APPEAL_DUE_SOON_HOURS * 60 * 60 * 1000) return "DUE_SOON";
  return "OPEN";
}

export type AppealWorkload = {
  open: number;
  dueSoon: number;
  overdue: number;
  resolved: number;
  /** Oldest unresolved case, useful when choosing moderator shifts. */
  oldestUnresolvedAt: Date | null;
};

/** Aggregates only counters and oldest date; never user narratives or PII. */
export function summarizeAppealWorkload(cases: readonly AppealSlaCase[], now: Date): AppealWorkload {
  const summary: AppealWorkload = { open: 0, dueSoon: 0, overdue: 0, resolved: 0, oldestUnresolvedAt: null };
  for (const item of cases) {
    const urgency = appealResolutionUrgency(item, now);
    if (urgency === "RESOLVED") {
      summary.resolved++;
      continue;
    }
    summary.open++;
    if (urgency === "DUE_SOON") summary.dueSoon++;
    if (urgency === "OVERDUE") summary.overdue++;
    if (summary.oldestUnresolvedAt === null || item.submittedAt < summary.oldestUnresolvedAt)
      summary.oldestUnresolvedAt = item.submittedAt;
  }
  return summary;
}
