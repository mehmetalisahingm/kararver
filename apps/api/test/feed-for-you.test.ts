/**
 * KV-27 (#29) "Senin İçin" feed'i, gerçek PostgreSQL ile (TEST_DATABASE_URL). Sıralama kurallarının ayrıntısı
 * DB'siz birim testlerindedir (for-you.test.ts); burada sinyal sayımı, ilgi tablosu, görünürlük ve cursor.
 * Feed bütün veritabanını gördüğü için her test kendi topluluğunu açar ve `communityId` filtresiyle okur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { ErrorBody, PollCard } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { DEFAULT_FEED_SETTINGS } from "../src/modules/feed/for-you.ts";
import { createPrismaFeedStore } from "../src/modules/feed/prisma-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();
const HOUR = 60 * 60 * 1000;

describe("Senin İçin feed'i (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let author: { cookie: string; id: string };

  function send(method: "POST" | "PUT" | "DELETE", url: string, body: unknown, cookie?: string, key?: string) {
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
  const get = (url: string, cookie?: string) => h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `fy_${id}@example.test`, username: `fy_${id}`, displayName: "Senin İçin", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  /** Oy/yorum sinyali için hızlı kullanıcı (oturumsuz, doğrudan DB). */
  async function rawUser() {
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = await db.user.create({
      data: { email: `raw_${id}@example.test`, emailNormalized: `raw_${id}@example.test`, username: `raw_${id}`, usernameNormalized: `raw_${id}`, displayName: "Ham", passwordHash: "x" },
      select: { id: true },
    });
    return user.id;
  }

  async function newCategory() {
    return (await db.category.create({ data: { slug: `fy-${randomUUID().slice(0, 8)}`, name: "Senin İçin Testi" } })).id;
  }

  async function newCommunity(...memberIds: string[]) {
    const community = await db.community.create({ data: { slug: `fy-${randomUUID().slice(0, 8)}`, name: "Senin İçin Topluluğu", createdById: memberIds[0]! } });
    for (const userId of memberIds) await db.communityMembership.create({ data: { communityId: community.id, userId } });
    return community.id;
  }

  /** Anket saat (h.clock) anında açılır. */
  async function createPoll(communityId: string, categoryId: string, by = author) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Senin için ${randomUUID()}`, categoryId, communityId, durationHours: 168, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      by.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  async function walk(url: string, limit: number, cookie?: string) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${url}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, cookie);
      assert.equal(res.statusCode, 200, res.body);
      for (const item of res.json().data) seen.push(PollCard.parse(item).id);
      cursor = res.json().page.nextCursor;
      pages++;
    } while (cursor && pages < 100);
    return seen;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    author = await signUp();
  });
  afterEach(() => {
    Object.assign(h.feedSettings, DEFAULT_FEED_SETTINGS);
  });
  after(async () => {
    await h?.close();
  });

  test("sinyaller üretim anına kadarki veriden sayılır; sonra açılan anket aday olmaz", async () => {
    const community = await newCommunity(author.id);
    const pollId = await createPoll(community, await newCategory());
    const T = h.clock.now;
    const at = (ms: number) => new Date(T.getTime() + ms);
    const option = (await db.pollOption.findFirst({ where: { pollId }, select: { id: true } }))!.id;
    const vote = async (createdAt: Date, invalidatedAt: Date | null = null) =>
      db.vote.create({
        data: { pollId, optionId: option, userId: await rawUser(), createdAt, invalidatedAt, invalidationReason: invalidatedAt ? "test" : null },
      });
    await vote(at(-30 * HOUR)); // toplamda sayılır, son 24 saatte değil
    await vote(at(-1 * HOUR)); // ikisinde de
    await vote(at(+1 * HOUR)); // üretim anından sonra: sayılmaz
    await vote(at(-2 * HOUR), at(-1 * HOUR)); // o an zaten geçersiz: sayılmaz
    await vote(at(-3 * HOUR), at(+1 * HOUR)); // sonradan geçersiz sayıldı: o an geçerliydi, sayılır
    const comment = async (createdAt: Date, deletedAt: Date | null = null) =>
      db.comment.create({ data: { pollId, authorId: await rawUser(), body: "yorum", createdAt, deletedAt } });
    await comment(at(-1 * HOUR));
    await comment(at(-25 * HOUR)); // 24 saatten eski
    await comment(at(-2 * HOUR), at(-1 * HOUR)); // o an silinmişti
    await comment(at(+60_000)); // sonra yazıldı

    h.clock.advance(HOUR);
    const later = await createPoll(community, await newCategory());

    const store = createPrismaFeedStore(db);
    const candidates = await store.candidates({ generatedAt: T, categoryId: null, communityId: community, limit: 500 });
    assert.deepEqual(
      candidates.map((c) => ({ id: c.id, visible: c.visible, votesTotal: c.votesTotal, votes24h: c.votes24h, comments24h: c.comments24h })),
      [{ id: pollId, visible: true, votesTotal: 3, votes24h: 2, comments24h: 1 }],
    );
    const now = await store.candidates({ generatedAt: h.clock.now, categoryId: null, communityId: community, limit: 500 });
    assert.deepEqual(new Set(now.map((c) => c.id)), new Set([pollId, later]));
  });

  test("tercihsiz kullanıcı ve misafir çeşitli kategoriler görür (10 kartta aynı kategoriden en fazla 4)", async () => {
    h.feedSettings.maxSameAuthorPerWindow = 10; // tek yazarlı fixture: burada kategori kuralı ölçülüyor
    const community = await newCommunity(author.id);
    const [a, b, c] = [await newCategory(), await newCategory(), await newCategory()];
    const byCategory = new Map<string, string>();
    for (const cat of [c, c, c, b, b, b, a, a, a, a, a, a]) {
      byCategory.set(await createPoll(community, cat), cat);
      h.clock.advance(10 * 60_000);
    }
    const guest = await walk(`/feed?tab=for_you&communityId=${community}`, 10);
    assert.equal(guest.length, 12);
    const first = guest.slice(0, 10).map((id) => byCategory.get(id)!);
    assert.equal(new Set(first).size, 3, "üç kategori de ilk 10 kartta");
    for (const cat of [a, b, c]) assert.ok(first.filter((x) => x === cat).length <= 4, "kategori sınırı");

    const user = await signUp();
    assert.deepEqual(await walk(`/feed?tab=for_you&communityId=${community}`, 10, user.cookie), guest, "ilgisi olmayan kullanıcı misafirle aynı");
    // "Yeni" sekmesi aynı veride en taze kategoriyi yığar.
    const newest = (await walk(`/feed?tab=new&communityId=${community}`, 10)).slice(0, 6).map((id) => byCategory.get(id));
    assert.deepEqual(new Set(newest), new Set([a]));
  });

  test("ilgi alanı (user_interests) öne çıkar: bir gün önceki ilgi anketi yeni anketlerin önünde", async () => {
    const community = await newCommunity(author.id);
    const [liked, other] = [await newCategory(), await newCategory()];
    const likedPoll = await createPoll(community, liked);
    h.clock.advance(20 * HOUR);
    const fresh = [await createPoll(community, other), await createPoll(community, other)];

    const user = await signUp();
    // İlgi, KV-15'in gerçek endpoint'iyle seçilir (onboarding).
    const chosen = await send("PUT", "/me/interests", { categoryIds: [liked] }, user.cookie);
    assert.equal(chosen.statusCode, 200, chosen.body);
    const mine = await walk(`/feed?tab=for_you&communityId=${community}`, 10, user.cookie);
    assert.equal(mine[0], likedPoll);
    const guest = await walk(`/feed?tab=for_you&communityId=${community}`, 10);
    assert.notEqual(guest[0], likedPoll);
    assert.deepEqual(new Set(guest), new Set([likedPoll, ...fresh]));
  });

  test("gizli, incelemede ve kaldırılmış anket feed'e girmez; geri alınan tekrar görünür", async () => {
    const community = await newCommunity(author.id);
    const cat = await newCategory();
    const [visible, hidden, review, removed] = [await createPoll(community, cat), await createPoll(community, cat), await createPoll(community, cat), await createPoll(community, cat)];
    await db.poll.update({ where: { id: hidden }, data: { status: "HIDDEN" } });
    await db.poll.update({ where: { id: review }, data: { status: "UNDER_REVIEW" } });
    assert.equal((await send("DELETE", `/polls/${removed}`, undefined, author.cookie)).statusCode, 204);

    assert.deepEqual(await walk(`/feed?tab=for_you&communityId=${community}`, 1), [visible]);
    await db.poll.update({ where: { id: hidden }, data: { status: "ACTIVE" } });
    assert.deepEqual(new Set(await walk(`/feed?tab=for_you&communityId=${community}`, 1)), new Set([visible, hidden]));
  });

  test("cursor tutarlı: sayfalar arasında yeni anket, yeni oy ve kaldırma tekrar/kayıp üretmez", async () => {
    const community = await newCommunity(author.id);
    const cats = [await newCategory(), await newCategory(), await newCategory()];
    const polls: string[] = [];
    for (let i = 0; i < 9; i++) {
      polls.push(await createPoll(community, cats[i % 3]!));
      h.clock.advance(5 * 60_000);
    }
    const url = `/feed?tab=for_you&communityId=${community}`;
    const full = await walk(url, 100);
    assert.deepEqual(new Set(full), new Set(polls));
    for (const limit of [1, 2, 3]) assert.deepEqual(await walk(url, limit), full, `limit ${limit}`);

    // İlk sayfa (3 kart) alındıktan sonra: yeni anket açılır, sonraki bir ankete oy gelir, bir anket kaldırılır.
    const page1 = await get(`${url}&limit=3`);
    const shown = page1.json().data.map((c: { id: string }) => c.id) as string[];
    h.clock.advance(60_000);
    const late = await createPoll(community, cats[0]!);
    const target = full[full.length - 1]!;
    const option = (await db.pollOption.findFirst({ where: { pollId: target }, select: { id: true } }))!.id;
    // Oy üretim anından sonra gelir. created_at DB saatidir; test saati (h.clock) gerçek saatten ileride
    // olduğu için API ile verilen oy "geçmişte" görünürdü. Üretimdeki durum açık zaman damgasıyla kurulur.
    const bursts = Array.from({ length: 30 }, async () =>
      db.vote.create({ data: { pollId: target, optionId: option, userId: await rawUser(), createdAt: h.clock.now } }),
    );
    await Promise.all(bursts);
    // Biri zaten gösterilmiş, biri henüz gösterilmemiş iki anket kaldırılır. Gösterilmiş olanın kalkması,
    // yerleşim yeniden hesaplansaydı sonraki kartı bir öne kaydırıp atlatırdı.
    const goneShown = shown[1]!;
    const gone = full[5]!;
    for (const id of [goneShown, gone]) assert.equal((await send("DELETE", `/polls/${id}`, undefined, author.cookie)).statusCode, 204);

    const rest: string[] = [];
    let cursor: string | null = page1.json().page.nextCursor;
    while (cursor) {
      const res = await get(`${url}&limit=3&cursor=${cursor}`);
      assert.equal(res.statusCode, 200, res.body);
      rest.push(...res.json().data.map((c: { id: string }) => c.id));
      cursor = res.json().page.nextCursor;
    }
    assert.deepEqual(rest, full.slice(3).filter((id) => id !== gone), "aynı sıra, tekrar/kayıp yok, kaldırılan hariç");
    assert.ok(!rest.includes(late), "üretim anından sonra açılan anket bu kaydırmada yok");
    assert.ok((await walk(url, 100)).includes(late), "yeni istekte var");
  });

  test("cursor filtreye ve izleyiciye bağlı; bozuk veya gelecekten gelen cursor 400", async () => {
    const community = await newCommunity(author.id);
    const cat = await newCategory();
    for (let i = 0; i < 3; i++) await createPoll(community, cat);
    const url = `/feed?tab=for_you&communityId=${community}`;
    const res = await get(`${url}&limit=1`);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["cache-control"]), /no-store/, "sunucu tarafı ortak cache yok");
    const cursor = res.json().page.nextCursor as string;

    const user = await signUp();
    assertError(await get(`${url}&limit=1&cursor=${cursor}`, user.cookie), 400, "INVALID_CURSOR");
    assertError(await get(`/feed?tab=for_you&categoryId=${cat}&limit=1&cursor=${cursor}`), 400, "INVALID_CURSOR");
    assertError(await get(`/feed?tab=new&communityId=${community}&limit=1&cursor=${cursor}`), 400, "INVALID_CURSOR");

    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const forge = (k: unknown[]) => Buffer.from(JSON.stringify({ ...payload, k })).toString("base64url");
    assertError(await get(`${url}&limit=1&cursor=${forge([new Date(h.clock.now.getTime() + HOUR).toISOString(), 1])}`), 400, "INVALID_CURSOR");
    assertError(await get(`${url}&limit=1&cursor=${forge([payload.k[0], -1])}`), 400, "INVALID_CURSOR");
    assertError(await get(`${url}&limit=1&cursor=${forge(["dün", 1])}`), 400, "INVALID_CURSOR");
  });
});
