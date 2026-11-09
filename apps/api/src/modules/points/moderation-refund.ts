// V1 #327 — one-time return of publishing points for human-rejected review submissions.
// Must run inside the SAME transaction as UNDER_REVIEW -> REMOVED moderation.
// Caller must first lock the poll row, then this function locks the points account.
// Uses a stable ledger key and never refunds more than the actual original charge.
import type { Prisma } from "@kararver/db";

type Tx = Prisma.TransactionClient;

/**
 * Returns the credited amount (zero when no PUBLISH charge existed).
 *
 * No credit for ordinary poll deletions, or for polls that were already public:
 * the moderator invokes this ONLY on the pending-review rejection transition.
 *
 * The account and append-only point ledger are modified atomically. The unique
 * (userId,idempotencyKey) index is a second guard against duplicated credits.
 * Do NOT log the poll text, moderation reason, account email or private content.
 */
export async function refundRejectedReviewPoints(
  tx: Tx,
  input: { pollId: string; authorId: string; now: Date },
): Promise<number> {
  const refundKey = `moderation-refund:${input.pollId}`;
  const existing = await tx.pointLedgerEntry.findUnique({
    where: { userId_idempotencyKey: { userId: input.authorId, idempotencyKey: refundKey } },
    select: { delta: true },
  });
  if (existing) return 0;

  const publish = await tx.pointLedgerEntry.findFirst({
    where: { userId: input.authorId, referenceId: input.pollId, reason: "PUBLISH", delta: { lt: 0 } },
    select: { delta: true },
  });
  // With a configured free/test publication cost no PUBLISH charge exists;
  // there is nothing to refund. Never fabricate a 10-point grant.
  if (!publish) return 0;
  const amount = -publish.delta;

  // Lock the author row before the points account, matching auth and publish
  // transactions. The ledger FK may otherwise take a user key-share lock
  // AFTER this path locks points, producing a cross-transaction deadlock.
  const authors = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM users WHERE id = ${input.authorId}::uuid FOR UPDATE`;
  if (authors.length !== 1) throw new Error("refund_author_missing");

  // Do not upsert here: a deleted account must not be resurrected or receive
  // new balances. If a charged account is unexpectedly gone, fail the entire
  // moderation transaction rather than silently losing the refund.
  const account = await tx.pointAccount.update({
    where: { userId: input.authorId },
    data: { balance: { increment: amount }, updatedAt: input.now },
    select: { balance: true },
  });
  await tx.pointLedgerEntry.create({
    data: {
      userId: input.authorId,
      delta: amount,
      balanceAfter: account.balance,
      reason: "MODERATION_REFUND",
      referenceId: input.pollId,
      idempotencyKey: refundKey,
      createdAt: input.now,
    },
  });
  return amount;
}
