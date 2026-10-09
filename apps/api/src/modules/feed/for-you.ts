// "Senin İçin" sıralaması — KV-27 (#29). Saf ve deterministik: aynı aday listesi, aynı an ve aynı ayarlar
// her zaman aynı sırayı verir. DB'ye dokunmaz; adaylar ve sinyaller store'dan gelir. Kurallar ve gerekçeler:
// docs/KV-27_FOR_YOU_FEED.md.
//
// Sayfalar arası tutarlılık: Sıralama, cursor'daki üretim anına (generatedAt) göre hesaplanır. Sinyaller o ana
// kadarki veriden sayılır; o andan sonra açılan anket aday olmaz. Yerleşim, o an görünmez olan adayları da içerir;
// sayfa kesilirken görünmezler atlanır. Böylece sayfalar arasında içerik kaldırılsa bile diğerlerinin sırası
// kaymaz: tekrar ve kayıp olmaz.

export type ForYouCandidate = {
  id: string;
  authorId: string;
  categoryId: string;
  opensAt: Date;
  /** İstek anında herkese görünür mü (ACTIVE/LOCKED). Yerleşimde yer tutar, sayfada gösterilmez. */
  visible: boolean;
  /** generatedAt'e kadar verilmiş, o an geçersiz sayılmamış oylar. */
  votesTotal: number;
  /** (generatedAt − 24 saat, generatedAt] aralığındaki oylar. */
  votes24h: number;
  /** (generatedAt − 24 saat, generatedAt] aralığındaki yorum, cevap ve alternatifler. */
  comments24h: number;
};

export type FeedSettings = {
  /** Kartların yüzde kaçı keşif havuzundan (yeni/az oylu). 0 kapalı. */
  explorationPercent: number;
  /** Art arda DIVERSITY_WINDOW kartta aynı yazardan en fazla. */
  maxSameAuthorPerWindow: number;
  /** Art arda DIVERSITY_WINDOW kartta aynı kategoriden en fazla. */
  maxSameCategoryPerWindow: number;
};

/**
 * Resmî değer yok (contracts settings.ts → feed.*, KV-04 açık konu 8). Faruk'un önerisi; Mehmet teyidi bekliyor.
 * KV-40 ayar servisi gelince değerler oradan okunur.
 */
export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  explorationPercent: 20,
  maxSameAuthorPerWindow: 2,
  maxSameCategoryPerWindow: 4,
};

export const DIVERSITY_WINDOW = 10;

/** Keşif havuzu: az oy almış (< EXPLORATION_MAX_VOTES) ve yeni (≤ EXPLORATION_MAX_AGE_HOURS) anketler. */
export const EXPLORATION_MAX_VOTES = 10;
export const EXPLORATION_MAX_AGE_HOURS = 72;

/**
 * Puan ağırlıkları. Ayar değildir (KV-04 açık konu 9: sıralama ağırlıkları kayıtta yok); ürün geri
 * bildirimiyle değişir. Örnek: ilgi alanındaki 1 günlük anket (1.5 + 1.0) ilgisiz yeni ankete (2.0) üstün gelir,
 * ilgi alanındaki 1 haftalık anket (1.5 + 0.25) gelmez.
 */
