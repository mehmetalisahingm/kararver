// #172: approved communities have seven days to reach ten distinct members.
// Transactional locks + actual membership count, safe across retries/concurrent joins.
import type { PrismaClient } from "@kararver/db";
import { writeWorkerAudit } from "../sanctions/audit.ts";

export const COMMUNITY_REQUESTS_EXPIRE_QUEUE = "communities.requests.expire";
export const COMMUNITY_REQUESTS_EXPIRE_CRON = "10 3 * * *"; // daily UTC
export const COMMUNITY_REQUEST_BATCH = 200;

export type CommunityRequestExpiryDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  batchSize?: number;
  afterLock?: (id: string) => Promise<void>;
};

export async function expireCommunityRequest(deps: CommunityRequestExpiryDeps, id: string): Promise<boolean> {
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const claim = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM community_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (!claim.length) return false;
    await deps.afterLock?.(id);
    const request = await tx.communityRequest.findUnique({ where: { id } });
    if (!request || request.status !== "APPROVED" || !request.communityId ||
      !request.approvalDeadline || request.approvalDeadline > now) return false;

    // Serialize with concurrent join and poll create. Their community locks
    // must see HIDDEN after this transaction commits.
    const community = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM communities
      WHERE id = ${request.communityId}::uuid FOR UPDATE`;
    if (!community.length || community[0]!.status !== "ACTIVE") return false;
    const memberCount = await tx.communityMembership.count({ where: { communityId: request.communityId } });
    if (memberCount >= 10) return false;

    await tx.community.update({ where: { id: request.communityId }, data: { status: "HIDDEN", memberCount } });
    await tx.communityRequest.update({ where: { id }, data: { status: "CLOSED", closedAt: now } });
    await writeWorkerAudit(tx, {
      source: "WORKER", actorId: null, action: "community.request.expire",
      target: { type: "COMMUNITY", id: request.communityId },
      before: { requestId: id, status: "ACTIVE", memberCount },
      after: { requestId: id, status: "HIDDEN", memberCount, reason: "seven-day-threshold" },
      requestId: null, at: now,
    });
    return true;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function expireCommunityRequests(deps: CommunityRequestExpiryDeps) {
  const rows = await deps.prisma.communityRequest.findMany({
    where: { status: "APPROVED", approvalDeadline: { lte: deps.now() } },
    orderBy: { approvalDeadline: "asc" },
    select: { id: true }, take: deps.batchSize ?? COMMUNITY_REQUEST_BATCH,
  });
  const result = { candidates: rows.length, closed: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    try {
      if (await expireCommunityRequest(deps, row.id)) result.closed++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      deps.log("error", "Topluluk süre dolumu hatası", { requestId: row.id, error: String(error) });
    }
  }
  return result;
}
