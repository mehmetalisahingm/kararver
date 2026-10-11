/**
 * #181 yönetici başlatmalı şifre sıfırlama: admin.users.passwordReset.send.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env). audit_logs append-only ve test DB'si dosyalar arasında
 * sıfırlanmaz: sorgular her testin yeni kullanıcısına göre yapılır. Üstteki iki test veritabanı istemez (route birimi).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, headers } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { registerAdminUserRoutes } from "../src/modules/admin-users/routes.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string; password: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const REASON = "Kullanıcı e-postasına erişimi olmadığını destek kanalından kanıtladı";

function routeUnit(store: any, mailer: { send: (mail: any) => Promise<void> }) {
  const handlers = new Map<string, any>();
  registerAdminUserRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, {
    store,
    now: () => new Date("2026-10-11T10:00:00Z"),
    mediaPublicBaseUrl: "https://media.test",
    mailer,
    tokenPepper: "pepper",
    webUrl: "https://web.test",
  });
  return handlers.get("admin.users.passwordReset.send");
}

const unitStore = (issue: (input: any) => Promise<any>) => ({
  target: async () => ({ id: "u", role: null, status: "ACTIVE", deleted: false }),
  issuePasswordReset: issue,
});
const unitCtx = { params: { id: "u" }, body: { reason: REASON }, viewer: { id: "admin", roles: ["ADMIN"] }, request: { id: "req", log: { error() {} } }, authorize: async () => {} };

test("e-posta servisi hata verirse sent=false döner; token yanıtta yok, store'a yalnız özet gider", async () => {
  let input: any;
  const handler = routeUnit(
    unitStore(async (value) => {
      input = value;
      return { kind: "issued", email: "kullanici@example.test" };
    }),
    {
      send: async () => {
        throw new Error("smtp down");
      },
    },
  );
  const res = await handler(unitCtx);
  assert.equal(res.status, 202);
  assert.equal(res.body.data.sent, false);
  assert.deepEqual(Object.keys(res.body.data).sort(), ["expiresAt", "sent"]);
  assert.match(input.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(input.token, undefined);
  assert.equal(input.expiresAt.getTime() - new Date("2026-10-11T10:00:00Z").getTime(), HOUR);
});

test("sınır aşımı 429 RATE_LIMITED + Retry-After; yasaklı ve silinmiş 409; kayıp hedef 404", async () => {
  const limited = routeUnit(unitStore(async () => ({ kind: "limited", retryAfterMs: 41_200 })), { send: async () => {} });
  await assert.rejects(limited(unitCtx), (e: any) => e.code === "RATE_LIMITED" && e.headers[headers.retryAfter] === "42");
  const banned = routeUnit(unitStore(async () => ({ kind: "rejected", reason: "user_banned" })), { send: async () => {} });
  await assert.rejects(banned(unitCtx), (e: any) => e.code === "CONFLICT" && e.details[0].code === "user_banned");
  const deleted = routeUnit(unitStore(async () => ({ kind: "rejected", reason: "user_deleted" })), { send: async () => {} });
  await assert.rejects(deleted(unitCtx), (e: any) => e.code === "CONFLICT" && e.details[0].code === "user_deleted");
  const missing = routeUnit(unitStore(async () => ({ kind: "rejected", reason: "not_found" })), { send: async () => {} });
  await assert.rejects(missing(unitCtx), { code: "NOT_FOUND" });
});

describe("admin şifre sıfırlama (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdmin: User;
  let admin: User;
  let moderator: User;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    superAdmin = await signUp();
    await db.userRole.create({ data: { userId: superAdmin.id, role: "SUPER_ADMIN" } });
    admin = await staff("ADMIN");
    moderator = await staff("MODERATOR");
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `pr_${id}@example.test`, username: `pr_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username, email: account.email, password: account.password };
  }

  async function staff(role: "ADMIN" | "MODERATOR"): Promise<User> {
    const user = await signUp();
    await db.userRole.create({ data: { userId: user.id, role, grantedById: superAdmin.id } });
    return user;
  }

  const reset = (userId: string, cookie = admin.cookie, reason: unknown = REASON) =>
    send("POST", `/admin/users/${userId}/password-reset`, { reason }, cookie);
  const auditOf = (userId: string) =>
    db.auditLog.findMany({ where: { action: "user.password.reset", targetType: "USER", targetId: userId }, orderBy: { createdAt: "asc" } });
  const mailsTo = (email: string) => h.mails.filter((m) => m.to === email);
  const openTokens = (userId: string) => db.authToken.count({ where: { userId, purpose: "PASSWORD_RESET", usedAt: null } });

  // ─── Yetki ──────────────────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve moderatör 403; ADMIN admin hedefe 403, SUPER_ADMIN'e izin; kendine 403; olmayan kullanıcı 404", async () => {
    const user = await signUp();
    const peerAdmin = await staff("ADMIN");
    assertError(await reset(user.id, ""), 401, "UNAUTHENTICATED");
    assertError(await reset(user.id, user.cookie), 403, "FORBIDDEN");
    assertError(await reset(user.id, moderator.cookie), 403, "FORBIDDEN");
    assertError(await reset(peerAdmin.id, admin.cookie), 403, "FORBIDDEN");
    assertError(await reset(admin.id, admin.cookie), 403, "FORBIDDEN");
    assertError(await reset(randomUUID(), admin.cookie), 404, "NOT_FOUND");
    assert.equal(mailsTo(user.email).length, 1, "yalnız kayıt doğrulama maili var; hiçbir reddedilen istek mail göndermedi");
    assert.equal(mailsTo(peerAdmin.email).length, 1);
    assert.equal((await reset(peerAdmin.id, superAdmin.cookie)).statusCode, 202);
    for (const u of [user, peerAdmin]) assert.equal((await auditOf(u.id)).length, u.id === peerAdmin.id ? 1 : 0);
    assert.equal(await openTokens(user.id), 0);
  });

  test("gerekçe zorunlu: eksik, boş ve kısa gerekçe 400; hiçbir iz bırakmaz", async () => {
    const user = await signUp();
    assertError(await send("POST", `/admin/users/${user.id}/password-reset`, {}, admin.cookie), 400, "VALIDATION_ERROR");
    assertError(await reset(user.id, admin.cookie, "  "), 400, "VALIDATION_ERROR");
    assertError(await reset(user.id, admin.cookie, "ab"), 400, "VALIDATION_ERROR");
    assert.equal((await auditOf(user.id)).length, 0);
    assert.equal(await openTokens(user.id), 0);
  });

  // ─── Başarılı akış ──────────────────────────────────────────

  test("gönderim: yanıtta token/bağlantı yok; mail kullanıcının adresine gider, bağlantı çalışır ve oturumları kapatır; audit ham sır içermez", async () => {
    const user = await signUp();
    const before = mailsTo(user.email).length;
    const res = await reset(user.id);
    assert.equal(res.statusCode, 202, res.body);
    const data = res.json().data;
    assert.deepEqual(Object.keys(data).sort(), ["expiresAt", "sent"]);
    assert.equal(data.sent, true);
    assert.equal(new Date(data.expiresAt).getTime() - h.clock.now.getTime(), HOUR);

    const mails = mailsTo(user.email);
    assert.equal(mails.length, before + 1);
    const mail = mails.at(-1)!;
    assert.match(mail.text, /yönetici/);
    const token = tokenFrom(mail);
    assert.equal(res.body.includes(token), false, "token yanıtta görünmez");

    const [entry, ...others] = await auditOf(user.id);
    assert.equal(others.length, 0);
    assert.equal(entry!.actorId, admin.id);
    assert.equal(entry!.operation, "send");
    assert.equal(entry!.reason, REASON);
    assert.ok(entry!.requestId);
    assert.deepEqual(entry!.after, { expiresAt: data.expiresAt });
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes(user.email), false);

    // Mevcut şifre bağlantı kullanılana kadar çalışır; bağlantı yeni şifre belirletir ve bütün oturumları kapatır.
    assert.equal((await send("POST", "/auth/login", { email: user.email, password: user.password })).statusCode, 200);
    assert.equal((await send("GET", "/me", undefined, user.cookie)).statusCode, 200);
    const newPassword = "yeni-guclu-sifre-2";
    const done = await send("POST", "/auth/password/reset", { token, password: newPassword });
    assert.equal(done.statusCode, 204, done.body);
    assert.equal((await send("GET", "/me", undefined, user.cookie)).statusCode, 401);
    assert.equal((await send("POST", "/auth/login", { email: user.email, password: user.password })).statusCode, 401);
    assert.equal((await send("POST", "/auth/login", { email: user.email, password: newPassword })).statusCode, 200);
    assert.equal((await send("POST", "/auth/password/reset", { token, password: "baska-guclu-sifre-3" })).statusCode, 400, "bağlantı tek kullanımlık");
  });

  test("askıya alınmış (SUSPENDED) hesaba da gönderilir; yasaklı 409 user_banned, silinmiş 409 user_deleted; ikisi de iz bırakmaz", async () => {
    const suspended = await signUp();
    await db.user.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
    assert.equal((await reset(suspended.id)).statusCode, 202);

    const banned = await signUp();
    await db.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
    assertError(await reset(banned.id), 409, "CONFLICT", "user_banned");
    const deleted = await signUp();
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: h.clock.now } });
    assertError(await reset(deleted.id), 409, "CONFLICT", "user_deleted");
    for (const u of [banned, deleted]) {
      assert.equal((await auditOf(u.id)).length, 0);
      assert.equal(await openTokens(u.id), 0);
      assert.equal(mailsTo(u.email).length, 1, "yalnız kayıt doğrulama maili");
    }
  });

  // ─── Sıklık sınırı ve yarış ─────────────────────────────────

  test("çift tıklama: ikinci istek 429 + Retry-After, yeni token ve mail üretmez; bekleme sonrası yeni bağlantı eskisini geçersiz kılar", async () => {
    const user = await signUp();
    const first = await reset(user.id);
    assert.equal(first.statusCode, 202);
    const firstToken = tokenFrom(mailsTo(user.email).at(-1));

    h.clock.advance(10 * 1000);
    const second = await reset(user.id);
    assertError(second, 429, "RATE_LIMITED");
    assert.equal(second.headers["retry-after"], "50");
    assert.equal(mailsTo(user.email).length, 2, "kayıt doğrulama + tek sıfırlama maili");
    assert.equal((await auditOf(user.id)).length, 1);
    assert.equal(await openTokens(user.id), 1);

    h.clock.advance(51 * 1000);
    assert.equal((await reset(user.id)).statusCode, 202);
    assert.equal(await openTokens(user.id), 1, "önceki kullanılmamış token geçersiz kılındı");
    const secondToken = tokenFrom(mailsTo(user.email).at(-1));
    assert.notEqual(secondToken, firstToken);
    assert.equal((await send("POST", "/auth/password/reset", { token: firstToken, password: "yeni-guclu-sifre-2" })).statusCode, 400);
    assert.equal((await send("POST", "/auth/password/reset", { token: secondToken, password: "yeni-guclu-sifre-2" })).statusCode, 204);
  });

  test("saatte en çok 5: altıncı 429; en eski kayıt pencereden çıkınca yeniden izinli", async () => {
    const user = await signUp();
    for (let i = 0; i < 5; i++) {
      assert.equal((await reset(user.id)).statusCode, 202, `istek ${i + 1}`);
      h.clock.advance(61 * 1000);
    }
    const sixth = await reset(user.id);
    assertError(sixth, 429, "RATE_LIMITED");
    assert.ok(Number(sixth.headers["retry-after"]) > 0);
    assert.equal((await auditOf(user.id)).length, 5);
    h.clock.advance(HOUR);
    assert.equal((await reset(user.id)).statusCode, 202);
    assert.equal((await auditOf(user.id)).length, 6);
  });

  test("sınır hesap başınadır: aynı anda iki yöneticinin istekleri bir hesabı en çok bir kez tetikler; başka hesap etkilenmez", async () => {
    const user = await signUp();
    const other = await signUp();
    const results = await Promise.all([reset(user.id, admin.cookie), reset(user.id, superAdmin.cookie), reset(user.id, admin.cookie), reset(other.id, admin.cookie)]);
    const statuses = results.slice(0, 3).map((r) => r.statusCode).sort();
    assert.deepEqual(statuses, [202, 429, 429]);
    assert.equal(results[3]!.statusCode, 202);
    assert.equal((await auditOf(user.id)).length, 1);
    assert.equal(await openTokens(user.id), 1);
    assert.equal(mailsTo(user.email).length, 2, "kayıt doğrulama + tek sıfırlama maili");
  });
});
