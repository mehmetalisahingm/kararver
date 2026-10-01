# KV-27: "Senin İçin" ve keşif feed sıralaması (#29)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/feed` (`for-you.ts` sıralama, `prisma-store.ts` sinyaller, `routes.ts`) · Sözleşme: `feed.list` `tab=for_you` (`packages/contracts/src/domains/discovery.ts`)
> Ürün kaynağı: PRODUCT_TEAM_PLAN §7 "Feed ve keşfet" ("V1'de Senin İçin yapay zekâ gerektirmez")

## Özet

`GET /v1/feed?tab=for_you` artık kişisel. Sıralama her istekte, cursor'daki **üretim anına** göre deterministik olarak hesaplanır:

1. **Adaylar:** Üretim anına kadar açılmış en yeni 500 anket (`categoryId` / `communityId` filtresiyle). Durumdan bağımsız alınır; görünmezler yer tutar ama gösterilmez (aşağıda "Sayfalar arası tutarlılık").
2. **Puan:** ilgi + yenilik + son 24 saatteki oy ve yorum + toplam oy (ağırlıklar aşağıda).
3. **Yerleşim:** Puan sırası; her 5 karttan biri keşif yuvası; son 10 kartta aynı yazar ve aynı kategori sınırı.
4. **Sayfa:** Yerleşimden sıradaki görünür kartlar. Kart yüklenirken görünürlük bir kez daha kontrol edilir.

Misafir ve ilgi seçmemiş kullanıcı aynı sırayı görür: ilgi terimi 0 olduğunda sonuç "popüler + yeni karışımı"dır (sözleşme notu).

## Puan

| Sinyal | Ağırlık | Hesap |
|---|---|---|
| İlgi alanı | 1.5 | Anketin kategorisi `user_interests`'te ise 1 |
| Yenilik | 2.0 | `1 / (1 + yaş_saat / 24)`: yeni anket 1, 1 günlük 0.5, 1 haftalık 0.125 |
| Son 24 saatte oy | 1.0 | `ln(1 + oy)` |
| Son 24 saatte yorum | 0.7 | `ln(1 + yorum)` (yorum, cevap, alternatif) |
| Toplam oy | 0.3 | `ln(1 + oy)` |

- Eşitlikte yeni anket önce, sonra `id`.
- Örnek: ilgi alanındaki 1 günlük anket (1.5 + 1.0) ilgisiz yeni ankete (2.0) üstün gelir, 1 haftalık olan (1.5 + 0.25) gelmez.
- **Ağırlıklar ayar değildir:** KV-04 açık konu 9'da "sıralama ağırlıkları kayıtta yok" olarak duruyor; ürün geri bildirimiyle koddan değişir.
- **Kaydetme aktivitesi (plan §7) henüz yok:** Bookmark tablosu KV-22 (Mehmet) ile gelecek. `polls.save_count` üretim anına göre sabitlenemediği için kullanılmadı.

## Keşif payı ve tekrar sınırı

