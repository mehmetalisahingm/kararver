/**
 * KV-27 (#29) "Senin İçin" sıralamasının birim testleri. DB gerektirmez: sabit (deterministik) fixture'lar.
 * Kurallar: docs/KV-27_FOR_YOU_FEED.md.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_FEED_SETTINGS,
  DIVERSITY_WINDOW,
  isExplorationCandidate,
  isExplorationSlot,
  pageOf,
  rankForYou,
  score,
  type FeedSettings,
  type ForYouCandidate,
} from "../src/modules/feed/for-you.ts";

const T = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const NONE = new Set<string>();

/** Sabit kimlikli aday. Varsayılan: 2 saatlik, 50 oylu (keşif havuzunda değil), görünür. */
function poll(n: number, over: Partial<ForYouCandidate> = {}): ForYouCandidate {
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    authorId: `author-${n}`,
    categoryId: "cat-a",
    opensAt: new Date(T.getTime() - 2 * HOUR),
    visible: true,
    votesTotal: 50,
    votes24h: 0,
    comments24h: 0,
    ...over,
  };
}

const settings = (over: Partial<FeedSettings> = {}): FeedSettings => ({ ...DEFAULT_FEED_SETTINGS, ...over });
const ids = (list: { id: string }[]) => list.map((c) => c.id);

/** Tek kategoriden sıkışık bir havuz: kategori A çok taze, B ve C daha eski. */
function crowded(): ForYouCandidate[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => poll(i, { categoryId: "cat-a", opensAt: new Date(T.getTime() - (i + 1) * 60_000) })),
    ...Array.from({ length: 5 }, (_, i) => poll(100 + i, { categoryId: "cat-b", opensAt: new Date(T.getTime() - (10 + i) * HOUR) })),
    ...Array.from({ length: 5 }, (_, i) => poll(200 + i, { categoryId: "cat-c", opensAt: new Date(T.getTime() - (20 + i) * HOUR) })),
  ];
}

function maxInWindow(list: ForYouCandidate[], key: "authorId" | "categoryId", window = DIVERSITY_WINDOW): number {
  let max = 0;
  for (let i = 0; i + window <= list.length; i++) {
    const counts = new Map<string, number>();
    for (const c of list.slice(i, i + window)) counts.set(c[key], (counts.get(c[key]) ?? 0) + 1);
    max = Math.max(max, ...counts.values());
  }
  return max;
}

