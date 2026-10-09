// KV-21 PR-3 (#23) — bildirim yazımının ham SQL koruması (gerçek PostgreSQL).
// writeNotifications satırları tek INSERT … SELECT unnest(...) ile yazar; kolon eşlemesini Prisma denetlemez. Bu test:
// - unnest yoluyla yazılan satırı Prisma ile geri okuyup bütün kolonları (type enum dahil) taslakla karşılaştırır ve
//   contracts NotificationView / notificationData şemasından geçirir; her NotificationType değeri DB enum'unda yazılabilir;
// - Prisma modelinin alan listesini ve tablonun kolon listesini sabitler: notifications'a kolon eklenir, kaldırılır veya
//   adı değişirse kırılır (INSERT'in de güncellenmesi gerekir);
// - aynı alıcı aynı dilimde iki kez gelse de (ör. anket sahibi aynı zamanda oy veren) tek satır yazıldığını gösterir.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { newEventId, NotificationType, NotificationView, notificationData } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { allowAll } from "../src/jobs/notifications/policy.ts";
import { writeNotifications, type NotificationDraft } from "../src/jobs/notifications/write.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-07-01T09:30:15.123Z");

/** INSERT'teki kolonlar + read_at (yazımda boş). */
const COLUMNS = ["actor_id", "created_at", "data", "dedupe_key", "event_id", "id", "poll_id", "read_at", "recipient_id", "subject_id", "subject_type", "type"];
const FIELDS = ["actorId", "createdAt", "data", "dedupeKey", "eventId", "id", "pollId", "readAt", "recipientId", "subjectId", "subjectType", "type"];

describe("bildirim yazımı: ham SQL koruması (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;

  before(() => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  after(async () => {
    await db?.$disconnect();
  });

  test("tablo ve model kolonları sabit: kolon eklenir/kaldırılır/adı değişirse INSERT de güncellenmeli", async () => {
    const rows = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'notifications' ORDER BY column_name`;
    assert.deepEqual(rows.map((r) => r.column_name), COLUMNS);
    assert.deepEqual(Object.keys(Prisma.NotificationScalarFieldEnum).sort(), FIELDS);
  });

  test("unnest ile yazılan satır Prisma ile birebir okunur ve contracts şemalarından geçer (bütün tipler)", async () => {
    const [recipient, actor] = await f.users(2);
    const poll = await f.poll({ opensAt: T, categoryId: await f.category(), authorId: actor! });
    const samples: Record<NotificationType, NotificationDraft["data"]> = {
      COMMENT_ON_POLL: {},
      REPLY_TO_COMMENT: { parentId: poll.optionId },
      ALTERNATIVE_ON_POLL: {},
      POLL_MILESTONE: { metric: "VOTES", milestone: 500 },
      POLL_TRENDING: { format: "WEEKLY_MOST_VOTED", rank: 4 },
      POLL_CLOSED: { reason: "OWNER" },
      DECISION_UPDATED: { first: false },
      MODERATION_APPLIED: { action: "HIDE", toStatus: "HIDDEN" },
      COMMUNITY_FEATURED: { communityId: poll.optionIds[1] },
      SANCTION_APPLIED: { sanctionType: "RESTRICT_COMMENTS", endsAt: "2031-07-08T09:30:15.123Z" },
      ANNOUNCEMENT_PUBLISHED: { level: "INFO" },
    };
    for (const type of NotificationType.options) {
      const draft: NotificationDraft = {
        type,
        eventId: newEventId(T),
        eventActorId: actor!,
        actorId: actor!,
        subject: { type: "COMMENT", id: poll.optionId },
        pollId: poll.id,
        data: samples[type],
        dedupeKey: `notifications:sql-guard:${type}:${newEventId()}`,
        createdAt: T,
      };
      assert.equal(await writeNotifications(db as unknown as Prisma.TransactionClient, draft, [recipient!], allowAll), 1, type);
      const row = await db.notification.findUniqueOrThrow({ where: { recipientId_dedupeKey: { recipientId: recipient!, dedupeKey: draft.dedupeKey } } });
      assert.deepEqual(
        { recipientId: row.recipientId, type: row.type, eventId: row.eventId, actorId: row.actorId, subjectType: row.subjectType, subjectId: row.subjectId, pollId: row.pollId, data: row.data, dedupeKey: row.dedupeKey, readAt: row.readAt, createdAt: row.createdAt },
        { recipientId: recipient, type, eventId: draft.eventId, actorId: actor, subjectType: "COMMENT", subjectId: poll.optionId, pollId: poll.id, data: draft.data, dedupeKey: draft.dedupeKey, readAt: null, createdAt: T },
        type,
      );
      // Kimlik UUIDv7 ve zaman bitleri bildirimin zamanı.
      assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(parseInt(row.id.replaceAll("-", "").slice(0, 12), 16), T.getTime());
      // API görünümü (notifications.list) bu satırdan kurulur.
      NotificationView.parse({
        id: row.id,
        type: row.type,
        subject: { type: row.subjectType, id: row.subjectId },
        actor: null,
        data: row.data,
        readAt: null,
        createdAt: row.createdAt.toISOString(),
      });
      notificationData[type].parse(row.data);
    }
  });

  test("aynı alıcı aynı dilimde iki kez gelse de tek satır (UNIQUE recipient_id + dedupe_key, ON CONFLICT DO NOTHING); retry 0 yazar", async () => {
    const [owner, voter] = await f.users(2);
    const draft: NotificationDraft = {
      type: "POLL_CLOSED",
      eventId: newEventId(T),
      eventActorId: null,
      actorId: null,
      subject: { type: "POLL", id: owner! },
      pollId: null,
      data: { reason: "EXPIRED" },
      dedupeKey: `notifications:sql-guard:dup:${newEventId()}`,
      createdAt: T,
    };
    const tx = db as unknown as Prisma.TransactionClient;
    assert.equal(await writeNotifications(tx, draft, [owner!, voter!, owner!], allowAll), 2);
    assert.equal(await writeNotifications(tx, draft, [owner!, voter!], allowAll), 0);
    assert.equal(await db.notification.count({ where: { dedupeKey: draft.dedupeKey } }), 2);
  });
});
