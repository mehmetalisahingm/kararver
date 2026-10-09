// KV-21 PR-3 (#23) bildirim tüketicisi ve adapter'ları — gerçek PostgreSQL.
// Üreticiler (yorum, kapanış, kilometre taşı, trend, karar, moderasyon, öne çıkarma) PR-4'te gelir: olaylar burada contracts
// createEvent ile kurulur, DB verisi (anket, oy, yorum, kullanıcı) fixtures ile yazılır. sanction.applied'ın gerçek
// üreticisi var (PR-2): uçtan uca test API'nin yazdığı biçimde olay satırından dağıtıcı ile bildirime gider.
// Test DB'si sıfırlanmaz: doğrulamalar yalnız bu dosyanın olay kimlikleri ve kullanıcıları üzerinden yapılır.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId, NotificationView, type DomainEvent, type EventPayload, type EventType } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { PermanentEventError } from "../src/jobs/events/consumers.ts";
import { dispatchBatch, processNext } from "../src/jobs/events/dispatch.ts";
import { cleanupNotifications } from "../src/jobs/notifications/cleanup.ts";
import { createNotificationsConsumer, type NotificationsConsumerOptions } from "../src/jobs/notifications/consumer.ts";
import type { NotificationPolicy } from "../src/jobs/notifications/policy.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-08-01T10:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(T.getTime() + ms);

type Log = { level: string; message: string; fields: Record<string, unknown> };

