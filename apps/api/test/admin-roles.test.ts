/**
 * KV-33 (#35) global rol ataması (admin.roles.put) ve son aktif SUPER_ADMIN kuralının yarışta korunması.
 * Gerçek PostgreSQL gerektirir. "Son aktif SUPER_ADMIN" sayımı global olduğu için yarış testleri önce bütün
 * SUPER_ADMIN satırlarını siler (admin-bootstrap.test.ts ile aynı yöntem) ve bittiğinde bu dosyanın SUPER_ADMIN'ini
 * geri yazar. Bu, test dosyalarının sırayla çalışmasına dayanır (package.json: --test-concurrency=1).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, headers } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
type RoleName = "USER" | "MODERATOR" | "ADMIN" | "SUPER_ADMIN";

describe("admin rol ataması (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let root: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    root = await signUp();
    await db.userRole.create({ data: { userId: root.id, role: "SUPER_ADMIN" } });
  });
  after(async () => {
    await h?.close();
  });

  function send(method: "GET" | "POST" | "PUT", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
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
    const account = { email: `ar_${id}@example.test`, username: `ar_${id}`, displayName: "Rol", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id };
  }

  const put = (userId: string, role: RoleName, cookie = root.cookie, reason = "Ekip görevi değişti") =>
    send("PUT", `/admin/users/${userId}/role`, { role, reason }, cookie);
  const roleOf = async (userId: string) => (await db.userRole.findUnique({ where: { userId }, select: { role: true, grantedById: true } })) ?? null;
  const audits = (userId: string) =>
    db.auditLog.findMany({
      where: { targetType: "USER", targetId: userId, action: "user.role.assign" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { actorId: true, operation: true, before: true, after: true, reason: true, requestId: true },
    });

  async function superAdmin(): Promise<User> {
    const u = await signUp();
    await db.userRole.create({ data: { userId: u.id, role: "SUPER_ADMIN", grantedById: root.id } });
    return u;
  }

  test("grant → change → revoke; aynı rol değişiklik ve audit üretmez; roles tek elemanlı", async () => {
    const user = await signUp();
    const granted = await put(user.id, "MODERATOR");
    assert.equal(granted.statusCode, 200, granted.body);
    assert.deepEqual(granted.json().data, { userId: user.id, roles: ["MODERATOR"] });
    assert.deepEqual(await roleOf(user.id), { role: "MODERATOR", grantedById: root.id });

    assert.equal((await put(user.id, "MODERATOR")).statusCode, 200);
    assert.deepEqual((await put(user.id, "ADMIN")).json().data.roles, ["ADMIN"]);
    const revoked = await put(user.id, "USER");
    assert.deepEqual(revoked.json().data.roles, ["USER"]);
    assert.equal(await roleOf(user.id), null, "USER'a düşürme satırı siler");

    const trail = await audits(user.id);
    assert.deepEqual(
      trail.map((a) => [a.operation, a.before, a.after]),
      [
        ["grant", { role: "USER" }, { role: "MODERATOR" }],
        ["change", { role: "MODERATOR" }, { role: "ADMIN" }],
        ["revoke", { role: "ADMIN" }, { role: "USER" }],
      ],
    );
    assert.ok(trail.every((a) => a.actorId === root.id && a.reason === "Ekip görevi değişti"));
    assert.equal(trail[2]!.requestId, revoked.headers[headers.requestId.toLowerCase()]);
  });

  test("yetki: ADMIN rol atayamaz (403), kendi rolünü değiştirmek 409, olmayan kullanıcı 404, gerekçe zorunlu", async () => {
    const admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: root.id } });
    const user = await signUp();
    assertError(await put(user.id, "MODERATOR", admin.cookie), 403, "FORBIDDEN");
    assertError(await put(root.id, "ADMIN"), 409, "CONFLICT");
    assertError(await put(randomUUID(), "MODERATOR"), 404, "NOT_FOUND");
    assertError(await put(user.id, "MODERATOR", root.cookie, " "), 400, "VALIDATION_ERROR");
    assert.equal(await roleOf(user.id), null);
    assert.deepEqual(await audits(user.id), []);
  });

  test("ACTIVE olmayan SUPER_ADMIN düşürülebilir (aktif sayıyı azaltmaz)", async () => {
    const banned = await superAdmin();
    await db.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    const res = await put(banned.id, "USER");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await roleOf(banned.id), null);
  });

  // ─── Son aktif SUPER_ADMIN yarışı ───────────────────────────

  /** Bütün SUPER_ADMIN satırlarını silip yalnız verilen iki hesabı SUPER_ADMIN yapar; sonra root'u geri yazar. */
  async function withOnlyTwoSuperAdmins(run: (a: User, b: User) => Promise<void>): Promise<void> {
    const a = await signUp();
    const b = await signUp();
    await db.userRole.deleteMany({ where: { role: "SUPER_ADMIN" } });
    await db.userRole.createMany({ data: [{ userId: a.id, role: "SUPER_ADMIN" }, { userId: b.id, role: "SUPER_ADMIN", grantedById: a.id }] });
    try {
      await run(a, b);
    } finally {
      await db.userRole.upsert({ where: { userId: root.id }, create: { userId: root.id, role: "SUPER_ADMIN" }, update: { role: "SUPER_ADMIN" } });
    }
  }

  const eventsAbout = (...userIds: string[]) =>
    db.domainEvent.findMany({ where: { subjectType: "USER", subjectId: { in: userIds } }, select: { type: true, actorId: true, subjectId: true, payload: true } });

  const activeSuperAdmins = () => db.userRole.count({ where: { role: "SUPER_ADMIN", user: { status: "ACTIVE", deletedAt: null } } });

  /** Yarışta 500 dönerse sebebi (ör. deadlock) assert mesajında görünsün. */
  const failure = (results: Res[]) =>
    [...results.map((r) => r.body), ...h.logs.filter((l) => l.includes("beklenmeyen hata")).slice(-2).map((l) => l.slice(0, 600))].join("\n");

  /**
   * Kaybeden isteğin sonucu zamanlamaya bağlıdır ve ikisi de doğrudur: kazanan önce commit ederse kaybedenin aktörü
   * yetki kontrolüne geldiğinde artık SUPER_ADMIN değildir (403 FORBIDDEN); kontrolü kazanandan önce geçerse transaction
   * içi sayım son aktif SUPER_ADMIN'i korur (409 CONFLICT). Asıl koşul her iki durumda aynıdır.
   */
  test("yarış: iki SUPER_ADMIN birbirini aynı anda düşürür → biri 200, diğeri 403 (artık SUPER_ADMIN değil) veya 409 (last_super_admin); tek aktif SUPER_ADMIN ve tek audit kalır", async () => {
    await withOnlyTwoSuperAdmins(async (a, b) => {
      const requests = [
        { actor: a, target: b },
        { actor: b, target: a },
      ];
      const results = await Promise.all(requests.map(({ actor, target }) => put(target.id, "ADMIN", actor.cookie)));
      const winners = results.flatMap((r, i) => (r.statusCode === 200 ? [i] : []));
      assert.equal(winners.length, 1, failure(results));
      const won = winners[0]!;
      const loser = results[1 - won]!;

      if (loser.statusCode === 403) assertError(loser, 403, "FORBIDDEN");
      else assertError(loser, 409, "CONFLICT");

      // Kalan tek aktif SUPER_ADMIN kazananın aktörüdür (= kaybeden isteğin hedefi); kaybedenin aktörü ADMIN'e düştü.
      const { actor: survivor, target: demoted } = requests[won]!;
      assert.equal(await activeSuperAdmins(), 1);
      assert.equal((await roleOf(survivor.id))?.role, "SUPER_ADMIN");
      assert.deepEqual(await roleOf(demoted.id), { role: "ADMIN", grantedById: survivor.id });

      const trail = [...(await audits(a.id)), ...(await audits(b.id))];
      assert.equal(trail.length, 1, JSON.stringify(trail));
      assert.equal(trail[0]!.actorId, survivor.id);
      assert.deepEqual([trail[0]!.operation, trail[0]!.before, trail[0]!.after], ["change", { role: "SUPER_ADMIN" }, { role: "ADMIN" }]);

      // Olay audit ile aynı transaction'da: kaybeden işlem olay da yazmaz (KV-21 PR-2).
      const events = await eventsAbout(a.id, b.id);
      assert.deepEqual(
        events.map((e) => [e.type, e.actorId, e.subjectId, e.payload]),
        [["role.changed", survivor.id, demoted.id, { previousRoles: ["SUPER_ADMIN"], roles: ["ADMIN"] }]],
      );
    });
  });

  /**
   * Kaybeden isteğin sonucu zamanlamaya bağlıdır ve ikisi de doğrudur: BAN, aktörün oturumlarını aynı transaction'da
   * iptal eder. Kaybedenin oturum kontrolü kazananın commit'inden sonra çalışırsa oturum artık geçersizdir (401
   * UNAUTHENTICATED); önce çalışırsa transaction içi taze yetki kontrolü aktörü BANNED görür (403 FORBIDDEN). Son aktif
   * SUPER_ADMIN kuralına (409) hiç gelinmez: SUPER_ADMIN kilidi yetki kontrolünden önce alınır.
   */
  test("yarış: iki SUPER_ADMIN birbirini aynı anda banlar → biri 201, diğeri 403 (aktör BANNED) veya 401 (oturumu iptal edildi); tek aktif SUPER_ADMIN kalır", async () => {
    await withOnlyTwoSuperAdmins(async (a, b) => {
      const ban = (target: User, actor: User) =>
        send("POST", `/admin/users/${target.id}/sanctions`, { type: "BAN", endsAt: null, reason: "Hesap ele geçirildi" }, actor.cookie);
      const results = await Promise.all([ban(b, a), ban(a, b)]);
      const winners = results.filter((r) => r.statusCode === 201);
      assert.equal(winners.length, 1, failure(results));
      const loser = results.find((r) => r.statusCode !== 201)!;
      if (loser.statusCode === 401) assertError(loser, 401, "UNAUTHENTICATED");
      else assertError(loser, 403, "FORBIDDEN");
      assert.equal(await activeSuperAdmins(), 1);
      assert.equal(await db.sanction.count({ where: { userId: { in: [a.id, b.id] } } }), 1);
      const events = await eventsAbout(a.id, b.id);
      assert.deepEqual(events.map((e) => e.type), ["sanction.applied"]);
    });
  });
});
