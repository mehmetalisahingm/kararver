import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PollDetail, createEvent, newEventId } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { createNotificationsConsumer } from "../../worker/src/jobs/notifications/consumer.ts";
const backend = prismaBackend();
type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; json(): any };
describe("KV-23 decisions and follows", { skip: !backend }, () => {
 let h: Harness; let db: PrismaClient; let categoryId: string; let owner: User; let alice: User; let bob: User;
 before(async () => {
  h = await createHarness(backend!); db = h.prisma!;
  categoryId = (await db.category.create({ data: { slug: `kv23-${randomUUID()}`, name: "KV23" } })).id;
  [owner, alice, bob] = [await signUp(), await signUp(), await signUp()];
 });
 after(async () => { await h?.close(); });
  function send(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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


 test("only owner; same PUT/concurrent PUT emits once, preserves votes/closure and revision", async () => {
  const p = await createPoll(); const input = { chosenOptionId: p.options[0]!.id, note: "Tercihim bu." };
  assertError(await send("PUT", `/polls/${p.id}/decision`, input), 401, "UNAUTHENTICATED");
  assertError(await send("PUT", `/polls/${p.id}/decision`, input, alice.cookie), 403, "FORBIDDEN");
  const before = await db.poll.findUniqueOrThrow({ where: { id: p.id } });
  const results = await Promise.all(Array.from({ length: 3 }, () => send("PUT", `/polls/${p.id}/decision`, input, owner.cookie)));
  for (const r of results) assert.equal(r.statusCode, 200, r.body);
  const events = await db.domainEvent.findMany({ where: { subjectId: p.id, type: "decision.updated" } });
  assert.equal(events.length, 1); assert.deepEqual(events[0]!.payload, { chosenOptionId: input.chosenOptionId, first: true });
  assert.deepEqual(await db.poll.findUniqueOrThrow({ where: { id: p.id } }), before);
  const revision = await db.pollRevision.findFirstOrThrow({ where: { pollId: p.id }, orderBy: { version: "desc" } });
  assert.equal((revision.snapshot as any).decision.note, input.note);
  assert.equal((await send("GET", `/polls/${p.id}/decision`, undefined)).json().data.decision.note, input.note);
 });
 test("closed polls allow decisions; locked/removed content and foreign options reject", async () => {
  const p = await createPoll(); const other = await createPoll();
  assertError(await send("PUT", `/polls/${p.id}/decision`, { chosenOptionId: other.options[0]!.id, note: "Yanlış" }, owner.cookie), 400, "VALIDATION_ERROR");
  await db.poll.update({ where: { id: p.id }, data: { closedAt: h.clock.now } });
  const input = { chosenOptionId: p.options[0]!.id, note: "Son karar" };
  assert.equal((await send("PUT", `/polls/${p.id}/decision`, input, owner.cookie)).statusCode, 200);
  await db.poll.update({ where: { id: p.id }, data: { status: "LOCKED" } });
  assertError(await send("PUT", `/polls/${p.id}/decision`, input, owner.cookie), 409, "CONTENT_LOCKED");
  await db.poll.update({ where: { id: p.id }, data: { status: "REMOVED" } });
  assertError(await send("GET", `/polls/${p.id}/decision`, undefined), 404, "NOT_FOUND");
  assertError(await send("PUT", `/polls/${p.id}/follow`, undefined, alice.cookie), 404, "NOT_FOUND");
  assert.equal((await send("DELETE", `/polls/${p.id}/follow`, undefined, alice.cookie)).statusCode, 200);
 });
 test("follow is idempotent; follower and voter overlap gets one notification on replay", async () => {
  const p = await createPoll();
  for (const u of [alice, alice, bob]) assert.equal((await send("PUT", `/polls/${p.id}/follow`, undefined, u.cookie)).statusCode, 200);
  assert.equal(await db.pollFollow.count({ where: { pollId: p.id } }), 2);
  assert.equal((await send("GET", `/polls/${p.id}/decision`, undefined, alice.cookie)).json().data.following, true);
  assert.equal((await send("PUT", `/polls/${p.id}/vote`, { optionId: p.options[0]!.id }, alice.cookie)).statusCode, 201);
  const consumer = createNotificationsConsumer({ slice: 1 });
  const event = createEvent({ id: newEventId(), type: "decision.updated", occurredAt: h.clock.now.toISOString(), actorId: owner.id,
   subject: { type: "POLL", id: p.id }, payload: { chosenOptionId: p.options[0]!.id, first: true } });
  for (let i = 0; i < 2; i++) await db.$transaction(tx => consumer.handle(event, { tx, attempt: 1, log: () => {} }));
  assert.equal(await db.notification.count({ where: { eventId: event.id } }), 2);
  await send("DELETE", `/polls/${p.id}/follow`, undefined, bob.cookie);
  const closed = createEvent({ id: newEventId(), type: "poll.closed", occurredAt: h.clock.now.toISOString(), actorId: owner.id,
   subject: { type: "POLL", id: p.id }, payload: { reason: "OWNER", closedAt: h.clock.now.toISOString() } });
  await db.$transaction(tx => consumer.handle(closed, { tx, attempt: 1, log: () => {} }));
  assert.deepEqual((await db.notification.findMany({ where: { eventId: closed.id } })).map(n => n.recipientId), [alice.id]);
 });
});
