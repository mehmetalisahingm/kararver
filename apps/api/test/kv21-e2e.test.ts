/**
 * KV-21 (#23) uçtan uca: gerçek HTTP mutation → domain_events (aynı transaction) → worker dağıtıcısı → bildirim
 * tüketicisi → notifications → alıcının GET /notifications'ı. Gerçek PostgreSQL gerektirir.
 *
 * Worker'ın dağıtıcısı ve bildirim tüketicisi YALNIZ BU TESTTE göreli yolla import edilir (KV-21 PR-4 karar 5); üretim
 * kodu apps/api ↔ apps/worker arasında import yapmaz. Dağıtma global çalışır: başka testlerin dağıtılmamış olayları da
 * işlenebilir; doğrulamalar bu dosyanın kullanıcıları üzerinden yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { CommentView, createEvent, newEventId, NotificationView, PollDetail } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { dispatchBatch, processNext, type DispatchDeps } from "../../worker/src/jobs/events/dispatch.ts";
import { writeWorkerEvent } from "../../worker/src/jobs/events/write.ts";
import { createNotificationsConsumer } from "../../worker/src/jobs/notifications/consumer.ts";
import { writeEvent } from "../src/modules/events/write.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; json(): any };

describe("KV-21 uçtan uca: mutation → olay → dağıtıcı → bildirim (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let deps: DispatchDeps;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `kv21e2e-${randomUUID().slice(0, 8)}`, name: "KV-21 e2e" } })).id;
    deps = { prisma: db, consumers: [createNotificationsConsumer()], now: () => new Date(), log: () => {} };
  });
  after(async () => {
    await h?.close();
  });

  function send(method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string, key?: string) {
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

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `e2e_${id}@example.test`, username: `e2e_${id}`, displayName: "Uçtan Uca", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie((login as unknown as { headers: Record<string, string> }).headers["set-cookie"]!), id: login.json().data.id };
  }

  async function createPoll(owner: User) {
    const body = { kind: "POLL", title: `Uçtan uca ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] };
    const res = await send("POST", "/polls", body, owner.cookie, `e2e-${randomUUID()}`);
    assert.equal(res.statusCode, 201, res.body);
    return PollDetail.parse(res.json().data);
  }

  /** events.dispatch'in bir turu gibi: dağıt, vadesi gelen bütün teslimleri işle. */
  async function drain() {
    for (;;) {
      const d = await dispatchBatch(deps);
      let n = 0;
      while ((await processNext(deps)) !== "none") n++;
      if (d.events === 0 && n === 0) return;
    }
  }

  async function notificationsOf(user: User) {
    const res = await send("GET", "/notifications", undefined, user.cookie);
    assert.equal(res.statusCode, 200, res.body);
    return (res.json().data as unknown[]).map((n) => NotificationView.parse(n));
  }
  const unread = async (user: User) => (await send("GET", "/notifications/unread-count", undefined, user.cookie)).json().data.count as number;

  test("yorum: POST /polls/:id/comments → anket sahibi GET /notifications'ta COMMENT_ON_POLL görür (aktör yorumcu)", async () => {
    const [owner, alice] = [await signUp(), await signUp()];
    const poll = await createPoll(owner);
    const res = await send("POST", `/polls/${poll.id}/comments`, { body: "Bence alınır" }, alice.cookie);
    assert.equal(res.statusCode, 201, res.body);
    const comment = CommentView.parse(res.json().data);
    await drain();

    const list = await notificationsOf(owner);
    assert.deepEqual(
      list.map((n) => [n.type, n.subject, n.actor?.id, n.data, n.readAt]),
      // #138: bildirim, hedef ankete gitmek için data.pollId taşır.
      [["COMMENT_ON_POLL", { type: "COMMENT", id: comment.id }, alice.id, { pollId: poll.id }, null]],
    );
    assert.equal(await unread(owner), 1);
    assert.deepEqual(await notificationsOf(alice), [], "kendi eylemine bildirim yok");
    const delivery = await db.eventDelivery.findFirstOrThrow({ where: { consumer: "notifications", event: { subjectId: comment.id } }, select: { status: true, attempts: true } });
    assert.deepEqual(delivery, { status: "DONE", attempts: 1 });
  });

  test("elle kapatma: POST /polls/:id/close → oy verenler POLL_CLOSED görür, sahip (aktör) görmez; tekrar dağıtım çift bildirim üretmez", async () => {
    const [owner, alice, bob] = [await signUp(), await signUp(), await signUp()];
    const poll = await createPoll(owner);
    for (const u of [alice, bob]) assert.equal((await send("PUT", `/polls/${poll.id}/vote`, { optionId: poll.options[0]!.id }, u.cookie)).statusCode, 201);
    assert.equal((await send("POST", `/polls/${poll.id}/close`, undefined, owner.cookie)).statusCode, 200);
    await drain();
    await drain();
    for (const u of [alice, bob]) {
      const closed = (await notificationsOf(u)).filter((n) => n.type === "POLL_CLOSED");
      assert.deepEqual(closed.map((n) => [n.subject, n.actor?.id, n.data]), [[{ type: "POLL", id: poll.id }, owner.id, { reason: "OWNER", pollId: poll.id }]]);
    }
    assert.equal((await notificationsOf(owner)).filter((n) => n.type === "POLL_CLOSED").length, 0);
  });

  test("worker olay yazıcısı API yazıcısıyla aynı satırı yazar (kolon eşlemesi)", async () => {
    const event = createEvent({
      id: newEventId(),
      type: "sanction.applied",
      occurredAt: new Date().toISOString(),
      actorId: randomUUID(),
      subject: { type: "USER", id: randomUUID() },
      payload: { sanctionId: randomUUID(), type: "WARNING", endsAt: null },
    });
    const rollback = new Error("geri al");
    const rowWith = async (write: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<unknown>) => {
      let row: Record<string, unknown> | null = null;
      await db
        .$transaction(async (tx) => {
          await write(tx);
          const { createdAt: _createdAt, ...rest } = await tx.domainEvent.findUniqueOrThrow({ where: { id: event.id } });
          row = rest;
          throw rollback;
        })
        .catch((err) => {
          if (err !== rollback) throw err;
        });
      return row;
    };
    const api = await rowWith((tx) => writeEvent(tx, event));
    const worker = await rowWith((tx) => writeWorkerEvent(tx, event));
    assert.ok(api);
    assert.deepEqual(worker, api);
  });
});
