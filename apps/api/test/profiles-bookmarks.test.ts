/** KV-22 (#24) public profil + private bookmark entegrasyon testleri. Gerçek PostgreSQL gerektirir. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { createPrismaProfileStore } from "../src/modules/profiles/prisma-store.ts";
import { prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN } from "./support/harness.ts";

const backendFactory = prismaBackend();

describe("KV-22 profiles/bookmarks (postgres)", { skip: backendFactory ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let backend: Awaited<ReturnType<NonNullable<typeof backendFactory>["create"]>>;
  let db: PrismaClient;
  let app: ReturnType<typeof buildApp>;
  let mails: { text: string }[];
  let first: { id: string; username: string; cookie: string };
  let second: { id: string; username: string; cookie: string };
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
      pollStore: createPrismaPollStore(db),
      profileStore: createPrismaProfileStore(db),
      logger: false,
    });
    await app.ready();
    first = await signUp("birinci");
    second = await signUp("ikinci");
    const suffix = randomUUID().slice(0, 8);
    categoryId = (await db.category.create({
      data: { slug: `kv22-${suffix}`, name: `KV22 ${suffix}`, sortOrder: 9100, isActive: true },
      select: { id: true },
    })).id;
  });

  after(async () => {
    await app?.close();
    await backend?.close();
  });

  function request(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function signUp(prefix: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const account = {
      email: `${prefix}_${suffix}@example.test`,
      username: `${prefix}_${suffix}`,
      displayName: `${prefix} kullanıcı`,
      password: "guclu-bir-sifre-1",
    };
    const mailIndex = mails.length;
    assert.equal((await request("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await request("POST", "/auth/email/verify", { token: tokenFrom(mails[mailIndex] as any) })).statusCode, 200);
    const login = await request("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { id: login.json().data.id as string, username: account.username, cookie: sessionCookie(login.headers["set-cookie"]) };
  }

  async function seedPoll(authorId: string, title: string, createdAt: Date, status: "ACTIVE" | "LOCKED" | "REMOVED" = "ACTIVE") {
    const id = randomUUID();
    await db.poll.create({
      data: {
        id,
        publicId: randomUUID().replaceAll("-", "").slice(0, 8),
        slug: title.toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        authorId,
        categoryId,
        kind: "POLL",
        title,
        description: "KV-22 profil ve kaydetme testi için açıklama.",
        status,
        resultsVisibility: "ALWAYS",
        allowComments: true,
        opensAt: createdAt,
        closesAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt,
        updatedAt: createdAt,
        options: { create: [{ label: "Bir", position: 0 }, { label: "İki", position: 1 }] },
      },
    });
    return id;
  }

  test("public profil gerçek sayaçları verir ve profil düzenleme görünür", async () => {
    const pollId = await seedPoll(first.id, "Profil sayaçları için görünür anket", new Date("2026-09-30T10:00:00Z"));
    await db.poll.update({ where: { id: pollId }, data: { voteCount: 7 } });
    await seedPoll(first.id, "Kaldırılmış profil anketi sayaç dışı", new Date("2026-09-29T10:00:00Z"), "REMOVED");
    await db.comment.create({ data: { pollId, authorId: first.id, body: "Görünür yorum" } });

    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: first.cookie },
      payload: JSON.stringify({ displayName: "Güncel Profil", bio: "KV-22 biyografi" }),
    });
    assert.equal(patch.statusCode, 200, patch.body);

    const profile = await request("GET", `/profiles/${first.username}`);
    assert.equal(profile.statusCode, 200, profile.body);
    assert.equal(profile.json().data.displayName, "Güncel Profil");
    assert.equal(profile.json().data.bio, "KV-22 biyografi");
    assert.equal(profile.json().data.stats.pollCount, 1);
    assert.equal(profile.json().data.stats.votesReceived, 7);
    assert.equal(profile.json().data.stats.commentCount, 1);
  });

  test("kaydetme doğal idempotent; başka hesap private listeyi göremez; silme sayaç şişirmez", async () => {
    const pollId = await seedPoll(second.id, "Private bookmark görünürlük anketi", new Date("2026-10-01T08:00:00Z"));

    assert.equal((await request("PUT", `/polls/${pollId}/bookmark`, undefined, first.cookie)).statusCode, 200);
    assert.equal((await request("PUT", `/polls/${pollId}/bookmark`, undefined, first.cookie)).statusCode, 200);
    assert.equal(await db.bookmark.count({ where: { userId: first.id, pollId } }), 1);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId }, select: { saveCount: true } })).saveCount, 1);

    const mine = await request("GET", "/me/bookmarks?limit=10", undefined, first.cookie);
    assert.equal(mine.statusCode, 200, mine.body);
    assert.ok(mine.json().data.some((p: { id: string }) => p.id === pollId));

    const theirs = await request("GET", "/me/bookmarks?limit=10", undefined, second.cookie);
    assert.equal(theirs.statusCode, 200, theirs.body);
    assert.ok(!theirs.json().data.some((p: { id: string }) => p.id === pollId));

    assert.equal((await request("DELETE", `/polls/${pollId}/bookmark`, undefined, first.cookie)).statusCode, 200);
    assert.equal((await request("DELETE", `/polls/${pollId}/bookmark`, undefined, first.cookie)).statusCode, 200);
    assert.equal(await db.bookmark.count({ where: { userId: first.id, pollId } }), 0);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId }, select: { saveCount: true } })).saveCount, 0);
  });

  test("private bookmark listesi boş durum ve cursor pagination destekler", async () => {
    const empty = await request("GET", "/me/bookmarks?limit=2", undefined, second.cookie);
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().data, []);
    assert.equal(empty.json().page.hasMore, false);
    assert.equal(empty.json().page.nextCursor, null);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await seedPoll(second.id, `Bookmark pagination örneği ${i} uzun başlık`, new Date(Date.UTC(2026, 9, 1, 12, i)));
      ids.push(id);
      assert.equal((await request("PUT", `/polls/${id}/bookmark`, undefined, first.cookie)).statusCode, 200);
    }
    const firstPage = await request("GET", "/me/bookmarks?limit=2", undefined, first.cookie);
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.equal(firstPage.json().data.length, 2);
    assert.equal(firstPage.json().page.hasMore, true);
    assert.ok(firstPage.json().page.nextCursor);

    const secondPage = await request("GET", `/me/bookmarks?limit=2&cursor=${firstPage.json().page.nextCursor}`, undefined, first.cookie);
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    assert.ok(secondPage.json().data.length >= 1);
    const combined = [...firstPage.json().data, ...secondPage.json().data].map((p: { id: string }) => p.id);
    for (const id of ids) assert.ok(combined.includes(id));
  });
});
