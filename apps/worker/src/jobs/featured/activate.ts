// KV-42 (#44) scheduled featured and announcement publication.
// The API emits immediately-active records in the create/update transaction;
// future records are picked up at their start time by this minute-level worker.
// activatedAt is a durable one-time claim (independent of 30-day outbox cleanup).
// The update and event write happen in the SAME transaction. Parallel workers
// cannot emit twice, and failed writes roll back the activation marker.
import { createEvent, newEventId } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import type { EventLog } from "../events/consumers.ts";
import { writeWorkerEvent } from "../events/write.ts";

export const FEATURED_ACTIVATE_QUEUE = "featured.activate";
export const FEATURED_ACTIVATE_CRON = "* * * * *";
export const ACTIVATION_BATCH = 250;

export type ActivationDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: EventLog;
  batchSize?: number;
};
export type ActivationResult = {
  featuredCandidates: number;
  announcementCandidates: number;
  featuredEvents: number;
  announcementEvents: number;
  skipped: number;
  failed: number;
};

export async function activateFeatured(deps: ActivationDeps, placementId: string): Promise<number> {
  const at = deps.now();
  return deps.prisma.$transaction(async tx => {
    const claim = await tx.featuredPlacement.updateMany({
      where: { id: placementId, activatedAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
      data: { activatedAt: at },
    });
    if (claim.count !== 1) return 0;
    const row = await tx.featuredPlacement.findUniqueOrThrow({ where: { id: placementId } });
    // An admin may remove the poll after scheduling. Never notify for removed content.
    if (await tx.poll.count({ where: { id: row.pollId, status: { not: "REMOVED" } } }) !== 1) return 0;
    const details = {
      placementId: row.id, surface: row.surface, scopeId: row.scopeId,
      startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    };
    const featured = await writeWorkerEvent(tx, createEvent({
      id: newEventId(at), type: "featured.applied", occurredAt: at.toISOString(),
      actorId: row.createdBy, subject: { type: "POLL", id: row.pollId }, payload: details,
    }));
    if (row.surface === "COMMUNITY" && row.scopeId) {
      await writeWorkerEvent(tx, createEvent({
        id: newEventId(at), type: "community.featured", occurredAt: at.toISOString(),
        actorId: row.createdBy, subject: { type: "POLL", id: row.pollId },
        payload: {
          placementId: row.id, communityId: row.scopeId,
          startsAt: details.startsAt, endsAt: details.endsAt,
        },
      }));
    }
    return featured.written ? 1 : 0;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function activateAnnouncement(deps: ActivationDeps, announcementId: string): Promise<boolean> {
  const at = deps.now();
  return deps.prisma.$transaction(async tx => {
    const claim = await tx.announcement.updateMany({
      where: {
        id: announcementId, activatedAt: null, startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      },
      data: { activatedAt: at },
    });
    if (claim.count !== 1) return false;
    const row = await tx.announcement.findUniqueOrThrow({ where: { id: announcementId } });
    const event = await writeWorkerEvent(tx, createEvent({
      id: newEventId(at), type: "announcement.published", occurredAt: at.toISOString(),
      actorId: row.createdBy, subject: { type: "ANNOUNCEMENT", id: row.id },
      payload: {
        level: row.level, audience: row.audience, startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      },
    }));
    return event.written;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function activateScheduled(deps: ActivationDeps): Promise<ActivationResult> {
  const now = deps.now();
  const limit = deps.batchSize ?? ACTIVATION_BATCH;
  const [featuredRows, announcementRows] = await Promise.all([
    deps.prisma.featuredPlacement.findMany({
      where: { activatedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: limit, select: { id: true },
    }),
    deps.prisma.announcement.findMany({
      where: { activatedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: limit, select: { id: true },
    }),
  ]);
  const result: ActivationResult = {
    featuredCandidates: featuredRows.length, announcementCandidates: announcementRows.length,
    featuredEvents: 0, announcementEvents: 0, skipped: 0, failed: 0,
  };
  for (const row of featuredRows) {
    try {
      if (await activateFeatured(deps, row.id)) result.featuredEvents++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      deps.log("error", "featured activation failed", { placementId: row.id, error: String(error) });
    }
  }
  for (const row of announcementRows) {
    try {
      if (await activateAnnouncement(deps, row.id)) result.announcementEvents++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      deps.log("error", "announcement activation failed", { announcementId: row.id, error: String(error) });
    }
  }
  return result;
}
