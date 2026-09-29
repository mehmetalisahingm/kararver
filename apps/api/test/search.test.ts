/**
 * KV-26 (#28) kategori listesi ve arama senaryoları. Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL).
 * Arama bütün veritabanında çalıştığı için her test benzersiz bir "iz" kelimesiyle kendi verisini bulur.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Category, ErrorBody, PollCard, SearchResult } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { likeLiteral } from "../src/modules/search/prisma-store.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

/** PRODUCT_TEAM_PLAN §9 "İlk kategoriler", migration 20260928220000_faruk_kv26_categories_search. */
const SEED = [
  ["teknoloji", "Teknoloji"],
  ["otomobil", "Otomobil"],
  ["alisveris", "Alışveriş"],
  ["egitim", "Eğitim"],
  ["universite", "Üniversite"],
  ["yasam", "Yaşam"],
  ["seyahat", "Seyahat"],
  ["oyun", "Oyun"],
  ["spor", "Spor"],
  ["yemek", "Yemek"],
  ["ev-emlak", "Ev / Emlak"],
  ["kariyer", "Kariyer"],
  ["diger", "Diğer"],
] as const;

test("LIKE joker karakterleri düz metin sayılır", () => {
  assert.equal(likeLiteral("100%_\\"), "100\\%\\_\\\\");
});

