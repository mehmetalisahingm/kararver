// Feed, arama, kategori ve trendler — sağlayıcı Faruk
// KV-20 (#22), KV-26 (#28), KV-27 (#29), KV-28 (#30), KV-29 (#31)
import { z } from "zod";
import { CommunityRef, CursorQuery, dataOf, DiscoverySource, Id, pageOf, PageInfo, Percent, PublicUser, Timestamp } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";
import { PollCard } from "./polls.ts";

export const Category = z.strictObject({
  id: Id,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  iconKey: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const FeedTab = z.enum(["for_you", "rising", "new", "top"]);
export const TrendFormat = z.enum(["DAILY_RISING", "WEEKLY_RISING", "WEEKLY_MOST_VOTED", "WEEKLY_MOST_DISCUSSED", "WEEKLY_MOVERS"]);

export const SearchResult = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("poll"), poll: PollCard }),
  z.strictObject({ type: z.literal("user"), user: PublicUser }),
  z.strictObject({ type: z.literal("category"), category: Category }),
  z.strictObject({ type: z.literal("community"), community: CommunityRef }),
]);

/** Sadece WEEKLY_MOVERS: iki pencere sonu arasındaki fark (DATA_MODEL.md §8). */
export const Movement = z.strictObject({
  optionId: Id,
  fromPercent: Percent,
  toPercent: Percent,
  deltaPoints: z.number().min(-100).max(100),
  sampleFrom: z.number().int().min(0),
  sampleTo: z.number().int().min(0),
  windowFromEnd: Timestamp,
  windowToEnd: Timestamp,
});

export const TrendItem = z.strictObject({ rank: z.number().int().min(1), poll: PollCard, movement: Movement.nullable() });

export const TrendPage = z.strictObject({
  data: z.array(TrendItem),
  page: PageInfo,
  meta: z
    .strictObject({
      format: TrendFormat,
      computedAt: Timestamp,
      calculationVersion: z.number().int().min(1),
      windowStart: Timestamp,
      windowEnd: Timestamp,
    })
    .nullable(),
  /** Yeterli geçmiş yoksa boş liste + açıklama; ekran az-veri durumunu gösterir. */
  reason: z.literal("INSUFFICIENT_HISTORY").optional(),
});

const feed = { owner: "Faruk", module: "feed" } as const;
const search = { owner: "Faruk", module: "search" } as const;
const categories = { owner: "Faruk", module: "categories" } as const;
const trends = { owner: "Faruk", module: "trends" } as const;

export const discoveryEndpoints = [
  defineEndpoint({
    id: "feed.list",
    domain: "discovery",
    method: "GET",
    path: "/feed",
    summary: "Ana akış sekmeleri; kategori/topluluk filtresi",
    auth: "public",
    provider: feed,
    consumers: ["Ümit (web)", "Mert (topluluk akışı, KV-31)"],
    unblocks: ["#22", "#29", "#15", "#32", "#33"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        tab: FeedTab.default("for_you"),
        categoryId: Id.optional(),
        communityId: Id.optional(),
        source: DiscoverySource.optional(),
      }),
    },
    responses: { 200: pageOf(PollCard) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
    notes: [
      "for_you misafirde popüler + yeni karışımıdır; cursor üretim anını taşır, sayfalar arası tekrar olmaz.",
      "Cursor tab/filtreye bağlıdır; filtre değişip eski cursor gelirse 400 INVALID_CURSOR.",
    ],
  }),
  defineEndpoint({
    id: "search.query",
    domain: "discovery",
    method: "GET",
    path: "/search",
    summary: "Anket, kullanıcı, kategori, topluluk araması (Türkçe normalizasyon)",
    auth: "public",
    provider: search,
    consumers: ["Ümit (keşfet, KV-30)"],
    unblocks: ["#28", "#32"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        q: z.string().trim().min(2).max(100),
        type: z.enum(["polls", "users", "categories", "communities"]).default("polls"),
      }),
    },
    responses: { 200: pageOf(SearchResult) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
    notes: ["q kv_normalize ile eşleşir: 'isik' → 'Işık', 'sise' → 'Şişe'."],
  }),
  defineEndpoint({
    id: "categories.list",
    domain: "discovery",
    method: "GET",
    path: "/categories",
    summary: "Aktif kategoriler (sıralı)",
    auth: "public",
    provider: categories,
    consumers: ["Ümit (web)", "Mehmet (onboarding, KV-15)"],
    unblocks: ["#28", "#15", "#17"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(z.array(Category)) },
    errors: [],
    idempotency: "none",
    cache: "public",
    notes: ["Liste küçük olduğu için sayfalanmaz."],
  }),
  defineEndpoint({
    id: "trends.list",
    domain: "discovery",
    method: "GET",
    path: "/trends/:format",
    summary: "Trend listesi (son başarılı çalıştırma)",
    auth: "public",
    provider: trends,
    consumers: ["Ümit (trend ekranları, KV-30)"],
    unblocks: ["#30", "#31", "#32"],
    availability: { status: "ready" },
    request: {
      params: z.strictObject({ format: TrendFormat }),
      query: z.strictObject({ ...CursorQuery.shape, categoryId: Id.optional() }),
    },
    responses: { 200: TrendPage },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
    notes: [
      "Cursor çalıştırma (run) kimliğini taşır: kaydırma sırasında sıralama değişmez. Yeni run gelince eski cursor 400 INVALID_CURSOR.",
      "WEEKLY_MOVERS sadece sonucu herkese görünen anketleri içerir (ALWAYS veya kapanmış); movement başka formatlarda null.",
      "AFTER_VOTE anket kartında results gizli kuralına tabidir; trend puanı ve bileşenleri public değildir.",
    ],
  }),
];
