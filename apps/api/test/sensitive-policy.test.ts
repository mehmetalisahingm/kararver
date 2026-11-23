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

test("annotated personal categories are blocked but topic-only descriptions remain allowed", () => {
  const prompt = "Hangisisin? Sana yakın olan grubu seç";
  for (const choices of [
    [{ label: "Alevi mezhebi" }, { label: "Sünni mezhebi" }],
    [{ label: "Alevi (A)" }, { label: "Sünni (B)" }],
  ]) {
    assert.deepEqual(detectSensitiveSurvey({ title: prompt, options: choices }),
      { field: "options.0.label", category: "belief" });
  }
  for (const title of [
    "Psikiyatrik tedavi hizmetleri ücretsiz olmalı mı?",
    "Hangi hastalık için araştırma bütçesi artırılmalı?",
  ]) assert.equal(detectSensitiveSurvey({ title, options: [{ label: "Katılıyorum" }, { label: "Katılmıyorum" }] }), null, title);

  assert.deepEqual(detectSensitiveSurvey({ title: "Psikiyatrik tedavi görüyor musun?" }),
    { field: "title", category: "health" });
  assert.deepEqual(detectSensitiveSurvey({ title: "Hangi hastalığın var?" }),
    { field: "title", category: "health" });
});


test("direct sensitive respondent prompts in polite Turkish are rejected without blocking neutral topics", () => {
  const blocked = [
    ["İnancınız nedir?", "belief"],
    ["Mezhebiniz nedir?", "belief"],
    ["Cinsel yöneliminiz nedir?", "sexual"],
    ["Sabıka kaydınız var mı?", "justice"],
    ["Parmak iziniz nedir?", "biometric"],
    ["Parmak izinizi paylaşır mısınız?", "biometric"],
  ] as const;
  for (const [title, category] of blocked) {
    const result = detectSensitiveSurvey({ title });
    assert.deepEqual(result, { field: "title", category }, title);
  }
  for (const title of [
    "İnanç özgürlüğü hakkında kamu hizmetleri nasıl iyileştirilmeli?",
    "Sabıka kayıtlarına erişim prosedürü nasıl geliştirilmeli?",
    "Parmak izi sensörleri daha hızlı çalışmalı mı?",
  ]) assert.equal(detectSensitiveSurvey({ title }), null, title);
});


test("review #371: bypass probes are rejected before unmoderated publication", () => {
  const choose = (...labels: string[]) => labels.map(label => ({ label }));
  const forbidden = [
    { title: "Hangi par\u200bti\u200byi seçtin?" },
    { title: "S1yas1 görüşün ne?" },
    { title: "Hangisisin?", options: choose("HDP", "DEM") },
    { title: "Hangisisin?", options: choose("CHP'li", "AK Partili") },
    { title: "Sence?", options: choose("Ben AKP'liyim", "Ben CHP'liyim") },
    { title: "Which party did you vote for?" },
    { title: "What is your religion?" },
    { title: "Depresyon tanısı aldın mı?" },
    { title: "Eşcinsel misin?" },
    { title: "Ramazanda oruç tutuyor musun?" },
    { title: "Namaz kılıyor musun?" },
    { title: "Başörtüsü takıyor musun?" },
    { title: "Kürt müsün Türk müsün?", options: choose("Kürt", "Türk") },
    { title: "Hangisisin?", options: choose("Kürt", "Türk", "Arap") },
    { title: "Engelli raporun var mı?" },
  ];
  for (const input of forbidden) {
    const result = detectSensitiveSurvey(input);
    assert.ok(result, JSON.stringify(input) + " must be rejected or reviewed");
    assert.match(result.field, /^(title|options\.\d+\.label)$/);
  }
});

