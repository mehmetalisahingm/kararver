import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSensitiveSurvey } from "../src/modules/polls/sensitive-policy.ts";

test("V1 refuses explicit special-category respondent questions, regardless of Turkish case/diacritics", () => {
  const cases = [
    ["Siyasi görüşün nedir, hangi görüştesin?", "political"],
    ["Hangi partiye oy verdin?", "political"],
    ["Dinin nedir, hangi dine inanıyorsun?", "belief"],
    ["Müslüman mısın?", "belief"],
    ["Hangi hastalığın var?", "health"],
    ["Sağlık durumun nasıl?", "health"],
    ["Hangi ilacı kullanıyorsun?", "health"],
    ["HIV pozitif misin?", "health"],
    ["Etnik kökenin nedir?", "ethnicity"],
    ["Hangi sendikaya üyesin?", "membership"],
    ["Cinsel yönelimin nedir?", "sexual"],
    ["Sabıka kaydın var mı?", "justice"],
    ["Genetik test sonucunuz nedir?", "biometric"],
  ] as const;
  for (const [title, category] of cases) {
    const match = detectSensitiveSurvey({ title });
    assert.equal(match?.category, category, title);
    assert.equal(match?.field, "title");
  }
});

test("V1 refuses sensitive choice labels even if title is intentionally ambiguous", () => {
  for (const options of [
    [{ label: "CHP" }, { label: "MHP" }],
    [{ label: "Müslüman" }, { label: "Ateist" }],
    [{ label: "Diyabet" }, { label: "Depresyon" }],
  ]) {
    const outcome = detectSensitiveSurvey({ title: "Hangisisin? Birini seç", options });
    assert.match(outcome?.field ?? "", /^options\.\d+\.label$/);
  }
});

test("V1 protects description, extra info, discussions, and post-publication addenda", () => {
  assert.deepEqual(
    detectSensitiveSurvey({ title: "Günlük sorumuz", description: "Sağlık durumun nasıl?" }),
    { field: "description", category: "health" },
  );
  assert.deepEqual(
    detectSensitiveSurvey({ title: "Günlük sorumuz", extraInfo: "Hangi partiye oy verdin?" }),
    { field: "extraInfo", category: "political" },
  );
  assert.deepEqual(
    detectSensitiveSurvey({ body: "Dinin nedir?" }),
    { field: "body", category: "belief" },
  );
});

test("general public-policy/service questions and ordinary product polls are not automatically rejected", () => {
  const allowed = [
    "Sağlık Bakanlığı randevu hizmeti nasıl iyileştirilebilir?",
    "Hastane otoparkı daha ucuz olmalı mı?",
    "Bu seçimde oy kullanma sistemi nasıl kolaylaştırılır?",
    "Telefon fiyatları önümüzdeki yıl düşer mi?",
    "Hangi telefon daha iyi?",
    "Dini mimari eserlerin restorasyonu nasıl yapılmalı?",
    "Diyabet hakkında bilimsel makale önerileri var mı?",
    "Hangi ilacı hastane stoklarına eklemeli?",
  ];
  for (const title of allowed) assert.equal(detectSensitiveSurvey({ title }), null, title);
});

test("matching returns only category and field, never supplied private text", () => {
  const risk = detectSensitiveSurvey({ title: "Hangi partiye oy verdin?" });
  const serialized = JSON.stringify(risk);
  assert.ok(risk);
  assert.ok(!serialized.includes("oy verdin"));
  assert.ok(!serialized.includes("Hangi partiye"));
});

test("ordinary 'tip' descriptions are not mistaken for a political party; exact TİP still blocks", () => {
  const title = "Hangisini tercih edersin?";
  assert.equal(detectSensitiveSurvey({ title, options: [{ label: "Spor tip" }, { label: "Klasik tip" }] }), null);
  assert.deepEqual(
    detectSensitiveSurvey({ title, options: [{ label: "TİP" }, { label: "CHP" }] }),
    { field: "options.0.label", category: "political" },
  );
  assert.deepEqual(
    detectSensitiveSurvey({ title, options: [{ label: "Türkiye İşçi Partisi" }, { label: "Diğer" }] }),
    { field: "options.0.label", category: "political" },
  );
});

test("non-personal research and public-service choices remain allowed", () => {
  assert.equal(detectSensitiveSurvey({
    title: "Hangi alanda araştırmaya daha fazla bütçe ayrılmalı?",
    options: [{ label: "Kanser araştırmaları" }, { label: "Uzay araştırmaları" }],
  }), null);
  assert.equal(detectSensitiveSurvey({
    title: "Kültürel miras üzerine genel değerlendirme",
    options: [{ label: "Alevi" }, { label: "Sünni" }],
  }), null);
});

test("an addendum cannot turn earlier categorical choices into a personal-attribute question", () => {
  const base = {
    title: "Kültürel miras üzerine genel değerlendirme",
    options: [{ label: "Alevi" }, { label: "Sünni" }],
  };
  assert.deepEqual(detectSensitiveSurvey({ ...base, addenda: ["Hangisisin? Sana yakın olan grubu seç"] }),
    { field: "options.0.label", category: "belief" });
  assert.deepEqual(detectSensitiveSurvey({
    title: "Kültürel miras üzerine genel değerlendirme",
    addenda: ["Hangisisin? Sana yakın olan grubu seç"],
    options: base.options,
  }), { field: "options.0.label", category: "belief" });
});
