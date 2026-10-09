import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createPrismaPointAdminStore } from "../src/modules/points/admin-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

describe("admin puan düzeltmesi (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;

  before(async () => {
    h = await createHarness(backend!);
  });

  after(async () => {
    await h?.close();
  });

  function send(method: "POST", url: string, body: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: JSON.stringify(body),
    });
  }

  async function accountWithInitialGrant() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `puan_admin_${id}@example.test`, username: `puan_admin_${id}`, displayName: "Puan Admin", password: "guclu-bir-sifre-1" };
    const mailIndex = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailIndex]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { id: login.json().data.id as string, cookie: sessionCookie(login.headers["set-cookie"]) };
  }

  test("gerekçeli düzeltme atomik, idempotent ve aynı transaction'da auditli", async () => {
    const db = h.prisma!;
    const { id: userId } = await accountWithInitialGrant();
    const store = createPrismaPointAdminStore(db);
    const key = `adjust-${randomUUID()}`;
    const requestId = randomUUID();
    const scope = {
      userId,
      route: "admin.points.adjust",
      key,
      requestHash: "a".repeat(64),
      now: h.clock.now,
    };

    const first = await store.adjust({
      targetUserId: userId,
      delta: 5,
      reason: "Destek incelemesi sonrası düzeltme",
      actorId: userId,
      requestId,
      now: h.clock.now,
      scope,
    });
    const replay = await store.adjust({
      targetUserId: userId,
      delta: 5,
      reason: "Destek incelemesi sonrası düzeltme",
      actorId: userId,
      requestId,
      now: h.clock.now,
      scope,
    });

    assert.equal(replay.id, first.id);
    assert.equal((await h.store.getPointsSummary(userId)).balance, 25);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId, reason: "ADMIN_ADJUSTMENT" } }), 1);
    assert.equal(await db.auditLog.count({ where: { actorId: userId, action: "points.adjust", targetId: userId } }), 1);

    await assert.rejects(
      store.adjust({
        targetUserId: userId,
        delta: 10,
        reason: "Aynı anahtar farklı istek",
        actorId: userId,
        requestId: randomUUID(),
        now: h.clock.now,
        scope: { ...scope, requestHash: "b".repeat(64) },
      }),
      (error: unknown) => (error as { code?: string }).code === "IDEMPOTENCY_KEY_REUSED",
    );

    await assert.rejects(
      store.adjust({
        targetUserId: userId,
        delta: -30,
        reason: "Negatif bakiye engeli",
        actorId: userId,
        requestId: randomUUID(),
        now: h.clock.now,
        scope: {
          userId,
          route: "admin.points.adjust",
          key: `adjust-${randomUUID()}`,
          requestHash: "c".repeat(64),
          now: h.clock.now,
        },
      }),
      (error: unknown) => (error as { code?: string }).code === "INSUFFICIENT_POINTS",
    );
    assert.equal((await h.store.getPointsSummary(userId)).balance, 25);
    assert.equal(await db.auditLog.count({ where: { actorId: userId, action: "points.adjust", targetId: userId } }), 1);
  });

  test("admin.points.adjust gerçek HTTP endpoint'i RBAC, idempotency ve audit ile çalışır", async () => {
    const db = h.prisma!;
    const seeds = rbacSeeds(h);
    const root = await accountWithInitialGrant();
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    const admin = await accountWithInitialGrant();
    await seeds.setRole(admin.id, "ADMIN", root.id);
    const target = await accountWithInitialGrant();

    const key = `http-adjust-${randomUUID()}`;
    const body = { delta: 5, reason: "Destek talebi doğrulandı" };
    const first = await send("POST", `/admin/users/${target.id}/point-adjustments`, body, admin.cookie, key);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().data.delta, 5);
    assert.equal(first.json().data.balanceAfter, 25);

    const replay = await send("POST", `/admin/users/${target.id}/point-adjustments`, body, admin.cookie, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().data.id, first.json().data.id);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: target.id, reason: "ADMIN_ADJUSTMENT" } }), 1);
    assert.equal(await db.auditLog.count({ where: { actorId: admin.id, action: "points.adjust", targetId: target.id } }), 1);

    const reused = await send("POST", `/admin/users/${target.id}/point-adjustments`, { ...body, delta: 10 }, admin.cookie, key);
    assert.equal(reused.statusCode, 409, reused.body);

    const ordinary = await accountWithInitialGrant();
    const forbidden = await send("POST", `/admin/users/${target.id}/point-adjustments`, body, ordinary.cookie, `http-adjust-${randomUUID()}`);
    assert.equal(forbidden.statusCode, 403, forbidden.body);
  });
});
