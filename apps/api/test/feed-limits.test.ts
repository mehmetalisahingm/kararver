/**
 * KV-20 (#22) yayın limitleri (cooldown, günlük limit, aynı başlık) ve temel feed.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL; CI'da tanımlı). Cevaplar sözleşme şemasıyla doğrulanır.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { ErrorBody, PollCard } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createPrismaPollStore } from "../src/modules/polls/prisma-store.ts";
import { DEFAULT_POLL_SETTINGS } from "../src/modules/polls/store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const backend = prismaBackend();

describe("yayın limitleri ve feed (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let lenient: typeof DEFAULT_POLL_SETTINGS;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    lenient = { ...h.pollSettings };
  });
  afterEach(() => {
    Object.assign(h.pollSettings, lenient);
  });
  after(async () => {
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

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
  const get = (url: string, cookie?: string) => h.app.inject({ method: "GET", url: `/v1${url}`, headers: cookie ? { cookie } : {} });
  const key = () => `test-${randomUUID()}`;

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `limit_${id}@example.test`, username: `limit_${id}`, displayName: "Limit", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  /** Hesabı "normal" yapar: oluşturulma zamanını test saatinden 30 gün öncesine çeker. */
  async function makeVeteran(userId: string) {
    await db.user.update({ where: { id: userId }, data: { createdAt: new Date(h.clock.now.getTime() - 30 * DAY) } });
  }

  async function newCategory() {
    return (await db.category.create({ data: { slug: `feed-${randomUUID().slice(0, 8)}`, name: "Feed" }, select: { id: true } })).id;
  }

  let seq = 0;
  function body(categoryId: string, overrides: Record<string, unknown> = {}) {
    return {
      kind: "POLL",
      title: `Limit ve feed test anketi ${++seq}`,
      categoryId,
      durationHours: 72,
      resultsVisibility: "AFTER_VOTE",
      options: [{ label: "A" }, { label: "B" }],
      ...overrides,
    };
  }

  const useOfficialLimits = () => Object.assign(h.pollSettings, DEFAULT_POLL_SETTINGS);

  // ─── Cooldown ve günlük limit (kabul koşulu 1) ──────────────

  test("yeni hesap: 30 dk cooldown ve 24 saatte 3 anket; Retry-After doğru", async () => {
    useOfficialLimits();
    const user = await signUp();
    const cat = await newCategory();
    const start = h.clock.now.getTime();

    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
    const tooSoon = await send("POST", "/polls", body(cat), user.cookie, key());
    assertError(tooSoon, 429, "PUBLISH_COOLDOWN");
    assert.equal(tooSoon.headers["retry-after"], String(30 * 60));

    h.clock.advance(30 * MINUTE);
    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
    h.clock.advance(30 * MINUTE);
    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
    h.clock.advance(30 * MINUTE);
    const overLimit = await send("POST", "/polls", body(cat), user.cookie, key());
    assertError(overLimit, 429, "DAILY_PUBLISH_LIMIT");
    // İlk anket açılışından 24 saat sonra bir hak açılır.
    const expected = Math.ceil((start + DAY - h.clock.now.getTime()) / 1000);
    assert.equal(overLimit.headers["retry-after"], String(expected));

    h.clock.advance(expected * 1000);
    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
  });

  test("normal hesap: 10 dk cooldown ve 24 saatte 10 anket", async () => {
    useOfficialLimits();
    const user = await signUp();
    await makeVeteran(user.id);
    const cat = await newCategory();
    for (let i = 0; i < 10; i++) {
      const res = await send("POST", "/polls", body(cat), user.cookie, key());
      assert.equal(res.statusCode, 201, `${i}. anket: ${res.body}`);
      const soon = await send("POST", "/polls", body(cat), user.cookie, key());
      assertError(soon, 429, i === 9 ? "DAILY_PUBLISH_LIMIT" : "PUBLISH_COOLDOWN");
      if (i < 9) assert.equal(soon.headers["retry-after"], String(10 * 60));
      h.clock.advance(10 * MINUTE);
    }
    assertError(await send("POST", "/polls", body(cat), user.cookie, key()), 429, "DAILY_PUBLISH_LIMIT");
  });

  test("silinen anket hakkı geri vermez (sil-yeniden-aç limiti aşamaz)", async () => {
    Object.assign(h.pollSettings, { newAccountDailyLimit: 1, newAccountCooldownMinutes: 0 });
    const user = await signUp();
    const cat = await newCategory();
    const first = await send("POST", "/polls", body(cat), user.cookie, key());
    assert.equal((await send("DELETE", `/polls/${first.json().data.id}`, undefined, user.cookie)).statusCode, 204);
    assertError(await send("POST", "/polls", body(cat), user.cookie, key()), 429, "DAILY_PUBLISH_LIMIT");
  });

  test("eşzamanlı istekler limiti aşamaz: günlük 3 hakla 6 paralel istekten 3'ü açılır", async () => {
    Object.assign(h.pollSettings, { newAccountDailyLimit: 3, newAccountCooldownMinutes: 0 });
    const user = await signUp();
    const cat = await newCategory();
    const results = await Promise.all(Array.from({ length: 6 }, () => send("POST", "/polls", body(cat), user.cookie, key())));
    const codes = results.map((r) => r.statusCode).sort();
    assert.deepEqual(codes, [201, 201, 201, 429, 429, 429], results.map((r) => r.body).join("\n"));
    assert.equal(await db.poll.count({ where: { authorId: user.id } }), 3);
  });

  test("eşzamanlı istekler cooldown'u aşamaz: 5 paralel istekten 1'i açılır", async () => {
    useOfficialLimits();
    const user = await signUp();
    const cat = await newCategory();
    const results = await Promise.all(Array.from({ length: 5 }, () => send("POST", "/polls", body(cat), user.cookie, key())));
    assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
    for (const r of results.filter((x) => x.statusCode !== 201)) assertError(r, 429, "PUBLISH_COOLDOWN");
    assert.equal(await db.poll.count({ where: { authorId: user.id } }), 1);
  });

  test("başarılı isteğin tekrarı (aynı anahtar) cooldown'a takılmaz; eşzamanlı tekrarlar da", async () => {
    useOfficialLimits();
    const user = await signUp();
    const cat = await newCategory();
    const k = key();
    const b = body(cat);
    const results = await Promise.all(Array.from({ length: 5 }, () => send("POST", "/polls", b, user.cookie, k)));
    assert.deepEqual(results.map((r) => r.statusCode), [201, 201, 201, 201, 201], results.map((r) => r.body).join("\n"));
    assert.equal(new Set(results.map((r) => r.json().data.id)).size, 1);
    const later = await send("POST", "/polls", b, user.cookie, k);
    assert.equal(later.statusCode, 201);
    assert.equal(later.json().data.id, results[0]!.json().data.id);
  });

  test("yarış: aynı anahtarlı iki istek yazar kilidinde beklerse ikincisi limite değil kayıtlı sonuca düşer", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const store = createPrismaPollStore(db);
    const now = h.clock.now;
    const poll = (publicId: string) => ({
      authorId: user.id,
      publicId,
      slug: "yaris",
      title: "Yarış testi için anket başlığı",
      description: null,
      categoryId: cat,
      communityId: null,
      tagSlugs: [],
      mediaIds: [],
      priceAmount: null,
      priceCurrency: null,
      extraInfo: null,
      allowComments: true,
      resultsVisibility: "ALWAYS" as const,
      opensAt: now,
      closesAt: new Date(now.getTime() + DAY),
      options: ["A", "B"],
    });
    const scope = { userId: user.id, route: "polls.create", key: key(), requestHash: "a".repeat(64), now, ttlMs: DAY };

    // Yazar satırını tutan işlem: iki istek de erken tekrar kontrolünü geçip bu kilitte bekler.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      locked();
      await gate;
    });
    await lockTaken;
    const official = { ...DEFAULT_POLL_SETTINGS };
    const a = store.createPoll(poll(randomUUID().slice(0, 8)), scope, official);
    const b = store.createPoll(poll(randomUUID().slice(0, 8)), scope, official);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;
    const [ra, rb] = await Promise.all([a, b]);
    const ids = [ra, rb].map((r) => (r.kind === "key_reused" ? null : r.resourceId));
    assert.ok(ids[0] && ids[0] === ids[1], JSON.stringify([ra, rb]));
    assert.deepEqual([ra.kind, rb.kind].sort(), ["created", "replayed"]);
    assert.equal(await db.poll.count({ where: { authorId: user.id } }), 1);
  });

  test("limitler deploysuz değişir: ayar anında uygulanır", async () => {
    useOfficialLimits();
    const user = await signUp();
    const cat = await newCategory();
    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
    assertError(await send("POST", "/polls", body(cat), user.cookie, key()), 429, "PUBLISH_COOLDOWN");
    h.pollSettings.newAccountCooldownMinutes = 0;
    assert.equal((await send("POST", "/polls", body(cat), user.cookie, key())).statusCode, 201);
  });

  test("DB oturumu UTC: ham SQL'deki Date parametresi timestamptz ile doğru karşılaştırılır", async () => {
    const d = new Date("2026-10-01T09:00:00.000Z");
    const [row] = await db.$queryRaw<{ tz: string; same: boolean }[]>`
      SELECT current_setting('TimeZone') AS tz, (timestamptz '2026-10-01 09:00:00+00' = ${d}) AS same`;
    assert.deepEqual(row, { tz: "UTC", same: true });
  });

  test("aynı başlık: süresi dolmuş anket açık sayılmaz", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const title = `Süresi dolmuş anket ${randomUUID().slice(0, 6)}`;
    assert.equal((await send("POST", "/polls", body(cat, { title, durationHours: 1 }), user.cookie, key())).statusCode, 201);
    h.clock.advance(2 * HOUR);
    assert.equal((await send("POST", "/polls", body(cat, { title }), user.cookie, key())).statusCode, 201);
  });

  // ─── Aynı başlık ────────────────────────────────────────────

  test("aynı başlık: yazarın açık anketiyle aynıysa 409; Türkçe karakter/büyük harf farkı sayılmaz", async () => {
    const user = await signUp();
    const other = await signUp();
    const cat = await newCategory();
    const first = await send("POST", "/polls", body(cat, { title: "İstanbul'da hangi semt daha iyi?" }), user.cookie, key());
    assert.equal(first.statusCode, 201);
    const dup = await send("POST", "/polls", body(cat, { title: "istanbul'da HANGİ semt daha iyi?" }), user.cookie, key());
    assertError(dup, 409, "DUPLICATE_TITLE");
    assert.deepEqual(dup.json().error.details, [{ field: "title", code: "duplicate" }]);
    // Başka yazar aynı başlığı kullanabilir.
    assert.equal((await send("POST", "/polls", body(cat, { title: "İstanbul'da hangi semt daha iyi?" }), other.cookie, key())).statusCode, 201);
    // İlk anket kapanınca aynı başlık yeniden açılabilir.
    assert.equal((await send("POST", `/polls/${first.json().data.id}/close`, undefined, user.cookie)).statusCode, 200);
    assert.equal((await send("POST", "/polls", body(cat, { title: "İstanbul'da hangi semt daha iyi?" }), user.cookie, key())).statusCode, 201);
  });

  // ─── Feed (kabul koşulu 2 ve 3) ─────────────────────────────

  async function seedPolls(cat: string, count: number, cookie: string, overrides: Record<string, unknown> = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await send("POST", "/polls", body(cat, overrides), cookie, key());
      assert.equal(res.statusCode, 201, res.body);
      ids.push(res.json().data.id);
    }
    return ids;
  }

  async function walk(url: string, limit: number) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`${url}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(res.statusCode, 200, res.body);
      for (const c of res.json().data) seen.push(PollCard.parse(c).id);
      cursor = res.json().page.nextCursor;
      assert.equal(res.json().page.hasMore, cursor !== null);
      pages++;
    } while (cursor && pages < 50);
    return seen;
  }

  test("gizli, incelemede ve kaldırılmış içerik feed dışında; kilitli içerik görünür", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const [active, hidden, review, removed, locked] = await seedPolls(cat, 5, user.cookie);
    await db.poll.update({ where: { id: hidden! }, data: { status: "HIDDEN" } });
    await db.poll.update({ where: { id: review! }, data: { status: "UNDER_REVIEW" } });
    await send("DELETE", `/polls/${removed}`, undefined, user.cookie);
    await db.poll.update({ where: { id: locked! }, data: { status: "LOCKED" } });

    const ids = await walk(`/feed?tab=new&categoryId=${cat}`, 10);
    assert.deepEqual(new Set(ids), new Set([active, locked]));
  });

  test("yeni sekmesi: deterministik (eşit zamanda id), sayfalama tekrar/kayıp yok", async () => {
    const user = await signUp();
    const cat = await newCategory();
    // Saat ilerlemiyor: hepsi aynı opensAt ile açılır, sırayı id belirler.
    const ids = await seedPolls(cat, 7, user.cookie);
    const expected = [...ids].sort().reverse();
    const full = await walk(`/feed?tab=new&categoryId=${cat}`, 100);
    assert.deepEqual(full, expected);
    for (const limit of [1, 2, 3]) assert.deepEqual(await walk(`/feed?tab=new&categoryId=${cat}`, limit), expected, `limit ${limit}`);
    assert.deepEqual(await walk(`/feed?tab=new&categoryId=${cat}`, 3), await walk(`/feed?tab=new&categoryId=${cat}`, 3), "aynı istek aynı sırayı verir");
  });

  test("en çok oy sekmesi: oy sayısına göre, eşitlikte yeni önce, sonra id; sayfalama tekrar/kayıp yok", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(...(await seedPolls(cat, 1, user.cookie)));
      h.clock.advance(MINUTE);
    }
    const votes = [5, 0, 5, 2, 0, 9];
    for (let i = 0; i < ids.length; i++) await db.poll.update({ where: { id: ids[i]! }, data: { voteCount: votes[i]! } });
    // 9 → [5: sonra açılan önce] → 2 → [0: sonra açılan önce]
    const expected = [ids[5], ids[2], ids[0], ids[3], ids[4], ids[1]];
    assert.deepEqual(await walk(`/feed?tab=top&categoryId=${cat}`, 100), expected);
    assert.deepEqual(await walk(`/feed?tab=top&categoryId=${cat}`, 2), expected);
  });

  test("kart sözleşmesi: misafirde gizli sonuç sayı içermez; filtreler; sekme değişince eski cursor 400", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const other = await newCategory();
    await seedPolls(cat, 3, user.cookie);
    await seedPolls(other, 1, user.cookie);

    const res = await get(`/feed?tab=new&categoryId=${cat}&limit=2`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "private, no-store");
    for (const c of res.json().data) {
      const card = PollCard.parse(c);
      assert.deepEqual(card.results, { visible: false });
      assert.equal(card.viewer, null);
      assert.equal(card.category.id, cat);
    }
    const next = res.json().page.nextCursor;
    assertError(await get(`/feed?tab=top&categoryId=${cat}&cursor=${next}`), 400, "INVALID_CURSOR");
    assertError(await get(`/feed?tab=new&categoryId=${other}&cursor=${next}`), 400, "INVALID_CURSOR");
    assertError(await get(`/feed?tab=rising`), 400, "VALIDATION_ERROR");

    const forYou = await walk(`/feed?tab=for_you&categoryId=${cat}`, 100);
    assert.deepEqual(forYou, await walk(`/feed?tab=new&categoryId=${cat}`, 100), "for_you şimdilik new sıralaması");
  });

  test("topluluk filtresi sadece o topluluğun anketlerini döner", async () => {
    const user = await signUp();
    const cat = await newCategory();
    const community = await db.community.create({ data: { slug: `feed-${randomUUID().slice(0, 8)}`, name: "Feed Topluluğu", createdById: user.id } });
    await db.communityMembership.create({ data: { communityId: community.id, userId: user.id } });
    const inside = await seedPolls(cat, 2, user.cookie, { communityId: community.id });
    await seedPolls(cat, 1, user.cookie);
    assert.deepEqual(new Set(await walk(`/feed?tab=new&communityId=${community.id}`, 10)), new Set(inside));
  });
});