describe("kategori ve arama (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let author: { cookie: string; id: string };
  let categoryId: string;

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
  const search = (params: Record<string, string>) => get(`/search?${new URLSearchParams(params)}`);

  function assertError(res: { statusCode: number; json(): any }, status: number, code: string) {
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
  }

  async function signUp(displayName = "Arama") {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `ara_${id}@example.test`, username: `ara_${id}`, displayName, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string, username: account.username };
  }

  /** Benzersiz iz: Türkçe karakterli yazılır, normalize hâliyle aranır. */
  function marker() {
    const r = randomUUID().replaceAll("-", "").replace(/[0-9]/g, "").slice(0, 6) || "abcdef";
    return { written: `Şğı${r}`, normalized: `sgi${r}` };
  }

  async function createPoll(title: string, overrides: Record<string, unknown> = {}) {
    const res = await send(
      "POST",
      "/polls",
      { kind: "POLL", title, categoryId, durationHours: 24, resultsVisibility: "AFTER_VOTE", options: [{ label: "A" }, { label: "B" }], ...overrides },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().data.id as string;
  }

  async function walk(params: Record<string, string>, limit: number) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await search({ ...params, limit: String(limit), ...(cursor ? { cursor } : {}) });
      assert.equal(res.statusCode, 200, res.body);
      for (const item of res.json().data) {
        const r = SearchResult.parse(item);
        seen.push(r.type === "poll" ? r.poll.id : r.type === "user" ? r.user.id : r.type === "category" ? r.category.id : r.community.id);
      }
      cursor = res.json().page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    return seen;
  }

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    author = await signUp();
    categoryId = (await db.category.create({ data: { slug: `ara-${randomUUID().slice(0, 8)}`, name: "Arama Testi", sortOrder: 99 } })).id;
  });
  after(async () => {
    await h?.close();
  });

  // ─── Kategoriler (kabul koşulu 1) ───────────────────────────

  test("13 başlangıç kategorisi seed ile var ve listede sırasıyla", async () => {
    const res = await get("/categories");
    assert.equal(res.statusCode, 200);
    const list = (res.json().data as unknown[]).map((c) => Category.parse(c));
    const seeded = list.filter((c) => SEED.some(([slug]) => slug === c.slug));
    assert.deepEqual(
      seeded.map((c) => [c.slug, c.name]),
      SEED.map(([slug, name]) => [slug, name]),
    );
    assert.deepEqual(
      seeded.map((c) => c.sortOrder),
      SEED.map((_, i) => i + 1),
    );
  });

  test("pasif kategori: listede ve kategori aramasında yok, yeni anket açılamaz; mevcut anketleri görünür kalır", async () => {
    const m = marker();
    const cat = await db.category.create({ data: { slug: `pasif-${randomUUID().slice(0, 8)}`, name: `Pasif ${m.written}` } });
    const pollId = await createPoll(`Pasif kategoride anket ${m.written}`, { categoryId: cat.id });
    await db.category.update({ where: { id: cat.id }, data: { isActive: false } });

    const list = (await get("/categories")).json().data.map((c: { id: string }) => c.id);
    assert.ok(!list.includes(cat.id));
    assert.deepEqual(await walk({ q: m.normalized, type: "categories" }, 10), []);
    const blocked = await send(
      "POST",
      "/polls",
      { kind: "POLL", title: `Yeni anket açılamamalı ${m.written}`, categoryId: cat.id, durationHours: 24, resultsVisibility: "ALWAYS", options: [{ label: "A" }, { label: "B" }] },
      author.cookie,
      `test-${randomUUID()}`,
    );
    assertError(blocked, 400, "VALIDATION_ERROR");

    assert.equal((await get(`/polls/${pollId}`)).statusCode, 200, "mevcut anket görünür");
    assert.deepEqual(await walk({ q: m.normalized }, 10), [pollId], "mevcut anket aramada bulunur");
  });

  test("kategori araması Türkçe karakterleri yok sayar", async () => {
    const res = await search({ q: "alisveris", type: "categories" });
    const hit = SearchResult.parse(res.json().data[0]);
    assert.equal(hit.type === "category" && hit.category.slug, "alisveris");
    assert.equal(SearchResult.parse((await search({ q: "ÜNİVERSİTE", type: "categories" })).json().data[0]).type, "category");
  });

  // ─── Anket araması (kabul koşulu 2) ─────────────────────────

  test("Türkçe karakter örnekleri: ş/s, ı/i, ğ/g, ç/c, ö/o, ü/u ve büyük harf", async () => {
    const m = marker();
    const pollId = await createPoll(`Çiçekçi ışığı göz üzüm ${m.written}`);
    for (const q of ["cicekci isigi", "ÇİÇEKÇİ IŞIĞI", "goz uzum", `göz üzüm ${m.written.toUpperCase()}`, m.normalized]) {
      const ids = await walk({ q }, 100);
      assert.ok(ids.includes(pollId), `"${q}" bulamadı`);
    }
  });

  test("başlık eşleşmesi açıklama eşleşmesinden önce; sonra yeniden eskiye; sayfalama tekrar/kayıp yok", async () => {
    const m = marker();
    const inDescription = await createPoll("Sadece açıklamada geçen anket", { description: `Burada ${m.written} geçiyor` });
    h.clock.advance(60_000);
    const titleOld = await createPoll(`Eski başlık ${m.written}`);
    h.clock.advance(60_000);
    const titleNew = await createPoll(`Yeni başlık ${m.written}`);
    const expected = [titleNew, titleOld, inDescription];
    assert.deepEqual(await walk({ q: m.normalized }, 100), expected);
    assert.deepEqual(await walk({ q: m.normalized }, 1), expected);
    assert.deepEqual(await walk({ q: m.normalized }, 2), expected);
  });

  test("gizli, incelemede ve kaldırılmış anket aramada bulunmaz; gizli sonuç kartta sayı vermez", async () => {
    const m = marker();
    const visible = await createPoll(`Görünür ${m.written}`);
    const hidden = await createPoll(`Gizli ${m.written}`);
    const review = await createPoll(`İnceleme ${m.written}`);
    const removed = await createPoll(`Kaldırılan ${m.written}`);
    await db.poll.update({ where: { id: hidden }, data: { status: "HIDDEN" } });
    await db.poll.update({ where: { id: review }, data: { status: "UNDER_REVIEW" } });
    await send("DELETE", `/polls/${removed}`, undefined, author.cookie);

    const res = await search({ q: m.normalized });
    const cards = (res.json().data as unknown[]).map((x) => SearchResult.parse(x));
    assert.deepEqual(cards.map((c) => (c.type === "poll" ? c.poll.id : null)), [visible]);
    const card = cards[0]!;
    assert.ok(card.type === "poll");
    assert.deepEqual(PollCard.parse(card.poll).results, { visible: false });
    assert.doesNotMatch(res.body, /"votes"|"total"/);
  });

  test("LIKE joker karakterleri sızmaz: '%' ve '_' düz metin aranır", async () => {
    const m = marker();
    const literal = await createPoll(`İndirim yüzde 100% ${m.written}`);
    await createPoll(`İndirim yüzde 1000 ${m.written}`);
    assert.deepEqual(await walk({ q: `100% ${m.normalized}` }, 10), [literal]);
    assert.deepEqual(await walk({ q: `__ ${m.normalized}` }, 10), []);
  });

  test("q en az 2 karakter; q veya tür değişince eski cursor 400", async () => {
    assertError(await search({ q: "a" }), 400, "VALIDATION_ERROR");
    const m = marker();
    await createPoll(`Cursor bir ${m.written}`);
    await createPoll(`Cursor iki ${m.written}`);
    const first = await search({ q: m.normalized, limit: "1" });
    const cursor = first.json().page.nextCursor as string;
    assert.ok(cursor);
    assertError(await search({ q: `${m.normalized}x`, cursor }), 400, "INVALID_CURSOR");
    assertError(await search({ q: m.normalized, type: "users", cursor }), 400, "INVALID_CURSOR");
  });

  // ─── Kullanıcı ve topluluk araması ──────────────────────────

  test("kullanıcı araması: görünen ad Türkçe karakterli; banlı/askıdaki kullanıcı bulunmaz; e-posta sızmaz", async () => {
    const m = marker();
    const active = await signUp(`Gül ${m.written}`);
    const banned = await signUp(`Gül ${m.written}`);
    await h.setStatus(banned.id, "BANNED");
    const res = await search({ q: `gul ${m.normalized}`, type: "users" });
    const hits = (res.json().data as unknown[]).map((x) => SearchResult.parse(x));
    assert.deepEqual(hits.map((x) => (x.type === "user" ? x.user.id : null)), [active.id]);
    assert.doesNotMatch(res.body, /@example\.test/);
    // Kullanıcı adının başıyla eşleşme önce gelir.
    const prefix = await walk({ q: active.username.slice(0, 8), type: "users" }, 100);
    assert.ok(prefix.includes(active.id));
  });

  test("topluluk araması sadece açık toplulukları döner", async () => {
    const m = marker();
    const open = await db.community.create({ data: { slug: `ara-${randomUUID().slice(0, 8)}`, name: `Öğrenci ${m.written}`, createdById: author.id } });
    await db.community.create({ data: { slug: `ara-${randomUUID().slice(0, 8)}`, name: `Kapalı ${m.written}`, createdById: author.id, status: "HIDDEN" } });
    assert.deepEqual(await walk({ q: m.normalized, type: "communities" }, 10), [open.id]);
    assert.deepEqual(await walk({ q: `ogrenci ${m.normalized}`, type: "communities" }, 10), [open.id]);
  });

  // ─── Index (kabul koşulu 3) ─────────────────────────────────

  test("arama index'leri var ve başlık araması index'i kullanabiliyor", async () => {
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_search_idx' ORDER BY indexname`;
    assert.deepEqual(
      indexes.map((i) => i.indexname),
      ["communities_name_search_idx", "polls_description_search_idx", "polls_title_search_idx", "users_display_name_search_idx", "users_username_search_idx"],
    );
    // Küçük test verisinde planlayıcı sıralı taramayı seçebilir; index'in kullanılabilir olduğunu görmek için kapatılır.
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        "EXPLAIN SELECT id FROM polls WHERE kv_normalize(title) LIKE '%' || kv_normalize('cicekci') || '%'",
      );
    });
    assert.match(plan.map((r) => r["QUERY PLAN"]).join("\n"), /polls_title_search_idx/);
  });
});
