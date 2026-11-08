/**
 * KararVer V1 #290: users can FILE a moderation appeal in the 30 days
 * after a provably delivered rejection notice reaches their inbox.
 *
 * This is NOT KVKK article 13's statutory data-subject response deadline.
 * Only the recorded notification delivery, NEVER event.createdAt, action
 * timestamp, readAt or queue time, starts this product-policy clock.
 */
export const APPEAL_WINDOW_HOURS = 30 * 24;
export const APPEAL_WINDOW_MS = APPEAL_WINDOW_HOURS * 60 * 60 * 1000;

export type AppealWindow =
  | { state: "NOT_DELIVERED"; deadlineAt: null }
  | { state: "OPEN"; deadlineAt: Date }
  | { state: "EXPIRED"; deadlineAt: Date };

/** Inclusive deadline. Submitted appeals must be stamped by the server. */
export function appealWindow(
  deliveredAt: Date | null,
  submittedAt: Date,
): AppealWindow {
  if (!deliveredAt) return { state: "NOT_DELIVERED", deadlineAt: null };
  if (!Number.isFinite(deliveredAt.getTime()) || !Number.isFinite(submittedAt.getTime())) {
    throw new RangeError("invalid appeal clock");
  }
  const deadlineAt = new Date(deliveredAt.getTime() + APPEAL_WINDOW_MS);
  return submittedAt.getTime() <= deadlineAt.getTime()
    ? { state: "OPEN", deadlineAt }
    : { state: "EXPIRED", deadlineAt };
}

/** An on-time appeal stays on time even when the moderator decides later. */
export function filedInTime(deliveredAt: Date | null, filedAt: Date): boolean {
  return appealWindow(deliveredAt, filedAt).state === "OPEN";
}
