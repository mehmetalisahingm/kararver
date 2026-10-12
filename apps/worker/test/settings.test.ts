// Worker sistem ayarı okuyucusu (KV-40, #42): varsayılan, DB değeri, önbellek ve fail-safe.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "@kararver/contracts";
import { createWorkerSettings } from "../src/settings.ts";
import { TREND_CONFIG } from "../src/jobs/trends/config.ts";
import { scoreQuery } from "../src/jobs/trends/score.ts";
import { loadTrendSettings } from "../src/jobs/trends/settings.ts";

type Row = { key: string; value: unknown; version?: number };
function fakePrisma(load: () => Promise<Row[]>) {
  return { systemSetting: { findMany: async () => load() } } as never;
}

test("satırı olmayan ayar contracts varsayılanıyla; DB değeri varsayılanı ezer", async () => {
  const settings = createWorkerSettings(fakePrisma(async () => [{ key: "media.maxBytes", value: 1_000_000 }]), { now: () => new Date() });
  assert.equal(await settings.get("media.maxBytes"), 1_000_000);
  assert.equal(await settings.get("trends.moversMinVotes"), defaultSettings().values["trends.moversMinVotes"]);
});

test("bilinmeyen anahtar satırı yok sayılır (yeni sürümde silinmiş ayar worker'ı düşürmez)", async () => {
  const settings = createWorkerSettings(fakePrisma(async () => [{ key: "eski.ayar", value: 1 }]), { now: () => new Date() });
  assert.equal(await settings.get("media.maxBytes"), defaultSettings().values["media.maxBytes"]);
});

test("önbellek TTL'e kadar eski değeri tutar, sonra yeniler; invalidate anında", async () => {
  let now = new Date("2026-10-08T10:00:00.000Z");
  let value = 5;
  const settings = createWorkerSettings(fakePrisma(async () => [{ key: "trends.moversMinVotes", value }]), { now: () => now, ttlMs: 5_000 });
  assert.equal(await settings.get("trends.moversMinVotes"), 5);
  value = 9;
  now = new Date(now.getTime() + 4_000);
  assert.equal(await settings.get("trends.moversMinVotes"), 5);
  now = new Date(now.getTime() + 2_000);
  assert.equal(await settings.get("trends.moversMinVotes"), 9);
  value = 11;
  settings.invalidate();
  assert.equal(await settings.get("trends.moversMinVotes"), 11);
});

test("fail-safe: DB okunamazsa son bilinen değer, hiç yoksa varsayılan; job düşmez", async () => {
  let now = new Date("2026-10-08T10:00:00.000Z");
  let fail = true;
  const errors: unknown[] = [];
  const settings = createWorkerSettings(
    fakePrisma(async () => {
      if (fail) throw new Error("db yok");
      return [{ key: "trends.moversMinVotes", value: 7 }];
    }),
    { now: () => now, ttlMs: 5_000, onError: (e) => errors.push(e) },
  );
  assert.equal(await settings.get("trends.moversMinVotes"), defaultSettings().values["trends.moversMinVotes"]);
  fail = false;
  now = new Date(now.getTime() + 1_500);
  assert.equal(await settings.get("trends.moversMinVotes"), 7);
  fail = true;
  now = new Date(now.getTime() + 6_000);
  assert.equal(await settings.get("trends.moversMinVotes"), 7, "son bilinen değer");
  assert.equal(errors.length, 2);
});

test("Haftanın Değişkenleri sorgusu eşikleri ayardan alır; verilmezse kayıt defteri varsayılanı", () => {
  const end = new Date("2026-10-08T10:00:00.000Z");
  const custom = scoreQuery("WEEKLY_MOVERS", end, { minVotes: 77, minActiveAccounts: 5 }).values;
  assert.ok(custom.includes(77) && custom.includes(5));
  const dflt = scoreQuery("WEEKLY_MOVERS", end).values;
  assert.ok(dflt.includes(TREND_CONFIG.movers.minVotes) && dflt.includes(TREND_CONFIG.movers.minActiveAccounts));
  assert.ok(!dflt.includes(77));
});

test("trend varsayılanları mevcut beş formatın hesaplarını korur", async () => {
  const settings = createWorkerSettings(fakePrisma(async () => []), { now: () => new Date() });
  const config = await loadTrendSettings(settings);
  for (const key of Object.keys(config) as (keyof typeof config)[]) assert.deepEqual(config[key], TREND_CONFIG[key], key);
});

test("katsayı ve sürümler tek görüntüden; TTL sonrasında artar, ilgisiz ayar etkilemez", async () => {
  let now = new Date(0);
  let rows: Row[] = [
    { key: "trends.dailyCommentWeightPercent", value: 75, version: 2 },
    { key: "trends.weeklySmoothing", value: 22, version: 3 },
    { key: "media.maxBytes", value: 4000, version: 90 },
  ];
  const settings = createWorkerSettings(fakePrisma(async () => rows), { now: () => now });
  const first = await loadTrendSettings(settings);
  assert.equal(first.daily.commentWeight, 0.75);
  assert.equal(first.weeklyRising.smoothing, 22);
  assert.equal(first.calculationVersion, 6);
  rows = [{ key: "trends.dailyCommentWeightPercent", value: 50, version: 4 }, rows[1]!, rows[2]!];
  assert.deepEqual(await loadTrendSettings(settings), first);
  now = new Date(5001);
  const next = await loadTrendSettings(settings);
  assert.equal(next.daily.commentWeight, 0.5);
  assert.equal(next.calculationVersion, 8);
  assert.equal(first.daily.commentWeight, 0.75, "devam eden işin görüntüsü değişmez");
  assert.ok(scoreQuery("DAILY_RISING", now, next.movers, next).values.includes(0.5));
});

test("invalidate sonrası DB hatasında ve bozuk ayarda son iyi görüntü korunur", async () => {
  let rows: Row[] = [{ key: "trends.dailyGravityPercent", value: 150, version: 2 }];
  let fail = false;
  const settings = createWorkerSettings(fakePrisma(async () => {
    if (fail) throw new Error("DB unavailable");
    return rows;
  }), { now: () => new Date() });
  const expected = await loadTrendSettings(settings);
  const copy = await settings.snapshot();
  (copy.values as Record<string, unknown>)["trends.dailyGravityPercent"] = -1;
  assert.equal((await loadTrendSettings(settings)).daily.gravity, 1.5, "istemci önbelleği değiştiremez");
  settings.invalidate();
  fail = true;
  assert.deepEqual(await loadTrendSettings(settings), expected);
  fail = false;
  rows = [{ key: "trends.dailyGravityPercent", value: 0, version: 3 }];
  settings.invalidate();
  assert.deepEqual(await loadTrendSettings(settings), expected);
});