describe("Senin İçin sıralaması", () => {
  test("deterministik: aynı girdi aynı sıra; aday listesinin sırası sonucu değiştirmez", () => {
    const list = crowded();
    const once = ids(rankForYou(list, T, NONE, settings()));
    assert.deepEqual(ids(rankForYou(list, T, NONE, settings())), once);
    assert.deepEqual(ids(rankForYou([...list].reverse(), T, NONE, settings())), once);
    assert.equal(new Set(once).size, list.length, "her aday bir kez");
  });

  test("tercihsiz kullanıcı çeşitli kategoriler görür: 10 kartta aynı kategoriden en fazla 4", () => {
    const placed = rankForYou(crowded(), T, NONE, settings({ explorationPercent: 0 }));
    assert.ok(maxInWindow(placed.slice(0, 15), "categoryId") <= 4);
    assert.deepEqual(new Set(placed.slice(0, 10).map((c) => c.categoryId)), new Set(["cat-a", "cat-b", "cat-c"]));

    // Sınır kapatılınca (10) aynı veri tek kategoriye yığılır: çeşitliliği sağlayan kural bu.
    const unlimited = rankForYou(crowded(), T, NONE, settings({ explorationPercent: 0, maxSameCategoryPerWindow: 10 }));
    assert.deepEqual(new Set(unlimited.slice(0, 10).map((c) => c.categoryId)), new Set(["cat-a"]));
  });

  test("aynı yazar sınırı: 10 kartta en fazla 2", () => {
    // "prolific" en taze 8 anketin yazarı; 12 başka yazarın anketi daha eski.
    const list = Array.from({ length: 20 }, (_, i) =>
      poll(i, { authorId: i < 8 ? "prolific" : `author-${i}`, categoryId: `cat-${i}`, opensAt: new Date(T.getTime() - (i + 1) * 60_000) }),
    );
    const placed = rankForYou(list, T, NONE, settings({ explorationPercent: 0 }));
    assert.equal(placed.slice(0, 10).filter((c) => c.authorId === "prolific").length, 2);
    const unlimited = rankForYou(list, T, NONE, settings({ explorationPercent: 0, maxSameAuthorPerWindow: 10 }));
    assert.equal(unlimited.slice(0, 10).filter((c) => c.authorId === "prolific").length, 8, "sınır olmasa yığılırdı");
    // Diğer yazarlar bitince sınır gevşer: içerik kaybolmaz.
    assert.deepEqual(new Set(ids(placed)), new Set(ids(list)));
  });

  test("sınır gevşetilir: tek kategori ve tek yazarlı havuzda da bütün anketler gelir", () => {
    const list = Array.from({ length: 6 }, (_, i) => poll(i, { authorId: "same", opensAt: new Date(T.getTime() - (i + 1) * HOUR) }));
    const placed = rankForYou(list, T, NONE, settings());
    assert.deepEqual(ids(placed), ids(list), "gevşeyince puan (yenilik) sırası");
  });

  test("ilgi alanı öne çıkar: 1 günlük ilgi alanı anketi yeni ilgisiz anketin önünde, 1 haftalık değil", () => {
    const fresh = poll(1, { categoryId: "cat-x", opensAt: T });
    const dayOld = poll(2, { categoryId: "cat-liked", opensAt: new Date(T.getTime() - 24 * HOUR) });
    const weekOld = poll(3, { categoryId: "cat-liked", opensAt: new Date(T.getTime() - 7 * 24 * HOUR) });
    const s = settings({ explorationPercent: 0, maxSameCategoryPerWindow: 10 });
    assert.deepEqual(ids(rankForYou([fresh, dayOld, weekOld], T, NONE, s)), ids([fresh, dayOld, weekOld]));
    assert.deepEqual(ids(rankForYou([fresh, dayOld, weekOld], T, new Set(["cat-liked"]), s)), ids([dayOld, fresh, weekOld]));
  });

  test("etkileşim: son 24 saatte hızlı oy ve yorum alan anket yukarı çıkar", () => {
    const quiet = poll(1, { opensAt: new Date(T.getTime() - HOUR) });
    const busy = poll(2, { opensAt: new Date(T.getTime() - 20 * HOUR), votes24h: 40, comments24h: 12 });
    const s = settings({ explorationPercent: 0, maxSameCategoryPerWindow: 10 });
    assert.deepEqual(ids(rankForYou([quiet, busy], T, NONE, s)), ids([busy, quiet]));
  });

  test("keşif payı %20: her 5. kart yeni/az oylu havuzdan; %0 iken yuva ayrılmaz", () => {
    const popular = Array.from({ length: 12 }, (_, i) =>
      poll(i, { categoryId: `cat-${i}`, votesTotal: 500, votes24h: 100, opensAt: new Date(T.getTime() - (i + 1) * HOUR) }),
    );
    const fresh = Array.from({ length: 3 }, (_, i) =>
      poll(100 + i, { categoryId: `new-${i}`, votesTotal: 0, opensAt: new Date(T.getTime() - (30 + i) * 60_000) }),
    );
    const placed = rankForYou([...popular, ...fresh], T, NONE, settings({ explorationPercent: 20 }));
    const slots = placed.map((c, i) => (c.explore ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(slots, [4, 9, 14]);
    assert.deepEqual(ids(placed.filter((c) => c.explore)), ids(fresh), "keşif havuzu yeniden eskiye");

    const off = rankForYou([...popular, ...fresh], T, NONE, settings({ explorationPercent: 0 }));
    assert.ok(off.every((c) => !c.explore));
    assert.ok(off.findIndex((c) => c.id === fresh[0]!.id) > 4, "keşif payı yokken az oylu anket yuva almaz");
  });

  test("keşif yuvası sayısı yüzdeye eşit ve eşit aralıklı", () => {
    for (const p of [0, 5, 10, 20, 33, 50]) {
      const slots = Array.from({ length: 100 }, (_, i) => i).filter((i) => isExplorationSlot(i, p));
      assert.equal(slots.length, p, `%${p}`);
    }
  });

  test("keşif adayı: 10 oydan az ve en fazla 72 saatlik anket", () => {
    assert.equal(isExplorationCandidate(poll(1, { votesTotal: 9, opensAt: new Date(T.getTime() - 72 * HOUR) }), T), true);
    assert.equal(isExplorationCandidate(poll(2, { votesTotal: 0, opensAt: new Date(T.getTime() - 73 * HOUR) }), T), false);
    assert.equal(isExplorationCandidate(poll(3, { votesTotal: 10, opensAt: T }), T), false);
  });

  test("yeni platform: bütün anketler az oyluyken de ilgi ve etkileşim sırası korunur (keşif payı onları ana sıradan çıkarmaz)", () => {
    // Hepsi keşif adayı (0–5 oy, birkaç saatlik). İlgi alanındaki eski anket yine başta olmalı.
    const list = [
      poll(1, { categoryId: "cat-liked", votesTotal: 0, opensAt: new Date(T.getTime() - 6 * HOUR) }),
      ...Array.from({ length: 8 }, (_, i) => poll(10 + i, { categoryId: `cat-${i}`, votesTotal: 5, opensAt: new Date(T.getTime() - (i + 1) * 60_000) })),
    ];
    assert.ok(list.every((c) => isExplorationCandidate(c, T)));
    const placed = rankForYou(list, T, new Set(["cat-liked"]), settings());
    assert.equal(placed[0]!.id, list[0]!.id);
    assert.deepEqual(new Set(ids(placed)), new Set(ids(list)));
  });
});

describe("yerleşim performans düzeltmesi (KV-47)", () => {
  /** KV-27'deki ilk (karesel) yerleşim: davranış referansı. Yeni uygulama bununla birebir aynı sırayı vermeli. */
  function reference(candidates: readonly ForYouCandidate[], at: Date, interests: ReadonlySet<string>, s: FeedSettings) {
    const byRecency = (a: ForYouCandidate, b: ForYouCandidate) => b.opensAt.getTime() - a.opensAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    const main = candidates.map((c) => ({ ...c, score: score(c, at, interests), explore: false })).sort((a, b) => b.score - a.score || byRecency(a, b));
    const explore = main.filter((c) => isExplorationCandidate(c, at)).sort(byRecency);
    const placed: typeof main = [];
    const done = new Set<string>();
    const fits = (c: (typeof main)[number]) => {
      const recent = placed.slice(-DIVERSITY_WINDOW);
      return recent.filter((p) => p.authorId === c.authorId).length < s.maxSameAuthorPerWindow && recent.filter((p) => p.categoryId === c.categoryId).length < s.maxSameCategoryPerWindow;
    };
    const pick = (order: typeof main) => {
      const open = order.filter((c) => !done.has(c.id));
      return open.find(fits) ?? open[0];
    };
    while (placed.length < main.length) {
      const fromExplore = isExplorationSlot(placed.length, s.explorationPercent) ? pick(explore) : undefined;
      const next = fromExplore ?? pick(main)!;
      done.add(next.id);
      placed.push({ ...next, explore: fromExplore !== undefined });
    }
    return placed.map((c) => [c.id, c.explore]);
  }

  test("50 rastgele (tekrarlanabilir) aday setinde eski yerleşimle birebir aynı sıra ve keşif yuvaları", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 50; round++) {
      const n = 20 + Math.floor(rnd() * 300);
      const list = Array.from({ length: n }, (_, i) =>
        poll(round * 1000 + i, {
          authorId: `a-${Math.floor(rnd() * 15)}`,
          categoryId: `c-${Math.floor(rnd() * 6)}`,
          opensAt: new Date(T.getTime() - Math.floor(rnd() * 200) * HOUR),
          votesTotal: Math.floor(rnd() * 40),
          votes24h: Math.floor(rnd() * 20),
          comments24h: Math.floor(rnd() * 8),
          visible: rnd() > 0.1,
        }),
      );
      const s = settings({ explorationPercent: [0, 10, 20, 35][round % 4]!, maxSameAuthorPerWindow: 1 + (round % 3), maxSameCategoryPerWindow: 2 + (round % 4) });
      const interests = new Set(round % 2 ? ["c-1", "c-3"] : []);
      assert.deepEqual(rankForYou(list, T, interests, s).map((c) => [c.id, c.explore]), reference(list, T, interests, s), `tur ${round}`);
    }
  });
});

