import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const DAY = 24 * 60 * 60 * 1000;
const DELIVERED = new Date("2031-11-08T15:00:00.000Z");
const plus = (ms: number) => new Date(DELIVERED.getTime() + ms);

describe("14-day appeal case DB safety and moderator queue", { skip: url ? false : "TEST_DATABASE_URL yok" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let author: string;
  let otherUser: string;
  let moderator: string;
  let actionId: string;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
    [author, otherUser, moderator] = await f.users(3) as [string, string, string];
    const poll = await f.poll({
      authorId: author, categoryId: await f.category(), opensAt: DELIVERED,
    });
    const action = await db.moderationAction.create({
      data: { actorId: moderator, pollId: poll.id, action: "REMOVE",
        fromStatus: "UNDER_REVIEW", toStatus: "REMOVED", reason: "Review rejection test" },
    });
    actionId = action.id;
    await db.moderationAppealNoticeReceipt.create({
      data: { moderationActionId: actionId, recipientId: author, notificationId: randomUUID(),
        deliveredAt: DELIVERED, appealDeadlineAt: plus(30 * DAY) },
    });
  });

  after(async () => { await db?.$disconnect(); });

  test("server-recorded case has a 14-day target and initial OPEN status", async () => {
    const submittedAt = plus(DAY);
    const row = await db.moderationAppealCase.create({
      data: { rejectionActionId: actionId, appellantId: author, submittedAt,
        resolutionDueAt: new Date(submittedAt.getTime() + 14 * DAY) },
    });
    assert.equal(row.status, "OPEN");
    assert.equal(row.resolutionDueAt.getTime() - row.submittedAt.getTime(), 14 * DAY);
    const stored = await db.moderationAppealCase.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.appellantId, author);
    assert.equal(stored.rejectionActionId, actionId);
  });

  test("DB blocks impersonation, late filing and deadline tampering even if a future route has a bug", async () => {
    const submittedAt = plus(DAY);
    await assert.rejects(() => db.moderationAppealCase.create({
      data: { rejectionActionId: actionId, appellantId: otherUser, submittedAt,
        resolutionDueAt: new Date(submittedAt.getTime() + 14 * DAY) },
    }), /INVALID_APPEAL_RECEIPT|Prisma/i);
    const late = plus(30 * DAY + 1);
    await assert.rejects(() => db.moderationAppealCase.create({
      data: { rejectionActionId: actionId, appellantId: author, submittedAt: late,
        resolutionDueAt: new Date(late.getTime() + 14 * DAY) },
    }), /INVALID_APPEAL_RECEIPT|Prisma/i);
    const recorded = await db.moderationAppealCase.findFirstOrThrow({ where: { rejectionActionId: actionId, appellantId: author } });
    await assert.rejects(() => db.moderationAppealCase.update({
      where: { id: recorded.id },
      data: { resolutionDueAt: new Date(recorded.resolutionDueAt.getTime() + DAY) },
    }), /IMMUTABLE_APPEAL_FILING|Prisma/i);
    await assert.rejects(() => db.moderationAppealCase.create({
      data: { rejectionActionId: actionId, appellantId: author, submittedAt,
        resolutionDueAt: new Date(submittedAt.getTime() + 13 * DAY) },
    }), /moderation_appeal_cases_deadline_check|Prisma/i);
  });

  test("resolved case records reason-free outcome; SLA overrun does not auto-dispose unresolved appeals", async () => {
    const row = await db.moderationAppealCase.findFirstOrThrow({ where: { rejectionActionId: actionId, appellantId: author } });
    await db.moderationAppealCase.update({
      where: { id: row.id },
      data: { status: "RESOLVED", outcome: "ACCEPTED",
        resolvedAt: new Date(row.submittedAt.getTime() + 15 * DAY), resolvedById: moderator },
    });
    const saved = await db.moderationAppealCase.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(saved.outcome, "ACCEPTED");
    assert.equal(saved.resolutionDueAt.getTime(), row.resolutionDueAt.getTime(),
      "late human decision does not mutate target or silently reject");
    await assert.rejects(() => db.moderationAppealCase.update({
      where: { id: row.id }, data: { status: "OPEN", outcome: null, resolvedAt: null, resolvedById: null },
    }), /IMMUTABLE_APPEAL_RESOLUTION|Prisma/i);
    assert.equal(await db.moderationAppealCase.count({ where: { status: "OPEN", resolutionDueAt: { lt: new Date("2100-01-01") } } }), 0);
  });
});