| Ayar | Önerilen (API'nin geçici değeri) | Anlamı |
|---|---|---|
| `feed.explorationPercent` | 20 | Her 100 kartın 20'si (eşit aralıklı: 5., 10., 15. …) keşif yuvası |
| `feed.maxSameAuthorPerWindow` | 2 | Art arda 10 kartta aynı yazardan en fazla |
| `feed.maxSameCategoryPerWindow` | 4 | Art arda 10 kartta aynı kategoriden en fazla |

- **Keşif adayı:** 10'dan az oy almış ve en fazla 72 saatlik anket. Keşif yuvasında, henüz yerleşmemiş keşif adaylarının en yenisi alınır.
- **Keşif payı adayları ana sıradan çıkarmaz, sadece yer garanti eder.** Yeni platformda çoğu anket az oyludur; çıkarsaydı "Senin İçin" "Yeni" sekmesine dönerdi (bunu yakalayan birim testi var).
- **Sınır gevşer:** Uyan aday yoksa (ör. tek kategoriye ilgi, tek yazarlı topluluk) sıranın ilki alınır. İçerik kaybolmaz, sadece sona kayar.
- **Değerlerin kaynağı yok:** Ayarlar kayıtta `default: null` + öneriyle duruyor (KV-04 açık konu 8), **Mehmet teyidi bekliyor**. API, KV-40 ayar servisi gelene kadar `DEFAULT_FEED_SETTINGS`'i kullanır.

## Sayfalar arası tutarlılık

Cursor, izleyiciye ve filtreye bağlıdır (başka izleyici veya filtre 400 `INVALID_CURSOR`). İçinde **üretim anı** ve yerleşimdeki **konum** vardır.

- Sinyaller üretim anına kadarki veriden sayılır: sonra gelen oy ve yorum sırayı değiştirmez; oy o an geçerliyse (sonradan geçersiz sayılsa bile) sayılır; o an silinmiş yorum sayılmaz.
- Üretim anından sonra açılan anket bu kaydırmada yoktur; yeni istekte (cursor'sız) gelir.
- Kaldırılan/gizlenen anket yerleşimde yer tutmaya devam eder, sadece gösterilmez. Böylece zaten gösterilmiş bir anket kaldırılsa bile sonraki kartlar kaymaz (tekrar ve kayıp yok). Test: görünmezler yerleşimden çıkarılınca bu test kırılıyor.
- Gelecekten gelen, negatif konumlu veya bozuk cursor 400 `INVALID_CURSOR`.

**Saat varsayımı:** Üretim anı uygulama saatinden, oy ve yorumların `created_at`'i veritabanı saatinden gelir. Üretimde iki saat NTP ile aynıdır. Büyük bir saat kayması olursa, üretim anına çok yakın bir oy iki sayfa arasında farklı sayılabilir.

## Görünürlük ve cache

- Feed'de sadece `ACTIVE` ve `LOCKED` anketler gösterilir. Gizli, incelemedeki ve kaldırılmış içerik hiçbir sayfada görünmez.
- İki katman: yerleşimde `visible` bayrağı, kart yüklenirken `listByIds` durumu yeniden kontrol eder.
- **Sunucu tarafında cache yok**; her istek yeniden hesaplanır. Yanıt `Cache-Control: private, no-store`. "Cache dahil görünmez" koşulu bu yüzden sağlanıyor. İleride cache eklenirse (KV-47) bu iki katman korunmalı.

## Veri modeli

- **`user_interests`**: Mehmet'in `growth.prisma` tablosu, KV-15 (#17) ile geldi (migration `20260930203000_mehmet_kv15_user_interests`). Feed sadece okur; `/me/interests` ve onboarding Mehmet'te.
- **Index'ler de aynı migration'da:** Mehmet, bu PR ile şema çakışmasın diye aşağıdaki iki index'i KV-15 migration'ına aldı; bu PR migration içermez.
- **`votes (poll_id, created_at, invalidated_at)`**: aday başına "üretim anına kadar" ve "son 24 saat" geçerli oy sayımı; `invalidated_at` index'te olduğu için tabloya gidilmez.
- **`polls (opens_at DESC, id DESC)`**: aday havuzu (ve "Yeni" sekmesinin sırası).

## Sorgu planı

Yerel PostgreSQL 17, 100.000 anket (her 50'den biri kaldırılmış), 20.000 kullanıcı, en yeni 2.000 ankete 500'er oy (1.000.000 oy, son 48 saate yayılmış). Filtresiz feed, 500 aday; en kötü durum: bütün adaylar 500 oylu.

| | Aday sorgusu (`EXPLAIN ANALYZE`) | Uçtan uca aday + sıralama |
|---|---|---|
| Sadece mevcut index'lerle | 256 ms: `polls` sıralı tarama; oy sayımı `votes_poll_id_option_id_idx` + 250.000 tablo bloğu | ~175 ms + 5 ms |
| KV-27 index'leriyle | 46 ms: `polls_opens_at_id_idx` ve `votes_poll_id_created_at_invalidated_at_idx` index-only (`Heap Fetches: 0`) | ~23 ms + 5 ms |

- Sıralama (500 aday, yerleşim ve çeşitlilik) ~5 ms.
- Yorum sayımı mevcut `comments (poll_id, parent_id, created_at)` index'iyle yapılır. Anket başına yorum sayısı oydan çok daha az olduğu için ayrı index açılmadı.
- Kategori filtresinde (13 kategoriden biri) planlayıcı yine `polls_opens_at_id_idx`'i tarayıp kategoriyi süzer: aday sorgusu 1,7 ms, uçtan uca ~10 ms. Çok seyrek bir kategori veya toplulukta süzülen satır sayısı artar; KV-47'de izlenecek.
- Yük altında ve cache ile ölçüm KV-47'de (#49).

## Testler

- `apps/api/test/for-you.test.ts`: 13 birim testi, DB gerektirmez, sabit fixture'lar. Kapsam: determinizm, kategori ve yazar sınırı, gevşeme, ilgi, etkileşim, keşif yuvaları, yeni platform durumu, sayfa kesme.
- `apps/api/test/feed-for-you.test.ts`: 6 senaryo, gerçek PostgreSQL. Kapsam: sinyallerin üretim anına göre sayılması, tercihsiz kullanıcı ve misafir çeşitliliği, `user_interests`, görünürlük, sayfalar arası yeni anket/oy/kaldırma, cursor doğrulaması.
- **Mutasyon kontrolleri** (her biri ilgili testi kırıyor): üretim anından sonraki oyları saymak; görünmezleri yerleşimden çıkarmak; ilgi ağırlığını 0 yapmak; kategori sınırını kaldırmak.

## Sınırlar ve kalan işler

| Konu | İş |
|---|---|
| `feed.*` değerlerinin ürün teyidi | Mehmet (KV-04 açık konu 8) |
| Ayarların admin'den değişmesi | KV-40 (#42), Utku |
| Kaydetme sinyali | KV-22 bookmark tablosu (Mehmet) gelince |
| Aday havuzu 500 anket: daha eskiye kaydıran kullanıcı için feed biter | Gerekirse "Yeni" sırasıyla devam (ürün kararı) |
| Görülmüş/oy verilmiş anketleri geri itme | Plan'da yok; ürün geri bildirimiyle |
| Cache ve yük altında ölçüm | KV-47 (#49) |
