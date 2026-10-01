/**
 * KV-47 (#49) N+1 regresyon testi: liste uç noktalarının SQL sorgu sayısı sayfa boyutundan bağımsız olmalı.
 * Gerçek PostgreSQL gerektirir. Sayım, createPrismaClient'ın onQuery kancasıyla yapılır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaAuthStore } from "../src/modules/auth/prisma-store.ts";
import { createPrismaCommentStore } from "../src/modules/comments/prisma-store.ts";
import { createPrismaFeedStore } from "../src/modules/feed/prisma-store.ts";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { createPrismaRbacStore } from "../src/modules/rbac/prisma-store.ts";
import { createPrismaSearchStore } from "../src/modules/search/prisma-store.ts";
import { prismaBackend } from "./support/harness.ts";

const backend = prismaBackend();

describe("sorgu sayısı sayfa boyutundan bağımsız (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let counted: PrismaClient;
  let app: FastifyInstance;
  let queries = 0;
  let categoryId: string;
  let pollId: string;
  const marker = `nplus${randomUUID().replace(/[0-9-]/g, "").slice(0, 8)}`;

  before(async () => {
    const harness = await backend!.create(); // migration'ları uygular
    db = harness.prisma!;
    counted = createPrismaClient(process.env.TEST_DATABASE_URL, { onQuery: () => void queries++ });
    app = buildApp({
      config: loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "silent",
        WEB_URL: "http://localhost:3000",
        API_URL: "http://localhost:4000",
        SESSION_COOKIE_SECURE: "false",
        AUTH_TOKEN_PEPPER: "test-pepper-0123456789-abcdefghijklmnop",
        MAIL_FROM: "KararVer <no-reply@localhost>",
        MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
      }),
      authStore: createPrismaAuthStore(counted),
      rbacStore: createPrismaRbacStore(counted),
      pollStore: createPrismaPollStore(counted),
      searchStore: createPrismaSearchStore(counted),
      feedStore: createPrismaFeedStore(counted),
      commentStore: createPrismaCommentStore(counted),
      hasher: createArgon2Hasher(),
      mailer: { send: async () => {} },
    });
    await app.ready();

    // 25 anket (farklı yazarlar, seçenekler, etiketler) ve bir ankette 25 yorum.
    categoryId = (await db.category.create({ data: { slug: `nq-${randomUUID().slice(0, 8)}`, name: "N+1" } })).id;
    const users = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        db.user.create({
          data: { email: `nq${i}-${marker}@x.test`, emailNormalized: `nq${i}-${marker}@x.test`, username: `nq${i}${marker}`.slice(0, 30), usernameNormalized: `nq${i}${marker}`.slice(0, 30), displayName: "N", passwordHash: "x" },
          select: { id: true },
        }),
      ),
    );
    const tag = await db.tag.create({ data: { slug: `nq-${randomUUID().slice(0, 8)}`, name: "nq" } });
    for (const [i, u] of users.entries()) {
      const p = await db.poll.create({
        data: {
          publicId: `nq${randomUUID().slice(0, 8)}`,
          slug: `nq-${i}`,
          authorId: u.id,
          categoryId,
          title: `${marker} anket ${i}`,
          closesAt: new Date(Date.now() + 86_400_000),
          options: { create: [{ label: "A", position: 0 }, { label: "B", position: 1 }, { label: "C", position: 2 }] },
          tags: { create: [{ tagId: tag.id }] },
        },
        select: { id: true },
      });
      pollId ??= p.id;
    }
    for (const u of users) await db.comment.create({ data: { pollId, authorId: u.id, body: "yorum" } });
  });
  after(async () => {
    await app?.close();
    await counted?.$disconnect();
    await db?.$disconnect();
  });

  async function count(url: string) {
    queries = 0;
    const res = await app.inject({ method: "GET", url: `/v1${url}` });
    assert.equal(res.statusCode, 200, res.body);
    return queries;
  }

  for (const [label, url] of [
    ["feed new", (n: number) => `/feed?tab=new&categoryId=__CAT__&limit=${n}`],
    ["feed for_you", (n: number) => `/feed?tab=for_you&categoryId=__CAT__&limit=${n}`],
    ["arama", (n: number) => `/search?q=__MARKER__&limit=${n}`],
    ["yorumlar", (n: number) => `/polls/__POLL__/comments?limit=${n}`],
  ] as const) {
    test(`${label}: 2, 10 ve 25 kartta aynı sorgu sayısı`, async () => {
      const fill = (n: number) => url(n).replace("__CAT__", categoryId).replace("__MARKER__", marker).replace("__POLL__", pollId);
      const counts = [await count(fill(2)), await count(fill(10)), await count(fill(25))];
      assert.equal(new Set(counts).size, 1, `${label} sorgu sayıları: ${counts.join(", ")}`);
      assert.ok(counts[0]! <= 20, `${label} istek başına ${counts[0]} sorgu (beklenen ≤ 20)`);
    });
  }
});
