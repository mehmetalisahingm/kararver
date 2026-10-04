// Olay outbox'ı dağıtıcısı — KV-21 PR-2 (#23). Gerçek PostgreSQL.
// Test DB'si dosyalar arasında sıfırlanmaz ve dağıtma global çalışır (başka testlerin bıraktığı olaylar da dağıtılabilir);
// bu yüzden her test kendi tüketici adını kullanır ve doğrulamalar yalnız bu dosyanın olayları üzerinden yapılır.
// Olaylar başka hiçbir üreticinin yazmadığı poll.milestone tipindedir (sistem olayı, aktör NULL).
// Saat sahtedir (T): vade, backoff, kira ve saklama süreleri buna göre ilerletilir.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId, type DomainEvent, type EventType } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { cleanupEvents, RETENTION_DAYS } from "../src/jobs/events/cleanup.ts";
import { assertConsumers, PermanentEventError, productionConsumers, type EventConsumer } from "../src/jobs/events/consumers.ts";
import {
  dispatchBatch,
  LEASE_MS,
  MAX_ATTEMPTS,
  processNext,
  RETRY_DELAYS_MS,
  runDispatchLoop,
  type DispatchDeps,
  type ProcessOutcome,
} from "../src/jobs/events/dispatch.ts";
import { migratedClient, testDatabaseUrl } from "./support/db.ts";

