import { UiError } from "../../lib/model.ts";
import type { Poll } from "../../lib/model.ts";
import { normalizeSearch } from "./model.ts";
import type {
  Page,
  FeedTab,
  SearchType,
  SearchResult,
  TrendFormat,
  TrendPage,
} from "./model.ts";
import {
  demoCategories,
  trendOrders,
  movements,
  fixtureEnd,
  fixturePreviousEnd,
} from "./fixtures.ts";

/** Snapshot/cursor simulator. Never sends private ranking scores to the view. */
export class DemoDiscovery {
  private cursors = new Map<
    string,
    { scope: string; items: unknown[]; offset: number }
  >();
  expirePages() {
    this.cursors.clear();
  }
  categories() {
    return structuredClone(demoCategories);
  }
  private page<T>(items: T[], scope: string, cursor?: string): Page<T> {
    let offset = 0;
    if (cursor) {
      const saved = this.cursors.get(cursor);
      if (!saved || saved.scope !== scope)
        throw new UiError(
          "INVALID_CURSOR",
          "Bu listenin süresi doldu veya filtre değişti. Listeyi yenile.",
        );
      items = saved.items as T[];
      offset = saved.offset;
    }
    const data = items.slice(offset, offset + 3);
    const hasMore = offset + data.length < items.length;
    const nextCursor = hasMore ? crypto.randomUUID().replaceAll("-", "") : null;
    if (nextCursor) {
      if (this.cursors.size >= 100)
        this.cursors.delete(this.cursors.keys().next().value!);
      this.cursors.set(nextCursor, {
        scope,
        items: structuredClone(items),
        offset: offset + data.length,
      });
    }
    return structuredClone({ data, page: { nextCursor, hasMore } });
  }
  private category(polls: Poll[], id?: string) {
    if (!id) return polls;
    const c = demoCategories.find((c) => c.id === id);
    if (!c) throw new UiError("NOT_FOUND", "Bu kategori bulunamadı.");
    return polls.filter((p) => p.category === c.name);
  }
  feed(
    polls: Poll[],
    viewer: string,
    tab: FeedTab,
    categoryId?: string,
    cursor?: string,
  ) {
    let items = this.category(
      polls.filter((p) => p.status !== "LOCKED"),
      categoryId,
    );
    if (tab === "new")
      items = items.toSorted(
        (a, b) =>
          Date.parse(b.createdAt || "1970-01-01") -
          Date.parse(a.createdAt || "1970-01-01"),
      );
    if (tab === "top") {
      const order = [
        ...trendOrders.WEEKLY_MOST_VOTED,
        "calisma-sekli",
        "kapali-anket",
      ];
      items = items.toSorted(
        (a, b) =>
          (order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) -
          (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id)),
      );
    }
    return this.page(
      items,
      JSON.stringify(["feed", viewer, tab, categoryId]),
      cursor,
    );
  }
  search(
    polls: Poll[],
    viewer: string,
    query: string,
    type: SearchType,
    cursor?: string,
  ) {
    if (query.trim().length < 2 || query.trim().length > 100)
      throw new UiError(
        "VALIDATION_ERROR",
        "Arama 2–100 karakter arasında olmalı.",
      );
    const normalized = normalizeSearch(query.trim());
    const matches = (text: string) =>
      normalizeSearch(text).includes(normalized);
    let items: SearchResult[] = [];
    if (type === "polls")
      items = polls
        .filter(
          (p) =>
            p.status !== "LOCKED" &&
            matches(p.title + " " + p.description + " " + p.category),
        )
        .map((poll) => ({ type: "poll", poll }));
    if (type === "categories")
      items = demoCategories
        .filter((c) => matches(c.name))
        .map((category) => ({ type: "category", category }));
    if (type === "users")
      items = [
        { id: "demo-umit", username: "umit", displayName: "Ümit" },
        { id: "demo-deniz", username: "deniz", displayName: "Deniz" },
        { id: "demo-isik", username: "isik", displayName: "Işık" },
      ]
        .filter((u) => matches(u.username + " " + u.displayName))
        .map((user) => ({ type: "user", user }));
    if (type === "communities")
      items = [
        { id: "demo-rota", slug: "rota-arkadaslari", name: "Rota Arkadaşları" },
        { id: "demo-kitap", slug: "kitap-kulubu", name: "Kitap Kulübü" },
      ]
        .filter((c) => matches(c.name))
        .map((community) => ({ type: "community", community }));
    return this.page(
      items,
      JSON.stringify(["search", viewer, normalized, type]),
      cursor,
    );
  }
  trends(
    polls: Poll[],
    viewer: string,
    format: TrendFormat,
    categoryId?: string,
    cursor?: string,
  ): TrendPage {
    const candidates = this.category(polls, categoryId);
    const items = trendOrders[format].flatMap((id, index) => {
      const poll = candidates.find((p) => p.id === id);
      if (
        !poll ||
        (format === "WEEKLY_MOVERS" &&
          (!poll.results.visible ||
            (poll.visibility !== "always" && poll.status !== "CLOSED")))
      )
        return [];
      return [
        {
          poll,
          rank: index + 1,
          movement: format === "WEEKLY_MOVERS" ? movements[id] : null,
        },
      ];
    });
    const result = this.page(
      items,
      JSON.stringify(["trends", viewer, format, categoryId]),
      cursor,
    );
    return {
      ...result,
      meta: {
        format,
        computedAt: "2026-09-27T21:05:00Z",
        calculationVersion: 1,
        windowStart:
          format === "DAILY_RISING"
            ? "2026-09-26T21:00:00Z"
            : fixturePreviousEnd,
        windowEnd: fixtureEnd,
      },
      ...(format === "WEEKLY_MOVERS" && !items.length
        ? { reason: "INSUFFICIENT_HISTORY" as const }
        : {}),
    };
  }
}
