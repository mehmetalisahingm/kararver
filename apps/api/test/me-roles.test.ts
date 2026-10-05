/**
 * /me ve giriş cevabındaki `roles` alanı `user_roles`'tan okunur (yönetim ekranlarının menü/düğme gizlemesi bunu kullanır).
 * Yetkinin kendisi her istekte sunucuda verilir; burada yalnız ekranın doğru rolü görmesi sınanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Me } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("/me rolleri (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let superAdminId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    superAdminId = (await signUp()).id;
    await db.userRole.create({ data: { userId: superAdminId, role: "SUPER_ADMIN" } });
  });
  after(async () => {
    await h?.close();
  });

  const send = (method: "GET" | "POST", url: string, body?: unknown, cookie?: string) =>
    h.app.inject({
      method,
      url: `/v1${url}`,
      headers: { origin: WEB_ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `me_${id}@example.test`, username: `me_${id}`, displayName: "Kullanıcı", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { account, login, cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  test("rolü olmayan hesap USER; yönetici ve moderatör kendi rolünü hem girişte hem /me'de görür", async () => {
    const user = await signUp();
    assert.deepEqual(Me.parse(user.login.json().data).roles, ["USER"]);
    assert.deepEqual((await send("GET", "/me", undefined, user.cookie)).json().data.roles, ["USER"]);

    for (const role of ["MODERATOR", "ADMIN"] as const) {
      const staff = await signUp();
      await db.userRole.create({ data: { userId: staff.id, role, grantedById: superAdminId } });
      const relogin = await send("POST", "/auth/login", { email: staff.account.email, password: staff.account.password });
      assert.deepEqual(Me.parse(relogin.json().data).roles, [role]);
      assert.deepEqual((await send("GET", "/me", undefined, staff.cookie)).json().data.roles, [role]);
    }
  });

  test("rol değişimi açık oturumda bir sonraki /me isteğinde görünür; rol alınınca USER'a döner", async () => {
    const user = await signUp();
    assert.deepEqual((await send("GET", "/me", undefined, user.cookie)).json().data.roles, ["USER"]);

    await db.userRole.create({ data: { userId: user.id, role: "ADMIN", grantedById: superAdminId } });
    assert.deepEqual((await send("GET", "/me", undefined, user.cookie)).json().data.roles, ["ADMIN"]);

    await db.userRole.deleteMany({ where: { userId: user.id } });
    assert.deepEqual((await send("GET", "/me", undefined, user.cookie)).json().data.roles, ["USER"]);
  });

  test("profil güncelleme cevabı da gerçek rolü taşır", async () => {
    const staff = await signUp();
    await db.userRole.create({ data: { userId: staff.id, role: "ADMIN", grantedById: superAdminId } });
    const res = await h.app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: staff.cookie },
      payload: JSON.stringify({ displayName: "Yeni Ad" }),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.roles, ["ADMIN"]);
  });
});
