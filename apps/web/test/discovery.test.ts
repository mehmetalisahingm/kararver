import test from "node:test";
import assert from "node:assert/strict";
import { DemoClient } from "../src/lib/demo-client.ts";
import { emptyDraft } from "../src/lib/model.ts";
import {
  dateLabel,
  formats,
  normalizeSearch,
  parseQuery,
  queryUrl,
} from "../src/features/discovery/model.ts";
import type { TrendFormat } from "../src/features/discovery/model.ts";

test("feed cursor is bound to filters and viewer; snapshot does not duplicate when content is inserted", async () => {
  const c = new DemoClient(0);
  await c.login("umit@example.test", "Demo12345!");
  let page = await c.getFeed("new");
  const cursor = page.page.nextCursor!;
  const seen = page.data.map((p) => p.id);
  await assert.rejects(c.getFeed("top", undefined, cursor), {
    code: "INVALID_CURSOR",
  });
  await assert.rejects(c.getFeed("new", "teknoloji", cursor), {
    code: "INVALID_CURSOR",
  });
  const created = await c.create(
    {
      ...emptyDraft(),
      title: "Yeni bir fikir nasıl geliştirilir?",
      kind: "discussion",
      options: [],
    },
    "new-discovery",
  );
  while (page.page.hasMore) {
    page = await c.getFeed("new", undefined, page.page.nextCursor!);
    seen.push(...page.data.map((p) => p.id));
  }
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.includes(created.id), false);
  assert.equal((await c.getFeed("new")).data[0].id, created.id);
  await c.logout();
  await assert.rejects(c.getFeed("new", undefined, cursor), {
    code: "INVALID_CURSOR",
  });
});
test("feed, search and daily trends do not expose hidden vote counts or private ranking scores", async () => {
  const c = new DemoClient(0);
  const feed = await c.getFeed("for_you");
  const search = await c.search("uzaktan", "polls");
  const trend = await c.getTrends("DAILY_RISING");
  const polls = [
    feed.data.find((p) => p.id === "calisma-sekli")!,
    search.data[0].type === "poll" ? search.data[0].poll : null,
    trend.data[0].poll,
  ];
  for (const p of polls) {
    assert.ok(p);
    assert.deepEqual(p.results, { visible: false });
    for (const key of ["counts", "votes", "voteCount", "score", "trendScore"])
      assert.equal(key in p, false);
  }
  assert.equal("score" in trend.data[0], false);
});
test("Turkish search normalization and all result types respect public fields", async () => {
  const c = new DemoClient(0);
  assert.equal(normalizeSearch("IŞIK ŞİŞE"), "isik sise");
  assert.equal((await c.search("sicak isik", "polls")).data.length, 1);
  const users = await c.search("isik", "users");
  assert.equal(users.data[0].type, "user");
  assert.equal(JSON.stringify(users).includes("email"), false);
  assert.equal(
    (await c.search("egitim", "categories")).data[0].type,
    "category",
  );
  assert.equal(
    (await c.search("rota", "communities")).data[0].type,
    "community",
  );
  assert.equal((await c.search("bulunmayanifade", "polls")).data.length, 0);
  await assert.rejects(c.search("a", "polls"), { code: "VALIDATION_ERROR" });
  await assert.rejects(c.search("a".repeat(101), "polls"), {
    code: "VALIDATION_ERROR",
  });
});
test("five trend formats have distinct ordered fixtures and preserve metadata across pages", async () => {
  const c = new DemoClient(0);
  const lists = [];
  for (const format of Object.keys(formats) as TrendFormat[]) {
    let p = await c.getTrends(format);
    const meta = p.meta;
    const items = [...p.data];
    while (p.page.hasMore) {
      p = await c.getTrends(format, undefined, p.page.nextCursor!);
      assert.deepEqual(p.meta, meta);
      items.push(...p.data);
    }
    assert.equal(new Set(items.map((i) => i.poll.id)).size, items.length);
    lists.push(items.map((i) => i.poll.id).join(","));
    if (format !== "WEEKLY_MOVERS")
      assert.ok(items.every((i) => i.movement === null));
  }
  assert.equal(new Set(lists).size, 5);
});
test("movements show signed percentage points and dated samples; insufficient history is explicit", async () => {
  const c = new DemoClient(0);
  const page = await c.getTrends("WEEKLY_MOVERS");
  assert.equal(page.data.length, 2);
  for (const { poll, movement } of page.data) {
    assert.ok(poll.results.visible);
    assert.ok(movement);
    assert.equal(
      movement.deltaPoints,
      movement.toPercent - movement.fromPercent,
    );
    assert.ok(movement.sampleFrom >= 30 && movement.sampleTo >= 30);
    assert.equal(
      (Date.parse(movement.windowToEnd) - Date.parse(movement.windowFromEnd)) /
        86400000,
      7,
    );
  }
  const empty = await c.getTrends("WEEKLY_MOVERS", "seyahat");
  assert.equal(empty.reason, "INSUFFICIENT_HISTORY");
  assert.deepEqual(empty.data, []);
  assert.equal((await c.getTrends("DAILY_RISING", "spor")).reason, undefined);
});
test("expiration, cancellation and retry never consume a canceled failure or mix categories", async () => {
  const c = new DemoClient(0);
  const first = await c.getFeed("for_you");
  c.expireDiscoveryPages();
  await assert.rejects(
    c.getFeed("for_you", undefined, first.page.nextCursor!),
    { code: "INVALID_CURSOR" },
  );
  const abort = new AbortController();
  c.failNext("trends");
  abort.abort();
  await assert.rejects(
    c.getTrends("DAILY_RISING", undefined, undefined, abort.signal),
    { name: "AbortError" },
  );
  await assert.rejects(c.getTrends("DAILY_RISING"), { code: "INTERNAL_ERROR" });
  assert.ok((await c.getTrends("DAILY_RISING")).data.length);
  assert.ok(
    (await c.getFeed("for_you", "teknoloji")).data.every(
      (p) => p.category === "Teknoloji",
    ),
  );
  await assert.rejects(c.getFeed("for_you", "missing"), { code: "NOT_FOUND" });
});
test("query links round-trip allowed values without carrying cursors; dates use Istanbul", () => {
  const q = parseQuery({
    tab: "__proto__",
    type: "constructor",
    format: "x",
    q: ["a", "b"],
  });
  assert.equal(q.tab, "for_you");
  assert.equal(q.type, "polls");
  assert.equal(q.format, "DAILY_RISING");
  assert.equal(q.q, "");
  const url = queryUrl("/yukselenler", q, {
    format: "WEEKLY_MOVERS",
    category: "teknoloji",
  });
  assert.equal(url, "/yukselenler?format=WEEKLY_MOVERS&category=teknoloji");
  assert.ok(dateLabel("2026-09-27T21:00:00Z").startsWith("28"));
});
