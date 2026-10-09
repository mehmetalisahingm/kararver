// KV-21 PR-4a (#23) — worker üreticileri (gerçek PostgreSQL): polls.expire (poll.closed EXPIRED) ve trends.refresh'in
// listeye giriş olayları (poll.trending), worker olay yazıcısı. Test DB'si sıfırlanmaz ve job'lar global çalışır:
// doğrulamalar bu dosyanın anketleri üzerinden yapılır. Saat sahtedir (T, uzak gelecek), böylece başka testlerin
// anketleri bu dosyanın penceresine girmez.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId, parseEvent } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { writeWorkerEvent } from "../src/jobs/events/write.ts";
import { createNotificationsConsumer } from "../src/jobs/notifications/consumer.ts";
import { boundFrom, emitExpired, expirePolls, FIRST_RUN_LOOKBACK_MS, findExpired, LOOKBACK_MS } from "../src/jobs/polls/expire.ts";
import { emitTrendEntries, TRENDING_TOP_RANK } from "../src/jobs/trends/entries.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2032-03-01T12:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(T.getTime() + ms);

describe("KV-21 worker üreticileri (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
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

  const log = () => {};
  const closedEvents = (pollId: string) =>
    db.domainEvent.findMany({ where: { type: "poll.closed", subjectId: pollId }, select: { actorId: true, occurredAt: true, payload: true, naturalKey: true } });

  /** closes_at = T + closesIn; opens_at ondan iki gün önce (polls_window_check). */
  async function pollClosing(closesIn: number, extra: { closedAt?: Date } = {}) {
    const poll = await f.poll({ opensAt: at(closesIn - 2 * DAY), categoryId });
    await db.poll.update({ where: { id: poll.id }, data: { closesAt: at(closesIn), closedAt: extra.closedAt ?? null } });
    return poll;
  }

  /** Tartışma: süresizdir (closes_at NULL), kapanmaz; tür sonradan değiştirilemez (KV_POLL_KIND_IMMUTABLE). */
  async function discussion() {
    const [authorId] = await f.users(1);
    const s = randomUUID().replaceAll("-", "").slice(0, 12);
    return db.poll.create({
      data: { publicId: s, slug: `tartisma-${s}`, authorId: authorId!, categoryId, title: `Tartışma ${s}`, kind: "DISCUSSION", resultsVisibility: null, closesAt: null, opensAt: at(-2 * DAY) },
      select: { id: true },
    });
  }

  // ─── polls.expire ───────────────────────────────────────────

  test("alt sınır: hiç süre dolumu olayı yoksa son 1 saat; varsa max(şimdi − 7 gün, en eski olay)", () => {
    assert.deepEqual(boundFrom(null, T), at(-FIRST_RUN_LOOKBACK_MS));
    assert.deepEqual(boundFrom(at(-30 * DAY), T), at(-LOOKBACK_MS));
    assert.deepEqual(boundFrom(at(-2 * DAY), T), at(-2 * DAY), "deploy öncesi kapanışlar hiç olay üretmez");
  });

  test("polls.expire: süresi dolan anket için tek poll.closed EXPIRED (aktör yok, zaman closes_at); ikinci tur yeni olay yazmaz", async () => {
    const poll = await pollClosing(-5 * MIN);
    await expirePolls({ prisma: db, now: () => T, log });
    assert.deepEqual(await closedEvents(poll.id), [
      { actorId: null, occurredAt: at(-5 * MIN), payload: { reason: "EXPIRED", closedAt: at(-5 * MIN).toISOString() }, naturalKey: `poll.closed:${poll.id}` },
    ]);
    assert.equal((await findExpired(db, at(-DAY), T, 10_000)).includes(poll.id), false, "olayı olan anket aday değil");
    await expirePolls({ prisma: db, now: () => at(MIN), log });
    assert.equal((await closedEvents(poll.id)).length, 1);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { closedAt: true } })).closedAt, null, "closed_at'e dokunulmaz");
  });

  test("polls.expire: elle kapatılmış, süresi dolmamış, tartışma ve alt sınırdan eski anketler atlanır", async () => {
    const owner = await pollClosing(-5 * MIN, { closedAt: at(-DAY) });
    const future = await pollClosing(5 * MIN);
    const talk = await discussion();
    const old = await pollClosing(-10 * DAY);
    await expirePolls({ prisma: db, now: () => T, log });
    for (const p of [owner, future, talk, old]) assert.deepEqual(await closedEvents(p.id), [], p.id);
  });

  test("polls.expire: iki tur aynı anda aynı anketi işlerse tek olay (anket kilidi + natural key)", async () => {
    const poll = await pollClosing(-3 * MIN);
    const slow = { prisma: db, now: () => T, log, afterLock: async () => void (await sleep(150)) };
    const results = await Promise.all([emitExpired(slow, poll.id), emitExpired(slow, poll.id)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await closedEvents(poll.id)).length, 1);
  });

  test("polls.expire: elle kapatma ile aynı natural key; önce elle kapatılan anket için süre dolumu olay yazmaz", async () => {
    const poll = await pollClosing(-1 * MIN);
    // API closePoll'un yazdığı olay (aynı natural key); closed_at'i job koşulundan bağımsız sınamak için yalnız olay.
    await db.$transaction((tx) =>
      writeWorkerEvent(tx, createEvent({ id: newEventId(at(-2 * MIN)), type: "poll.closed", occurredAt: at(-2 * MIN).toISOString(), actorId: poll.authorId, subject: { type: "POLL", id: poll.id }, payload: { reason: "OWNER", closedAt: at(-2 * MIN).toISOString() } })),
    );
    assert.equal(await emitExpired({ prisma: db, now: () => T, log }, poll.id), false);
    assert.deepEqual((await closedEvents(poll.id)).map((e) => (e.payload as { reason: string }).reason), ["OWNER"]);
  });

  // ─── trends.refresh: listeye giriş ──────────────────────────

  let windowEnd = new Date("2033-01-01T00:00:00.000Z").getTime() + Math.floor(Math.random() * 1_000_000) * 5 * MIN;

  /** Uzak gelecekte (her test koşusunda farklı) başarılı bir çalıştırma: sıralama pollIds sırası. */
  async function run(format: "WEEKLY_MOST_VOTED", pollIds: string[]) {
    windowEnd += 5 * MIN;
    const r = await db.trendRun.create({
      data: { format, calculationVersion: 1, status: "SUCCEEDED", windowStart: new Date(windowEnd - 7 * DAY), windowEnd: new Date(windowEnd), startedAt: new Date(windowEnd), finishedAt: new Date(windowEnd) },
      select: { id: true },
    });
    await db.trendScore.createMany({ data: pollIds.map((pollId, i) => ({ runId: r.id, pollId, rank: i + 1, score: 100 - i, components: {} })) });
    return r.id;
  }
  const trendingEvents = (runId: string) =>
    db.domainEvent.findMany({ where: { type: "poll.trending", payload: { path: ["trendRunId"], equals: runId } }, orderBy: { id: "asc" }, select: { subjectId: true, payload: true, actorId: true } });

  test("trend: önceki çalıştırmada ilk 10'da olmayıp bu çalıştırmada ilk 10'a girenler için poll.trending; kalan ve düşen için yok", async () => {
    const polls = await Promise.all(Array.from({ length: 13 }, () => f.poll({ opensAt: at(-DAY), categoryId })));
    const ids = polls.map((p) => p.id);
    await run("WEEKLY_MOST_VOTED", ids.slice(0, 12)); // önceki: 0..9 ilk 10'da, 10 ve 11 dışarıda
    // şimdiki: 11 sıra 2'ye, 12 (yeni) sıra 5'e girer; 8 ve 9 ilk 10'dan düşer
    const order = [ids[0]!, ids[11]!, ids[1]!, ids[2]!, ids[12]!, ids[3]!, ids[4]!, ids[5]!, ids[6]!, ids[7]!, ids[8]!, ids[9]!];
    const current = await run("WEEKLY_MOST_VOTED", order);
    const n = await db.$transaction((tx) => emitTrendEntries(tx, { format: "WEEKLY_MOST_VOTED", runId: current, now: T }));
    assert.equal(n, 2);
    // Aynı anda üretilen UUIDv7'lerin sırası rastgele: sıraya göre karşılaştır.
    const byRank = (await trendingEvents(current)).sort((a, b) => (a.payload as { rank: number }).rank - (b.payload as { rank: number }).rank);
    assert.deepEqual(byRank.map((e) => [e.subjectId, e.payload, e.actorId]), [
      [ids[11], { format: "WEEKLY_MOST_VOTED", rank: 2, trendRunId: current }, null],
      [ids[12], { format: "WEEKLY_MOST_VOTED", rank: 5, trendRunId: current }, null],
    ]);
    assert.equal(TRENDING_TOP_RANK, 10);
  });

  test("trend: düşüp yeniden giren için yeni olay; bildirim anket + format başına tek (PR-3 tüketicisi)", async () => {
    const polls = await Promise.all(Array.from({ length: 11 }, () => f.poll({ opensAt: at(-DAY), categoryId })));
    const ids = polls.map((p) => p.id);
    const target = ids[10]!;
    const top10 = ids.slice(0, 10);
    await run("WEEKLY_MOST_VOTED", top10); // taban
    const enter1 = await run("WEEKLY_MOST_VOTED", [target, ...top10.slice(0, 9)]);
    const drop = await run("WEEKLY_MOST_VOTED", top10);
    const enter2 = await run("WEEKLY_MOST_VOTED", [target, ...top10.slice(0, 9)]);
    for (const runId of [enter1, drop, enter2]) await db.$transaction((tx) => emitTrendEntries(tx, { format: "WEEKLY_MOST_VOTED", runId, now: T }));
    assert.deepEqual((await trendingEvents(enter1)).map((e) => e.subjectId), [target]);
    assert.ok(!(await trendingEvents(drop)).some((e) => e.subjectId === target));
    assert.deepEqual((await trendingEvents(enter2)).map((e) => e.subjectId), [target]);

    const consumer = createNotificationsConsumer();
    const rows = await db.domainEvent.findMany({ where: { type: "poll.trending", subjectId: target } });
    assert.equal(rows.length, 2);
    for (const r of rows) {
      const event = parseEvent({ version: r.version, id: r.id, type: r.type, occurredAt: r.occurredAt.toISOString(), actorId: r.actorId, subject: { type: r.subjectType, id: r.subjectId }, payload: r.payload });
      await db.$transaction((tx) => consumer.handle(event, { tx, attempt: 1, log }));
    }
    assert.equal(await db.notification.count({ where: { type: "POLL_TRENDING", subjectId: target } }), 1);
  });

  test("trend: formatın önceki başarılı çalıştırması yoksa (ilk tur) olay üretilmez", async () => {
    // Paylaşımlı test DB'sinde "hiç önceki çalıştırma yok" durumu kurulamaz; sorgu katmanı sahte transaction'la sınanır.
    const writes: string[] = [];
    const tx = {
      $queryRaw: async () => [],
      domainEvent: { createMany: async (args: unknown) => void writes.push(JSON.stringify(args)) },
    } as unknown as Prisma.TransactionClient;
    assert.equal(await emitTrendEntries(tx, { format: "WEEKLY_MOST_VOTED", runId: randomUUID(), now: T }), 0);
    assert.deepEqual(writes, []);
  });
});
