/**
 * Independent synthetic #371/#393 P1 guard regression.
 * These cases require human REVIEW rather than unmoderated PUBLISH.
 * They are executable assertions, not skipped tests or TODO placeholders.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenV1Publication, type ReviewInput } from "../src/modules/polls/risk-review.ts";

const labels = (...values: string[]) => values.map(label => ({ label }));
const yesNo = labels("Evet", "Hayır");
const poll = (title: string, options = yesNo): ReviewInput => ({ kind: "POLL", title, options });

const MUST_REVIEW: Array<[string, ReviewInput]> = [
  ["oruç geçmiş zaman", poll("Bu ramazan oruç tuttun mu?")],
  ["oruç siz", poll("Ramazanda oruç tutuyor musunuz?")],
  ["namaz siz", poll("Namaz kılıyor musunuz?")],
  ["başörtüsü", poll("Başörtüsü takıyor musunuz?")],
  ["depresyon tanı", poll("Sana hiç depresyon teşhisi kondu mu?")],
  ["gay", poll("Gay misin?")],
  ["lezbiyen", poll("Lezbiyen misiniz?")],
  ["kürt", poll("Kürt müsünüz?")],
  ["Kiril homoglifi", poll("Hangi pаrtiye yakınsın?", labels("A", "B"))],
  ["aday desteği", poll("Son seçimde kimi destekledin?", labels("Aday A", "Aday B"))],
  ["cumhurbaşkanlığı tercihi", poll("Cumhurbaşkanlığı seçiminde tercihin?", labels("Aday A", "Aday B"))],
  ["are you gay", poll("Are you gay?", labels("Yes", "No"))],
  ["pray five times", poll("Do you pray five times a day?", labels("Yes", "No"))],
  ["diagnosed with depression", poll("Have you been diagnosed with depression?", labels("Yes", "No"))],
  ["vote last election", poll("How did you vote in the last election?", labels("AKP", "CHP"))],
  ["öz tanım seçenek", poll("Ben ...", labels("AKP'liyim", "CHP'liyim"))],
  ["dinin hangisi", poll("Dinin hangisi?", labels("İslam", "Hristiyanlık"))],
  ["inanç dolaylı", poll("Allah'a inanıyor musun?")],
  ["tutuklanma", poll("Hiç tutuklandın mı?")],
  ["HIV test sonucu", poll("HIV testin pozitif mi çıktı?")],
  ["sıfır genişlikli siyasi", poll("Si\u200byasi konularda hangisine yakınsın?", labels("A", "B"))],
  // Independent third-round variants (#395); not in the original 15.
  ["oruca geniş zaman", poll("Ramazanda oruç tutar mısın?")],
  ["namaza geniş zaman", poll("Namaz kılar mısınız?")],
  ["inanç geniş zaman", poll("Allah'a inanır mısın?")],
  ["ramazan kelimesi olmadan oruç", poll("Oruç tutuyor musun?")],
  ["diyabet teşhisi", poll("Sana diyabet teşhisi kondu mu?")],
  ["HIV diagnosed english", poll("Have you been diagnosed with HIV?", labels("Yes", "No"))],
  ["ever diagnosed", poll("Have you ever been diagnosed with depression?", labels("Yes", "No"))],
  ["HIV geçmiş", poll("HIV testin pozitif miydi?")],
  ["dinin hangisidir", poll("Dinin hangisidir?")],
  ["tutuklandınız", poll("Hiç tutuklandınız mı?")],
  ["gözaltına", poll("Hiç gözaltına alındın mı?")],
  ["biseksüel", poll("Biseksüel misin?")],
  ["lesbian", poll("Are you lesbian?", labels("Yes", "No"))],
  ["bisexual", poll("Are you bisexual?", labels("Yes", "No"))],
  ["arap", poll("Arap mısın?")],
  ["are you muslim", poll("Are you Muslim?", labels("Yes", "No"))],
  ["Kiril k homoglifi", poll("кürt müsünüz?")],
  ["hangi adayı", poll("Son seçimde hangi adayı destekledin?")],
  ["future vote", poll("How will you vote in the next election?")],
  ["ruling party", poll("Did you vote for the ruling party?")],
  ["öz tanım oy", poll("Hangi seçenek sana yakın?", labels("CHP'ye oy verdim", "MHP'ye oy verdim"))],
];

for (const [name, input] of MUST_REVIEW) {
  test(`P1 sensitive context is not auto-published: ${name}`, () => {
    const decision = screenV1Publication(input);
    assert.equal(decision.action, "REVIEW");
    assert.ok(!JSON.stringify(decision).includes(input.title), "do not echo input in review signals");
  });
}

test("neutral public-service and product questions are not automatically queued", () => {
  for (const title of [
    "Seçim barajı düşürülmeli mi?",
    "Seçim sistemi nasıl iyileştirilebilir?",
    "Kanser araştırmalarına daha çok fon ayrılmalı mı?",
    "Hastane randevu sistemi nasıl olmalı?",
    "Asgari ücret ne kadar artmalı?",
    "Hangi telefon daha iyi?",
  ]) {
    assert.deepEqual(screenV1Publication(poll(title)), { action: "PUBLISH", signals: [] }, title);
  }
});

test("common non-sensitive words sharing prefixes with sensitive terms still publish", () => {
  for (const title of [
    "Gayrimenkul piyasası yükselir mi?",
    "Dinamik fiyatlama faydalı mı?",
    "Bu ürünün tanımı doğru mu?",
    "Kurtuluş Savaşı sergisi nerede?",
    "Partikül fiziği dersi zor mu?",
    "İnanılmaz bir telefon mu?",
  ]) {
    assert.deepEqual(screenV1Publication(poll(title)), { action: "PUBLISH", signals: [] }, title);
  }
});
