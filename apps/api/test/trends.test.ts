/**
 * KV-28 (#30) trend listeleri API'si (trends.list), gerçek PostgreSQL ile. Sıralamayı worker'daki job yazar
 * (apps/worker/test/trends.test.ts); burada çalıştırmalar doğrudan DB'ye yazılır ve okuma kuralları test edilir.
 * "Güncel çalıştırma" en yeni pencere sonudur: testler mevcut en büyük pencere sonundan sonrasını kullanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, TrendPage } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();
type Format = "DAILY_RISING" | "WEEKLY_RISING" | "WEEKLY_MOST_VOTED" | "WEEKLY_MOST_DISCUSSED";

describe("trend listeleri (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let author: { cookie: string; id: string };
  const createdRuns: string[] = [];

  function send(method: "POST" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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
  const get = (url: string) => h.app.inject({ method: "GET", url: `/v1${url}` });

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `tr_${id}@example.test`, username: `tr_${id}`, displayName: "Trend", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  const newCategory = async () => (await db.category.create({ data: { slug: `tr-${randomUUID().slice(0, 8)}`, name: "Trend Testi" } })).id;

  async function createPoll(categoryId: string, resultsVisibility: "ALWAYS" | "AFTER_VOTE" = "ALWAYS") {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Trend ${randomUUID()}`, categoryId, durationHours: 168, resultsVisibility, options: [{ label: "A" }, { label: "B" }] },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  /** Mevcut bütün çalıştırmalardan sonraki pencere sonu: bu test "güncel çalıştırma"yı belirler. */
  async function nextWindowEnd() {
    const latest = await db.trendRun.findFirst({ orderBy: { windowEnd: "desc" }, select: { windowEnd: true } });
    return new Date(Math.max(latest?.windowEnd.getTime() ?? 0, h.clock.now.getTime()) + 5 * 60_000);
  }

  async function seedRun(format: Format, pollIds: string[], windowEnd: Date, status: "SUCCEEDED" | "FAILED" | "RUNNING" = "SUCCEEDED") {
    const run = await db.trendRun.create({
      data: {
        format,
        calculationVersion: 1,
        status,
        windowStart: new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000),
        windowEnd,
        startedAt: windowEnd,
        finishedAt: status === "RUNNING" ? null : new Date(windowEnd.getTime() + 30_000),
        scores: { create: pollIds.map((pollId, i) => ({ pollId, rank: i + 1, score: 100 - i, components: { voters: 100 - i } })) },
      },
    });
    createdRuns.push(run.id);
    return run;
  }

  async function walk(url: string, limit: number) {
    const seen: { id: string; rank: number }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${url}${url.includes("?") ? "&" : "?"}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      const page = TrendPage.parse(res.json());
      seen.push(...page.data.map((d) => ({ id: d.poll.id, rank: d.rank })));
      cursor = page.page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    return seen;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    author = await signUp();
  });
  after(async () => {
    // Uzak gelecek pencereli çalıştırmalar sonraki koşularda "güncel" kalmasın.
    if (db) await db.trendRun.deleteMany({ where: { id: { in: createdRuns } } });
    await h?.close();
  });

  test("Haftanın Değişkenleri KV-29'a kadar boş liste ve INSUFFICIENT_HISTORY", async () => {
    const res = await get("/trends/WEEKLY_MOVERS");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(TrendPage.parse(res.json()), { data: [], page: { nextCursor: null, hasMore: false }, meta: null, reason: "INSUFFICIENT_HISTORY" });
  });

  test("güncel başarılı çalıştırma okunur; sonraki başarısız/süren çalıştırma ekrana yansımaz; meta dolu", async () => {
    const cat = await newCategory();
    const [a, b] = [await createPoll(cat), await createPoll(cat)];
    const W = await nextWindowEnd();
    const ok = await seedRun("WEEKLY_MOST_VOTED", [b, a], W);
    await seedRun("WEEKLY_MOST_VOTED", [a], new Date(W.getTime() + 5 * 60_000), "FAILED");
    await seedRun("WEEKLY_MOST_VOTED", [a], new Date(W.getTime() + 10 * 60_000), "RUNNING");

    const page = TrendPage.parse((await get("/trends/WEEKLY_MOST_VOTED?limit=10")).json());
    assert.deepEqual(page.data.map((d) => [d.rank, d.poll.id, d.movement]), [[1, b, null], [2, a, null]]);
    assert.deepEqual(page.meta, {
      format: "WEEKLY_MOST_VOTED",
      computedAt: ok.finishedAt!.toISOString(),
      calculationVersion: 1,
      windowStart: ok.windowStart.toISOString(),
      windowEnd: W.toISOString(),
    });
    assert.equal(page.reason, undefined);
  });

  test("kategori filtresi: sıra numarası filtrelenmiş listede 1'den; AFTER_VOTE kartı misafire sonuç göstermez", async () => {
    const [x, y] = [await newCategory(), await newCategory()];
    const polls = [await createPoll(x), await createPoll(y, "AFTER_VOTE"), await createPoll(x), await createPoll(y)];
    await seedRun("DAILY_RISING", polls, await nextWindowEnd());

    assert.deepEqual(await walk("/trends/DAILY_RISING", 10), polls.map((id, i) => ({ id, rank: i + 1 })));
    assert.deepEqual(await walk(`/trends/DAILY_RISING?categoryId=${y}`, 10), [{ id: polls[1]!, rank: 1 }, { id: polls[3]!, rank: 2 }]);

    const card = TrendPage.parse((await get(`/trends/DAILY_RISING?categoryId=${y}&limit=1`)).json()).data[0]!.poll as Record<string, any>;
    assert.deepEqual(card.results, { visible: false }, "sayı yok");
  });

  test("çalıştırmadan sonra gizlenen veya trendden çıkarılan anket görünmez; sayfalar arası tekrar/kayıp yok", async () => {
    const cat = await newCategory();
    const polls: string[] = [];
    for (let i = 0; i < 6; i++) polls.push(await createPoll(cat));
    await seedRun("WEEKLY_RISING", polls, await nextWindowEnd());
    const url = `/trends/WEEKLY_RISING?categoryId=${cat}`;
    assert.deepEqual((await walk(url, 2)).map((s) => s.id), polls);

    // İlk sayfa (2 kart) alındıktan sonra: gösterilmiş biri gizlenir, gösterilmemiş biri trendden çıkarılır.
    const first = TrendPage.parse((await get(`${url}&limit=2`)).json());
    await db.poll.update({ where: { id: polls[0]! }, data: { status: "HIDDEN" } });
    await db.poll.update({ where: { id: polls[3]! }, data: { trendExcludedAt: h.clock.now } });
    const rest: { id: string; rank: number }[] = [];
    let cursor = first.page.nextCursor;
    while (cursor) {
      const page = TrendPage.parse((await get(`${url}&limit=2&cursor=${cursor}`)).json());
      rest.push(...page.data.map((d) => ({ id: d.poll.id, rank: d.rank })));
      cursor = page.page.nextCursor;
    }
    assert.deepEqual(rest.map((r) => r.id), [polls[2], polls[4], polls[5]]);
    // Yeni istekte sıra numaraları boşluksuz.
    assert.deepEqual(await walk(url, 10), [polls[1], polls[2], polls[4], polls[5]].map((id, i) => ({ id, rank: i + 1 })));
  });

  test("cursor çalıştırmaya bağlı: yeni çalıştırma gelince 400 INVALID_CURSOR; filtre değişimi ve bozuk konum da 400", async () => {
    const cat = await newCategory();
    const polls = [await createPoll(cat), await createPoll(cat), await createPoll(cat)];
    await seedRun("WEEKLY_MOST_DISCUSSED", polls, await nextWindowEnd());
    const url = `/trends/WEEKLY_MOST_DISCUSSED?categoryId=${cat}`;
    const cursor = TrendPage.parse((await get(`${url}&limit=1`)).json()).page.nextCursor!;
    assert.ok(cursor);
    assert.equal((await get(`${url}&limit=1&cursor=${cursor}`)).statusCode, 200);

    assertError(await get(`/trends/WEEKLY_MOST_DISCUSSED?limit=1&cursor=${cursor}`), 400, "INVALID_CURSOR");
    assertError(await get(`/trends/WEEKLY_MOST_VOTED?categoryId=${cat}&limit=1&cursor=${cursor}`), 400, "INVALID_CURSOR");
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...payload, k: [payload.k[0], -1] })).toString("base64url");
    assertError(await get(`${url}&limit=1&cursor=${forged}`), 400, "INVALID_CURSOR");

    await seedRun("WEEKLY_MOST_DISCUSSED", [...polls].reverse(), await nextWindowEnd());
    assertError(await get(`${url}&limit=1&cursor=${cursor}`), 400, "INVALID_CURSOR");
    assert.deepEqual((await walk(url, 1)).map((s) => s.id), [...polls].reverse());
  });
});
