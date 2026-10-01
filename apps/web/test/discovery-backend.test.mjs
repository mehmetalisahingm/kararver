// Real HTTP + production routes/Prisma stores. Trend job output is seeded in SQL;
// worker ranking tests remain responsible for calculation correctness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness, prismaBackend, tokenFrom, WEB_ORIGIN } from "../../api/test/support/harness.ts";
import { ApiClient } from "../src/lib/api-client.ts";
import { emptyDraft } from "../src/lib/model.ts";
import { formats } from "../src/features/discovery/model.ts";

const backend = prismaBackend();
test("KV-30 real HTTP/PostgreSQL: categories, feed cursors, search and five distinct trends", {
  skip: backend ? false : "TEST_DATABASE_URL required; executed in database CI job",
  timeout: 120000,
}, async () => {
  const h = await createHarness(backend);
  const db = h.prisma;
  const runs = [];
  try {
    const origin = await h.app.listen({ host: "127.0.0.1", port: 0 });
    let cookie = "";
    const client = new ApiClient(origin, async (url, init) => {
      const response = await fetch(url, {
        ...init, headers: { ...init?.headers, origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}) },
      });
      const setCookie = response.headers.getSetCookie()[0];
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    });
    const guest = new ApiClient(origin);
    const key = randomUUID().replaceAll("-", "").slice(0, 10);
    const email = `kv30_${key}@example.test`;
    await client.register("Keşfet Testi", email, "secure-password-123", `kv30_${key}`);
    await client.verify("", tokenFrom(h.mails.at(-1)));
    await client.login(email, "secure-password-123");
    const category = await db.category.create({ data: { name: `Işık ${key}`, slug: `kv30-${key}` } });
    assert.ok((await guest.getCategories()).some(c => c.id === category.id && c.slug === category.slug));
    const polls = [];
    for (let i = 0; i < 21; i++) {
      polls.push(await client.create({ ...emptyDraft(), categoryId: category.id,
        title: `Işık ${key} karşılaştırma ${i}`, options: ["Birinci", "İkinci"],
        visibility: i === 20 ? "after_vote" : "always", hours: 336,
      }, randomUUID()));
    }
    for (const tab of ["for_you", "new", "top"]) {
      const first = await guest.getFeed(tab, category.id);
      assert.ok(first.data.length > 0);
      assert.ok(first.data.every(p => polls.some(created => created.id === p.id)));
      if (tab !== "for_you") {
        assert.equal(first.page.hasMore, true);
        const second = await guest.getFeed(tab, category.id, first.page.nextCursor);
        assert.equal(new Set([...first.data, ...second.data].map(p => p.id)).size, 21);
      }
    }
    const search = await guest.search(`ışık ${key}`, "polls");
    assert.ok(search.data.length > 0);
    assert.equal(search.page.hasMore, true);
    const next = await guest.search(`ışık ${key}`, "polls", search.page.nextCursor);
    assert.equal(new Set([...search.data, ...next.data].map(r => r.poll.id)).size, 21);
    assert.ok((await guest.search(key, "categories")).data.some(r => r.category.id === category.id));
    assert.ok((await guest.search(`kv30_${key}`, "users")).data.length);
    assert.deepEqual((await guest.search(`absent_${key}`, "communities")).data, []);

    const latest = await db.trendRun.findFirst({ orderBy: { windowEnd: "desc" } });
    const end = new Date(Math.max(latest?.windowEnd.getTime() ?? 0, h.clock.now.getTime()) + 300000);
    const movement = { optionId: polls[4].options[0].id, fromPercent: 75, toPercent: 50,
      deltaPoints: -25, sampleFrom: 40, sampleTo: 60,
      windowFromEnd: "2026-09-23T21:00:00.000Z", windowToEnd: "2026-09-30T21:00:00.000Z" };
    for (const [index, format] of Object.keys(formats).entries()) {
      const ids = [polls[index].id, ...polls.filter((_, i) => i !== index).map(p => p.id)];
      const run = await db.trendRun.create({ data: {
        format, calculationVersion: 1, status: "SUCCEEDED",
        windowStart: new Date(end.getTime() - 7 * 86400000), windowEnd: end,
        startedAt: end, finishedAt: end,
        scores: { create: ids.map((pollId, i) => ({ pollId, rank: i + 1, score: 100 - i,
          components: format === "WEEKLY_MOVERS" ? movement : {} })) },
      } });
      runs.push(run.id);
      const page = await guest.getTrends(format, category.id);
      assert.equal(page.meta.format, format);
      assert.equal(page.data[0].poll.id, polls[index].id);
      assert.equal(page.data[0].poll.options[0].label, "Birinci");
      assert.equal(page.meta.windowEnd, end.toISOString());
      assert.equal(page.page.hasMore, true);
      const rest = await guest.getTrends(format, category.id, page.page.nextCursor);
      const all = [...page.data, ...rest.data];
      assert.equal(new Set(all.map(item => item.poll.id)).size, 21);
      const hidden = all.find(item => item.poll.id === polls[20].id);
      assert.deepEqual(hidden.poll.results, { visible: false });
      assert.equal(hidden.movement, null);
      if (format === "WEEKLY_MOVERS") assert.deepEqual(page.data[0].movement, movement);
      else assert.equal(page.data[0].movement, null);
    }
    await db.trendScore.deleteMany({ where: { runId: runs.at(-1) } });
    const insufficient = await guest.getTrends("WEEKLY_MOVERS", category.id);
    assert.deepEqual(insufficient.data, []);
    assert.equal(insufficient.reason, "INSUFFICIENT_HISTORY");
    await assert.rejects(guest.getFeed("new", category.id, "invalid_cursor"), error => error.code === "INVALID_CURSOR");
  } finally {
    await db.trendRun.deleteMany({ where: { id: { in: runs } } });
    await h.close();
  }
});
