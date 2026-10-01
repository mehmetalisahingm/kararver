// Trend listeleri — KV-28 (#30). Sözleşme: packages/contracts/src/domains/discovery.ts → trends.list
// Her format için güncel başarılı çalıştırma okunur. Cursor çalıştırma kimliğini ve sıralamadaki konumu taşır:
// kaydırma sırasında sıra değişmez; yeni çalıştırma gelince eski cursor 400 INVALID_CURSOR.
// WEEKLY_MOVERS KV-29 (#31) ile hesaplanır; o zamana kadar ve henüz çalıştırma yokken boş liste + INSUFFICIENT_HISTORY.
import { PollCard } from "@kararver/contracts";
import { decodeCursor, encodeCursor } from "../../http/cursor.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import type { PollSettings, PollStore } from "../polls/store.ts";
import { toPollDetail } from "../polls/view.ts";
import type { TrendFormatId, TrendStore } from "./store.ts";

export type TrendDeps = {
  store: TrendStore;
  polls: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<PollSettings>;
};

const CARD_KEYS = Object.keys(PollCard.shape) as (keyof typeof PollCard.shape)[];

function invalidCursor(): ApiError {
  return new ApiError("INVALID_CURSOR", "Liste yenilendi; baştan yükleyin.", [{ field: "cursor", code: "stale" }]);
}

export function registerTrendRoutes(route: Route, deps: TrendDeps): void {
  route("trends.list", async ({ params, query, viewer }) => {
    const format = params.format as TrendFormatId;
    const filter = `trends:${format}:${query.categoryId ?? ""}`;
    const after = decodeCursor(query.cursor, filter);
    const empty = { status: 200, body: { data: [], page: { nextCursor: null, hasMore: false }, meta: null, reason: "INSUFFICIENT_HISTORY" } };

    const run = format === "WEEKLY_MOVERS" ? null : await deps.store.latestRun(format);
    if (!run) {
      if (after) throw invalidCursor();
      return empty;
    }
    let offset = 0;
    if (after) {
      const [runId, position] = after.keys;
      if (runId !== run.id) throw invalidCursor();
      if (typeof position !== "number" || !Number.isInteger(position) || position < 0) throw invalidCursor();
      offset = position;
    }

    // Sıra numarası, kategori filtresinden sonra görünür kartlar arasındaki konumdur (1'den).
    const entries = await deps.store.entries(run.id, query.categoryId ?? null);
    const page: { pollId: string; rank: number }[] = [];
    let rank = entries.slice(0, offset).filter((e) => e.visible).length;
    let i = offset;
    for (; i < entries.length && page.length < query.limit; i++) {
      if (entries[i]!.visible) page.push({ pollId: entries[i]!.pollId, rank: ++rank });
    }
    const more = entries.slice(i).some((e) => e.visible);
    const last = page[page.length - 1];
    const nextCursor = more && last ? encodeCursor(filter, [run.id, i], last.pollId) : null;

    // Kart yüklenirken görünürlük yeniden kontrol edilir (listByIds sadece herkese görünenleri döner).
    const polls = new Map((await deps.polls.listByIds(page.map((p) => p.pollId), viewer?.id ?? null)).map((p) => [p.id, p]));
    const now = deps.now();
    const settings = await deps.settings();
    const data = page.flatMap(({ pollId, rank }) => {
      const poll = polls.get(pollId);
      if (!poll) return [];
      const detail = toPollDetail(poll, viewer, now, settings, deps.mediaPublicBaseUrl) as Record<string, unknown>;
      return [{ rank, poll: Object.fromEntries(CARD_KEYS.map((k) => [k, detail[k]])), movement: null }];
    });

    return {
      status: 200,
      body: {
        data,
        page: { nextCursor, hasMore: nextCursor !== null },
        meta: {
          format: run.format,
          computedAt: run.finishedAt.toISOString(),
          calculationVersion: run.calculationVersion,
          windowStart: run.windowStart.toISOString(),
          windowEnd: run.windowEnd.toISOString(),
        },
      },
    };
  });
}
