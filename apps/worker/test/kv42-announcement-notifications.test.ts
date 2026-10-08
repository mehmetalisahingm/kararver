import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createNotificationsConsumer } from "../src/jobs/notifications/consumer.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const log = () => {};
const now = new Date();

describe("KV-42 announcement fanout and recipient opt-outs (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok" }, () => {
  let db: PrismaClient;
  let author: string;
  let recipient: string;
  let optedOut: string;
  let announcementId: string;

  before(async () => {
    db = migratedClient(url!);
    const f = fixtures(db);
    [author, recipient, optedOut] = await f.users(3) as [string, string, string];
    const row = await db.announcement.create({
      data: {
        title: "Yeni beta duyurusu", body: "Takvim testi", audience: "AUTHENTICATED",
        level: "INFO", startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60 * 60_000),
        activatedAt: now, createdBy: author,
      },
    });
    announcementId = row.id;
    await db.notificationTypeOptOut.create({
      data: { userId: optedOut, type: "ANNOUNCEMENT_PUBLISHED" },
    });
  });
  after(async () => { await db?.$disconnect(); });

  test("user inbox receives one notification; author and opted-out user do not", async () => {
    const event = createEvent({
      id: newEventId(now),
      type: "announcement.published",
      occurredAt: now.toISOString(),
      actorId: author,
      subject: { type: "ANNOUNCEMENT", id: announcementId },
      payload: {
        level: "INFO", audience: "AUTHENTICATED",
        startsAt: new Date(now.getTime() - 60_000).toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      },
    });
    const consumer = createNotificationsConsumer({ slice: 20, limit: 5000 });
    for (let i = 0; i < 2; i++) {
      await db.$transaction(tx => consumer.handle(event, { tx, attempt: i + 1, log }), {
        maxWait: 10_000, timeout: 30_000,
      });
    }
    const filters = { type: "ANNOUNCEMENT_PUBLISHED" as const, subjectId: announcementId };
    assert.equal(await db.notification.count({ where: { ...filters, recipientId: recipient } }), 1);
    assert.equal(await db.notification.count({ where: { ...filters, recipientId: author } }), 0);
    assert.equal(await db.notification.count({ where: { ...filters, recipientId: optedOut } }), 0);
    const row = await db.notification.findFirstOrThrow({ where: { ...filters, recipientId: recipient } });
    assert.deepEqual(row.data, { level: "INFO" });
    assert.equal(row.subjectType, "ANNOUNCEMENT");
    assert.equal(row.actorId, null);
  });
});
