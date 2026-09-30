/** KV-15 (#17) ilgi seçimi / onboarding entegrasyon testleri. Gerçek PostgreSQL gerektirir. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("KV-15 onboarding (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let cookie: string;
  let userId: string;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    const account = await signUp();
    cookie = account.cookie;
    userId = account.id;
  });

  after(async () => h?.close());

  function request(method: "GET" | "PUT" | "POST", url: string, body?: unknown, authCookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(authCookie ? { cookie: authCookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function assertError(res: { statusCode: number; body: string; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = {
      email: `onboarding_${id}@example.test`,
      username: `onboard_${id}`,
      displayName: "Onboarding Kullanıcısı",
      password: "guclu-bir-sifre-1",
    };
    const mailCount = h.mails.length;
    assert.equal((await request("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await request("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await request("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function category(active = true) {
    const suffix = randomUUID().slice(0, 8);
    return db.category.create({
      data: { slug: `kv15-${suffix}`, name: `KV15 ${suffix}`, sortOrder: 9000, isActive: active },
      select: { id: true },
    });
  }

  test("misafir ilgi alanlarını okuyamaz veya yazamaz", async () => {
    assertError(await request("GET", "/me/interests"), 401, "UNAUTHENTICATED");
    assertError(await request("PUT", "/me/interests", { categoryIds: [] }), 401, "UNAUTHENTICATED");
  });

  test("yeni kullanıcı boş ilgi listesiyle başlar", async () => {
    const res = await request("GET", "/me/interests", undefined, cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.categoryIds, []);
  });

  test("seçimler tam liste olarak kaydedilir ve sonradan değiştirilebilir", async () => {
    const a = await category();
    const b = await category();
    let res = await request("PUT", "/me/interests", { categoryIds: [a.id, b.id] }, cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(new Set(res.json().data.categoryIds), new Set([a.id, b.id]));

    res = await request("PUT", "/me/interests", { categoryIds: [b.id] }, cookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.categoryIds, [b.id]);
    assert.equal(await db.userInterest.count({ where: { userId } }), 1);
  });

  test("boş liste onboarding'i atlar ve mevcut tercihleri temizler", async () => {
    const a = await category();
    assert.equal((await request("PUT", "/me/interests", { categoryIds: [a.id] }, cookie)).statusCode, 200);
    const cleared = await request("PUT", "/me/interests", { categoryIds: [] }, cookie);
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json().data.categoryIds, []);
    assert.equal(await db.userInterest.count({ where: { userId } }), 0);
  });

  test("pasif/bilinmeyen kategori eski seçimleri bozmadan reddedilir", async () => {
    const current = await category();
    const inactive = await category(false);
    assert.equal((await request("PUT", "/me/interests", { categoryIds: [current.id] }, cookie)).statusCode, 200);

    assertError(await request("PUT", "/me/interests", { categoryIds: [inactive.id] }, cookie), 400, "VALIDATION_ERROR");
    assertError(await request("PUT", "/me/interests", { categoryIds: [randomUUID()] }, cookie), 400, "VALIDATION_ERROR");

    const after = await request("GET", "/me/interests", undefined, cookie);
    assert.deepEqual(after.json().data.categoryIds, [current.id]);
  });

  test("aynı kategori iki kez gönderilemez", async () => {
    const a = await category();
    assertError(await request("PUT", "/me/interests", { categoryIds: [a.id, a.id] }, cookie), 400, "VALIDATION_ERROR");
  });
});
