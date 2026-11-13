// #371 bağımsız inceleme — hassas anket korumasının iki katmanı birlikte: ret (sensitive-policy) ya da insan incelemesi
// (risk-review). Değişmez kural: aşağıdaki girdilerin hiçbiri onaysız doğrudan yayına çıkmamalı.
// `todo` işaretli olanlar bugün AÇIK (doğrudan yayın); kapandıkça işaret kaldırılır. Girdiler sentetiktir.
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenV1Publication, type ReviewInput } from "../src/modules/polls/risk-review.ts";
import { detectSensitiveSurvey } from "../src/modules/polls/sensitive-policy.ts";

type Case = { name: string; input: Omit<ReviewInput, "kind">; open?: string };

/** Ret ya da inceleme: ikisinden biri yeterli. */
function guarded(input: Omit<ReviewInput, "kind">): boolean {
  const kind = input.options?.length ? "POLL" : "DISCUSSION";
  return detectSensitiveSurvey(input) !== null || screenV1Publication({ kind, ...input }).action === "REVIEW";
}

const ZW = "​";
const choose = (...labels: string[]) => labels.map((label) => ({ label }));

const MUST_NOT_PUBLISH: Case[] = [
  // Kontrol: bugün korunanlar (gerileme olmasın).
  { name: "doğrudan siyasi görüş sorusu", input: { title: "Siyasi görüşün ne?" } },
  { name: "'Hangisisin?' + mezhep seçenekleri", input: { title: "Hangisisin?", options: choose("Alevi", "Sünni") } },
  { name: "kişisel ilaç sorusu", input: { title: "Hangi ilacı kullanıyorsun?" } },
  { name: "HIV sorusu", input: { title: "HIV pozitif misin?" } },

  // Açık: yazım oyunları.
  { name: "sıfır genişlikli boşlukla bölünmüş 'parti'", input: { title: `Hangi par${ZW}ti${ZW}yi seçtin?` }, open: "normalizasyon \\p{Cf}'yi boşluğa çeviriyor, kelime bölünüyor" },
  { name: "rakamla yazım (s1yas1)", input: { title: "S1yas1 görüşün ne?" }, open: "1↔ı/i eşlemesi yok" },

  // Açık: parti adları ve ekli biçimler.
  { name: "'Hangisisin?' + HDP / DEM", input: { title: "Hangisisin?", options: choose("HDP", "DEM") }, open: "SENSITIVE_ANSWERS listesinde yok" },
  { name: "'Hangisisin?' + CHP'li / AK Partili", input: { title: "Hangisisin?", options: choose("CHP'li", "AK Partili") }, open: "tam eşleşme; ekli biçim geçiyor" },
  { name: "seçenekte öz tanım (Ben AKP'liyim)", input: { title: "Sence?", options: choose("Ben AKP'liyim", "Ben CHP'liyim") }, open: "öz tanım kalıbı yok" },

  // Açık: Türkçe dışı.
  { name: "İngilizce parti sorusu", input: { title: "Which party did you vote for?" }, open: "Türkçe dışı metin kapsanmıyor" },
  { name: "İngilizce din sorusu", input: { title: "What is your religion?" }, open: "Türkçe dışı metin kapsanmıyor" },

  // Açık: '…misin?' biçimindeki doğrudan kişisel sorular.
  { name: "tanı sorusu", input: { title: "Depresyon tanısı aldın mı?" }, open: "sağlık kalıbında 'tanısı aldın mı' yok" },
  { name: "cinsel yönelim (eşcinsel misin)", input: { title: "Eşcinsel misin?" }, open: "cinsellik kalıbı yalnız 'cinsel …' ile başlıyor" },
  { name: "dini pratik (oruç)", input: { title: "Ramazanda oruç tutuyor musun?" }, open: "dini pratik kalıbı yok" },
  { name: "dini pratik (namaz)", input: { title: "Namaz kılıyor musun?" }, open: "dini pratik kalıbı yok" },
  { name: "dini pratik (başörtüsü)", input: { title: "Başörtüsü takıyor musun?" }, open: "dini pratik kalıbı yok" },
  { name: "etnik köken (Kürt müsün Türk müsün)", input: { title: "Kürt müsün Türk müsün?", options: choose("Kürt", "Türk") }, open: "etnik seçenekler SENSITIVE_ANSWERS'ta yok" },
  { name: "'Hangisisin?' + etnik seçenekler", input: { title: "Hangisisin?", options: choose("Kürt", "Türk", "Arap") }, open: "etnik seçenekler SENSITIVE_ANSWERS'ta yok" },
  { name: "engellilik", input: { title: "Engelli raporun var mı?" }, open: "sağlık/engellilik kalıbı yok" },
];

for (const c of MUST_NOT_PUBLISH) {
  test(`hassas içerik doğrudan yayına çıkmaz: ${c.name}`, c.open ? { todo: `AÇIK (#371): ${c.open}` } : {}, () => {
    assert.equal(guarded(c.input), true, "ne reddedildi ne incelemeye alındı");
  });
}

// Genel konular ve ürün değerlendirmeleri doğrudan yayımlanabilir (yanlış pozitif kuyruğu şişirir).
const MAY_PUBLISH: Case[] = [
  { name: "genel sağlık araştırması", input: { title: "Kanser araştırmalarına daha çok fon ayrılmalı mı?" } },
  { name: "genel seçim sistemi sorusu", input: { title: "Seçim barajı düşürülmeli mi?" }, open: "'secim' tek başına inceleme sinyali" },
];

for (const c of MAY_PUBLISH) {
  test(`genel konu reddedilmez ve gereksiz incelemeye düşmez: ${c.name}`, c.open ? { todo: `AÇIK (#371): ${c.open}` } : {}, () => {
    assert.equal(detectSensitiveSurvey(c.input), null);
    assert.equal(screenV1Publication({ kind: "DISCUSSION", ...c.input }).action, "PUBLISH");
  });
}
