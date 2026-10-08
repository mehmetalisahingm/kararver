import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { activateAnnouncement, activateFeatured, activateScheduled } from "../src/jobs/featured/activate.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2032-08-01T12:00:00.000Z");
const at = (minute: number) => new Date(T.getTime() + minute * 60_000);
const log = () => {};

describe("KV-42 scheduled activation and outbox (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok" }, () => {
  let db: PrismaClient;
  let pollId = "";
  let userId = "";

  before(async () => {
    db = migratedClient(url!);
    const f = fixtures(db);
    const [owner] = await f.users(1);
    userId = owner!;
    const categoryId = await f.category();
    const poll = await f.poll({ opensAt: at(-120), categoryId, authorId: userId });
    pollId = poll.id;
  });
  after(async () => { await db?.$disconnect(); });

  test("scheduled COMMUNITY featured is silent before start; emitted only once at activation", async () => {
    const id = randomUUID();
    const communityId = randomUUID();
    await db.featuredPlacement.create({
      data: { id, pollId, surface: "COMMUNITY", scopeId: communityId, priority: 4,
        startsAt: at(5), endsAt: at(60), createdBy: userId },
    });
    const options = { prisma: db, now: () => at(0), log };
    assert.equal(await activateFeatured(options, id), 0);
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `community.featured:${id}` } }), 0);
    const due = { ...options, now: () => at(6) };
    const results = await Promise.all([activateFeatured(due, id), activateFeatured(due, id)]);
    assert.deepEqual(results.sort(), [0, 1]);
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `featured.applied:${id}` } }), 1);
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `community.featured:${id}` } }), 1);
    const row = await db.featuredPlacement.findUniqueOrThrow({ where: { id } });
    assert.deepEqual(row.activatedAt, at(6));
    assert.equal(await activateFeatured({ ...options, now: () => at(300) }, id), 0);
  });

  test("cancelled and removed placements never notify after start", async () => {
    const expiredId = randomUUID();
    const removedId = randomUUID();
    for (const id of [expiredId, removedId]) {
      await db.featuredPlacement.create({ data: {
        id, pollId, surface: "FEED_TOP", priority: 0,
        startsAt: at(5), endsAt: at(10), createdBy: userId,
      } });
    }
    assert.equal(await activateFeatured({ prisma: db, now: () => at(11), log }, expiredId), 0);
    await db.featuredPlacement.delete({ where: { id: removedId } });
    assert.equal(await activateFeatured({ prisma: db, now: () => at(6), log }, removedId), 0);
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `featured.applied:${expiredId}` } }), 0);
  });

  test("announcement publication is single and scheduled rather than at creation", async () => {
    const id = randomUUID();
    await db.announcement.create({ data: {
      id, title: "Planlı duyuru", body: "Üyelere duyuru", level: "INFO",
      audience: "AUTHENTICATED", startsAt: at(15), endsAt: at(40), createdBy: userId,
    } });
    assert.equal(await activateAnnouncement({ prisma: db, now: () => at(14), log }, id), false);
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `announcement.published:${id}` } }), 0);
    const active = { prisma: db, now: () => at(16), log };
    assert.deepEqual((await Promise.all([activateAnnouncement(active, id), activateAnnouncement(active, id)])).sort(), [false, true]);
    const events = await db.domainEvent.findMany({ where: { naturalKey: `announcement.published:${id}` } });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.subjectType, "ANNOUNCEMENT");
    assert.equal(await activateAnnouncement({ ...active, now: () => at(80) }, id), false);
  });

  test("scheduled worker picks due rows and safely skips an already activated record", async () => {
    const id = randomUUID();
    await db.announcement.create({ data: {
      id, title: "Worker test duyurusu", body: "Takvim kabulü", level: "WARNING",
      audience: "ALL", startsAt: at(100), endsAt: at(150), createdBy: userId,
    } });
    await activateScheduled({ prisma: db, now: () => at(99), log, batchSize: 1000 });
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `announcement.published:${id}` } }), 0);
    await activateScheduled({ prisma: db, now: () => at(101), log, batchSize: 1000 });
    await activateScheduled({ prisma: db, now: () => at(101), log, batchSize: 1000 });
    assert.equal(await db.domainEvent.count({ where: { naturalKey: `announcement.published:${id}` } }), 1);
  });
});
