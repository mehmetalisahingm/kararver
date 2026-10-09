// Feed — KV-20 (#22) temel sekmeler, KV-27 (#29) "Senin İçin". Sözleşme: packages/contracts/src/domains/discovery.ts → feed.list
// "new" (en yeni) ve "top" (en çok oy) keyset ile sayfalanır. "for_you" sıralaması for-you.ts'te; cursor üretim anını
// ve yerleşimdeki konumu taşır. "rising" trend motoruna bağlıdır (KV-28, #30) ve henüz açık değildir.
import { PollCard } from "@kararver/contracts";
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route, RouteContext } from "../../http/route.ts";
import type { FeedTab, PollRecord, PollSettings, PollStore } from "../polls/store.ts";
import { toPollDetail } from "../polls/view.ts";
import { pageOf, rankForYou, type FeedSettings } from "./for-you.ts";
import type { FeedStore } from "./store.ts";

export type FeedDeps = {
  store: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<PollSettings>;
  /** Verilmezse "for_you" geçici olarak "new" sırasını kullanır (sadece anket store'u olan düzenekler). */
  feed?: { store: FeedStore; settings: () => Promise<FeedSettings> };
};

/** "Senin İçin" aday havuzu: üretim anına kadar açılmış en yeni anketler. Sonrası için feed biter (belge §Sınırlar). */
export const FOR_YOU_CANDIDATES = 500;

const CARD_KEYS = Object.keys(PollCard.shape) as (keyof typeof PollCard.shape)[];

export function registerFeedRoutes(route: Route, deps: FeedDeps): void {
  async function cards(polls: PollRecord[], viewer: RouteContext["viewer"]) {
    const now = deps.now();
    const settings = await deps.settings();
    return polls.map((poll) => {
      // Kart, detay projeksiyonunun alt kümesidir: sonuç gizliliği ve oy durumu aynı kuraldan gelir.
      const detail = toPollDetail(poll, viewer, now, settings, deps.mediaPublicBaseUrl) as Record<string, unknown>;
      return Object.fromEntries(CARD_KEYS.map((k) => [k, detail[k]]));
    });
  }

  async function forYou({ query, viewer }: RouteContext, feed: NonNullable<FeedDeps["feed"]>) {
    // Sıralama izleyicinin ilgilerine bağlı: cursor başka izleyiciye veya filtreye taşınamaz.
    const filter = `feed:for_you:${query.categoryId ?? ""}:${query.communityId ?? ""}:${viewer?.id ?? "guest"}`;
    const after = decodeCursor(query.cursor, filter);
    const now = deps.now();
    let generatedAt = now;
    let offset = 0;
    if (after) {
      const [at, position] = after.keys;
      generatedAt = new Date(typeof at === "string" ? at : NaN);
      offset = typeof position === "number" ? position : -1;
      if (Number.isNaN(generatedAt.getTime()) || generatedAt > now || !Number.isInteger(offset) || offset < 0 || offset > FOR_YOU_CANDIDATES) {
        throw invalidCursor();
      }
    }

    const [candidates, interests, settings] = await Promise.all([
      feed.store.candidates({
        generatedAt,
        categoryId: query.categoryId ?? null,
        communityId: query.communityId ?? null,
        limit: FOR_YOU_CANDIDATES,
      }),
      viewer ? feed.store.interests(viewer.id) : Promise.resolve([]),
      feed.settings(),
    ]);
    const placed = rankForYou(candidates, generatedAt, new Set(interests), settings);
    const page = pageOf(placed, offset, query.limit);

    // İkinci katman: kart yüklenirken görünürlük yeniden kontrol edilir (yerleşimle kart arasında kaldırılan içerik).
    const polls = await deps.store.listByIds(page.ids, viewer?.id ?? null);
    const nextCursor = page.nextOffset !== null && page.lastId ? encodeCursor(filter, [generatedAt.toISOString(), page.nextOffset], page.lastId) : null;
    return { status: 200, body: { data: await cards(polls, viewer), page: { nextCursor, hasMore: nextCursor !== null } } };
  }

  route("feed.list", async (ctx) => {
    const { query, viewer } = ctx;
    if (query.tab === "rising") {
      throw new ApiError("VALIDATION_ERROR", "Yükselenler sekmesi henüz açık değil.", [{ field: "tab", code: "not_supported_yet" }]);
    }
    if (query.tab === "for_you" && deps.feed) return forYou(ctx, deps.feed);

    const order: FeedTab = query.tab === "top" ? "top" : "new";
    // Cursor istenen sekmeye ve filtrelere bağlı: sekme/filtre değişirse eski cursor 400 INVALID_CURSOR.
    const filter = `feed:${query.tab}:${query.categoryId ?? ""}:${query.communityId ?? ""}`;
    const after = decodeCursor(query.cursor, filter);

    const rows = await deps.store.listFeed({
      tab: order,
      categoryId: query.categoryId ?? null,
      communityId: query.communityId ?? null,
      after,
      limit: query.limit + 1,
      viewerId: viewer?.id ?? null,
    });
    const visible = rows.slice(0, query.limit);
    const last = visible[visible.length - 1];
    const keys = (p: (typeof rows)[number]) => (order === "top" ? [p.voteCount, p.opensAt.toISOString()] : [p.opensAt.toISOString()]);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(filter, keys(last), last.id) : null;
    return { status: 200, body: { data: await cards(visible, viewer), page: { nextCursor, hasMore: nextCursor !== null } } };
  });
}
