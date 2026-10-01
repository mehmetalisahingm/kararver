import { examples as baseExamples, type Example } from "./examples.ts";

const clone = <T>(value: T): T => structuredClone(value);
const requestId = "req_01998b9a00007000";

function find(endpoint: string, name: string): Example {
  const example = baseExamples.find((item) => item.endpoint === endpoint && item.name === name);
  if (!example) throw new Error(`Eksik temel fixture: ${endpoint}/${name}`);
  return clone(example);
}

function emptyList(endpoint: string, sourceName = "ok", name = "empty"): Example {
  const example = find(endpoint, sourceName);
  example.name = name;
  const body = example.body as { data: unknown; page?: { nextCursor: string | null; hasMore: boolean } };
  body.data = [];
  if (body.page) body.page = { nextCursor: null, hasMore: false };
  return example;
}

function errorExample(endpoint: string, name: string, status: number, code: string, message: string): Example {
  const source = baseExamples.find((item) => item.endpoint === endpoint && item.status < 300);
  if (!source) throw new Error(`Başarılı temel fixture yok: ${endpoint}`);
  return {
    endpoint,
    name,
    request: clone(source.request),
    status,
    body: { error: { code, message, details: [] }, requestId },
  };
}

function trend(name: string, format: string, query?: Record<string, string>): Example {
  const example = find("trends.list", "movers");
  example.name = name;
  example.request = { params: { format }, ...(query ? { query } : {}) };
  const body = example.body as {
    data: Array<{ rank: number; poll: unknown; movement: unknown }>;
    page: { nextCursor: string | null; hasMore: boolean };
    meta: { format: string; computedAt: string; calculationVersion: number; windowStart: string; windowEnd: string } | null;
  };
  if (body.meta) {
    body.meta.format = format;
    if (format === "DAILY_RISING") {
      body.meta.windowStart = "2026-09-26T21:00:00.000Z";
      body.meta.windowEnd = "2026-09-27T21:00:00.000Z";
    } else if (format !== "WEEKLY_MOVERS") {
      body.meta.windowStart = "2026-09-20T21:00:00.000Z";
      body.meta.windowEnd = "2026-09-27T21:00:00.000Z";
    }
  }
  if (format !== "WEEKLY_MOVERS") body.data = body.data.map((item) => ({ ...item, movement: null }));
  body.page = { nextCursor: null, hasMore: false };
  return example;
}

const voteInvalidated = find("polls.get", "guest-hidden");
voteInvalidated.name = "vote-invalidated-hidden";
const voteInvalidatedBody = voteInvalidated.body as { data: Record<string, unknown> };
voteInvalidatedBody.data.viewer = {
  vote: null,
  voteInvalidated: true,
  reaction: null,
  bookmarked: false,
  following: false,
  isAuthor: false,
  canVote: false,
  voteBlockedReason: "VOTE_INVALIDATED",
};

const history = find("polls.history", "visible");
history.name = "multi-day";
const historyBody = history.body as {
  data: { visible: boolean; days: Array<{ localDate: string; pollDay: number; total: number; options: unknown[] }> };
};
const firstDay = clone(historyBody.data.days[0]);
historyBody.data.days = [0, 1, 2, 4, 5, 6].map((pollDay) => ({
  ...clone(firstDay),
  localDate: `2026-09-${String(21 + pollDay).padStart(2, "0")}`,
  pollDay,
}));

const pendingMedia = find("media.complete", "ok");
pendingMedia.endpoint = "media.get";
pendingMedia.name = "pending";
pendingMedia.status = 200;

const quarantinedMedia = clone(pendingMedia);
quarantinedMedia.name = "quarantined";
const quarantinedData = (quarantinedMedia.body as { data: Record<string, unknown> }).data;
quarantinedData.status = "QUARANTINED";
quarantinedData.url = null;
quarantinedData.preview = null;

const rejectedMedia = clone(pendingMedia);
rejectedMedia.name = "rejected";
const rejectedData = (rejectedMedia.body as { data: Record<string, unknown> }).data;
rejectedData.status = "REJECTED";
rejectedData.url = null;
rejectedData.preview = null;

const dailyRising = trend("daily-rising", "DAILY_RISING");
const dailyRisingPage2 = trend("daily-rising-page-2", "DAILY_RISING", { cursor: "eyJ2IjoxLCJyIjoxfQ" });
const weeklyRising = trend("weekly-rising", "WEEKLY_RISING");
const weeklyMostVoted = trend("weekly-most-voted", "WEEKLY_MOST_VOTED");
const weeklyMostDiscussed = trend("weekly-most-discussed", "WEEKLY_MOST_DISCUSSED");
const emptyTrend = trend("empty-run", "DAILY_RISING");
(emptyTrend.body as { data: unknown[] }).data = [];
emptyTrend.request = { params: { format: "DAILY_RISING" }, query: { categoryId: (find("categories.list", "ok").body as { data: Array<{ id: string }> }).data[0].id } };

const staleCursor = errorExample("trends.list", "stale-cursor", 400, "INVALID_CURSOR", "Trend listesi yenilendi; baştan yükleyin.");
staleCursor.request = { params: { format: "DAILY_RISING" }, query: { cursor: "eyJ2IjoxLCJyIjowfQ" } };

const unreadZero = find("notifications.unreadCount", "ok");
unreadZero.name = "zero";
(unreadZero.body as { data: { count: number } }).data.count = 0;

const extras: Example[] = [
  voteInvalidated,
  errorExample("votes.put", "guest", 401, "UNAUTHENTICATED", "Oy vermek için giriş yapın."),
  errorExample("votes.put", "unverified", 403, "EMAIL_NOT_VERIFIED", "Oy vermek için önce e-postanızı doğrulayın."),
  errorExample("votes.put", "content-locked", 409, "CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli; yeni oy alınmıyor."),
  history,
  emptyList("comments.list"),
  emptyList("comments.replies"),
  errorExample("comments.create", "content-locked", 409, "CONTENT_LOCKED", "Bu gönderi moderasyon nedeniyle kilitli; yeni yorum alınmıyor."),
  emptyList("search.query"),
  dailyRising,
  dailyRisingPage2,
  weeklyRising,
  weeklyMostVoted,
  weeklyMostDiscussed,
  emptyTrend,
  staleCursor,
  emptyList("profiles.polls"),
  emptyList("profiles.comments"),
  emptyList("bookmarks.list"),
  (() => {
    const example = find("announcements.active", "ok");
    example.name = "empty";
    (example.body as { data: unknown[] }).data = [];
    return example;
  })(),
  pendingMedia,
  quarantinedMedia,
  rejectedMedia,
  emptyList("admin.reports.list"),
  emptyList("admin.media.list"),
  emptyList("communities.list"),
  emptyList("communities.members"),
  emptyList("notifications.list"),
  unreadZero,
];

export const examples: Example[] = [...baseExamples, ...extras];
export type { Example } from "./examples.ts";
