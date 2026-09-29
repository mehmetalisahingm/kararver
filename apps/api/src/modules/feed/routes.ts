// Temel feed — KV-20 (#22). Sözleşme: packages/contracts/src/domains/discovery.ts → feed.list
// "new" (en yeni) ve "top" (en çok oy) sekmeleri. "for_you" kişiselleştirme KV-27 (#29) ile gelir; o zamana
// kadar "new" sıralamasını kullanır. "rising" trend motoruna bağlıdır (KV-28, #30) ve henüz açık değildir.
import { PollCard } from "@kararver/contracts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { FeedTab, PollSettings, PollStore } from "../polls/store.ts";
import { toPollDetail } from "../polls/view.ts";

export type FeedDeps = {
  store: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<PollSettings>;
};

const CARD_KEYS = Object.keys(PollCard.shape) as (keyof typeof PollCard.shape)[];

export function registerFeedRoutes(route: Route, deps: FeedDeps): void {
  route("feed.list", async ({ query, viewer }) => {
    if (query.tab === "rising") {
      throw new ApiError("VALIDATION_ERROR", "Yükselenler sekmesi henüz açık değil.", [{ field: "tab", code: "not_supported_yet" }]);
    }
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

    const now = deps.now();
    const settings = await deps.settings();
    const data = visible.map((poll) => {
      // Kart, detay projeksiyonunun alt kümesidir: sonuç gizliliği ve oy durumu aynı kuraldan gelir.
      const detail = toPollDetail(poll, viewer, now, settings, deps.mediaPublicBaseUrl) as Record<string, unknown>;
      return Object.fromEntries(CARD_KEYS.map((k) => [k, detail[k]]));
    });
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });
}
