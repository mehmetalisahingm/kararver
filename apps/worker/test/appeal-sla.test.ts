import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { readAppealSlaWorkload } from "../src/jobs/moderation/appeal-sla.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
describe("#341 periodic SLA aggregate (PostgreSQL)", { skip: url ? false : "TEST_DATABASE_URL yok" }, () => {
  let db: PrismaClient;
  before(() => { db = migratedClient(url!); });
  after(async () => { await db?.$disconnect(); });
  test("pending, due soon, overdue; rejected and erased excluded; no mutations", async () => {
    const f = fixtures(db);
    const baseline = await readAppealSlaWorkload(db);
    const [moderator] = await f.users(1);
    const categoryId = await f.category();
    const now = Date.now();
    const day = 86400000;
    const ids: string[] = [];
    for (const [age, rejected, erased] of [[3,false,false],[13,false,false],[15,false,false],[16,true,false],[17,false,true]] as const) {
      const poll = await f.poll({ categoryId, opensAt: new Date(now - 20*day) });
      await db.poll.update({ where: { id: poll.id }, data: { status: "REMOVED" } });
      const action = await db.moderationAction.create({ data: { actorId: moderator!, action:"REMOVE",
        pollId:poll.id, fromStatus:"UNDER_REVIEW", toStatus:"REMOVED", reason:"Sentetik karar" } });
      ids.push(action.id);
      const filedAt = new Date(now-age*day);
      await db.moderationAppealWindow.create({ data: { rejectionActionId:action.id, recipientId:poll.authorId,
        notificationId:randomUUID(), deliveredAt:filedAt, deadlineAt:new Date(filedAt.getTime()+30*day),
        filedAt, filedReason:"Sentetik başvuru gerekçesi",
        ...(rejected ? { rejectedAt:new Date(now-day), rejectionReasonCode:"ORIGINAL_DECISION_UPHELD" } : {}) } });
      if (erased) await db.user.update({ where:{id:poll.authorId}, data:{deletedAt:new Date(now-day)} });
    }
    const beforeRows = await db.moderationAppealWindow.findMany({ where:{rejectionActionId:{in:ids}}, orderBy:{rejectionActionId:"asc"} });
    const result = await readAppealSlaWorkload(db);
    assert.deepEqual(result, {pending:baseline.pending+3,dueSoon:baseline.dueSoon+1,overdue:baseline.overdue+1});
    assert.deepEqual(await db.moderationAppealWindow.findMany({ where:{rejectionActionId:{in:ids}}, orderBy:{rejectionActionId:"asc"} }),beforeRows);
  });
});
