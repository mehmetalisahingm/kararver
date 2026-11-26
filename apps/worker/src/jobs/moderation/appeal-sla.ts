// #341 — periodic aggregate operational warning, NOT an appeal decision.
import type { PrismaClient } from "@kararver/db";

export const APPEAL_SLA_QUEUE = "moderation.appeals.sla";
export const APPEAL_SLA_CRON = "0 * * * *";
export type AppealSlaWorkload = { pending: number; dueSoon: number; overdue: number };

/** A single read-only DB statement uses one clock and no identities or text. */
export async function readAppealSlaWorkload(prisma: Pick<PrismaClient, "$queryRaw">): Promise<AppealSlaWorkload> {
  const [row] = await prisma.$queryRaw<AppealSlaWorkload[]>`
    WITH observed AS (SELECT statement_timestamp() AS at),
    pending AS (
      SELECT w.filed_at
      FROM moderation_appeal_windows w
      JOIN users u ON u.id = w.recipient_id AND u.deleted_at IS NULL
      JOIN moderation_actions m ON m.id = w.rejection_action_id
      JOIN polls p ON p.id = m.poll_id AND p.author_id = w.recipient_id
      WHERE w.filed_at BETWEEN w.delivered_at AND w.deadline_at
        AND w.rejected_at IS NULL AND p.status = 'REMOVED'
        AND m.action = 'REMOVE' AND m.from_status = 'UNDER_REVIEW' AND m.to_status = 'REMOVED'
        AND NOT EXISTS (SELECT 1 FROM moderation_actions later WHERE later.poll_id=m.poll_id
          AND (later.created_at, later.id) > (m.created_at,m.id))
    )
    SELECT count(*)::int AS pending,
      count(*) FILTER (WHERE filed_at + interval '336 hours' >= at AND filed_at + interval '288 hours' <= at)::int AS "dueSoon",
      count(*) FILTER (WHERE filed_at + interval '336 hours' < at)::int AS overdue
    FROM pending CROSS JOIN observed`;
  if (!row) throw new Error("appeal_sla_measurement_unavailable");
  return { pending: row.pending, dueSoon: row.dueSoon, overdue: row.overdue };
}
