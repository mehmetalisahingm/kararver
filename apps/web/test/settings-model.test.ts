// Sistem ayarları ekranının saf kuralları (KV-40, #42).
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingKeys } from "@kararver/contracts";
import { emergencySwitches, formatValue, groupSettings, isEmergencyKey, isRisky, labelOf, parseInput, rangeOf, sameValue } from "../src/features/admin/settings-model.ts";

test("acil durum anahtarları kayıt defterindeki bütün feature/bakım ayarlarını kapsar", () => {
  const expected = settingKeys.filter((k) => k.startsWith("features.") || k === "maintenance.enabled").sort();
  assert.deepEqual(emergencySwitches.map((s) => s.key).sort(), expected);
});

test("her kayıt defteri anahtarının okunur açıklaması var; bilinmeyen anahtar kendisini gösterir", () => {
  for (const key of settingKeys) assert.notEqual(labelOf(key), key, key);
  assert.equal(labelOf("yeni.ayar"), "yeni.ayar");
});

test("gruplama: acil durum anahtarları tablodan çıkar; her ayar bir grupta; sıra sabit", () => {
  const items = settingKeys.map((key) => ({ key }));
  const groups = groupSettings(items);
  const keys = groups.flatMap((g) => g.items.map((i) => i.key));
  assert.equal(keys.length, settingKeys.length - emergencySwitches.length);
  assert.ok(keys.every((k) => !isEmergencyKey(k)));
  assert.deepEqual(groups.slice(0, 3).map((g) => g.group), ["polls", "comments", "media"]);
  assert.ok(groups.some((g) => g.group === "limits" && g.label === "Hız sınırları"));
});

test("riskli durum: bakımda açık, diğer anahtarlarda kapalı", () => {
  assert.equal(isRisky("maintenance", true), true);
  assert.equal(isRisky("maintenance", false), false);
  assert.equal(isRisky("comments", false), true);
  assert.equal(isRisky("comments", true), false);
});

test("giriş ayrıştırma: tam sayı, aralık, boş ve ondalık reddi; bool; tür listesi", () => {
  assert.deepEqual(parseInput("polls.dailyLimit", 10, " 25 "), { ok: true, value: 25 });
  assert.equal(parseInput("polls.dailyLimit", 10, "2.5").ok, false);
  assert.equal(parseInput("polls.dailyLimit", 10, "").ok, false);
  assert.equal(parseInput("polls.dailyLimit", 10, "abc").ok, false);
  const low = parseInput("polls.dailyLimit", 10, "0");
  assert.deepEqual(low, { ok: false, message: "En az 1 olmalı." });
  const high = parseInput("polls.maxDurationHours", 720, "721");
  assert.deepEqual(high, { ok: false, message: "En fazla 720 olmalı." });
  assert.deepEqual(parseInput("polls.voteChangeAllowed", true, false), { ok: true, value: false });
  assert.deepEqual(parseInput("media.allowedTypes", ["image/webp"], ["image/png"]), { ok: true, value: ["image/png"] });
  assert.equal(parseInput("media.allowedTypes", ["image/webp"], []).ok, false);
});

test("aralık metni ve değer biçimi", () => {
  assert.equal(rangeOf("polls.dailyLimit"), "1–1000");
  assert.equal(rangeOf("points.initialGrant"), "en az 0");
  assert.equal(rangeOf("polls.voteChangeAllowed"), null);
  assert.equal(formatValue("polls.voteChangeAllowed", true), "Açık");
  assert.equal(formatValue("media.allowedTypes", ["image/png", "image/webp"]), "image/png, image/webp");
  assert.match(formatValue("media.maxBytes", 8 * 1024 * 1024), /8 MB/);
  assert.equal(sameValue(["a"], ["a"]), true);
  assert.equal(sameValue(1, 2), false);
});
