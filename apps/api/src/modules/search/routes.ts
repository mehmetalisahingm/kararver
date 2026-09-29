// Kategori listesi ve arama — KV-26 (#28). Sözleşme: packages/contracts/src/domains/discovery.ts
// Admin kategori yönetimi (admin.categories.*): modules/categories.
import { PollCard } from "@kararver/contracts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import type { PollSettings, PollStore } from "../polls/store.ts";
import { toPollDetail } from "../polls/view.ts";
import type { CategoryRow, SearchStore, SearchType } from "./store.ts";

export type SearchDeps = {
  store: SearchStore;
  polls: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<PollSettings>;
};

const CARD_KEYS = Object.keys(PollCard.shape) as (keyof typeof PollCard.shape)[];

const toCategory = (c: CategoryRow) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  iconKey: c.iconKey,
  sortOrder: c.sortOrder,
});

export function registerSearchRoutes(route: Route, deps: SearchDeps): void {
  const { store } = deps;

  route("categories.list", async () => ({ status: 200, body: { data: (await store.listActiveCategories()).map(toCategory) } }));

  route("search.query", async ({ query, viewer }) => {
    const type = query.type as SearchType;
    const q = query.q as string;
    // Cursor sorguya ve türe bağlı: q veya tür değişirse 400 INVALID_CURSOR.
    const filter = `search:${type}:${q.toLocaleLowerCase("tr")}`;
    const after = decodeCursor(query.cursor, filter);
    const hits = await store.search(type, q, { after, limit: query.limit + 1 });
    const page = hits.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor = hits.length > query.limit && last ? encodeCursor(filter, last.keys, last.id) : null;
    const ids = page.map((h) => h.id);

    let data: unknown[];
    if (type === "polls") {
      const now = deps.now();
      const settings = await deps.settings();
      const polls = await deps.polls.listByIds(ids, viewer?.id ?? null);
      data = polls.map((poll) => {
        const detail = toPollDetail(poll, viewer, now, settings, deps.mediaPublicBaseUrl) as Record<string, unknown>;
        return { type: "poll", poll: Object.fromEntries(CARD_KEYS.map((k) => [k, detail[k]])) };
      });
    } else if (type === "users") {
      data = (await store.usersByIds(ids)).map((u) => ({
        type: "user",
        user: {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarPublicKey ? `${deps.mediaPublicBaseUrl}/${u.avatarPublicKey}` : null,
        },
      }));
    } else if (type === "categories") {
      data = (await store.categoriesByIds(ids)).map((c) => ({ type: "category", category: toCategory(c) }));
    } else {
      data = (await store.communitiesByIds(ids)).map((c) => ({ type: "community", community: c }));
    }
    return { status: 200, body: { data, page: { nextCursor, hasMore: nextCursor !== null } } };
  });
}