describe("bildirim tüketicisi (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  let categoryId: string;

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
    categoryId = await f.category();
  });
  after(async () => {
    await db?.$disconnect();
  });

  function event<T extends EventType>(type: T, subject: { type: "POLL" | "COMMENT" | "USER"; id: string }, actorId: string | null, payload: EventPayload<T>, occurredAt = T): DomainEvent<T> {
    return createEvent({ id: newEventId(occurredAt), type, occurredAt: occurredAt.toISOString(), actorId, subject, payload });
  }

  /** Tüketiciyi teslim transaction'ı gibi çalıştırır. */
  async function deliver(e: DomainEvent, opts: NotificationsConsumerOptions = {}): Promise<Log[]> {
    const logs: Log[] = [];
    const consumer = createNotificationsConsumer(opts);
    await db.$transaction((tx) => consumer.handle(e, { tx, attempt: 1, log: (level, message, fields) => void logs.push({ level, message, fields }) }), { timeout: 60_000 });
    return logs;
  }

  const forEvent = (eventId: string) =>
    db.notification.findMany({
      where: { eventId },
      orderBy: { recipientId: "asc" },
      select: { recipientId: true, type: true, actorId: true, subjectType: true, subjectId: true, pollId: true, data: true, dedupeKey: true, createdAt: true },
    });
  const recipientsOf = async (eventId: string) => (await forEvent(eventId)).map((n) => n.recipientId);
  const sorted = (ids: (string | undefined)[]) => [...ids].map(String).sort();

  async function pollBy(authorId?: string) {
    return f.poll({ opensAt: at(-30 * DAY), categoryId, ...(authorId ? { authorId } : {}) });
  }
  async function comment(pollId: string, authorId: string, opts: { parentId?: string; kind?: "COMMENT" | "ALTERNATIVE"; status?: "ACTIVE" | "HIDDEN" | "REMOVED" } = {}) {
    return (
      await db.comment.create({
        data: { pollId, authorId, body: "yorum", parentId: opts.parentId ?? null, kind: opts.kind ?? "COMMENT", status: opts.status ?? "ACTIVE", deletedAt: opts.status === "REMOVED" ? T : null },
        select: { id: true },
      })
    ).id;
  }

  // ─── Yorum, cevap, öneri ────────────────────────────────────

  test("comment.created: anket sahibine COMMENT_ON_POLL; konu yorum, aktör yorumcu, created_at = occurredAt", async () => {
    const [owner, commenter] = await f.users(2);
    const poll = await pollBy(owner);
    const c = await comment(poll.id, commenter!);
    const e = event("comment.created", { type: "COMMENT", id: c }, commenter!, { pollId: poll.id }, at(5 * MIN));
    await deliver(e);
    assert.deepEqual(await forEvent(e.id), [
      { recipientId: owner, type: "COMMENT_ON_POLL", actorId: commenter, subjectType: "COMMENT", subjectId: c, pollId: poll.id, data: {}, dedupeKey: `notifications:${e.id}`, createdAt: at(5 * MIN) },
    ]);
  });

  test("yorum: kendi anketine yorum yapana bildirim yok; gizlenmiş/kaldırılmış yorum ve gizli anket için yok; yorum yoksa kalıcı hata", async () => {
    const [owner, commenter] = await f.users(2);
    const poll = await pollBy(owner);
    const own = await comment(poll.id, owner!);
    const e1 = event("comment.created", { type: "COMMENT", id: own }, owner!, { pollId: poll.id });
    await deliver(e1);
    assert.deepEqual(await recipientsOf(e1.id), []);
    for (const status of ["HIDDEN", "REMOVED"] as const) {
      const c = await comment(poll.id, commenter!, { status });
      const e = event("comment.created", { type: "COMMENT", id: c }, commenter!, { pollId: poll.id });
      await deliver(e);
      assert.deepEqual(await recipientsOf(e.id), [], status);
    }
    const hiddenPoll = await pollBy(owner);
    await db.poll.update({ where: { id: hiddenPoll.id }, data: { status: "HIDDEN" } });
    const c = await comment(hiddenPoll.id, commenter!);
    const e2 = event("comment.created", { type: "COMMENT", id: c }, commenter!, { pollId: hiddenPoll.id });
    await deliver(e2);
    assert.deepEqual(await recipientsOf(e2.id), []);
    await assert.rejects(deliver(event("comment.created", { type: "COMMENT", id: randomUUID() }, commenter!, { pollId: poll.id })), PermanentEventError);
  });

  test("comment.replied: üst yorumun sahibine REPLY_TO_COMMENT (anket sahibine değil); alternative.created: anket sahibine", async () => {
    const [owner, parentAuthor, replier] = await f.users(3);
    const poll = await pollBy(owner);
    const parent = await comment(poll.id, parentAuthor!);
    const reply = await comment(poll.id, replier!, { parentId: parent });
    const e = event("comment.replied", { type: "COMMENT", id: reply }, replier!, { pollId: poll.id, parentId: parent });
    await deliver(e);
    const [n] = await forEvent(e.id);
    assert.deepEqual([n?.recipientId, n?.type, n?.data], [parentAuthor, "REPLY_TO_COMMENT", { parentId: parent }]);
    assert.equal((await forEvent(e.id)).length, 1);

    const alt = await comment(poll.id, replier!, { kind: "ALTERNATIVE" });
    const a = event("alternative.created", { type: "COMMENT", id: alt }, replier!, { pollId: poll.id });
    await deliver(a);
    assert.deepEqual((await forEvent(a.id)).map((x) => [x.recipientId, x.type]), [[owner, "ALTERNATIVE_ON_POLL"]]);
  });

  // ─── Kilometre taşı, trend ──────────────────────────────────

  test("poll.milestone: yalnız sahibine; aynı eşik farklı olay kimliğiyle tek satır; listede olmayan eşik yazılmaz", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const m1 = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 100 });
    const m2 = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 100 }, at(MIN));
    await deliver(m1);
    await deliver(m2);
    const rows = await db.notification.findMany({ where: { recipientId: owner!, type: "POLL_MILESTONE" }, select: { data: true, actorId: true, eventId: true } });
    assert.deepEqual(rows, [{ data: { metric: "VOTES", milestone: 100 }, actorId: null, eventId: m1.id }]);
    const m25 = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 25 });
    await deliver(m25);
    assert.deepEqual(await recipientsOf(m25.id), []);
  });

  test("poll.trending: anket + format başına ömür boyu tek bildirim (farklı trend çalıştırmaları); farklı format ayrı", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const trend = (format: "DAILY_RISING" | "WEEKLY_MOVERS", rank: number, minutes: number) =>
      event("poll.trending", { type: "POLL", id: poll.id }, null, { format, rank, trendRunId: randomUUID() }, at(minutes * MIN));
    for (const e of [trend("DAILY_RISING", 3, 0), trend("DAILY_RISING", 1, 5), trend("DAILY_RISING", 2, 60 * 24 * 7), trend("WEEKLY_MOVERS", 5, 10)]) await deliver(e);
    const rows = await db.notification.findMany({ where: { recipientId: owner!, type: "POLL_TRENDING" }, orderBy: { createdAt: "asc" }, select: { data: true } });
    assert.deepEqual(rows.map((r) => r.data), [{ format: "DAILY_RISING", rank: 3 }, { format: "WEEKLY_MOVERS", rank: 5 }]);
  });

  // ─── Kapanış ve karar: fan-out ──────────────────────────────

  test("poll.closed: 2500 geçerli oy veren (3 dilim) + sahip; geçersiz, silinmiş, BANNED yazılmaz, SUSPENDED yazılır; retry ve ikinci kapanış yeni satır yazmaz", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const voters = await f.votes(poll, 2500, (i) => at(-20 * DAY + i));
    const [invalid, deleted, banned, suspended] = voters;
    await db.vote.update({ where: { pollId_userId: { pollId: poll.id, userId: invalid! } }, data: { invalidatedAt: T, invalidationReason: "test: geçersiz" } });
    await db.user.update({ where: { id: deleted! }, data: { deletedAt: T } });
    await db.user.update({ where: { id: banned! }, data: { status: "BANNED" } });
    await db.user.update({ where: { id: suspended! }, data: { status: "SUSPENDED" } });

    const e = event("poll.closed", { type: "POLL", id: poll.id }, null, { reason: "EXPIRED", closedAt: T.toISOString() });
    await deliver(e);
    const expected = sorted([owner, ...voters.filter((v) => v !== invalid && v !== deleted && v !== banned)]);
    assert.deepEqual(await recipientsOf(e.id), expected);
    assert.equal(expected.length, 2498);
    const ownerRows = await db.notification.findMany({ where: { recipientId: owner!, eventId: e.id } });
    assert.equal(ownerRows.length, 1, "sahip tek bildirim");
    assert.deepEqual(ownerRows[0]!.data, { reason: "EXPIRED" });

    await deliver(e); // retry
    const again = event("poll.closed", { type: "POLL", id: poll.id }, null, { reason: "EXPIRED", closedAt: T.toISOString() }, at(MIN));
    await deliver(again); // farklı kimlikle ikinci kapanış (doğal anahtar)
    assert.equal(await db.notification.count({ where: { dedupeKey: `notifications:poll.closed:${poll.id}` } }), 2498);
  });

  test("poll.closed: sahip kendi anketine oy veremez (KV_SELF_VOTE); OWNER kapattığında aktör sahip, kendine bildirim almaz", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    await assert.rejects(db.vote.create({ data: { pollId: poll.id, optionId: poll.optionId, userId: owner! } }), /KV_SELF_VOTE/);
    const voters = await f.votes(poll, 3, (i) => at(-DAY + i));
    const e = event("poll.closed", { type: "POLL", id: poll.id }, owner!, { reason: "OWNER", closedAt: T.toISOString() });
    await deliver(e);
    assert.deepEqual(await recipientsOf(e.id), sorted(voters));
    assert.ok((await forEvent(e.id)).every((n) => n.actorId === owner));
  });

  test("fan-out sınırı: en eski N oy veren seçilir, warn logu; retry aynı kümeyi seçer", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const voters = await f.votes(poll, 12, (i) => at(-DAY + i * 1000));
    const e = event("poll.closed", { type: "POLL", id: poll.id }, null, { reason: "EXPIRED", closedAt: T.toISOString() });
    const logs = await deliver(e, { slice: 2, limit: 5 });
    assert.deepEqual(await recipientsOf(e.id), sorted([owner, ...voters.slice(0, 5)]));
    assert.ok(logs.some((l) => l.level === "warn" && l.fields.eventId === e.id && l.fields.recipients === 5));
    await deliver(e, { slice: 2, limit: 5 });
    assert.equal((await forEvent(e.id)).length, 6);
  });

  test("decision.updated: bütün geçerli oy verenlere; seçim yazılmaz; iki güncelleme iki bildirim; sahip (aktör) almaz", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const voters = await f.votes(poll, 4, (i) => at(-DAY + i));
    const d1 = event("decision.updated", { type: "POLL", id: poll.id }, owner!, { chosenOptionId: poll.optionId, first: true });
    const d2 = event("decision.updated", { type: "POLL", id: poll.id }, owner!, { chosenOptionId: poll.optionIds[1], first: false }, at(MIN));
    await deliver(d1);
    await deliver(d2);
    assert.deepEqual(await recipientsOf(d1.id), sorted(voters));
    assert.deepEqual(await recipientsOf(d2.id), sorted(voters));
    assert.ok((await forEvent(d1.id)).every((n) => JSON.stringify(n.data) === JSON.stringify({ first: true })));
  });

  // ─── Moderasyon, öne çıkarma, yaptırım ──────────────────────

  test("moderation.applied: anket/yorum sahibine, aktör gizli, yorumda anket çözülür; moderatör kendi içeriğine almaz; politika muaf", async () => {
    const [owner, commenter, moderator] = await f.users(3);
    const poll = await pollBy(owner);
    const c = await comment(poll.id, commenter!, { status: "HIDDEN" });
    const dropAll: NotificationPolicy = async () => [];
    const payload = { moderationActionId: randomUUID(), action: "HIDE" as const, fromStatus: "ACTIVE" as const, toStatus: "HIDDEN" as const, reportId: null };
    const onPoll = event("moderation.applied", { type: "POLL", id: poll.id }, moderator!, payload);
    const onComment = event("moderation.applied", { type: "COMMENT", id: c }, moderator!, payload);
    await deliver(onPoll, { policy: dropAll });
    await deliver(onComment, { policy: dropAll });
    assert.deepEqual((await forEvent(onPoll.id)).map((n) => [n.recipientId, n.actorId, n.subjectType, n.pollId, n.data]), [[owner, null, "POLL", poll.id, { action: "HIDE", toStatus: "HIDDEN" }]]);
    assert.deepEqual((await forEvent(onComment.id)).map((n) => [n.recipientId, n.actorId, n.subjectType, n.pollId]), [[commenter, null, "COMMENT", poll.id]]);
    const self = event("moderation.applied", { type: "POLL", id: (await pollBy(moderator)).id }, moderator!, payload);
    await deliver(self);
    assert.deepEqual(await recipientsOf(self.id), []);
  });

  test("community.featured: yalnız anket sahibine (üyelere değil), aktör gizli", async () => {
    const [owner, admin] = await f.users(2);
    const poll = await pollBy(owner);
    const communityId = randomUUID();
    const e = event("community.featured", { type: "POLL", id: poll.id }, admin!, { placementId: randomUUID(), communityId, startsAt: T.toISOString(), endsAt: at(DAY).toISOString() });
    await deliver(e);
    assert.deepEqual((await forEvent(e.id)).map((n) => [n.recipientId, n.type, n.actorId, n.data]), [[owner, "COMMUNITY_FEATURED", null, { communityId }]]);
  });

  test("sanction.applied: WARNING ve RESTRICT_* kullanıcıya (aktör ve gerekçe yok), SUSPEND/BAN yazılmaz; politika muaf", async () => {
    const [user, admin] = await f.users(2);
    const dropAll: NotificationPolicy = async () => [];
    const sanction = (type: "WARNING" | "RESTRICT_POSTING" | "SUSPEND" | "BAN", endsAt: string | null) =>
      event("sanction.applied", { type: "USER", id: user! }, admin!, { sanctionId: randomUUID(), type, endsAt });
    const warning = sanction("WARNING", null);
    const restrict = sanction("RESTRICT_POSTING", at(7 * DAY).toISOString());
    const suspend = sanction("SUSPEND", at(DAY).toISOString());
    const ban = sanction("BAN", null);
    for (const e of [warning, restrict, suspend, ban]) await deliver(e, { policy: dropAll });
    assert.deepEqual((await forEvent(warning.id)).map((n) => [n.recipientId, n.type, n.actorId, n.subjectType, n.subjectId, n.pollId, n.data]), [
      [user, "SANCTION_APPLIED", null, "USER", user, null, { sanctionType: "WARNING", endsAt: null }],
    ]);
    assert.deepEqual((await forEvent(restrict.id)).map((n) => n.data), [{ sanctionType: "RESTRICT_POSTING", endsAt: at(7 * DAY).toISOString() }]);
    assert.deepEqual(await recipientsOf(suspend.id), []);
    assert.deepEqual(await recipientsOf(ban.id), []);
  });

  // ─── Ortak kurallar ─────────────────────────────────────────

  test("created_at = occurredAt: yeni olay önce, eski olay sonra işlense de liste olay zamanına göre sıralanır", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const newer = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 50 }, at(2 * DAY));
    const older = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 10 }, at(DAY));
    await deliver(newer);
    await deliver(older);
    // notifications.list sırası: created_at ↓, id ↓
    const list = await db.notification.findMany({ where: { recipientId: owner! }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { data: true, createdAt: true } });
    assert.deepEqual(list.map((n) => n.data), [{ metric: "VOTES", milestone: 50 }, { metric: "VOTES", milestone: 10 }]);
    assert.deepEqual(list.map((n) => n.createdAt), [at(2 * DAY), at(DAY)]);
  });

  test("ortak süzgeç: BANNED ve silinmiş sahibe yazılmaz, SUSPENDED / RESTRICTED sahibe yazılır", async () => {
    const cases = [["BANNED", false], ["SUSPENDED", true], ["RESTRICTED", true]] as const;
    for (const [status, expected] of cases) {
      const [owner] = await f.users(1);
      await db.user.update({ where: { id: owner! }, data: { status } });
      const e = event("poll.milestone", { type: "POLL", id: (await pollBy(owner)).id }, null, { metric: "VOTES", milestone: 10 });
      await deliver(e);
      assert.equal((await recipientsOf(e.id)).length, expected ? 1 : 0, status);
    }
    const [gone] = await f.users(1);
    const poll = await pollBy(gone);
    await db.user.update({ where: { id: gone! }, data: { deletedAt: T } });
    const e = event("poll.milestone", { type: "POLL", id: poll.id }, null, { metric: "VOTES", milestone: 10 });
    await deliver(e);
    assert.deepEqual(await recipientsOf(e.id), []);
  });

  test("politika kancası: düşürülen alıcı yazılmaz (fan-out dahil); politika tipi ve anketi alır", async () => {
    const [owner] = await f.users(1);
    const poll = await pollBy(owner);
    const voters = await f.votes(poll, 3, (i) => at(-DAY + i));
    const asked: { type: string; pollId: string | null }[] = [];
    const muteFirst: NotificationPolicy = async (_tx, { type, pollId, recipientIds }) => {
      asked.push({ type, pollId });
      return recipientIds.filter((id) => id !== voters[0]);
    };
    const e = event("poll.closed", { type: "POLL", id: poll.id }, null, { reason: "EXPIRED", closedAt: T.toISOString() });
    await deliver(e, { policy: muteFirst });
    assert.deepEqual(await recipientsOf(e.id), sorted([owner, voters[1], voters[2]]));
    assert.ok(asked.length >= 2 && asked.every((a) => a.type === "POLL_CLOSED" && a.pollId === poll.id));
  });

  // ─── Uçtan uca ──────────────────────────────────────────────

  test("uçtan uca: API'nin yazdığı sanction.applied satırı → dağıtıcı → notifications satırı (teslim DONE, deneme 1)", async () => {
    const [user, admin] = await f.users(2);
    const e = event("sanction.applied", { type: "USER", id: user! }, admin!, { sanctionId: randomUUID(), type: "WARNING", endsAt: null });
    // apps/api/src/modules/events/write.ts ile aynı kolon eşlemesi
    await db.domainEvent.create({
      data: { id: e.id, type: e.type, version: 1, occurredAt: new Date(e.occurredAt), actorId: e.actorId, subjectType: "USER", subjectId: user!, payload: e.payload as Prisma.InputJsonObject, naturalKey: `sanction.applied:${e.payload.sanctionId}` },
    });
    const deps = { prisma: db, consumers: [createNotificationsConsumer()], now: () => new Date(), log: () => {} };
    for (let r = await dispatchBatch(deps); r.events > 0; r = await dispatchBatch(deps));
    while ((await processNext(deps)) !== "none");
    const delivery = await db.eventDelivery.findUniqueOrThrow({ where: { eventId_consumer: { eventId: e.id, consumer: "notifications" } } });
    assert.equal(delivery.status, "DONE");
    assert.equal(delivery.attempts, 1);
    const [n] = await db.notification.findMany({ where: { eventId: e.id } });
    assert.ok(n);
    assert.equal(n.recipientId, user);
    NotificationView.parse({ id: n.id, type: n.type, subject: { type: n.subjectType, id: n.subjectId }, actor: null, data: n.data, readAt: null, createdAt: n.createdAt.toISOString() });
  });

  // ─── Saklama ────────────────────────────────────────────────

  test("saklama: okunmuş 90 gün sonra silinir, okunmamış kalır; silinmiş hesabın bildirimleri 30 gün sonra silinir", async () => {
    const [reader, goneOld, goneRecent] = await f.users(3);
    const now = at(400 * DAY);
    const row = async (recipientId: string, createdAt: Date, readAt: Date | null) =>
      (await db.notification.create({
        data: { recipientId, type: "POLL_MILESTONE", eventId: newEventId(), subjectType: "POLL", subjectId: randomUUID(), data: {}, dedupeKey: `notifications:cleanup:${newEventId()}`, createdAt, readAt },
        select: { id: true },
      })).id;
    const readOld = await row(reader!, at(300 * DAY), new Date(now.getTime() - 91 * DAY));
    const readRecent = await row(reader!, at(300 * DAY), new Date(now.getTime() - 89 * DAY));
    const unreadOld = await row(reader!, at(100 * DAY), null);
    const goneOldRows = [await row(goneOld!, at(390 * DAY), null), await row(goneOld!, at(390 * DAY), at(395 * DAY))];
    const goneRecentRow = await row(goneRecent!, at(390 * DAY), null);
    await db.user.update({ where: { id: goneOld! }, data: { deletedAt: new Date(now.getTime() - 31 * DAY) } });
    await db.user.update({ where: { id: goneRecent! }, data: { deletedAt: new Date(now.getTime() - 29 * DAY) } });

    const result = await cleanupNotifications({ prisma: db, now: () => now, log: () => {}, batchSize: 2 });
    const exists = async (id: string) => (await db.notification.count({ where: { id } })) === 1;
    assert.equal(await exists(readOld), false);
    for (const id of goneOldRows) assert.equal(await exists(id), false);
    for (const id of [readRecent, unreadOld, goneRecentRow]) assert.equal(await exists(id), true);
    assert.ok(result.read >= 1 && result.deletedAccounts >= 2);
  });
});