describe("sayfa kesme", () => {
  const placed = rankForYou(crowded(), T, NONE, settings());

  function walk(list: typeof placed, limit: number) {
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = pageOf(list, offset, limit);
      seen.push(...page.ids);
      offset = page.nextOffset;
    }
    return seen;
  }

  test("1, 2, 3 ve 100'lük sayfalar aynı sırayı tekrar/kayıp olmadan verir", () => {
    for (const limit of [1, 2, 3, 100]) assert.deepEqual(walk(placed, limit), ids(placed), `limit ${limit}`);
    assert.equal(pageOf(placed, 0, 100).nextOffset, null);
  });

  test("görünmez aday yer tutar ama gösterilmez; sayfalar arası kaldırma diğerlerinin sırasını kaydırmaz", () => {
    const first = pageOf(placed, 0, 5);
    // İlk sayfadan sonra, henüz gösterilmemiş iki anket kaldırılır.
    const removed = new Set([placed[6]!.id, placed[9]!.id]);
    const after = rankForYou(
      crowded().map((c) => (removed.has(c.id) ? { ...c, visible: false } : c)),
      T,
      NONE,
      settings(),
    );
    assert.deepEqual(ids(after), ids(placed), "yerleşim aynı");
    const rest = walk(after, 5).slice(0); // baştan yürüyüş: kaldırılanlar yok
    const continued: string[] = [];
    let offset: number | null = first.nextOffset;
    while (offset !== null) {
      const page = pageOf(after, offset, 5);
      continued.push(...page.ids);
      offset = page.nextOffset;
    }
    const expected = ids(placed).filter((id) => !removed.has(id));
    assert.deepEqual([...first.ids, ...continued], expected, "tekrar yok, kayıp yok");
    assert.deepEqual(rest, expected);
  });

  test("son sayfadan sonra yalnız görünmezler kaldıysa hasMore yok", () => {
    const [a, b, c] = [poll(1), poll(2), poll(3, { visible: false })].map((p) => ({ ...p, score: 0, explore: false }));
    assert.deepEqual(pageOf([a!, b!, c!], 0, 1), { ids: [a!.id], nextOffset: 1, lastId: a!.id });
    assert.deepEqual(pageOf([a!, b!, c!], 1, 1), { ids: [b!.id], nextOffset: null, lastId: b!.id });
    assert.deepEqual(pageOf([c!], 0, 5), { ids: [], nextOffset: null, lastId: null });
  });
});
