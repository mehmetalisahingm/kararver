/**
 * #372 §4 (Utku): hesap silmenin yeniden deneme / yarış ve restore + silme tekrarı negatif testleri.
 *
 * Değişmez kurallar:
 * 1. Olay worker'ı (events.dispatch) silmeyle yarışırsa ya da silme transaction'ı yarıda düşüp yeniden denenirse,
 *    sonunda silinen kişiye bağlı olay, teslim veya oy kalmaz; yarım silme görünmez; tekrar denemede tek kayıt/audit.
 * 2. Yedekten dönen kopyada (silmeden önceki an) kişinin oyları, olayları ve teslimleri kapıda "dirilmiş" görünür;
 *    silme günlüğü tekrar uygulanınca hepsi gider, oy toplamları değişmez, silinmeyen kişi etkilenmez.
 *
 * Mevcut kapsam tekrar edilmedi: idempotent ikinci istek ve çift tıklama (account-erasure.test.ts), worker depo
 * yeniden denemesi (worker/test/account-erasure.test.ts), şifreli yedek → restore → kullanıcı/yorum/oturum tekrarı
 * (restore-drill.test.ts).
 *
 * Her describe kendi boş veritabanını açar ("<test>_rr_<run>_<ad>"); dağıtıcı global çalıştığı için başka test
 * dosyalarının olaylarına dokunmaz. Restore, PostgreSQL TEMPLATE kopyasıyla taklit edilir (pg_dump gerekmez); şifreli
 * yedek zinciri restore-drill.test.ts'de. Yalnız bu çalışmanın oluşturduğu veritabanları silinir. Veriler sentetiktir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId, type DomainEvent } from "@kararver/contracts";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import { dispatchBatch, processNext, type DispatchDeps } from "../../worker/src/jobs/events/dispatch.ts";
import type { EventConsumer } from "../../worker/src/jobs/events/consumers.ts";
import { createPrismaAccountErasureStore } from "../src/modules/account-erasure/prisma-store.ts";

const base = process.env.TEST_DATABASE_URL ?? null;
const skip = base ? false : "TEST_DATABASE_URL yok (CI'da çalışır)";
const dbPackage = path.resolve(import.meta.dirname, "../../../packages/db");
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const short = () => randomUUID().replaceAll("-", "").slice(0, 10);

type GateOutcome = { noResurrection: boolean; resurrected: Record<string, number>; retained: Record<string, number> };
type GateModule = { checkNoResurrection(db: PrismaClient, ids: string[]): Promise<GateOutcome> };

/** Bağlantıdan önce: yalnız yerel, sorgusuz, "_test" tabanlı adres; adlar çalışmaya özel. */
function dbUrl(rawUrl: string, name: string): string {
  const url = new URL(rawUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error("rr_not_local");
  if (url.search || url.hash) throw new Error("rr_url_query_not_allowed");
  const baseName = decodeURIComponent(url.pathname.slice(1));
  if (!IDENT.test(baseName) || !baseName.endsWith("_test") || !IDENT.test(name)) throw new Error("rr_name_invalid");
  url.pathname = `/${name}`;
  return url.toString();
}

/** Çalışmaya özel veritabanları: oluşturma, migration, sonunda yalnız bunları düşürme. */
function ownedDatabases(label: string) {
  const runId = short().slice(0, 8);
  const baseName = decodeURIComponent(new URL(base!).pathname.slice(1));
  const owned = new Set<string>();
  let admin: PrismaClient | undefined;
  const name = (suffix: string) => `${baseName}_rr_${runId}_${label}_${suffix}`;
  const exists = async (n: string) =>
    (await admin!.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${n}`)[0]!.n > 0;
  return {
    name,
    async open() {
      admin = createPrismaClient(dbUrl(base!, "postgres"));
    },
    /** Boş veritabanı + repodaki migration'lar. */
    async migrated(suffix: string): Promise<{ url: string; db: PrismaClient }> {
      const n = name(suffix);
      if (await exists(n)) throw new Error("rr_target_exists");
      await admin!.$executeRawUnsafe(`CREATE DATABASE "${n}"`);
      owned.add(n);
      const url = dbUrl(base!, n);
      const prismaCli = createRequire(path.join(dbPackage, "package.json")).resolve("prisma/build/index.js");
      const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: dbPackage, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      return { url, db: createPrismaClient(url) };
    },
    /** "Yedek": kaynağın o anki birebir kopyası (TEMPLATE). Kaynakta açık bağlantı olmamalı. */
    async snapshot(source: string, suffix: string): Promise<string> {
      const n = name(suffix);
      if (await exists(n)) throw new Error("rr_target_exists");
      await admin!.$executeRawUnsafe(`CREATE DATABASE "${n}" TEMPLATE "${source}"`);
      owned.add(n);
      return n;
    },
    async close() {
      if (!admin) return;
      for (const n of owned) if (IDENT.test(n)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}

async function user(db: PrismaClient, label = "rr") {
  const h = `${label}_${short()}`;
  return (await db.user.create({ data: { email: `${h}@example.test`, emailNormalized: `${h}@example.test`, username: h, usernameNormalized: h, displayName: "Sentetik", passwordHash: "x" } })).id;
}

async function poll(db: PrismaClient, authorId: string, categoryId: string) {
  return db.poll.create({
    data: { publicId: short().slice(0, 12), slug: "rr", authorId, categoryId, title: "Yeniden deneme anketi", closesAt: new Date("2031-01-01T00:00:00Z"),
      options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] } },
    select: { id: true, options: { orderBy: { position: "asc" }, select: { id: true } } },
  });
}

/** Oy, oy geçmişi ve sayaçlar aynı transaction'da (oy ucunun yazdığı satırlarla aynı biçim). */
async function vote(db: PrismaClient, userId: string, pollId: string, optionId: string, at: Date) {
  await db.$transaction(async (tx) => {
    const v = await tx.vote.create({ data: { pollId, optionId, userId, createdAt: at }, select: { id: true } });
    await tx.voteEvent.create({ data: { voteId: v.id, pollId, userId, type: "CAST", toOptionId: optionId, occurredAt: at } });
    await tx.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });
    await tx.poll.update({ where: { id: pollId }, data: { voteCount: { increment: 1 } } });
  });
}

/** API writeEvent ile aynı kolon eşlemesi; comment.created olayı yorumu yazanı actor_id olarak taşır. */
async function commentEvent(db: PrismaClient, actorId: string, pollId: string, at: Date): Promise<DomainEvent> {
  const commentId = (await db.comment.create({ data: { pollId, authorId: actorId, body: "Sentetik yorum" }, select: { id: true } })).id;
  const e = createEvent({ id: newEventId(at), type: "comment.created", occurredAt: at.toISOString(), actorId, subject: { type: "COMMENT", id: commentId }, payload: { pollId } });
  await db.domainEvent.create({ data: { id: e.id, type: e.type, version: e.version, occurredAt: new Date(e.occurredAt), actorId: e.actorId, subjectType: e.subject.type, subjectId: e.subject.id, payload: e.payload as never, naturalKey: `${e.type}:${e.subject.id}` } });
  return e;
}

/** Kişiye dört yoldan (aktör, USER konusu, payload, natural_key) bağlanan olay sayısı; kapıyla aynı tanım. */
async function linkedEvents(db: PrismaClient, userId: string): Promise<number> {
  const needle = `%${userId}%`;
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM domain_events
    WHERE actor_id = ${userId}::uuid OR (subject_type = 'USER' AND subject_id = ${userId})
       OR payload::text LIKE ${needle} OR natural_key LIKE ${needle}`;
  return row!.n;
}

const erase = (db: PrismaClient, userId: string, extra: { onDone?: (tx: unknown) => Promise<void> } = {}) =>
  createPrismaAccountErasureStore(db).anonymize({ userId, actorId: userId, self: true, requestId: randomUUID(), reason: "sentetik silme (#372 §4)", confirmUsername: "", now: new Date(), ...extra } as never);

describe("silme ile olay worker'ı: yarış ve yeniden deneme (postgres)", { skip }, () => {
  const dbs = ownedDatabases("w");
  let db: PrismaClient;
  let categoryId: string;
  const log: DispatchDeps["log"] = () => {};

  before(async () => {
    await dbs.open();
    ({ db } = await dbs.migrated("db"));
    categoryId = (await db.category.create({ data: { slug: `rr-${short()}`, name: "Yeniden deneme" } })).id;
  });
  after(async () => {
    await db?.$disconnect();
    await dbs.close();
  });

  /** Yalnız bu dosyanın olaylarına abone sahte tüketici; çağrıları sayar, hiçbir şey yazmaz. */
  function recorder(name: string) {
    const seen: string[] = [];
    const consumer: EventConsumer = { name, types: ["comment.created"], handle: async (event) => { seen.push(event.id); } };
    return { consumer, seen };
  }

  test("teslim kiralandıktan sonra hesap silinirse işleyici hiçbir şey yazmaz (lost), tüketici çağrılmaz, kişiye bağlı satır kalmaz", async () => {
    const author = await user(db);
    const subject = await user(db);
    const p = await poll(db, author, categoryId);
    const e = await commentEvent(db, subject, p.id, new Date());
    const { consumer, seen } = recorder(`rr-claim-${short()}`);
    const deps: DispatchDeps = { prisma: db, consumers: [consumer], now: () => new Date(), log };
    await dispatchBatch(deps);
    assert.equal(await db.eventDelivery.count({ where: { eventId: e.id } }), 1, "kurgu: teslim açıldı");

    let erasedInside = false;
    const outcome = await processNext({ ...deps, afterClaim: async (claim) => {
      if (claim.eventId !== e.id) return;
      assert.equal((await erase(db, subject)).kind, "anonymized");
      erasedInside = true;
    } });
    assert.ok(erasedInside, "silme kira ile işleme arasında çalıştı");
    assert.equal(outcome, "lost", "silinmiş teslim için hata ya da DEAD yazılmaz");
    assert.deepEqual(seen, [], "tüketici silinmiş kişinin olayını hiç görmez");
    assert.equal(await db.domainEvent.count({ where: { id: e.id } }), 0);
    assert.equal(await db.eventDelivery.count({ where: { eventId: e.id } }), 0);
    assert.equal(await linkedEvents(db, subject), 0);
    assert.equal(await processNext(deps), "none", "yeniden deneme kuyruğunda iz kalmaz");
  });

  test("tüketici işlerken başlayan silme teslimin bitmesini bekler; sonunda olay ve teslim yine silinmiş olur", async () => {
    const author = await user(db);
    const subject = await user(db);
    const p = await poll(db, author, categoryId);
    const e = await commentEvent(db, subject, p.id, new Date());
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let entered!: () => void;
    const inside = new Promise<void>((r) => { entered = r; });
    const name = `rr-slow-${short()}`;
    const consumer: EventConsumer = { name, types: ["comment.created"], handle: async (event) => {
      if (event.id !== e.id) return;
      entered();
      await gate;
    } };
    const deps: DispatchDeps = { prisma: db, consumers: [consumer], now: () => new Date(), log };
    await dispatchBatch(deps);

    const processing = processNext(deps);
    await inside;
    const erasing = erase(db, subject);
    // Silme teslim satırının kilidini bekler; tüketici bırakılınca ikisi de tamamlanır (kilitlenme yok).
    await new Promise((r) => setTimeout(r, 200));
    release();
    const [outcome, erased] = await Promise.all([processing, erasing]);
    assert.equal(outcome, "done");
    assert.equal(erased.kind, "anonymized");
    assert.equal(await db.domainEvent.count({ where: { id: e.id } }), 0);
    assert.equal(await db.eventDelivery.count({ where: { eventId: e.id } }), 0);
    assert.equal(await linkedEvents(db, subject), 0);
  });

  test("dağıtıcı ile silme aynı anda (beş tekrar): her sırada kişiye bağlı olay ve teslim kalmaz, tüketici en fazla bir kez çağrılır", async () => {
    for (let i = 0; i < 5; i++) {
      const author = await user(db);
      const subject = await user(db);
      const p = await poll(db, author, categoryId);
      const e = await commentEvent(db, subject, p.id, new Date());
      const { consumer, seen } = recorder(`rr-race-${i}-${short()}`);
      const deps: DispatchDeps = { prisma: db, consumers: [consumer], now: () => new Date(), log };
      const [, erased] = await Promise.all([
        (async () => { await dispatchBatch(deps); while ((await processNext(deps)) !== "none"); })(),
        erase(db, subject),
      ]);
      assert.equal(erased.kind, "anonymized");
      while ((await processNext(deps)) !== "none");
      assert.ok(seen.filter((id) => id === e.id).length <= 1, `tekrar ${i}: tüketici en fazla bir kez`);
      assert.equal(await db.domainEvent.count({ where: { id: e.id } }), 0, `tekrar ${i}: olay kalmadı`);
      assert.equal(await db.eventDelivery.count({ where: { eventId: e.id } }), 0, `tekrar ${i}: teslim kalmadı`);
      assert.equal(await linkedEvents(db, subject), 0, `tekrar ${i}`);
    }
  });

  test("silme transaction'ı son adımda düşerse hiçbir şey yarım kalmaz; yeniden deneme tamamlar ve tek kayıt/audit bırakır", async () => {
    const author = await user(db);
    const subject = await user(db);
    const p = await poll(db, author, categoryId);
    const at = new Date(Date.now() - 60_000);
    await vote(db, subject, p.id, p.options[0]!.id, at);
    const e = await commentEvent(db, subject, p.id, at);
    await db.session.create({ data: { userId: subject, tokenHash: short().padEnd(64, "a"), expiresAt: new Date("2031-01-01T00:00:00Z") } });
    const total = async () => (await db.poll.findUniqueOrThrow({ where: { id: p.id }, select: { voteCount: true } })).voteCount;
    const before = await total();

    // Çökme: transaction'ın en son adımında (olaylar silindikten ve audit yazıldıktan sonra) hata.
    await assert.rejects(erase(db, subject, { onDone: async () => { throw new Error("sentetik çökme"); } }), /sentetik çökme/);
    const u = await db.user.findUniqueOrThrow({ where: { id: subject }, select: { deletedAt: true, email: true } });
    assert.equal(u.deletedAt, null, "kullanıcı yarım anonimleşmedi");
    assert.match(u.email, /^rr_/);
    assert.equal(await db.vote.count({ where: { userId: subject } }), 1, "oy yerinde (geri alındı)");
    assert.equal(await db.domainEvent.count({ where: { id: e.id } }), 1, "olay silinmesi de geri alındı");
    assert.equal(await db.session.count({ where: { userId: subject } }), 1);
    assert.equal(await db.accountErasure.count({ where: { userId: subject } }), 0, "yarım silme kaydı yok");
    assert.equal(await db.auditLog.count({ where: { targetId: subject } }), 0, "yarım silmenin audit'i yok");
    assert.equal(await db.anonymousVoteGroup.count({ where: { pollId: p.id } }), 0);

    // Yeniden deneme: tam silme, sonra idempotent.
    assert.equal((await erase(db, subject)).kind, "anonymized");
    assert.equal((await erase(db, subject)).kind, "unchanged");
    assert.equal(await db.vote.count({ where: { userId: subject } }), 0);
    assert.equal(await db.voteEvent.count({ where: { userId: subject } }), 0);
    assert.equal(await linkedEvents(db, subject), 0);
    assert.equal(await db.session.count({ where: { userId: subject } }), 0);
    assert.equal(await db.accountErasure.count({ where: { userId: subject } }), 1, "tek silme kaydı");
    assert.equal(await db.auditLog.count({ where: { targetId: subject } }), 1, "tek audit");
    assert.equal(await total(), before, "oy toplamı değişmez");
    assert.equal(await db.anonymousVoteGroup.count({ where: { pollId: p.id } }), 1, "oy anonim gruba bir kez taşındı");
  });
});

describe("restore + silme tekrarı: oylar, olaylar ve teslimler (postgres)", { skip }, () => {
  const dbs = ownedDatabases("r");
  let gate: GateModule;

  before(async () => {
    await dbs.open();
    gate = (await import(pathToFileURL(path.join(dbPackage, "ops/restore-erasure-gate.mjs")).href)) as GateModule;
  });
  after(async () => { await dbs.close(); });

  test("yedekten dönen kopyada silinmiş kişinin oyları ve olayları kapıda görünür; tekrar uygulama hepsini siler, toplamlar ve başkaları değişmez", async () => {
    const { db: src } = await dbs.migrated("src");
    let subject: string, control: string, pollId: string, eventIds: string[], controlEvent: string;
    const totalsOf = async (db: PrismaClient) => db.pollOption.findMany({ where: { pollId }, orderBy: { position: "asc" }, select: { voteCount: true } });
    try {
      const author = await user(src);
      subject = await user(src);
      control = await user(src);
      const categoryId = (await src.category.create({ data: { slug: `rr-${short()}`, name: "Restore" } })).id;
      const p = await poll(src, author, categoryId);
      pollId = p.id;
      const at = new Date(Date.now() - 120_000);
      await vote(src, subject, p.id, p.options[0]!.id, at);
      await vote(src, control, p.id, p.options[1]!.id, new Date(at.getTime() + 1000));
      const mine = await commentEvent(src, subject, p.id, at);
      // Kimliği yalnız payload'da taşıyan olay (ör. yönetici oy geçersiz sayması) ve dağıtılmış teslimli olay.
      const viaPayload = createEvent({ id: newEventId(at), type: "vote.invalidated", occurredAt: at.toISOString(), actorId: author, subject: { type: "POLL", id: p.id }, payload: { voteId: randomUUID(), voterId: subject, optionId: p.options[0]!.id } } as never);
      await src.domainEvent.create({ data: { id: viaPayload.id, type: viaPayload.type, version: viaPayload.version, occurredAt: at, actorId: author, subjectType: "POLL", subjectId: p.id, payload: viaPayload.payload as never, dispatchedAt: at } });
      await src.eventDelivery.create({ data: { eventId: mine.id, consumer: "notifications", nextAttemptAt: at } });
      eventIds = [mine.id, viaPayload.id];
      controlEvent = (await commentEvent(src, control, p.id, at)).id;
    } finally {
      await src.$disconnect();
    }
    const srcName = dbs.name("src");

    // ── "Yedek" silmeden ÖNCE alınır.
    const restoreName = await dbs.snapshot(srcName, "restore");

    // ── Canlı tarafta silme.
    const live = createPrismaClient(dbUrl(base!, srcName));
    const restored = createPrismaClient(dbUrl(base!, restoreName));
    try {
      assert.equal((await erase(live, subject)).kind, "anonymized");
      const liveTotals = await totalsOf(live);
      assert.equal(await linkedEvents(live, subject), 0);

      // ── Kapı: kopya silmeden önceki an → oy ve olaylar dirilmiş görünür.
      const first = await gate.checkNoResurrection(restored, [subject]);
      assert.equal(first.noResurrection, false);
      assert.equal(first.resurrected.linkedVotes, 1, "oy kopyada kişiye bağlı");
      assert.equal(first.resurrected.actorEvents, 2, "aktör ve payload yoluyla iki olay");
      assert.equal(await restored.eventDelivery.count({ where: { eventId: eventIds[0]! } }), 1);

      // ── KV-48 7. adım: günlükteki kimlik kopyada yeniden silinir; ikinci tekrar idempotent.
      assert.equal((await erase(restored, subject)).kind, "anonymized");
      assert.equal((await erase(restored, subject)).kind, "unchanged");

      const second = await gate.checkNoResurrection(restored, [subject]);
      assert.equal(second.noResurrection, true, JSON.stringify(second.resurrected));
      assert.equal(await restored.vote.count({ where: { userId: subject } }), 0);
      assert.equal(await restored.voteEvent.count({ where: { userId: subject } }), 0);
      assert.equal(await restored.domainEvent.count({ where: { id: { in: eventIds } } }), 0);
      assert.equal(await restored.eventDelivery.count({ where: { eventId: eventIds[0]! } }), 0, "teslim satırı da gider");
      assert.equal(await linkedEvents(restored, subject), 0);

      // ── Oy toplamları canlıdakiyle aynı; kişinin oyu anonim gruba bir kez taşındı.
      assert.deepEqual(await totalsOf(restored), liveTotals);
      assert.equal(
        (await restored.anonymousVoteGroup.aggregate({ where: { pollId }, _sum: { multiplicity: true } }))._sum.multiplicity,
        (await live.anonymousVoteGroup.aggregate({ where: { pollId }, _sum: { multiplicity: true } }))._sum.multiplicity,
      );

      // ── Silinmeyen kişi etkilenmez.
      assert.equal(await restored.vote.count({ where: { userId: control } }), 1);
      assert.equal(await restored.domainEvent.count({ where: { id: controlEvent } }), 1);
      assert.equal((await gate.checkNoResurrection(restored, [control])).noResurrection, false, "kontrol: günlükte olmayan kimlik canlı");
    } finally {
      await live.$disconnect();
      await restored.$disconnect();
    }
  });
});
