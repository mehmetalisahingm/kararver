/**
 * KV-21 PR-4a (#23) — bildirim olaylarının API üreticileri (gerçek PostgreSQL): yorum / cevap / öneri, oy kilometre taşı,
 * elle kapatma. Her üretici için: olay katalog payload'ıyla birebir yazılır; mutation geri alınınca olay yoktur; tekrar eden
 * işlem tek olay üretir. Dağıtım ve bildirim: kv21-e2e.test.ts.
 *
 * "Geri alınınca olay yok" için test, domain_events'e yalnız işaretlenen konular için hata veren geçici bir AFTER INSERT
 * trigger'ı kurar: olay INSERT'i hata verince mutation'ın transaction'ı geri alınır; ne mutation satırı ne olay kalır.
 * Trigger dosyanın sonunda kaldırılır (db.integration testi trigger listesini sabitler).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CommentView, ErrorBody, parseEvent, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; json(): any };

describe("KV-21 üreticileri: yorum, kilometre taşı, kapanış (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let owner: User;
  let alice: User;
  let bob: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `kv21-${randomUUID().slice(0, 8)}`, name: "KV-21" } })).id;
    [owner, alice, bob] = [await signUp(), await signUp(), await signUp()];
    await dropFailTrigger();
    await db.$executeRawUnsafe(`CREATE TABLE kv21_test_fail_events (id text PRIMARY KEY)`);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION kv21_test_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM kv21_test_fail_events f WHERE f.id = NEW.subject_id OR f.id = NEW.payload->>'pollId') THEN
          RAISE EXCEPTION 'KV21_TEST_FAIL: olay yazımı test için reddedildi';
        END IF;
        RETURN NEW;
      END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER kv21_test_fail_event AFTER INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION kv21_test_fail_event()`);
  });
  after(async () => {
    if (db) await dropFailTrigger();
    await h?.close();
  });

  async function dropFailTrigger() {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS kv21_test_fail_event ON domain_events`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS kv21_test_fail_event()`);
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS kv21_test_fail_events`);
  }

  /** Bu konu (anket/yorum) için olay yazımı run boyunca hata verir. */
  async function failingEventsFor<T>(id: string, run: () => Promise<T>): Promise<T> {
    await db.$executeRawUnsafe(`INSERT INTO kv21_test_fail_events (id) VALUES ($1)`, id);
    try {
      return await run();
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM kv21_test_fail_events WHERE id = $1`, id);
    }
  }

  function send(method: "POST" | "PUT", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `kv21_${id}@example.test`, username: `kv21_${id}`, displayName: "Olay", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie((login as unknown as { headers: Record<string, string> }).headers["set-cookie"]!), id: login.json().data.id };
  }

  async function createPoll(overrides: Record<string, unknown> = {}) {
    const body = {
      kind: "POLL",
      title: `KV-21 olay anketi ${randomUUID().slice(0, 8)}`,
      categoryId,
      durationHours: 24,
      resultsVisibility: "ALWAYS",
      options: [{ label: "Evet" }, { label: "Hayır" }],
      ...overrides,
    };
    const res = await send("POST", "/polls", body, owner.cookie, `kv21-${randomUUID()}`);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  const comment = (pollId: string, body: Record<string, unknown>, cookie = alice.cookie, key?: string) => send("POST", `/polls/${pollId}/comments`, body, cookie, key);
  const vote = (pollId: string, optionId: string, cookie: string) => send("PUT", `/polls/${pollId}/vote`, { optionId }, cookie);

  /** Konuya ait olaylar (yazılış sırasıyla), contracts parseEvent'ten geçirilerek. */
  async function eventsAbout(where: { subjectId?: string; pollId?: string; type?: string }) {
    const rows = await db.domainEvent.findMany({
      where: {
        ...(where.type ? { type: where.type } : {}),
        ...(where.subjectId ? { subjectId: where.subjectId } : {}),
        ...(where.pollId ? { payload: { path: ["pollId"], equals: where.pollId } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({
      ...parseEvent({ version: r.version, id: r.id, type: r.type, occurredAt: r.occurredAt.toISOString(), actorId: r.actorId, subject: { type: r.subjectType, id: r.subjectId }, payload: r.payload }),
      naturalKey: r.naturalKey,
    }));
  }

  // ─── Yorum, cevap, öneri (Faruk comments) ──────────────────

  test("yorum / cevap / öneri: tipine göre comment.created, comment.replied, alternative.created; aktör yazar, zaman yorumun zamanı", async () => {
    const poll = await createPoll();
    const top = CommentView.parse((await comment(poll.id, { body: "Bence alınır" })).json().data);
    const reply = CommentView.parse((await comment(poll.id, { body: "Katılıyorum", parentId: top.id }, bob.cookie)).json().data);
    const alt = CommentView.parse((await comment(poll.id, { body: "Şunu düşün", kind: "ALTERNATIVE" })).json().data);
    const rows = await db.comment.findMany({ where: { id: { in: [top.id, reply.id, alt.id] } }, select: { id: true, createdAt: true } });
    const at = new Map(rows.map((r) => [r.id, r.createdAt.toISOString()]));
    assert.deepEqual(
      (await eventsAbout({ pollId: poll.id })).map((e) => [e.type, e.actorId, e.subject, e.payload, e.occurredAt, e.naturalKey]),
      [
        ["comment.created", alice.id, { type: "COMMENT", id: top.id }, { pollId: poll.id }, at.get(top.id), null],
        ["comment.replied", bob.id, { type: "COMMENT", id: reply.id }, { pollId: poll.id, parentId: top.id }, at.get(reply.id), null],
        ["alternative.created", alice.id, { type: "COMMENT", id: alt.id }, { pollId: poll.id }, at.get(alt.id), null],
      ],
    );
  });

  test("yorum: Idempotency-Key tekrarı tek olay; reddedilen yorum olay yazmaz", async () => {
    const poll = await createPoll();
    const key = `kv21-${randomUUID()}`;
    const first = await comment(poll.id, { body: "Tek sefer" }, alice.cookie, key);
    const again = await comment(poll.id, { body: "Tek sefer" }, alice.cookie, key);
    assert.equal(again.json().data.id, first.json().data.id);
    assert.equal((await eventsAbout({ pollId: poll.id })).length, 1);

    const noComments = await createPoll({ allowComments: false });
    assertError(await comment(noComments.id, { body: "x" }), 409, "COMMENTS_DISABLED");
    assert.equal((await eventsAbout({ pollId: noComments.id })).length, 0);
  });

  test("yorum: olay yazılamazsa transaction geri alınır, ne yorum ne olay kalır", async () => {
    const poll = await createPoll();
    const res = await failingEventsFor(poll.id, () => comment(poll.id, { body: "Geri alınacak" }));
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(await db.comment.count({ where: { pollId: poll.id } }), 0);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { commentCount: true } })).commentCount, 0);
    assert.equal((await eventsAbout({ pollId: poll.id })).length, 0);
  });

  // ─── Kilometre taşı (Faruk votes) ──────────────────────────

  async function voters(n: number): Promise<User[]> {
    const users: User[] = [];
    for (let i = 0; i < n; i++) users.push(await signUp());
    return users;
  }

  test("kilometre taşı: geçerli oy sayısı 10'a tam bu oyla ulaşınca poll.milestone (sistem, natural key); 9 ve 11'de yok", async () => {
    const poll = await createPoll();
    for (const u of await voters(11)) assert.equal((await vote(poll.id, poll.options[0]!.id, u.cookie)).statusCode, 201);
    assert.deepEqual(
      (await eventsAbout({ subjectId: poll.id, type: "poll.milestone" })).map((e) => [e.actorId, e.subject, e.payload, e.naturalKey]),
      [[null, { type: "POLL", id: poll.id }, { metric: "VOTES", milestone: 10 }, `poll.milestone:${poll.id}:VOTES:10`]],
    );
  });

  test("kilometre taşı: 12 eşzamanlı oy 10'u geçer → tek olay; oy değiştirme olay üretmez", async () => {
    const poll = await createPoll();
    const users = await voters(12);
    const results = await Promise.all(users.map((u) => vote(poll.id, poll.options[0]!.id, u.cookie)));
    assert.ok(results.every((r) => r.statusCode === 201), results.map((r) => r.body).join("\n"));
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { voteCount: true } })).voteCount, 12);
    assert.equal((await vote(poll.id, poll.options[1]!.id, users[0]!.cookie)).statusCode, 200);
    assert.deepEqual((await eventsAbout({ subjectId: poll.id, type: "poll.milestone" })).map((e) => e.payload), [{ metric: "VOTES", milestone: 10 }]);
  });

  test("kilometre taşı: geçersiz sayılıp sayı düştükten sonra eşik yeniden geçilirse ikinci olay yazılmaz (natural key)", async () => {
    const poll = await createPoll();
    const users = await voters(11);
    for (const u of users.slice(0, 10)) assert.equal((await vote(poll.id, poll.options[0]!.id, u.cookie)).statusCode, 201);
    // KV-43 geçersiz saymanın DB etkisi (oy işaretlenir, sayaçlar düşer): 10 → 9.
    await db.$transaction(async (tx) => {
      await tx.vote.update({ where: { pollId_userId: { pollId: poll.id, userId: users[0]!.id } }, data: { invalidatedAt: h.clock.now, invalidationReason: "test: geçersiz" } });
      await tx.pollOption.update({ where: { id: poll.options[0]!.id }, data: { voteCount: { decrement: 1 } } });
      await tx.poll.update({ where: { id: poll.id }, data: { voteCount: { decrement: 1 } } });
    });
    assert.equal((await vote(poll.id, poll.options[0]!.id, users[10]!.cookie)).statusCode, 201);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { voteCount: true } })).voteCount, 10);
    assert.equal((await eventsAbout({ subjectId: poll.id, type: "poll.milestone" })).length, 1);
  });

  test("kilometre taşı: olay yazılamazsa oy da yazılmaz (aynı transaction)", async () => {
    const poll = await createPoll();
    const users = await voters(10);
    for (const u of users.slice(0, 9)) assert.equal((await vote(poll.id, poll.options[0]!.id, u.cookie)).statusCode, 201);
    const res = await failingEventsFor(poll.id, () => vote(poll.id, poll.options[0]!.id, users[9]!.cookie));
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(await db.vote.count({ where: { pollId: poll.id } }), 9);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { voteCount: true } })).voteCount, 9);
    assert.equal((await eventsAbout({ subjectId: poll.id, type: "poll.milestone" })).length, 0);
  });

  // ─── Elle kapatma (Faruk polls) ────────────────────────────

  test("elle kapatma: poll.closed OWNER, aktör sahip, natural key; ikinci kapatma yeni olay yazmaz", async () => {
    const poll = await createPoll();
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    const now = h.clock.now.toISOString();
    assert.deepEqual(
      (await eventsAbout({ subjectId: poll.id, type: "poll.closed" })).map((e) => [e.actorId, e.payload, e.occurredAt, e.naturalKey]),
      [[owner.id, { reason: "OWNER", closedAt: now }, now, `poll.closed:${poll.id}`]],
    );
  });

  test("elle kapatma: süresi dolmuş anket kapatılmaz ve olay yazmaz (süre dolumu worker'da); tartışma kapatılamaz", async () => {
    const poll = await createPoll({ durationHours: 1 });
    h.clock.advance(2 * 60 * 60_000); // süre doldu (closes_at geçti)
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { closedAt: true } })).closedAt, null);
    assert.equal((await eventsAbout({ subjectId: poll.id, type: "poll.closed" })).length, 0);

    const discussion = await createPoll({ kind: "DISCUSSION", options: undefined, resultsVisibility: undefined, durationHours: undefined });
    assert.notEqual((await send("POST", `/polls/${discussion.id}/close`, undefined, owner.cookie)).statusCode, 200);
    assert.equal((await eventsAbout({ subjectId: discussion.id, type: "poll.closed" })).length, 0);
  });

  test("elle kapatma: olay yazılamazsa anket kapanmaz (aynı transaction)", async () => {
    const poll = await createPoll();
    const res = await failingEventsFor(poll.id, () => send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie));
    assert.equal(res.statusCode, 500, res.body);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: poll.id }, select: { closedAt: true } })).closedAt, null);
    assert.equal((await eventsAbout({ subjectId: poll.id, type: "poll.closed" })).length, 0);
  });
});
