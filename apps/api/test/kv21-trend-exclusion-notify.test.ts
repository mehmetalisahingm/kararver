/**
 * KV-21 (#23) düzeltme: trend dışı bırakma / geri alma bildirim üretmez (KV-21 karar 4), olay yazılmaya devam eder.
 * #130 bu işlemler için de moderation.applied üretir; bildirim tüketicisinin adapter'ı onları süzer. Gerçek PostgreSQL.
 * Worker dağıtıcısı ve bildirim tüketicisi YALNIZ BU TESTTE göreli yolla import edilir (KV-21 PR-4 karar 5).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { dispatchBatch, processNext, type DispatchDeps } from "../../worker/src/jobs/events/dispatch.ts";
import { createNotificationsConsumer } from "../../worker/src/jobs/notifications/consumer.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };

describe("KV-21: trend dışı bırakma bildirim üretmez (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
  });
  after(async () => {
    await h?.close();
  });

  function send(method: "POST", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(key ? { "idempotency-key": key } : {}) },
      payload: JSON.stringify(body),
    });
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ktr_${id}@example.test`, username: `ktr_${id}`, displayName: "Trend", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id };
  }

  test("EXCLUDE/INCLUDE_FROM_TRENDS: olay yazılır ve teslim edilir ama anket sahibine bildirim yok; HIDE bildirim üretir", async () => {
    const [root, admin, author] = [await signUp(), await signUp(), await signUp()];
    await db.userRole.create({ data: { userId: root.id, role: "SUPER_ADMIN" } });
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: root.id } });
    const categoryId = (await db.category.create({ data: { slug: `ktr-${randomUUID().slice(0, 8)}`, name: "Trend bildirimi" } })).id;
    const created = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Trend dışı ${randomUUID().slice(0, 8)}`, categoryId, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "Evet" }, { label: "Hayır" }] },
      author.cookie,
      `ktr-${randomUUID()}`,
    );
    assert.equal(created.statusCode, 201, created.body);
    const pollId = created.json().data.id as string;
    const moderate = async (action: string) => {
      const res = await send("POST", `/admin/polls/${pollId}/moderation`, { action, reason: "Moderatör incelemesi" }, admin.cookie);
      assert.equal(res.statusCode, 200, `${action}: ${res.body}`);
    };

    const deps: DispatchDeps = { prisma: db, consumers: [createNotificationsConsumer()], now: () => new Date(), log: () => {} };
    const drain = async () => {
      for (;;) {
        const d = await dispatchBatch(deps);
        let n = 0;
        while ((await processNext(deps)) !== "none") n++;
        if (d.events === 0 && n === 0) return;
      }
    };
    const eventsOf = (action: string) =>
      db.domainEvent.findMany({ where: { type: "moderation.applied", subjectId: pollId, payload: { path: ["action"], equals: action } }, select: { id: true } });

    await moderate("EXCLUDE_FROM_TRENDS");
    await moderate("INCLUDE_IN_TRENDS");
    await drain();
    for (const action of ["EXCLUDE_FROM_TRENDS", "INCLUDE_IN_TRENDS"]) {
      const events = await eventsOf(action);
      assert.equal(events.length, 1, `${action}: olay yazılmaya devam eder`);
      const delivery = await db.eventDelivery.findUniqueOrThrow({ where: { eventId_consumer: { eventId: events[0]!.id, consumer: "notifications" } } });
      assert.equal(delivery.status, "DONE", `${action}: teslim edilir`);
      assert.equal(await db.notification.count({ where: { eventId: events[0]!.id } }), 0, `${action}: bildirim yazılmaz`);
    }
    assert.equal(await db.notification.count({ where: { recipientId: author.id, type: "MODERATION_APPLIED" } }), 0);

    // Diğer moderasyon işlemleri bildirim üretmeye devam eder.
    await moderate("HIDE");
    await drain();
    const [hide] = await eventsOf("HIDE");
    assert.ok(hide);
    assert.deepEqual(
      await db.notification.findMany({ where: { eventId: hide.id }, select: { recipientId: true, type: true, actorId: true, data: true } }),
      [{ recipientId: author.id, type: "MODERATION_APPLIED", actorId: null, data: { action: "HIDE", toStatus: "HIDDEN" } }],
    );
  });
});
