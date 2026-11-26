/** Synthetic, executable fourth-round #371 P1 regressions. Never TODO/SKIP these. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenV1Publication } from "../src/modules/polls/risk-review.ts";

const poll = (title: string) => ({ kind: "POLL" as const, title, options: [{ label: "Evet" }, { label: "Hayır" }] });

const MUST_REVIEW = [
  "Are you Christian?",
  "Are you an atheist?",
  "Do you believe in God?",
  "Pazar günleri kiliseye gider misin?",
  "Tesettürlü müsün?",
  "Kanser tedavisi görüyor musun?",
  "Antidepresan kullanıyor musun?",
  "Obezite ameliyatı oldun mu?",
  "Engelli misiniz?",
  "Hamile misiniz?",
  "Hiç kürtaj oldun mu?",
  "Trans mısın?",
  "Are you queer?",
  "What is your sexual orientation?",
  "Ermeni misin?",
  "Rum musun?",
  "Zaza mısın?",
  "Laz mısın?",
  "Hiç hapis yattın mı?",
  "Have you ever been convicted of a crime?",
  "Are you a union member?",
  "Muhalefeti mi destekliyorsun iktidarı mı?",
  "Referandumda ne dedin?",
  "Cumhurbaşkanını destekliyor musun?"
];
for (const title of MUST_REVIEW) {
  test(`fourth-round direct personal sensitive question is reviewed: ${title}`, () => {
    const result = screenV1Publication(poll(title));
    assert.equal(result.action, "REVIEW", title);
    assert.ok(result.signals.includes("POSSIBLE_SENSITIVE_CONTEXT"), title);
    assert.equal(JSON.stringify(result).includes(title), false, "signals must not echo sensitive questions");
  });
}

const NEUTRAL_PUBLISH = [
  "Gayrimenkul yatırımı mı mevduat mı?",
  "Seçim barajı düşürülmeli mi?",
  "Kanser araştırmalarına daha çok fon ayrılmalı mı?",
  "Hastane randevu sistemi nasıl olmalı?",
  "Doğum günü kutlaması güzel olur mu?",
  "Dinamik fiyatlandırma faydalı mı?"
];
for (const title of NEUTRAL_PUBLISH) {
  test(`non-personal topic is not falsely routed to review: ${title}`, () => {
    assert.deepEqual(screenV1Publication(poll(title)), { action: "PUBLISH", signals: [] }, title);
  });
}


test("cross-field personal context cannot bypass human review", () => {
  for (const input of [
    { ...poll("Bir soru"), description: "Are you?", options: [{ label: "Christian" }, { label: "Other" }] },
    { ...poll("Kendinizi nasıl tanımlarsınız?"), addenda: ["Ermeni, Rum veya diğer"] },
    { ...poll("Do you have a diagnosis?"), description: "Multiple sclerosis" },
    { ...poll("Do you have a criminal record?") },
    { ...poll("Do you take insulin?") },
    { ...poll("Are you Buddhist?") },
  ]) {
    const result = screenV1Publication(input);
    assert.equal(result.action, "REVIEW", input.title);
    assert.ok(result.signals.includes("POSSIBLE_SENSITIVE_CONTEXT"));
  }
});

test("new sensitive vocabulary alone does not block neutral discussion", () => {
  for (const title of ["Buddhist architecture and cultural heritage", "Insulin manufacturing capacity", "Multiple sclerosis research funding", "Prison library policy"]) assert.deepEqual(screenV1Publication(poll(title)), { action: "PUBLISH", signals: [] }, title);
});
