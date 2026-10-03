/** KV-21 (#23) PR-1: bildirim saklama ve okuma API'si (liste, okunmamış sayısı, okundu). Gerçek PostgreSQL gerektirir. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { NotificationType } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaNotificationStore } from "../src/modules/notifications/prisma-store.ts";
import { prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN } from "./support/harness.ts";

const backendFactory = prismaBackend();
const NOW = new Date("2026-10-03T12:00:00.000Z");

type User = { id: string; cookie: string };

describe("KV-21 bildirimler (postgres)", { skip: backendFactory ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let backend: Awaited<ReturnType<NonNullable<typeof backendFactory>["create"]>>;
  let db: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let mails: { text: string }[];
  let alice: User;
  let bob: User;
  let actor: User;

  before(async () => {
    backend = await backendFactory!.create();
    db = backend.prisma!;
    mails = [];
    const config = loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "silent",
      WEB_URL: WEB_ORIGIN,
      API_URL: "http://localhost:4000",
      SESSION_COOKIE_SECURE: "false",
      AUTH_TOKEN_PEPPER: "test-pepper-0123456789-abcdefghijklmnop",
      MAIL_FROM: "KararVer <no-reply@localhost>",
      MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
    });
    app = buildApp({
      config,
      authStore: backend.store,
      rbacStore: backend.rbac,
      hasher: createArgon2Hasher(),
      mailer: { send: async (mail) => void mails.push({ text: mail.text }) },
      notificationStore: createPrismaNotificationStore(db),
      now: () => NOW,
      logger: false,
    });
    await app.ready();
    alice = await signUp();
    bob = await signUp();
    actor = await signUp();
  });

  after(async () => {
    await app?.close();
    await backend?.close();
  });

  async function signUp(): Promise<User> {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const account = { email: `kv21_${suffix}@example.test`, username: `kv21_${suffix}`, displayName: "KV21 kullanıcı", password: "guclu-bir-sifre-1" };
    const json = { origin: WEB_ORIGIN, "content-type": "application/json" };
    const mailIndex = mails.length;
    const register = await app.inject({ method: "POST", url: "/v1/auth/register", headers: json, payload: JSON.stringify(account) });
    assert.equal(register.statusCode, 202, register.body);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verify",
      headers: json,
      payload: JSON.stringify({ token: tokenFrom(mails[mailIndex] as any) }),
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: json,
      payload: JSON.stringify({ email: account.email, password: account.password }),
    });
    assert.equal(login.statusCode, 200, login.body);
    return { id: login.json().data.id as string, cookie: sessionCookie(login.headers["set-cookie"]) };
  }

  let seq = 0;
  /** Teslim job'u (PR-3) gelene kadar satırlar doğrudan yazılır; createdAt sırayı belirler. */
  async function seed(recipient: User, extra: { readAt?: Date | null; actorId?: string | null; minutesAgo?: number; data?: object } = {}) {
    seq += 1;
    const row = await db.notification.create({
      data: {
        recipientId: recipient.id,
        type: "COMMENT_ON_POLL",
        eventId: randomUUID(),
        actorId: extra.actorId === undefined ? actor.id : extra.actorId,
        subjectType: "COMMENT",
        subjectId: randomUUID(),
        data: extra.data ?? { seq },
        dedupeKey: `test:${randomUUID()}`,
        readAt: extra.readAt ?? null,
        createdAt: new Date(NOW.getTime() - (extra.minutesAgo ?? seq) * 60_000),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function reset(...users: User[]) {
    await db.notification.deleteMany({ where: { recipientId: { in: users.map((u) => u.id) } } });
  }

  const get = (user: User | null, url: string) =>
    app.inject({ method: "GET", url, headers: user ? { cookie: user.cookie } : {} });
  const markRead = (user: User, body: unknown) =>
    app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: user.cookie },
      payload: JSON.stringify(body),
    });
  const unread = async (user: User) => (await get(user, "/v1/notifications/unread-count")).json().data.count as number;

  test("DB enum'u contracts NotificationType ile birebir ve aynı sırada", async () => {
    const rows = await db.$queryRaw<{ v: string }[]>`
      SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'notification_type' ORDER BY e.enumsortorder`;
    assert.deepEqual(rows.map((r) => r.v), NotificationType.options);
  });

  test("oturum yoksa üç endpoint de 401", async () => {
    assert.equal((await get(null, "/v1/notifications")).statusCode, 401);
    assert.equal((await get(null, "/v1/notifications/unread-count")).statusCode, 401);
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/read",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ all: true }),
    });
    assert.equal(res.statusCode, 401);
  });

  test("liste yeniden eskiye, sözleşme görünümüyle; aktör PublicUser, sistem bildiriminde null", async () => {
    await reset(alice);
    const older = await seed(alice, { minutesAgo: 10, data: { milestone: 100 } });
    const system = await seed(alice, { minutesAgo: 5, actorId: null });
    const res = await get(alice, "/v1/notifications");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers["cache-control"], "private, no-store");
    const body = res.json();
    assert.deepEqual(body.data.map((n: { id: string }) => n.id), [system, older]);
    assert.equal(body.data[0].actor, null);
    assert.equal(body.data[1].actor.id, actor.id);
    assert.equal(body.data[1].actor.avatarUrl, null);
    assert.deepEqual(body.data[1].data, { milestone: 100 });
    assert.equal(body.data[1].readAt, null);
    assert.equal(body.data[1].createdAt, new Date(NOW.getTime() - 10 * 60_000).toISOString());
    assert.deepEqual(body.page, { nextCursor: null, hasMore: false });
  });

  test("cursor sayfalaması tekrarsız ve eksiksiz; aynı created_at'te id ile ayrılır", async () => {
    await reset(alice);
    const ids = [await seed(alice, { minutesAgo: 1 }), await seed(alice, { minutesAgo: 2 }), await seed(alice, { minutesAgo: 2 }), await seed(alice, { minutesAgo: 3 })];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(alice, `/v1/notifications?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      seen.push(...body.data.map((n: { id: string }) => n.id));
      cursor = body.page.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 4);
    assert.deepEqual(new Set(seen), new Set(ids));
    assert.equal(seen[0], ids[0]);
    assert.equal(seen[3], ids[3]);
  });

  test("unreadOnly yalnız okunmamışları döner; filtre değişince eski cursor 400 INVALID_CURSOR", async () => {
    await reset(alice);
    await seed(alice, { minutesAgo: 1, readAt: NOW });
    const a = await seed(alice, { minutesAgo: 2 });
    const b = await seed(alice, { minutesAgo: 3 });
    const res = await get(alice, "/v1/notifications?unreadOnly=true&limit=1");
    assert.deepEqual(res.json().data.map((n: { id: string }) => n.id), [a]);
    const cursor = res.json().page.nextCursor as string;
    const next = await get(alice, `/v1/notifications?unreadOnly=true&limit=1&cursor=${cursor}`);
    assert.deepEqual(next.json().data.map((n: { id: string }) => n.id), [b]);
    const mixed = await get(alice, `/v1/notifications?limit=1&cursor=${cursor}`);
    assert.equal(mixed.statusCode, 400);
    assert.equal(mixed.json().error.code, "INVALID_CURSOR");
  });

  test("bozuk cursor DB hatasına düşmez: 400 INVALID_CURSOR", async () => {
    for (const k of [["not-a-date"], [123], []]) {
      const cursor = Buffer.from(JSON.stringify({ v: 1, f: "notifications:all", k, id: randomUUID() })).toString("base64url");
      const res = await get(alice, `/v1/notifications?cursor=${cursor}`);
      assert.equal(res.statusCode, 400, JSON.stringify(k));
      assert.equal(res.json().error.code, "INVALID_CURSOR");
    }
    const badId = Buffer.from(JSON.stringify({ v: 1, f: "notifications:all", k: [NOW.toISOString()], id: "x" })).toString("base64url");
    assert.equal((await get(alice, `/v1/notifications?cursor=${badId}`)).statusCode, 400);
  });

  test("izolasyon: başkasının bildirimi listede, sayıda ve okundu işaretinde görünmez", async () => {
    await reset(alice, bob);
    const aliceId = await seed(alice);
    await seed(bob);

    const bobList = (await get(bob, "/v1/notifications")).json().data as { id: string }[];
    assert.equal(bobList.length, 1);
    assert.ok(!bobList.some((n) => n.id === aliceId));
    assert.equal(await unread(bob), 1);

    // Bob, Alice'in id'siyle okundu işaretler: 200, 0 satır, Alice'inki okunmamış kalır (varlık sızdırılmaz).
    const byId = await markRead(bob, { ids: [aliceId] });
    assert.equal(byId.statusCode, 200, byId.body);
    assert.deepEqual(byId.json().data, { updated: 0 });
    // "Hepsi" de yalnız Bob'un satırlarını etkiler.
    assert.deepEqual((await markRead(bob, { all: true })).json().data, { updated: 1 });
    assert.equal(await unread(alice), 1);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: aliceId } })).readAt, null);
  });

  test("okundu işaretleme: seçili ve hepsi; tekrar çağrı 0 (idempotent), sayaç tutarlı", async () => {
    await reset(alice);
    const [a, b, c] = [await seed(alice), await seed(alice), await seed(alice)];
    assert.equal(await unread(alice), 3);

    const first = await markRead(alice, { ids: [a, a, b] });
    assert.deepEqual(first.json().data, { updated: 2 });
    assert.deepEqual((await markRead(alice, { ids: [a] })).json().data, { updated: 0 });
    assert.equal(await unread(alice), 1);
    const read = await db.notification.findUniqueOrThrow({ where: { id: a } });
    assert.equal(read.readAt?.toISOString(), NOW.toISOString());

    assert.deepEqual((await markRead(alice, { all: true })).json().data, { updated: 1 });
    assert.deepEqual((await markRead(alice, { all: true })).json().data, { updated: 0 });
    assert.equal(await unread(alice), 0);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: c } })).readAt?.toISOString(), NOW.toISOString());
  });

  test("okundu gövdesi sözleşmeye uymazsa 400 (boş, 100'den fazla id, geçersiz id, all:false)", async () => {
    for (const body of [{}, { ids: [] }, { ids: Array.from({ length: 101 }, () => randomUUID()) }, { ids: ["x"] }, { all: false }]) {
      const res = await markRead(alice, body);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
    }
  });

  test("silinmiş aktörün adı bildirimde gösterilmez", async () => {
    const ghost = await signUp();
    await reset(alice);
    await seed(alice, { actorId: ghost.id });
    await db.user.update({ where: { id: ghost.id }, data: { deletedAt: NOW } });
    const [n] = (await get(alice, "/v1/notifications")).json().data;
    assert.equal(n.actor, null);
  });

  describe("DB kuralları (teslim job'u PR-3'e hazırlık)", () => {
    const base = () => ({
      recipientId: alice.id,
      type: "POLL_MILESTONE" as const,
      eventId: randomUUID(),
      subjectType: "POLL",
      subjectId: randomUUID(),
    });

    test("aynı alıcı + dedupe_key tek satır: tekrar teslim (skipDuplicates) ikinci satır üretmez", async () => {
      const dedupeKey = `notifications:poll.milestone:${randomUUID()}:VOTES:100`;
      const row = { ...base(), dedupeKey };
      assert.equal((await db.notification.createMany({ data: [row], skipDuplicates: true })).count, 1);
      assert.equal((await db.notification.createMany({ data: [{ ...row, eventId: randomUUID() }], skipDuplicates: true })).count, 0);
      assert.equal(await db.notification.count({ where: { recipientId: alice.id, dedupeKey } }), 1);
      // Aynı anahtar başka alıcıda ayrı bildirimdir.
      assert.equal((await db.notification.createMany({ data: [{ ...row, recipientId: bob.id }], skipDuplicates: true })).count, 1);
    });

    test("CHECK: aktör alıcı olamaz, data nesne olmalı, konu tipi sözleşmedeki küme", async () => {
      await assert.rejects(db.notification.create({ data: { ...base(), dedupeKey: `t:${randomUUID()}`, actorId: alice.id } }), /notifications_actor_not_recipient_check/);
      await assert.rejects(db.notification.create({ data: { ...base(), dedupeKey: `t:${randomUUID()}`, data: [1, 2] } }), /notifications_data_object_check/);
      await assert.rejects(db.notification.create({ data: { ...base(), dedupeKey: `t:${randomUUID()}`, subjectType: "REPORT" } }), /notifications_subject_type_check/);
      await assert.rejects(db.notification.create({ data: { ...base(), dedupeKey: "" } }), /notifications_dedupe_key_check/);
    });

    test("okunmamış partial index'i var", async () => {
      const [idx] = await db.$queryRaw<{ def: string }[]>`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'notifications_unread_idx'`;
      assert.match(idx!.def, /WHERE \(read_at IS NULL\)/);
    });
  });
});
