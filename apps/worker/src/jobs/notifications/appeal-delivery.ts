/**
 * #290 — Evidence of the first successful in-app MODERATION_APPLIED
 * notification delivery for a wrongful-review rejection.
 *
 * The outbox occurredAt and Notification.createdAt are EVENT timestamps,
 * not proof of delivery: never start the 30-day clock from those fields.
 * This is called only *after* writeNotifications in the same worker
 * transaction. If no recipient-specific notification was persisted, there
 * is no delivery row and the 30-day clock has NOT begun.
 *
 * The notification itself can be cleaned after 90 read days. This minimal
 * receipt survives independently until the separately approved retention
 * policy expires. It contains no free-text poll contents or email.
 */
import type { Prisma } from "@kararver/db";

export async function recordModerationRejectionInboxDelivery(
  tx: Prisma.TransactionClient,
  input: { eventId: string; rejectionActionId: string; pollId: string },
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO moderation_appeal_windows
      (rejection_action_id, recipient_id, notification_id, delivered_at, deadline_at)
    SELECT m.id, n.recipient_id, n.id, now(), now() + INTERVAL '30 days'
      FROM notifications n
      JOIN moderation_actions m ON m.id = ${input.rejectionActionId}::uuid
      JOIN polls p ON p.id = m.poll_id
     WHERE n.event_id = ${input.eventId}::uuid
       AND n.type = 'MODERATION_APPLIED'
       AND n.subject_type = 'POLL'
       AND n.subject_id = ${input.pollId}::uuid
       AND p.id = ${input.pollId}::uuid
       AND n.recipient_id = p.author_id
       AND m.action = 'REMOVE'
       AND m.from_status = 'UNDER_REVIEW'
       AND m.to_status = 'REMOVED'
       AND NOT EXISTS (
         SELECT 1 FROM account_erasures ae WHERE ae.user_id = n.recipient_id
       )
     ON CONFLICT (rejection_action_id) DO NOTHING`;
}
