/**
 * #371 yeniden test (Utku, 15 Kasım): #353 düzeltmesi 15 örneği tam ifade olarak kapattı.
 * 26 Kasım: #395 üzerinde önceki 20 açık vaka zorunlu regresyon olarak etkinleştirildi.
 * Değişmez kural: aşağıdaki sentetik girdilerin her biri detectSensitiveSurvey tarafından tutulur.
 * Sentetik test; tüm güvenlik kabulü anlamına gelmez.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSensitiveSurvey, type SensitiveInput } from "../src/modules/polls/sensitive-policy.ts";

const opts = (...labels: string[]) => labels.map(label => ({ label }));
const yesNo = opts("Evet", "Hayır");
const YES_NO = opts("Yes", "No");

const FIXED: Array<[string, SensitiveInput]> = [
  ["oruç, geçmiş zaman", { title: "Bu ramazan oruç tuttun mu?", options: yesNo }],
  ["oruç, siz", { title: "Ramazanda oruç tutuyor musunuz?", options: yesNo }],
  ["namaz, siz", { title: "Namaz kılıyor musunuz?", options: yesNo }],
  ["başörtüsü, siz", { title: "Başörtüsü takıyor musunuz?", options: yesNo }],
  ["depresyon, eşanlamlı", { title: "Sana hiç depresyon teşhisi kondu mu?", options: yesNo }],
  ["cinsel yönelim, gay", { title: "Gay misin?", options: yesNo }],
  ["cinsel yönelim, lezbiyen", { title: "Lezbiyen misiniz?", options: yesNo }],
  ["etnik köken, siz", { title: "Kürt müsünüz?", options: yesNo }],
  ["Kiril benzer harf", { title: "Hangi pаrtiye yakınsın?", options: opts("A", "B") }],
  ["oy davranışı, destek", { title: "Son seçimde kimi destekledin?", options: opts("Aday A", "Aday B") }],
  ["oy davranışı, tercih", { title: "Cumhurbaşkanlığı seçiminde tercihin?", options: opts("Aday A", "Aday B") }],
  ["İngilizce, cinsel yönelim", { title: "Are you gay?", options: YES_NO }],
  ["İngilizce, ibadet", { title: "Do you pray five times a day?", options: YES_NO }],
  ["İngilizce, tanı", { title: "Have you been diagnosed with depression?", options: YES_NO }],
  ["İngilizce, oy", { title: "How did you vote in the last election?", options: opts("AKP", "CHP") }],
  ["seçenekte öz tanım", { title: "Ben ...", options: opts("AKP'liyim", "CHP'liyim") }],
  ["din, çekim", { title: "Dinin hangisi?", options: opts("İslam", "Hristiyanlık") }],
  ["inanç, dolaylı", { title: "Allah'a inanıyor musun?", options: yesNo }],
  ["sabıka, eşanlamlı", { title: "Hiç tutuklandın mı?", options: yesNo }],
  ["sağlık, HIV testi", { title: "HIV testin pozitif mi çıktı?", options: yesNo }],
];

const CAUGHT: Array<[string, SensitiveInput]> = [
  ["leet parti", { title: "Hangi p4rtiye oy verdin?", options: opts("A", "B") }],
  ["harf aralıklı", { title: "H a n g i  p a r t i y e oy verdin?", options: opts("A", "B") }],
];

const ALLOWED: Array<[string, SensitiveInput]> = [
  ["genel politika", { title: "Asgari ücret ne kadar artmalı?", options: opts("%20", "%40") }],
  ["seçim tarihi", { title: "Türkiye'nin ilk çok partili seçimi hangi yıl?", options: opts("1946", "1950") }],
  ["sağlık hizmeti", { title: "Hastane randevu sistemi nasıl olmalı?", options: opts("Online", "Telefon") }],
];

for (const [name, input] of FIXED) {
  test(`varyant tutulur: ${name}`, () => {
    assert.notEqual(detectSensitiveSurvey(input), null);
  });
}
for (const [name, input] of CAUGHT) {
  test(`varyant tutulur (bugün korunuyor): ${name}`, () => {
    assert.notEqual(detectSensitiveSurvey(input), null);
  });
}
for (const [name, input] of ALLOWED) {
  test(`genel konu reddedilmez: ${name}`, () => {
    assert.equal(detectSensitiveSurvey(input), null);
  });
}
