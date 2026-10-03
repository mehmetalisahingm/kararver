/** KV-25 (#27) kaynak ölçümlü paylaşım linki entegrasyon testleri. Gerçek PostgreSQL gerektirir. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaShareStore } from "../src/modules/shares/prisma-store.ts";
import { prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN } from "./support/harness.ts";

const backendFactory = prismaBackend();

describe("KV-25 share links (postgres)", { skip: backendFactory ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let backend: Awaited<ReturnType<NonNullable<typeof backendFactory>["create"]>>;
  let db: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let mails: { text: string }[];
  let user: { id: string; email: string; cookie: string };
  let categoryId: string;

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
      shareStore: createPrismaShareStore(db),
      logger: false,
    });
    await app.ready();
    user = await signUp();
    const suffix = randomUUID().slice(0, 8);
    categoryId = (await db.category.create({
      data: { slug: `kv25-${suffix}`, name: `KV25 ${suffix}`, sortOrder: 9250, isActive: true },
      select: { id: true },
    })).id;
  });

  after(async () => {
    await app?.close();
    await backend?.close();
  });

  function request(id: string, channel: string) {
    return app.inject({
      method: "POST",
      url: `/v1/polls/${id}/shares`,
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ channel }),
    });
  }

  async function signUp() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const account = {
      email: `kv25_${suffix}@example.test`,
      username: `kv25_${suffix}`,
      displayName: "KV25 kullanıcı",
      password: "guclu-bir-sifre-1",
    };
    const mailIndex = mails.length;
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify(account),
    });
    assert.equal(register.statusCode, 202, register.body);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verify",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ token: tokenFrom(mails[mailIndex] as any) }),
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ email: account.email, password: account.password }),
    });
    assert.equal(login.statusCode, 200, login.body);
    return { id: login.json().data.id as string, email: account.email, cookie: sessionCookie(login.headers["set-cookie"]) };
  }

  async function seedPoll(title: string, status: "ACTIVE" | "LOCKED" | "HIDDEN" | "REMOVED") {
    const id = randomUUID();
    const publicId = randomUUID().replaceAll("-", "").slice(0, 8);
    const slug = title.toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await db.poll.create({
      data: {
        id,
        publicId,
        slug,
        authorId: user.id,
        categoryId,
        kind: "POLL",
        title,
        description: "KV-25 paylaşım ve gizlilik testi için açıklama.",
        status,
        resultsVisibility: "AFTER_VOTE",
        allowComments: true,
        opensAt: new Date("2026-10-03T12:00:00Z"),
        closesAt: new Date("2099-01-01T00:00:00.000Z"),
        options: { create: [{ label: "Bir", position: 0 }, { label: "İki", position: 1 }] },
      },
    });
    return { id, publicId, slug };
  }

  test("aktif içerik için yalnız opak src taşıyan canonical paylaşım linki üretir", async () => {
    const poll = await seedPoll("KV25 paylaşım linki aktif anket", "ACTIVE");
    const response = await request(poll.id, "copy");
    assert.equal(response.statusCode, 201, response.body);
    const data = response.json().data as { shareId: string; url: string };
    const url = new URL(data.url);
    assert.equal(url.origin, WEB_ORIGIN);
    assert.equal(url.pathname, `/karar/${poll.slug}-${poll.publicId}`);
    assert.equal(url.searchParams.get("src"), data.shareId);
    assert.deepEqual([...url.searchParams.keys()], ["src"]);
    assert.ok(!data.url.includes(user.email));
    assert.ok(!data.url.includes(user.id));
    assert.equal(await db.shareLink.count({ where: { id: data.shareId, pollId: poll.id, channel: "copy" } }), 1);
  });

  test("kilitli içerik paylaşılabilir; gizli veya kaldırılmış içerik için kayıt üretmez", async () => {
    const locked = await seedPoll("KV25 paylaşım linki kilitli anket", "LOCKED");
    const hidden = await seedPoll("KV25 paylaşım linki gizli anket", "HIDDEN");
    const removed = await seedPoll("KV25 paylaşım linki kaldırılmış anket", "REMOVED");

    assert.equal((await request(locked.id, "x")).statusCode, 201);
    assert.equal((await request(hidden.id, "whatsapp")).statusCode, 404);
    assert.equal((await request(removed.id, "other")).statusCode, 404);
    assert.equal(await db.shareLink.count({ where: { pollId: { in: [hidden.id, removed.id] } } }), 0);
  });

  test("sözleşme dışı kanal reddedilir", async () => {
    const poll = await seedPoll("KV25 geçersiz kanal anketi", "ACTIVE");
    const response = await request(poll.id, "email");
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(await db.shareLink.count({ where: { pollId: poll.id } }), 0);
  });
});
