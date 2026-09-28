// Risk seviyesi kuralları (docs/MEDIA_MODERATION.md §6.1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRisk } from "../src/jobs/media/policy.ts";

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
