// KV-47 (#49) N+1 taraması: her uç noktanın istek başına SQL sorgu sayısı, sayfa boyutu 5 ve 20 ile.
// Sorgu sayısı sayfa boyutuyla artıyorsa N+1 vardır.
//   PERF_DATABASE_URL=postgresql://.../kararver_perf node apps/api/perf/query-count.ts
import { createPrismaClient } from "@kararver/db";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { createPrismaAuthStore } from "../src/modules/auth/prisma-store.ts";
import { createPrismaCommentStore } from "../src/modules/comments/prisma-store.ts";
import { createPrismaFeedStore } from "../src/modules/feed/prisma-store.ts";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { createPrismaRbacStore } from "../src/modules/rbac/prisma-store.ts";
import { createPrismaSearchStore } from "../src/modules/search/prisma-store.ts";
import { createPrismaTrendStore } from "../src/modules/trends/prisma-store.ts";
import { createPrismaVoteStore } from "../src/modules/votes/prisma-store.ts";
import { PERF } from "./profile.ts";

let count = 0;
const prisma = createPrismaClient(process.env.PERF_DATABASE_URL!, { onQuery: () => void count++ });
const WEB = "http://localhost:3000";
const config = loadConfig({
  APP_ENV: "local",
  LOG_LEVEL: "silent",
  WEB_URL: WEB,
  API_URL: "http://127.0.0.1:4199",
  SESSION_COOKIE_SECURE: "false",
  AUTH_TOKEN_PEPPER: "perf-pepper-0123456789abcdefghijklmnop",
  MAIL_FROM: "KararVer <perf@localhost>",
  MEDIA_PUBLIC_BASE_URL: "http://cdn.perf/media",
});
const app = buildApp({
  config,
  authStore: createPrismaAuthStore(prisma),
  rbacStore: createPrismaRbacStore(prisma),
  pollStore: createPrismaPollStore(prisma),
  searchStore: createPrismaSearchStore(prisma),
  feedStore: createPrismaFeedStore(prisma),
  trendStore: createPrismaTrendStore(prisma),
  voteStore: createPrismaVoteStore(prisma),
  commentStore: createPrismaCommentStore(prisma),
  hasher: createArgon2Hasher(),
  mailer: { send: async () => {} },
});
await app.ready();

const login = await app.inject({
  method: "POST",
  url: "/v1/auth/login",
  headers: { origin: WEB, "content-type": "application/json" },
  payload: JSON.stringify({ email: `perf${PERF.authors + 1}@perf.test`, password: PERF.password }),
});
const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
const [poll] = await prisma.$queryRaw<{ id: string; option: string }[]>`
  SELECT p.id::text, o.id::text AS option FROM polls p JOIN poll_options o ON o.poll_id = p.id
  WHERE p.kind = 'POLL' AND p.closes_at > now() + interval '1 hour' ORDER BY p.comment_count DESC LIMIT 1`;

async function measure(label: string, url: string, auth: boolean, method: "GET" | "PUT" = "GET", body?: unknown) {
  count = 0;
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: { ...(auth ? { cookie } : {}), ...(body ? { origin: WEB, "content-type": "application/json" } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { label, status: res.statusCode, queries: count };
}

const rows = [];
for (const auth of [false, true]) {
  const who = auth ? "giriş" : "misafir";
  for (const limit of [5, 20]) {
    rows.push(await measure(`feed for_you (${who}, ${limit})`, `/feed?tab=for_you&limit=${limit}`, auth));
    rows.push(await measure(`feed new (${who}, ${limit})`, `/feed?tab=new&limit=${limit}`, auth));
    rows.push(await measure(`search (${who}, ${limit})`, `/search?q=hangisini&limit=${limit}`, auth));
    rows.push(await measure(`trends (${who}, ${limit})`, `/trends/WEEKLY_MOST_VOTED?limit=${limit}`, auth));
    rows.push(await measure(`comments (${who}, ${limit})`, `/polls/${poll!.id}/comments?limit=${limit}`, auth));
  }
  rows.push(await measure(`poll detail (${who})`, `/polls/${poll!.id}`, auth));
}
rows.push(await measure("vote (giriş)", `/polls/${poll!.id}/vote`, true, "PUT", { optionId: poll!.option }));
console.log("| İstek | Durum | SQL sorgusu |\n|---|---|---|");
for (const r of rows) console.log(`| ${r.label} | ${r.status} | ${r.queries} |`);
await app.close();
await prisma.$disconnect();
