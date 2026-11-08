import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { newEventId } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { recordModerationRejectionInboxDelivery } from "../src/jobs/notifications/appeal-delivery.ts";
import { allowAll } from "../src/jobs/notifications/policy.ts";
import { writeNotifications, type NotificationDraft } from "../src/jobs/notifications/write.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();

describe("V1 ret bildirimi: 30 günlük gerçek teslim kanıtı (PostgreSQL)", {
  skip: url ? false : "TEST_DATABASE_URL yok",
}, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  before(() => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  after(async () => { await db?.$disconnect(); });

  test("ret olayı değil gerçek kullanıcı bildirimi yazılınca saat başlar, retry tarihi sıfırlamaz ve bildirim temizliği kanıtı silmez", async () => {
    const [owner, moderator, other] = await f.users(3);
    const poll = await f.poll({ categoryId: await f.category(), authorId: owner! });
    const rejection = await db.moderationAction.create({
      data: {
        actorId: moderator!, action: "REMOVE", pollId: poll.id,
        fromStatus: "UNDER_REVIEW", toStatus: "REMOVED",
        reason: "İnceleme kararı",
      },
    });
    const eventId = newEventId(new Date("2026-10-01T09:00:00.000Z"));
    const message: NotificationDraft = {
      type: "MODERATION_APPLIED",
      eventId,
      eventActorId: moderator!,
      actorId: null,
      subject: { type: "POLL", id: poll.id },
      pollId: poll.id,
      data: { action: "REMOVE", toStatus: "REMOVED" },
      dedupeKey: `appeal-delivery:${rejection.id}`,
      // This is the original moderation/event timestamp, NOT delivery time.
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
    };
    const tx = db as unknown as Prisma.TransactionClient;
    assert.equal(await recordModerationRejectionInboxDelivery(tx, {
      eventId, rejectionActionId: rejection.id, pollId: poll.id,
    }), 0, "no real inbox notification means no appeal timer");

    // A foreign recipient must not create an owner's legal deadline.
    assert.equal(await writeNotifications(tx, message, [other!], allowAll), 1);
    assert.equal(await recordModerationRejectionInboxDelivery(tx, {
      eventId, rejectionActionId: rejection.id, pollId: poll.id,
    }), 0);
    assert.equal(await db.moderationAppealWindow.count({ where: { rejectionActionId: rejection.id } }), 0);

    // The recipient-specific notification and window are created together.
    assert.equal(await db.$transaction(async t => {
      await writeNotifications(t, message, [owner!], allowAll);
      return recordModerationRejectionInboxDelivery(t, {
        eventId, rejectionActionId: rejection.id, pollId: poll.id,
      });
    }), 1);
    const receipt = await db.moderationAppealWindow.findUniqueOrThrow({ where: { rejectionActionId: rejection.id } });
    assert.equal(receipt.recipientId, owner);
    assert.equal(receipt.deadlineAt.getTime() - receipt.deliveredAt.getTime(), 30 * 24 * 60 * 60_000);
    assert.ok(receipt.deliveredAt.getTime() > message.createdAt.getTime(),
      "the October outbox event cannot backdate actual November delivery");

    assert.equal(await recordModerationRejectionInboxDelivery(tx, {
      eventId, rejectionActionId: rejection.id, pollId: poll.id,
    }), 0, "retry cannot reset first legal clock");
    const afterRetry = await db.moderationAppealWindow.findUniqueOrThrow({ where: { rejectionActionId: rejection.id } });
    assert.equal(afterRetry.deliveredAt.getTime(), receipt.deliveredAt.getTime());
    assert.equal(afterRetry.deadlineAt.getTime(), receipt.deadlineAt.getTime());

    await assert.rejects(db.moderationAppealWindow.update({
      where: { rejectionActionId: rejection.id }, data: { deadlineAt: new Date("2032-01-01T00:00:00Z") },
    }), /APPEAL_RECEIPT_IMMUTABLE/);

    // Notification retention may delete the old inbox item. The limited
    // delivery receipt survives independently; retention still needs legal approval.
    await db.notification.deleteMany({ where: { recipientId: owner!, eventId } });
    assert.equal(await db.moderationAppealWindow.count({ where: { rejectionActionId: rejection.id } }), 1);
  });
});