export const WEIGHTS = {
  interest: 1.5,
  freshness: 2,
  votes24h: 1,
  comments24h: 0.7,
  votesTotal: 0.3,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** explore: kart bir keşif yuvasına keşif havuzundan yerleşti. */
export type Scored = ForYouCandidate & { score: number; explore: boolean };

export function score(c: ForYouCandidate, generatedAt: Date, interests: ReadonlySet<string>): number {
  const ageHours = Math.max(0, (generatedAt.getTime() - c.opensAt.getTime()) / HOUR_MS);
  const freshness = 1 / (1 + ageHours / 24);
  return (
    (interests.has(c.categoryId) ? WEIGHTS.interest : 0) +
    WEIGHTS.freshness * freshness +
    WEIGHTS.votes24h * Math.log1p(c.votes24h) +
    WEIGHTS.comments24h * Math.log1p(c.comments24h) +
    WEIGHTS.votesTotal * Math.log1p(c.votesTotal)
  );
}

export function isExplorationCandidate(c: ForYouCandidate, generatedAt: Date): boolean {
  const ageHours = (generatedAt.getTime() - c.opensAt.getTime()) / HOUR_MS;
  return c.votesTotal < EXPLORATION_MAX_VOTES && ageHours <= EXPLORATION_MAX_AGE_HOURS;
}

/** Eşitlik kırıcı: yeni önce, sonra id (azalan). */
function byRecency(a: ForYouCandidate, b: ForYouCandidate): number {
  const t = b.opensAt.getTime() - a.opensAt.getTime();
  return t !== 0 ? t : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** i. kart (0'dan) keşif yuvası mı: yüzde p için her 100 kartın p'si, eşit aralıklı. */
export function isExplorationSlot(i: number, percent: number): boolean {
  return percent > 0 && Math.floor(((i + 1) * percent) / 100) > Math.floor((i * percent) / 100);
}

/**
 * Bütün adayları yerleştirir. Her aday puan sırasındadır (ana sıra). Keşif yuvalarında ise henüz yerleşmemiş
 * keşif adaylarının en yenisi alınır: keşif payı az oylu anketlere en az bu kadar yer garanti eder, onları ana
 * sıradan çıkarmaz (yeni platformda çoğu anket az oyludur; çıkarsaydı "Senin İçin" "Yeni" sekmesine dönerdi).
 * Her yuvada, son DIVERSITY_WINDOW kartta yazar/kategori sınırını aşmayan ilk aday alınır; uyan yoksa sınır
 * gevşetilir (sıranın ilki; tek kategoriyle ilgilenen kullanıcı boş feed görmesin). Yerleşecek keşif adayı
 * kalmadıysa yuva ana sıradan dolar.
 */
export function rankForYou(
  candidates: readonly ForYouCandidate[],
  generatedAt: Date,
  interests: ReadonlySet<string>,
  settings: FeedSettings,
): Scored[] {
  const main: Scored[] = candidates
    .map((c) => ({ ...c, score: score(c, generatedAt, interests), explore: false }))
    .sort((a, b) => b.score - a.score || byRecency(a, b));
  const explore = main.filter((c) => isExplorationCandidate(c, generatedAt)).sort(byRecency);

  const placed: Scored[] = [];
  const done = new Set<string>();
  // Son DIVERSITY_WINDOW karttaki yazar/kategori sayıları artımlı tutulur (KV-47: her adayda pencereyi
  // yeniden saymak 500 adayda karesel maliyetti, yük altında CPU'nun üçte birini yiyordu).
  const authorCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, d: number) => m.set(k, (m.get(k) ?? 0) + d);
  const fits = (c: Scored) =>
    (authorCount.get(c.authorId) ?? 0) < settings.maxSameAuthorPerWindow &&
    (categoryCount.get(c.categoryId) ?? 0) < settings.maxSameCategoryPerWindow;
  /** Her sıranın ilk yerleşmemiş elemanı; önündekiler bir daha taranmaz. */
  const start = new Map<Scored[], number>([[main, 0], [explore, 0]]);
  /** Sıradaki yerleşmemiş ve sınıra uyan ilk aday; uyan yoksa yerleşmemiş ilk aday; hiç yoksa undefined. */
  const pick = (order: Scored[]) => {
    let i = start.get(order)!;
    while (i < order.length && done.has(order[i]!.id)) i++;
    start.set(order, i);
    let firstOpen: Scored | undefined;
    for (; i < order.length; i++) {
      const c = order[i]!;
      if (done.has(c.id)) continue;
      firstOpen ??= c;
      if (fits(c)) return c;
    }
    return firstOpen;
  };

  while (placed.length < main.length) {
    const fromExplore = isExplorationSlot(placed.length, settings.explorationPercent) ? pick(explore) : undefined;
    const next = fromExplore ?? pick(main)!;
    done.add(next.id);
    placed.push({ ...next, explore: fromExplore !== undefined });
    bump(authorCount, next.authorId, 1);
    bump(categoryCount, next.categoryId, 1);
    const leaving = placed[placed.length - 1 - DIVERSITY_WINDOW];
    if (leaving) {
      bump(authorCount, leaving.authorId, -1);
      bump(categoryCount, leaving.categoryId, -1);
    }
  }
  return placed;
}

/**
 * Yerleşimden bir sayfa keser: `offset`ten başlayarak görünür ilk `limit` kart. nextOffset, son alınan kartın
 * bir sonrası; ardında görünür kart kalmadıysa null.
 */
export function pageOf(placed: readonly Scored[], offset: number, limit: number): { ids: string[]; nextOffset: number | null; lastId: string | null } {
  const ids: string[] = [];
  let i = offset;
  for (; i < placed.length && ids.length < limit; i++) {
    if (placed[i]!.visible) ids.push(placed[i]!.id);
  }
  const more = placed.slice(i).some((c) => c.visible);
  return { ids, nextOffset: more ? i : null, lastId: ids[ids.length - 1] ?? null };
}