const url = testDatabaseUrl();
const T = new Date("2031-06-01T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const later = (ms: number) => new Date(T.getTime() + ms);
const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

type Log = { level: string; message: string; fields: Record<string, unknown> };

describe("olay outbox'ı dağıtıcısı (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;

  before(() => {
    db = migratedClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });

  let milestone = 0;
  /** Bu dosyanın olayı: her biri kendi konusu ve doğal anahtarıyla. */
  function event(at = T, type: EventType = "poll.milestone"): DomainEvent {
    const subject = { type: "POLL" as const, id: randomUUID() };
    if (type === "role.changed") {
      return createEvent({ id: newEventId(at), type, occurredAt: at.toISOString(), actorId: randomUUID(), subject: { type: "USER", id: subject.id }, payload: { previousRoles: ["USER"], roles: ["MODERATOR"] } });
    }
    return createEvent({ id: newEventId(at), type: "poll.milestone", occurredAt: at.toISOString(), actorId: null, subject, payload: { metric: "VOTES", milestone: ++milestone } });
  }

  /** API writeEvent ile aynı kolon eşlemesi (apps/api/src/modules/events/write.ts). */
  const row = (e: DomainEvent, naturalKey: string | null = `${e.type}:${e.subject.id}`): Prisma.DomainEventCreateManyInput => ({
    id: e.id,
    type: e.type,
    version: e.version,
    occurredAt: new Date(e.occurredAt),
    actorId: e.actorId,
    subjectType: e.subject.type,
    subjectId: e.subject.id,
    payload: e.payload as Prisma.InputJsonObject,
    naturalKey,
  });

  async function insert(...events: DomainEvent[]): Promise<string[]> {
    await db.domainEvent.createMany({ data: events.map((e) => row(e)) });
    return events.map((e) => e.id);
  }

  function recorder(name: string, behavior?: (event: DomainEvent, attempt: number) => void | Promise<void>, types: EventType[] = ["poll.milestone"]) {
    const seen: { id: string; attempt: number }[] = [];
    const consumer: EventConsumer = {
      name: `${name}-${tag()}`,
      types,
      async handle(e, { attempt }) {
        await behavior?.(e, attempt);
        seen.push({ id: e.id, attempt });
      },
    };
    return { consumer, seen, of: (id: string) => seen.filter((s) => s.id === id) };
  }

  function deps(consumers: EventConsumer[], overrides: Partial<DispatchDeps> = {}): DispatchDeps & { logs: Log[] } {
    const logs: Log[] = [];
    return { prisma: db, consumers, now: () => T, log: (level, message, fields) => void logs.push({ level, message, fields }), ...overrides, logs };
  }

  /** Dağıt ve vadesi gelen her teslimi işle; iş kalmayınca dön. */
  async function drain(d: DispatchDeps): Promise<ProcessOutcome[]> {
    const outcomes: ProcessOutcome[] = [];
    for (;;) {
      const r = await dispatchBatch(d);
      let n = 0;
      for (let o = await processNext(d); o !== "none"; o = await processNext(d)) {
        outcomes.push(o);
        n++;
      }
      if (r.events === 0 && n === 0) return outcomes;
    }
  }

  const delivery = (eventId: string, consumer: string) => db.eventDelivery.findUniqueOrThrow({ where: { eventId_consumer: { eventId, consumer } } });
  const eventRow = (id: string) => db.domainEvent.findUnique({ where: { id } });

  test("dağıt + işle: tüketici olayı bir kez alır; teslim DONE, deneme 1; olay dağıtılmış", async () => {
    const rec = recorder("t.rec");
    const [id] = await insert(event());
    await drain(deps([rec.consumer]));
    assert.deepEqual(rec.of(id!), [{ id, attempt: 1 }]);
    const d = await delivery(id!, rec.consumer.name);
    assert.equal(d.status, "DONE");
    assert.equal(d.attempts, 1);
    assert.deepEqual(d.processedAt, T);
    assert.deepEqual((await eventRow(id!))!.dispatchedAt, T);
  });

  test("iki eşzamanlı dağıtıcı ve işleyici: 200 olayın her biri her tüketiciye tam bir kez (SKIP LOCKED)", async () => {
    const a = recorder("t.conc-a", () => sleep(1));
    const b = recorder("t.conc-b", () => sleep(1));
    const ids = await insert(...Array.from({ length: 200 }, () => event()));
    const d = deps([a.consumer, b.consumer]);
    await Promise.all([drain(d), drain(d)]);
    for (const r of [a, b]) {
      for (const id of ids) assert.equal(r.of(id).length, 1, `${r.consumer.name} ${id}`);
    }
    const rows = await db.eventDelivery.findMany({ where: { eventId: { in: ids } }, select: { status: true, attempts: true } });
    assert.equal(rows.length, 400);
    assert.ok(rows.every((r) => r.status === "DONE" && r.attempts === 1));
  });

  test("retry: başarısız tüketici backoff ile yeniden denenir, 8. hatada DEAD; aynı olaydaki diğer tüketici etkilenmez", async () => {
    const rec = recorder("t.ok");
    const [id] = await insert(event());
    const flaky = recorder("t.flaky", (e) => {
      if (e.id === id) throw new Error("geçici hata");
    });
    let now = T;
    const d = deps([rec.consumer, flaky.consumer], { now: () => now });
    await drain(d);
    assert.equal((await delivery(id!, rec.consumer.name)).status, "DONE", "diğer tüketici ilk turda DONE");
    assert.deepEqual(rec.of(id!), [{ id, attempt: 1 }]);

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await delivery(id!, flaky.consumer.name);
      assert.equal(row.status, "PENDING");
      assert.equal(row.attempts, attempt);
      assert.match(row.lastError!, /geçici hata/);
      assert.deepEqual(row.nextAttemptAt, new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]!));
      // Vadeden önce alınmaz.
      now = new Date(row.nextAttemptAt.getTime() - 1);
      await drain(d);
      assert.equal((await delivery(id!, flaky.consumer.name)).attempts, attempt);
      now = row.nextAttemptAt;
      await drain(d);
    }
    const dead = await delivery(id!, flaky.consumer.name);
    assert.equal(dead.status, "DEAD");
    assert.equal(dead.attempts, MAX_ATTEMPTS);
    assert.equal(dead.processedAt, null);
    assert.ok(d.logs.some((l) => l.level === "error" && l.message === "olay teslimi DEAD" && l.fields.eventId === id));
    // DEAD teslim bir daha alınmaz.
    now = new Date(now.getTime() + 365 * DAY);
    await drain(d);
    assert.equal((await delivery(id!, flaky.consumer.name)).attempts, MAX_ATTEMPTS);
    assert.equal(rec.of(id!).length, 1);
  });

  test("retry: 3. denemede başarılı olan tüketici DONE olur", async () => {
    const [id] = await insert(event());
    const flaky = recorder("t.third", (e, attempt) => {
      if (e.id === id && attempt < 3) throw new Error(`deneme ${attempt}`);
    });
    let now = T;
    const d = deps([flaky.consumer], { now: () => now });
    await drain(d);
    for (let i = 0; i < 2; i++) {
      now = (await delivery(id!, flaky.consumer.name)).nextAttemptAt;
      await drain(d);
    }
    const row = await delivery(id!, flaky.consumer.name);
    assert.equal(row.status, "DONE");
    assert.equal(row.attempts, 3);
    assert.deepEqual(flaky.of(id!), [{ id, attempt: 3 }]);
  });

  test("PermanentEventError: yeniden denenmeden DEAD", async () => {
    const [id] = await insert(event());
    const bad = recorder("t.perm", (e) => {
      if (e.id === id) throw new PermanentEventError("geçersiz veri");
    });
    const d = deps([bad.consumer]);
    assert.ok((await drain(d)).includes("dead"));
    const row = await delivery(id!, bad.consumer.name);
    assert.equal(row.status, "DEAD");
    assert.equal(row.attempts, 1);
    assert.match(row.lastError!, /PermanentEventError: geçersiz veri/);
  });

  test("kira dolumu: kiralayıp çöken işleyicinin teslimi kira bitince başka işleyiciye geçer; deneme sayılmıştır", async () => {
    const rec = recorder("t.lease");
    const [id] = await insert(event());
    await dispatchBatch(deps([rec.consumer]));
    // Çökmüş işleyicinin bıraktığı durum: deneme 1 sayıldı, vade = kiralama anı + kira.
    await db.eventDelivery.update({ where: { eventId_consumer: { eventId: id!, consumer: rec.consumer.name } }, data: { attempts: 1, nextAttemptAt: later(LEASE_MS) } });
    assert.equal(await processNext(deps([rec.consumer], { now: () => later(LEASE_MS - 1) })), "none");
    assert.equal(await processNext(deps([rec.consumer], { now: () => later(LEASE_MS) })), "done");
    assert.deepEqual(rec.of(id!), [{ id, attempt: 2 }]);
    assert.equal((await delivery(id!, rec.consumer.name)).attempts, 2);
  });

  test("fencing: kirası dolan işleyici geç kalırsa yazmaz; teslimi devralan işler (tüketici bir kez çağrılır)", async () => {
    const rec = recorder("t.fence");
    const [id] = await insert(event());
    await dispatchBatch(deps([rec.consumer]));
    let second: ProcessOutcome | undefined;
    const late = deps([rec.consumer], {
      afterClaim: async () => {
        // İlk işleyici kiralandıktan sonra duraksar; kira dolar ve ikinci işleyici devralır.
        second = await processNext(deps([rec.consumer], { now: () => later(LEASE_MS + 1000) }));
      },
    });
    assert.equal(await processNext(late), "lost");
    assert.equal(second, "done");
    assert.deepEqual(rec.of(id!), [{ id, attempt: 2 }]);
    const row = await delivery(id!, rec.consumer.name);
    assert.equal(row.status, "DONE");
    assert.equal(row.attempts, 2);
    assert.ok(late.logs.some((l) => l.level === "warn" && l.fields.eventId === id));
  });

  test("abonesiz olay: teslim açılmadan dağıtılmış sayılır", async () => {
    const rec = recorder("t.sub");
    const [id] = await insert(event(T, "role.changed"));
    await drain(deps([rec.consumer]));
    assert.deepEqual((await eventRow(id!))!.dispatchedAt, T);
    assert.equal(await db.eventDelivery.count({ where: { eventId: id! } }), 0);
    assert.equal(rec.of(id!).length, 0);
  });

  test("ayrıştırılamayan satır: dispatch_error alır, döngüye girmez, teslim açılmaz", async () => {
    const rec = recorder("t.bad");
    const e = event();
    await db.domainEvent.create({ data: { ...row(e), payload: { metric: "VOTES" } } }); // milestone eksik
    const d = deps([rec.consumer]);
    await drain(d);
    const stored = (await eventRow(e.id))!;
    assert.deepEqual(stored.dispatchedAt, T);
    assert.match(stored.dispatchError!, /payload: poll\.milestone: milestone/);
    assert.equal(await db.eventDelivery.count({ where: { eventId: e.id } }), 0);
    assert.ok(d.logs.some((l) => l.level === "error" && l.fields.eventId === e.id));
    const again = await dispatchBatch(d);
    assert.equal(again.unparseable, 0, "ikinci turda yeniden alınmaz");
  });

  test("producer commit etmeden olay görünmez; kilitli satır beklenmez (SKIP LOCKED)", async () => {
    const rec = recorder("t.tx");
    const d = deps([rec.consumer]);
    const e = event();
    let inserted!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((r) => (inserted = r));
    const gate = new Promise<void>((r) => (release = r));
    const producer = db.$transaction(async (tx) => {
      await tx.domainEvent.create({ data: row(e) });
      inserted();
      await gate;
    }, { timeout: 30_000 });
    await ready;
    await drain(d);
    assert.equal(rec.of(e.id).length, 0, "commit edilmemiş olay işlenmez");
    release();
    await producer;
    assert.equal((await eventRow(e.id))!.dispatchedAt, null);
    await drain(d);
    assert.equal(rec.of(e.id).length, 1);

    // Başka bir işlemin kilitlediği dağıtılmamış olay atlanır, dağıtıcı beklemez.
    const [locked] = await insert(event());
    let lockedReady!: () => void;
    let unlock!: () => void;
    const isLocked = new Promise<void>((r) => (lockedReady = r));
    const unlockGate = new Promise<void>((r) => (unlock = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM domain_events WHERE id = ${locked!}::uuid FOR UPDATE`;
      lockedReady();
      await unlockGate;
    }, { timeout: 30_000 });
    await isLocked;
    const started = performance.now();
    await dispatchBatch(d);
    assert.ok(performance.now() - started < 5_000, "dağıtıcı kilitli satırı beklemedi");
    assert.equal((await eventRow(locked!))!.dispatchedAt, null);
    unlock();
    await holder;
    await drain(d);
    assert.equal(rec.of(locked!).length, 1);
  });

  test("zarf değişmez (KV_DOMAIN_EVENTS_IMMUTABLE); dispatched_at yazılabilir, satır silinebilir", async () => {
    const [id] = await insert(event());
    await assert.rejects(db.domainEvent.update({ where: { id: id! }, data: { payload: { metric: "VOTES", milestone: 1 } } }), /KV_DOMAIN_EVENTS_IMMUTABLE/);
    await assert.rejects(db.domainEvent.update({ where: { id: id! }, data: { type: "poll.closed" } }), /KV_DOMAIN_EVENTS_IMMUTABLE/);
    await db.domainEvent.update({ where: { id: id! }, data: { dispatchedAt: T } });
    await db.domainEvent.delete({ where: { id: id! } });
    assert.equal(await eventRow(id!), null);
  });

  test("DB kısıtları: tip/konu/payload biçimi, tüketici adı, DONE ⇔ processed_at", async () => {
    const e = event();
    await assert.rejects(db.domainEvent.create({ data: { ...row(e), version: 2 } }), /domain_events_version_check/);
    await assert.rejects(db.domainEvent.create({ data: { ...row(e), subjectType: "VOTE" } }), /domain_events_subject_check/);
    await assert.rejects(db.domainEvent.create({ data: { ...row(e), type: "Poll Milestone" } }), /domain_events_type_check/);
    await assert.rejects(db.domainEvent.create({ data: { ...row(e), payload: [1, 2] } }), /domain_events_payload_object_check/);
    await insert(e);
    await assert.rejects(db.domainEvent.create({ data: { ...row(event()), naturalKey: `${e.type}:${e.subject.id}` } }), /natural_key|naturalKey|Unique constraint/);
    await assert.rejects(db.eventDelivery.create({ data: { eventId: e.id, consumer: "Kötü Ad", nextAttemptAt: T } }), /domain_event_deliveries_consumer_check/);
    await assert.rejects(db.eventDelivery.create({ data: { eventId: e.id, consumer: "t.done", status: "DONE", nextAttemptAt: T } }), /domain_event_deliveries_processed_check/);
  });

  test("saklama: 30 günden eski işlenmiş olay silinir; PENDING, DEAD, ayrıştırılamamış, dağıtılmamış ve yeni olan kalır", async () => {
    const old = later(-(RETENTION_DAYS + 1) * DAY);
    const recent = later(-(RETENTION_DAYS - 1) * DAY);
    const consumer = `t.keep-${tag()}`;
    const mk = async (dispatchedAt: Date | null, deliveries: { status: "PENDING" | "DONE" | "DEAD"; processedAt?: Date }[], dispatchError?: string) => {
      const e = event(old);
      await db.domainEvent.create({ data: { ...row(e), createdAt: old, dispatchedAt, dispatchError: dispatchError ?? null } });
      for (const [i, d] of deliveries.entries()) {
        await db.eventDelivery.create({ data: { eventId: e.id, consumer: `${consumer}${i}`, status: d.status, processedAt: d.processedAt ?? null, attempts: 1, nextAttemptAt: old } });
      }
      return e.id;
    };
    const doneOld = await mk(old, [{ status: "DONE", processedAt: old }, { status: "DONE", processedAt: old }]);
    const noConsumersOld = await mk(old, []);
    const doneRecent = await mk(old, [{ status: "DONE", processedAt: old }, { status: "DONE", processedAt: recent }]);
    const pending = await mk(old, [{ status: "DONE", processedAt: old }, { status: "PENDING" }]);
    const dead = await mk(old, [{ status: "DEAD" }]);
    const unparseable = await mk(old, [], "TypeError: Invalid domain event payload");
    const undispatched = await mk(null, []);
    const noConsumersRecent = await mk(recent, []);

    const logs: Log[] = [];
    const result = await cleanupEvents({ prisma: db, now: () => T, log: (level, message, fields) => void logs.push({ level, message, fields }), batchSize: 2 });
    for (const id of [doneOld, noConsumersOld]) assert.equal(await eventRow(id), null, `silinmeli: ${id}`);
    assert.equal(await db.eventDelivery.count({ where: { eventId: doneOld } }), 0, "teslimler cascade ile gider");
    for (const id of [doneRecent, pending, dead, unparseable, undispatched, noConsumersRecent]) assert.ok(await eventRow(id), `kalmalı: ${id}`);
    assert.ok(result.deleted >= 2);
    assert.ok(result.dead >= 1 && result.stalePending >= 1 && result.staleUndispatched >= 1 && result.unparseable >= 1);
    assert.ok(logs.some((l) => l.level === "warn" && l.message === "events.cleanup bitti"));
  });

  test("runDispatchLoop: süre dolana kadar dağıtır ve işler; durdurma sinyaliyle hemen çıkar", async () => {
    const rec = recorder("t.loop");
    const ids = await insert(event(), event(), event());
    const result = await runDispatchLoop({ ...deps([rec.consumer]), maxMs: 500, idleMs: 20 });
    for (const id of ids) assert.equal(rec.of(id).length, 1);
    assert.ok(result.outcomes.done >= 3);
    const stop = new AbortController();
    stop.abort();
    assert.equal((await runDispatchLoop({ ...deps([rec.consumer]), maxMs: 60_000, signal: stop.signal })).turns, 0);
  });

  test("tüketici kaydı: ad biçimi ve tekilliği, katalog tipleri; üretimde kayıtlı tüketici yok", () => {
    const ok: EventConsumer = { name: "notifications", types: ["poll.closed"], handle: async () => {} };
    assert.equal(assertConsumers([ok]).length, 1);
    assert.throws(() => assertConsumers([{ ...ok, name: "Bildirim" }]), TypeError);
    assert.throws(() => assertConsumers([ok, { ...ok }]), TypeError);
    assert.throws(() => assertConsumers([{ ...ok, types: [] }]), TypeError);
    assert.throws(() => assertConsumers([{ ...ok, types: ["poll.deleted" as EventType] }]), TypeError);
    assert.deepEqual(productionConsumers, []);
  });
});
