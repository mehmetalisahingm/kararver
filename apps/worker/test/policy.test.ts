// Risk seviyesi kuralları (docs/MEDIA_MODERATION.md §6.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsRegistry } from "@kararver/contracts";
import { assessRisk, DEFAULT_THRESHOLDS, thresholdsFromPercent } from "../src/jobs/media/policy.ts";

test("tespit yoksa veya sadece örtülü/yüz sınıfları varsa düşük risk", () => {
  assert.deepEqual(assessRisk([]), { level: "LOW", score: 0 });
  assert.equal(assessRisk([{ class: "FACE_FEMALE", score: 0.99 }, { class: "BELLY_COVERED", score: 0.9 }]).level, "LOW");
});

test("yüksek sınıf: ≥0,65 HIGH, 0,35–0,65 MEDIUM, altı LOW", () => {
  assert.deepEqual(assessRisk([{ class: "FEMALE_BREAST_EXPOSED", score: 0.8 }]), { level: "HIGH", score: 0.8 });
  assert.equal(assessRisk([{ class: "BUTTOCKS_EXPOSED", score: 0.65 }]).level, "HIGH");
  assert.equal(assessRisk([{ class: "MALE_GENITALIA_EXPOSED", score: 0.5 }]).level, "MEDIUM");
  assert.equal(assessRisk([{ class: "ANUS_EXPOSED", score: 0.34 }]).level, "LOW");
});

test("orta sınıflar tek başına en fazla MEDIUM olur", () => {
  assert.equal(assessRisk([{ class: "BELLY_EXPOSED", score: 0.99 }]).level, "MEDIUM");
  assert.equal(assessRisk([{ class: "MALE_BREAST_EXPOSED", score: 0.5 }]).level, "LOW");
});

test("birden fazla bölgede en kötüsü kazanır; eşikler değiştirilebilir", () => {
  const detections = [
    { class: "FACE_MALE", score: 0.99 },
    { class: "BELLY_EXPOSED", score: 0.7 },
    { class: "FEMALE_GENITALIA_EXPOSED", score: 0.9 },
  ];
  assert.deepEqual(assessRisk(detections), { level: "HIGH", score: 0.9 });
  assert.equal(assessRisk([{ class: "FEMALE_BREAST_EXPOSED", score: 0.5 }], { high: 0.4, medium: 0.2 }).level, "HIGH");
});

// ── KV-38 (#40): eşikler ayardan ──
test("thresholdsFromPercent: yüzde → 0–1; orta eşik yüksek eşiği aşamaz (fail-closed)", () => {
  assert.deepEqual(thresholdsFromPercent(35, 65), { medium: 0.35, high: 0.65 });
  assert.deepEqual(thresholdsFromPercent(70, 50), { medium: 0.5, high: 0.5 });
});

test("kayıt defteri varsayılanları DEFAULT_THRESHOLDS ile aynı (tek kaynak kayması olmaz)", () => {
  const medium = settingsRegistry["media.riskMediumPercent"].default!.value as number;
  const high = settingsRegistry["media.riskHighPercent"].default!.value as number;
  assert.deepEqual(thresholdsFromPercent(medium, high), DEFAULT_THRESHOLDS);
});

test("eşik değişimi sonucu değiştirir: aynı tespit gevşek eşikte inceleme, sıkı eşikte yüksek risk", () => {
  const d = [{ class: "FEMALE_BREAST_EXPOSED", score: 0.5 }];
  assert.equal(assessRisk(d, thresholdsFromPercent(35, 65)).level, "MEDIUM");
  assert.equal(assessRisk(d, thresholdsFromPercent(35, 45)).level, "HIGH");
  assert.equal(assessRisk(d, thresholdsFromPercent(55, 65)).level, "LOW");
});

test("fail-closed taban: izinli en gevşek ayarlarda bile yüksek güvenli tespit yayına çıkamaz", () => {
  const loosest = thresholdsFromPercent(settingsRegistry["media.riskMediumPercent"].max!, settingsRegistry["media.riskHighPercent"].max!);
  for (const cls of ["FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED", "FEMALE_BREAST_EXPOSED", "BUTTOCKS_EXPOSED"]) {
    assert.equal(assessRisk([{ class: cls, score: 0.6 }], loosest).level, "MEDIUM", cls);
    assert.equal(assessRisk([{ class: cls, score: 0.95 }], loosest).level, "HIGH", cls);
  }
  // Taban 0,6'dır: en gevşek ayarda bile bunun altındaki tespit LOW olabilir (bilinen, belgelenmiş sınır).
  assert.equal(assessRisk([{ class: "BUTTOCKS_EXPOSED", score: 0.59 }], loosest).level, "LOW");
});
