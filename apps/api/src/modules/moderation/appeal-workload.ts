// Read-only, aggregate-only source for the future ADMIN/MODERATOR internal
// appeal workload dashboard and SLA reminder worker. No recipient personal
// data, reasons, poll contents or case IDs leave this helper.
import type { PrismaClient } from "@kararver/db";
import type { AppealWorkload } from "./appeal-resolution-sla.ts";

export async function countModeratorAppealWorkload(prisma: PrismaClient, now: Date): Promise<AppealWorkload> {
  if (!Number.isFinite(now.getTime())) throw new RangeError("invalid workload clock");
  const dueSoon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<AppealWorkload[]>`
    SELECT
      count(*) FILTER (WHERE status <> 'RESOLVED')::int AS "open",
      count(*) FILTER (WHERE status <> 'RESOLVED'
          AND resolution_due_at >= ${now}::timestamptz
          AND resolution_due_at <= ${dueSoon}::timestamptz)::int AS "dueSoon",
      count(*) FILTER (WHERE status <> 'RESOLVED'
          AND resolution_due_at < ${now}::timestamptz)::int AS "overdue",
      count(*) FILTER (WHERE status = 'RESOLVED')::int AS "resolved",
      min(submitted_at) FILTER (WHERE status <> 'RESOLVED') AS "oldestUnresolvedAt"
    FROM moderation_appeal_cases`;
  return rows[0] ?? { open: 0, dueSoon: 0, overdue: 0, resolved: 0, oldestUnresolvedAt: null };
}
