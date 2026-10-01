/**
 * V1 #67 yayın puanı. Gerçek PostgreSQL gerekir: satır kilidi, koşullu bakiye düşümü,
 * idempotency ve append-only trigger bellek içinde yeterince güvenilir taklit edilemez.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PointsSummary } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("yayın puanı (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let titleSeq = 0;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    h.pollSettings.publishCostPoints = 10;
    categoryId = (await db.category.create({ data: { slug: `puan-${randomUUID().slice(0, 8)}`, name: "Puan Testi" } })).id;
  });

  after(async () => {
    await h?.close();
  });

  function send(method: "POST" | "GET", url: string, body?: unknown, cookie?: string, key?: string) {
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
    });
  }

  function pollBody() {
    return {
      kind: "POLL",
      title: `Puan harcaması yapılan gerçek anket ${++titleSeq}`,
      categoryId,
      durationHours: 72,
      resultsVisibility: "ALWAYS",
      options: [{ label: "Evet" }, { label: "Hayır" }],
    };
  }

  async function registerVerified() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `puan_${id}@example.test`, username: `puan_${id}`, displayName: "Puan", password: "guclu-bir-sifre-1" };
    const mailIndex = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailIndex]) })).statusCode, 200);
    return account;
  }

  async function login(account: { email: string; password: string }) {
    const response = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(response.statusCode, 200, response.body);
    return { cookie: sessionCookie(response.headers["set-cookie"]), id: response.json().data.id as string };
  }

  async function summary(cookie: string) {
    const response = await send("GET", "/me/points", undefined, cookie);
    assert.equal(response.statusCode, 200, response.body);
    return PointsSummary.parse(response.json().data);
  }

  test("ilk başarılı login +20 verir; tekrar ve paralel login grant'i çoğaltmaz", async () => {
    const account = await registerVerified();
    const [a, b] = await Promise.all([login(account), login(account)]);
    assert.equal(a.id, b.id);
    assert.deepEqual(await summary(a.cookie), { balance: 20, publishCost: 10 });

    const third = await login(account);
    assert.deepEqual(await summary(third.cookie), { balance: 20, publishCost: 10 });
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: a.id, reason: "INITIAL_GRANT" } }), 1);
  });

  test("iki başarılı yayın bakiyeyi 0 yapar; retry çift harcamaz; üçüncü yayın atomik reddedilir", async () => {
    const account = await registerVerified();
    const owner = await login(account);

    const firstKey = `points-${randomUUID()}`;
    const firstBody = pollBody();
    const first = await send("POST", "/polls", firstBody, owner.cookie, firstKey);
    assert.equal(first.statusCode, 201, first.body);
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });

    const retry = await send("POST", "/polls", firstBody, owner.cookie, firstKey);
    assert.equal(retry.statusCode, 201, retry.body);
    assert.equal(retry.json().data.id, first.json().data.id);
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });

    const second = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(second.statusCode, 201, second.body);
    assert.deepEqual(await summary(owner.cookie), { balance: 0, publishCost: 10 });

    const beforeCount = await db.poll.count({ where: { authorId: owner.id } });
    const third = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(third.statusCode, 409, third.body);
    ErrorBody.parse(third.json());
    assert.equal(third.json().error.code, "INSUFFICIENT_POINTS");
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), beforeCount, "reddedilen yayın DB'de kalmamalı");
    assert.deepEqual(await summary(owner.cookie), { balance: 0, publishCost: 10 });
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 2);
  });

  test("son 10 puanla iki paralel yayın yarışırsa yalnız biri commit olur", async () => {
    const account = await registerVerified();
    const owner = await login(account);
    const warmup = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(warmup.statusCode, 201, warmup.body);
    assert.equal((await summary(owner.cookie)).balance, 10);

    const [a, b] = await Promise.all([
      send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`),
      send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body}\n${b.body}`);
    assert.equal((await summary(owner.cookie)).balance, 0);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 2);
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 2);
  });

  test("ledger sayfalı okunur ve DB'de UPDATE/DELETE edilemez", async () => {
    const account = await registerVerified();
    const owner = await login(account);
    assert.equal((await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`)).statusCode, 201);

    const page1 = await send("GET", "/me/points/ledger?limit=1", undefined, owner.cookie);
    assert.equal(page1.statusCode, 200, page1.body);
    assert.equal(page1.json().data.length, 1);
    assert.equal(page1.json().page.hasMore, true);
    assert.ok(page1.json().page.nextCursor);
    const page2 = await send("GET", `/me/points/ledger?limit=1&cursor=${encodeURIComponent(page1.json().page.nextCursor)}`, undefined, owner.cookie);
    assert.equal(page2.statusCode, 200, page2.body);
    assert.equal(page2.json().data.length, 1);
    assert.notEqual(page2.json().data[0].id, page1.json().data[0].id);

    await assert.rejects(
      db.$executeRaw`UPDATE point_ledger_entries SET delta = 1 WHERE user_id = ${owner.id}::uuid`,
      /KV_POINT_LEDGER_APPEND_ONLY/,
    );
    await assert.rejects(
      db.$executeRaw`DELETE FROM point_ledger_entries WHERE user_id = ${owner.id}::uuid`,
      /KV_POINT_LEDGER_APPEND_ONLY/,
    );
  });
});
