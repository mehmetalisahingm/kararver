/**
 * #371 yeniden test (Utku, 15 Kasım): sözlük (detectSensitiveSurvey) kaçırdığında inceleme kuyruğu yakalamalı.
 * Değişmez kural: aşağıdaki sentetik girdiler screenV1Publication'dan en az REVIEW çıkar, doğrudan yayına gitmez.
 * Bugün SENSITIVE_CONTEXT tam kelime eşliyor (din var, dinin yok) ve risk-review normalized() \p{Cf} temizlemiyor.
 * `todo` işaretliler bugün AÇIK; düzeltme geldikçe işaret kaldırılır. Veriler sentetiktir.
 * 20 Kasım: #357 2074b51 ile 4. tur kapandı (zorunlu); 5. tur listede olmayan kategori kelimeleri ve soru ekleri.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenV1Publication, type ReviewInput } from "../src/modules/polls/risk-review.ts";

const opts = (...labels: string[]) => labels.map(label => ({ label }));
const yesNo = opts("Evet", "Hayır");
const YES_NO = opts("Yes", "No");
const poll = (title: string, options = yesNo): ReviewInput => ({ kind: "POLL", title, options });

const CLOSED: Array<[string, ReviewInput]> = [
  ["oruç, geçmiş zaman", poll("Bu ramazan oruç tuttun mu?")],
  ["oruç, siz", poll("Ramazanda oruç tutuyor musunuz?")],
  ["namaz, siz", poll("Namaz kılıyor musunuz?")],
  ["başörtüsü, siz", poll("Başörtüsü takıyor musunuz?")],
  ["depresyon, eşanlamlı", poll("Sana hiç depresyon teşhisi kondu mu?")],
  ["cinsel yönelim, gay", poll("Gay misin?")],
  ["cinsel yönelim, lezbiyen", poll("Lezbiyen misiniz?")],
  ["etnik köken, siz", poll("Kürt müsünüz?")],
  ["Kiril benzer harf", poll("Hangi pаrtiye yakınsın?", opts("A", "B"))],
  ["oy davranışı, destek", poll("Son seçimde kimi destekledin?", opts("Aday A", "Aday B"))],
  ["oy davranışı, tercih", poll("Cumhurbaşkanlığı seçiminde tercihin?", opts("Aday A", "Aday B"))],
  ["İngilizce, cinsel yönelim", poll("Are you gay?", YES_NO)],
  ["İngilizce, ibadet", poll("Do you pray five times a day?", YES_NO)],
  ["İngilizce, tanı", poll("Have you been diagnosed with depression?", YES_NO)],
  ["İngilizce, oy", poll("How did you vote in the last election?", opts("AKP", "CHP"))],
  ["seçenekte öz tanım", poll("Ben ...", opts("AKP'liyim", "CHP'liyim"))],
  ["din, çekim", poll("Dinin hangisi?", opts("İslam", "Hristiyanlık"))],
  ["inanç, dolaylı", poll("Allah'a inanıyor musun?")],
  ["sabıka, eşanlamlı", poll("Hiç tutuklandın mı?")],
  ["sağlık, HIV testi", poll("HIV testin pozitif mi çıktı?")],
  ["sıfır genişlikli boşluk (U+200B)", poll("Si​yasi konularda hangisine yakınsın?", opts("A", "B"))],
];

const FOURTH_ROUND: Array<[string, ReviewInput]> = [
  ["din, İngilizce Hristiyan", poll("Are you Christian?", YES_NO)],
  ["din, İngilizce ateist", poll("Are you an atheist?", YES_NO)],
  ["inanç, İngilizce", poll("Do you believe in God?", YES_NO)],
  ["ibadet, kilise", poll("Pazar günleri kiliseye gider misin?")],
  ["din, tesettür", poll("Tesettürlü müsün?")],
  ["sağlık, kanser tedavisi", poll("Kanser tedavisi görüyor musun?")],
  ["sağlık, ilaç", poll("Antidepresan kullanıyor musun?")],
  ["sağlık, ameliyat", poll("Obezite ameliyatı oldun mu?")],
  ["sağlık, engellilik", poll("Engelli misiniz?")],
  ["sağlık, gebelik", poll("Hamile misiniz?")],
  ["sağlık, kürtaj", poll("Hiç kürtaj oldun mu?")],
  ["cinsel kimlik, trans", poll("Trans mısın?")],
  ["cinsel kimlik, İngilizce queer", poll("Are you queer?", YES_NO)],
  ["cinsel yönelim, İngilizce", poll("What is your sexual orientation?", opts("A", "B"))],
  ["etnik, Ermeni", poll("Ermeni misin?")],
  ["etnik, Rum", poll("Rum musun?")],
  ["etnik, Zaza", poll("Zaza mısın?")],
  ["etnik, Laz", poll("Laz mısın?")],
  ["adli, hapis", poll("Hiç hapis yattın mı?")],
  ["adli, İngilizce", poll("Have you ever been convicted of a crime?", YES_NO)],
  ["sendika, İngilizce", poll("Are you a union member?", YES_NO)],
  ["siyasi, muhalefet/iktidar", poll("Muhalefeti mi destekliyorsun iktidarı mı?", opts("Muhalefet", "İktidar"))],
  ["siyasi, referandum", poll("Referandumda ne dedin?", opts("Evet", "Hayır"))],
  ["siyasi, cumhurbaşkanı desteği", poll("Cumhurbaşkanını destekliyor musun?")],
];

const FIFTH_ROUND: Array<[string, ReviewInput]> = [
  ["din, Budist", poll("Budist misin?")],
  ["din, Süryani", poll("Süryani misiniz?")],
  ["etnik, Çerkez", poll("Çerkez misin?")],
  ["etnik, Gürcü", poll("Gürcü müsünüz?")],
  ["etnik, Roman", poll("Roman mısın?")],
  ["etnik, Boşnak", poll("Boşnak mısın?")],
  ["sağlık, bipolar", poll("Bipolar bozukluğun var mı?")],
  ["sağlık, şizofreni", poll("Şizofreni tanısı aldın mı?")],
  ["sağlık, kemoterapi", poll("Kemoterapi gördün mü?")],
  ["sağlık, İngilizce kanser", poll("Do you have cancer?", YES_NO)],
  ["sağlık, İngilizce gebelik", poll("Are you pregnant?", YES_NO)],
  ["sağlık, İngilizce engellilik", poll("Are you disabled?", YES_NO)],
  ["sağlık, epilepsi", poll("Epilepsi hastası mısın?")],
  ["adli, cezaevi", poll("Cezaevinde yattın mı?")],
  ["soru eki, kürtaj yaptırdın mı", poll("Kürtaj yaptırdın mı?")],
  ["soru eki, hamile kaldın mı", poll("Hamile kaldın mı?")],
  ["soru eki, sende ... var mı", poll("Sende kanser var mı?")],
  ["cinsel kimlik, İngilizce transgender", poll("Are you transgender?", YES_NO)],
  ["cinsel yönelim, heteroseksüel", poll("Heteroseksüel misin?")],
  ["cinsel yönelim, aseksüel", poll("Aseksüel misin?")],
  ["siyasi görüş, sağcı", poll("Sağcı mısın?")],
  ["siyasi görüş, solcu", poll("Solcu musun?")],
  ["siyasi görüş, milliyetçi", poll("Milliyetçi misin?")],
  ["siyasi, hükümet desteği", poll("Hükümeti destekliyor musun?")],
  ["siyasi, İngilizce parti kimliği", poll("Are you a Democrat?", YES_NO)],
  ["seçenekte öz tanım, din", poll("Hangisi seni tanımlar?", opts("Hristiyanım", "Ateistim", "Yahudiyim"))],
  ["seçenekte öz tanım, sağlık", poll("Durumun hangisi?", opts("Kemoterapi alıyorum", "Almıyorum"))],
  ["seçenekte öz tanım, yönelim", poll("Hangisisin?", opts("Eşcinselim", "Heteroseksüelim"))],
];

for (const [name, input] of CLOSED) {
  test(`incelemeye düşer: ${name}`, () => {
    assert.equal(screenV1Publication(input).action, "REVIEW");
  });
}

for (const [name, input] of FOURTH_ROUND) {
  test(`incelemeye düşer (4. tur): ${name}`, () => {
    assert.equal(screenV1Publication(input).action, "REVIEW");
  });
}

for (const [name, input] of FIFTH_ROUND) {
  test(`incelemeye düşer (5. tur): ${name}`, { todo: "AÇIK (#371 5. tur, #357 2074b51): kategori kelimesi listede yok ya da soru eki/öz tanım tanınmıyor" }, () => {
    assert.equal(screenV1Publication(input).action, "REVIEW");
  });
}

test("kontrol: sıfır genişlikli boşluk olmadan aynı soru bugün incelemeye düşüyor", () => {
  assert.equal(screenV1Publication(poll("Siyasi konularda hangisine yakınsın?", opts("A", "B"))).action, "REVIEW");
});

test("kontrol: genel konular doğrudan yayınlanır", () => {
  for (const title of ["Asgari ücret ne kadar artmalı?", "Hastane randevu sistemi nasıl olmalı?"]) {
    assert.equal(screenV1Publication(poll(title, opts("A", "B"))).action, "PUBLISH", title);
  }
});
