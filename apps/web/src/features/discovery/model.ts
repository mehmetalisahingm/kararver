import type { Poll } from "../../lib/model.ts";
export const feedTabs = {
  for_you: "Senin İçin",
  new: "Yeni",
  top: "En Çok Oy",
} as const;
export type FeedTab = keyof typeof feedTabs;
export const formats = {
  DAILY_RISING: "Günün Yükselenleri",
  WEEKLY_RISING: "Haftanın Yükselenleri",
  WEEKLY_MOST_VOTED: "En Çok Oy Verilenler",
  WEEKLY_MOST_DISCUSSED: "En Çok Konuşulanlar",
  WEEKLY_MOVERS: "Haftanın Değişkenleri",
} as const;
export type TrendFormat = keyof typeof formats;
export const searchTypes = {
  polls: "Gönderiler",
  users: "Kullanıcılar",
  categories: "Kategoriler",
  communities: "Topluluklar",
} as const;
export type SearchType = keyof typeof searchTypes;
export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
};
export type Page<T> = {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
};
export type SearchResult =
  | { type: "poll"; poll: Poll }
  | { type: "category"; category: Category }
  | {
      type: "user";
      user: { id: string; username: string; displayName: string };
    }
  | {
      type: "community";
      community: { id: string; slug: string; name: string };
    };
export type Movement = {
  optionId: string;
  fromPercent: number;
  toPercent: number;
  deltaPoints: number;
  sampleFrom: number;
  sampleTo: number;
  windowFromEnd: string;
  windowToEnd: string;
};
export type TrendItem = { rank: number; poll: Poll; movement: Movement | null };
export type TrendPage = Page<TrendItem> & {
  meta: {
    format: TrendFormat;
    computedAt: string;
    calculationVersion: number;
    windowStart: string;
    windowEnd: string;
  } | null;
  reason?: "INSUFFICIENT_HISTORY";
};
export interface DiscoveryClient {
  getCategories(signal?: AbortSignal): Promise<Category[]>;
  getFeed(
    tab: FeedTab,
    categoryId?: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<Poll>>;
  search(
    query: string,
    type: SearchType,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<SearchResult>>;
  getTrends(
    format: TrendFormat,
    categoryId?: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<TrendPage>;
}
export type Query = {
  tab: FeedTab;
  category: string;
  q: string;
  type: SearchType;
  format: TrendFormat;
};
export type Params = Record<string, string | string[] | undefined>;
export function parseQuery(params: Params): Query {
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const tab = value("tab"),
    type = value("type"),
    format = value("format");
  return {
    tab: Object.hasOwn(feedTabs, tab) ? (tab as FeedTab) : "for_you",
    category: value("category"),
    q: value("q").trim(),
    type: Object.hasOwn(searchTypes, type) ? (type as SearchType) : "polls",
    format: Object.hasOwn(formats, format)
      ? (format as TrendFormat)
      : "DAILY_RISING",
  };
}
export function queryUrl(
  path: string,
  query: Query,
  changes: Partial<Query> = {},
) {
  const q = { ...query, ...changes };
  const p = new URLSearchParams();
  if (q.q) {
    p.set("q", q.q);
    p.set("type", q.type);
  } else if (path === "/yukselenler") p.set("format", q.format);
  else if (q.tab !== "for_you") p.set("tab", q.tab);
  if (q.category && !q.q) p.set("category", q.category);
  return path + (p.size ? "?" + p.toString() : "");
}
export function normalizeSearch(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
export function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  }).format(new Date(iso));
}