test("review #371: ordinary policy and product questions remain allowed", () => {
  for (const title of [
    "Seçim barajı düşürülmeli mi?",
    "Kanser araştırmalarına daha çok fon ayrılmalı mı?",
    "Türkçe dil kurslarının fiyatları ne olmalı?",
    "Hangi telefon daha iyi?",
  ]) assert.equal(detectSensitiveSurvey({ title }), null, title);
});


test("review #371: generalized P1 bypass variants are blocked (independent of the original 15)", () => {
  const forbidden = [
    ["Ramazanda oruç tutuyor musunuz?", "belief"],
    ["Namaz kılıyor musunuz?", "belief"],
    ["Başörtüsü takıyor musunuz?", "belief"],
    ["Depresyon teşhisi kondu mu?", "health"],
    ["Gay misin?", "sexual"],
    ["Lezbiyen misiniz?", "sexual"],
    ["Kürt müsünüz?", "ethnicity"],
    ["Dinin hangisi?", "belief"],
    ["Allah'a inanıyor musun?", "belief"],
    ["Hiç tutuklandın mı?", "justice"],
    ["HIV testin pozitif mi çıktı?", "health"],
    ["Son seçimde kimi destekledin?", "political"],
    ["Cumhurbaşkanlığı seçiminde tercihin?", "political"],
    ["Are you gay?", "sexual"],
    ["Do you pray five times a day?", "belief"],
    ["Have you been diagnosed with depression?", "health"],
    ["How did you vote in the last election?", "political"],
    ["Hangi pаrtiye oy verdin?", "political"], // Cyrillic U+0430
    ["Hangi pαrtiye oy verdin?", "political"], // Greek U+03B1
  ] as const;
  for (const [title, category] of forbidden) {
    const result = detectSensitiveSurvey({ title });
    assert.deepEqual(result, { field: "title", category }, title);
  }
  for (const title of ["Sence?", "Bu seçeneklerden hangisi daha yakın?"]) {
    for (const labels of [
      ["AKP'liyim", "CHP'liyim"],
      ["Ben AKP'liyim", "Ben CHP'liyim"],
    ]) {
      const result = detectSensitiveSurvey({ title, options: labels.map(label => ({ label })) });
      assert.deepEqual(result, { field: "options.0.label", category: "political" }, title);
    }
  }
});

test("review #371: new generalizations do not classify neutral policy topics as personal data", () => {
  for (const title of [
    "Son seçimde katılım oranı yükseldi mi?",
    "Cumhurbaşkanlığı seçiminin tarihi ne zaman?",
    "Ramazanda oruç geleneğinin tarihi nedir?",
    "HIV test merkezleri hangi şehirlerde?",
    "Depresyon hakkında bilimsel araştırma var mı?",
    "Parti afişlerinde hangi renkler tercih ediliyor?",
  ]) assert.equal(detectSensitiveSurvey({ title }), null, title);
});

test("review #371: self-identification and first-person voting options cannot bypass generic questions", () => {
  const options = (...labels: string[]) => labels.map(label => ({ label }));
  const cases = [
    { title: "Kendinizi hangisine yakın hissediyorsunuz?", options: options("Alevi", "Sünni"), category: "belief" },
    { title: "Sence?", options: options("Ben CHP'ye oy verdim", "Ben DEM'e oy verdim"), category: "political" },
    { title: "Hangisini seçersiniz?", options: options("AKP'ye oy veriyorum", "MHP'ye oy veriyorum"), category: "political" },
  ] as const;
  for (const input of cases) {
    assert.deepEqual(detectSensitiveSurvey(input), { field: "options.0.label", category: input.category }, input.title);
  }
});

test("review #371: group-history and election-level discussion are not first-person disclosure", () => {
  assert.equal(detectSensitiveSurvey({
    title: "Kültür dersinde hangi konuya öncelik verilmeli?",
    options: [{ label: "Alevilik tarihi" }, { label: "Sünnilik tarihi" }],
  }), null);
  assert.equal(detectSensitiveSurvey({ title: "Partilerin oy oranları nasıl değişti?" }), null);
});
