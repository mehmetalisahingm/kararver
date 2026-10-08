// Worker sistem ayarı okuyucusu (KV-40, #42): varsayılan, DB değeri, önbellek ve fail-safe.
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings } from "@kararver/contracts";
import { createWorkerSettings } from "../src/settings.ts";
import { TREND_CONFIG } from "../src/jobs/trends/config.ts";
import { scoreQuery } from "../src/jobs/trends/score.ts";

type Row = { key: string; value: unknown };
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
