# KV-20: Anket spam/cooldown ve temel feed API (#22)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/polls` (limitler), `apps/api/src/modules/feed` · Sözleşme: `polls.create`, `feed.list`
> Ayarlar: `packages/contracts/src/settings.ts` → `polls.*` ([`KV-04_ROLES_EVENTS.md` §3](./KV-04_ROLES_EVENTS.md))

## Yayın limitleri

| Ayar | Varsayılan | Kaynak |
|---|---|---|
| `polls.newAccountPeriodDays` | 7 gün | PRODUCT_TEAM_PLAN §13 |
| `polls.newAccountDailyLimit` / `polls.newAccountCooldownMinutes` | 3 anket / 24 saat · 30 dakika | PRODUCT_TEAM_PLAN §13 |
| `polls.dailyLimit` / `polls.cooldownMinutes` | 10 anket / 24 saat · 10 dakika | PRODUCT_TEAM_PLAN §13 |

- **Cooldown aşımı:** 429 `PUBLISH_COOLDOWN`. Günlük limit aşımı: 429 `DAILY_PUBLISH_LIMIT`. İkisi de `Retry-After` (saniye) başlığıyla döner; aynı değer `details[0].message` içinde de var. Günlük limitte `Retry-After`, penceredeki bir hakkın açılacağı andır.
- **24 saatlik pencere kayan penceredir.** Kaldırılmış anketler de sayılır; sil-yeniden-aç ile limit aşılamaz.
- **Eşzamanlılık:** Kontrol, anketi yazan transaction içinde yazarın `users` satırı `FOR UPDATE` ile kilitlenerek yapılır. Aynı yazarın paralel istekleri sıraya girer:
  - Günlük 3 hakla 6 paralel istekten tam 3'ü açılır.
  - Cooldown varken 5 paralel istekten 1'i açılır.
- **Idempotency ile etkileşim:** Başarılı bir isteğin tekrarı cooldown'a takılmaz.
  - Kayıtlı sonuç önce aranır (KV-10).
  - Aynı anahtarla eşzamanlı gelen istek yazar kilidini bekledikten sonra anahtarı tekrar kontrol eder; bulursa kayıtlı sonucu döner, limit hatası değil. Deterministik yarış testi var.
- **Deploysuz değişiklik:** Limitler her istekte ayar sağlayıcısından okunur (`buildApp({ pollSettings })`). Ayar servisi (KV-40) bağlanınca admin değişikliği anında uygulanır.

### Aynı başlık
Yazarın **hâlâ açık** (kapanmamış, kaldırılmamış) bir anketiyle aynı başlık 409 `DUPLICATE_TITLE` döner (`details: [{field: "title", code: "duplicate"}]`). Karşılaştırma `kv_normalize` ile yapılır: Türkçe karakter ve büyük/küçük harf farkı sayılmaz. Başka yazar aynı başlığı kullanabilir. İlk anket kapanınca aynı başlık yeniden açılabilir.

> **Teyit bekliyor (Mehmet):** Planda "aynı başlığın tekrar tekrar paylaşılması engellenir" yazıyor ama süre tanımı yok. Kural uydurmamak için sadece açık anketlerle karşılaştırılıyor ve ayar eklenmedi. Farklı bir pencere istenirse kaynağıyla bir `polls.*` ayarı eklenir.

## Feed: `GET /v1/feed`

| Sekme | Sıralama |
|---|---|
| `new` | `opensAt` ↓, `id` ↓ |
| `top` | `voteCount` ↓, `opensAt` ↓, `id` ↓ (tüm zamanlar) |
| `for_you` | KV-27 (#29) ile kişiselleştirildi: [`KV-27_FOR_YOU_FEED.md`](./KV-27_FOR_YOU_FEED.md) |
| `rising` | **Henüz yok:** 400 `VALIDATION_ERROR` (`code: not_supported_yet`); trend motoruna (KV-28, #30) bağlı |

- **Görünürlük:** Feed'de sadece `ACTIVE` ve `LOCKED` anketler çıkar. Gizli, incelemede ve kaldırılmış içerik feed'e girmez.
- **Kart:** Detay projeksiyonunun alt kümesi. Sonuç gizliliği ve `viewer.canVote` aynı kuraldan gelir; misafirde AFTER_VOTE sonucu hiçbir sayı içermez.
- **Filtreler:** `categoryId`, `communityId`.
- **Cursor:** Sekmeye ve filtrelere bağlı; değişirse 400 `INVALID_CURSOR`. Sıralama deterministik. Testler, eşit zamanlı anketler dahil 1, 2, 3 ve 100 sayfa boyutlarında tekrar ve kayıp olmadığını doğruluyor.
- **Bilinen sınır:** `top` sekmesinde sayfalar arasında bir anket oy alırsa, keyset sıralamada o anket bir kez tekrar görünebilir veya atlanabilir. Sabit veride tekrar ve kayıp yok. Trend listelerindeki gibi çalıştırmaya bağlı sabit sıralama (KV-28) gelince `top` da o yapıya taşınabilir.

## Testler

`apps/api/test/feed-limits.test.ts`, 14 senaryo. Gerçek PostgreSQL gerektirir. Kontrol amaçlı:
- Yazar kilidi kaldırılınca iki eşzamanlılık testi kırılıyor.
- Anahtar tekrar kontrolü kaldırılınca yarış testi kırılıyor.

Test düzeneği, eski senaryolar etkilenmesin diye limitleri varsayılan olarak gevşek kurar. Limit testleri resmî değerleri açıkça kurar.

## Kalan işler

| Konu | İş |
|---|---|
| `rising` sekmesi ve trend listeleri | KV-28 (#30) |
| Ayar servisi (admin değişikliği) | KV-40 (#42), Utku |
| IP/istek hız sınırı (rate limit) | KV-19 (#21), Utku |
| Aynı başlık kuralının ürün teyidi | Mehmet |
