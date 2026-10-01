# KV-28: Günün/Haftanın Yükselenleri ve popülerlik trend motoru (#30)

> Sahip: **Faruk** · Hesap: `apps/worker/src/jobs/trends` (`config.ts` katsayılar, `score.ts` SQL, `job.ts` çalıştırma) · Okuma: `apps/api/src/modules/trends` · Sözleşme: `trends.list` (`packages/contracts/src/domains/discovery.ts`)
> Ürün kaynağı: PRODUCT_TEAM_PLAN §8 "KararVer'e özel trend formatları" ve "Trend puanı" · Veri modeli: DATA_MODEL §8.4

## Akış

1. `trends.refresh` job'u her 5 dakikada bir çalışır (pg-boss, `singleton` kuyruk, `*/5 * * * *`, Europe/Istanbul).
2. Her format için bir `trend_runs` satırı açılır (`RUNNING`). Sıralama SQL'le hesaplanır ve ilk 500 sıra `trend_scores`'a yazılır. `components` alanı puanın bileşenlerini tutar.
3. Puanlar ve `SUCCEEDED` durumu **aynı transaction'da** yazılır: okuyucu yarım sıralama görmez. Hata olursa çalıştırma hata metniyle `FAILED` olur; önceki başarılı sıralama yerinde kalır.
4. `GET /v1/trends/:format` her format için güncel başarılı çalıştırmayı (en yeni `window_end`) okur.

## Formatlar

Pencereler kayandır ve pencere sonu 5 dakikalık dilime yuvarlanır. Günlük: son 24 saat, haftalık: son 7 gün. (İstanbul takvim günü pencereleri Haftanın Değişkenleri içindir, KV-29.)

| Format | Puan | Listeye girme | Neyi ölçer |
|---|---|---|---|
| `DAILY_RISING` Günün Yükselenleri | `etkileşim / (yaş_saat + 2) ^ 1.2`; etkileşim = oy veren + 0.5 × yorum + yorumcu (son 24 saat) | oy veren + yorumcu ≥ 5 | "Son 24 saatte hızla etkileşim alan": yeni ve hızlı anket, aynı etkileşimdeki eski anketin önüne geçer |
| `WEEKLY_RISING` Haftanın Yükselenleri | `yeni² / (önceki + yeni + 10)`; yeni = bu hafta oy veren, önceki = pencereden önceki geçerli oy | yeni ≥ 10 | "Toplam oya göre değil, artış hızına göre": aynı haftalık oyu alan iki anketten oyu yeni gelen öne geçer |
| `WEEKLY_MOST_VOTED` En Çok Oy Verilenler | bu hafta oy veren benzersiz hesap | ≥ 1 | "Son 7 günde en fazla benzersiz oy" |
| `WEEKLY_MOST_DISCUSSED` En Çok Konuşulanlar | yorum (sınırlı) + 2 × benzersiz yorumcu | yorumcu ≥ 1 | "Yorum + cevap + benzersiz yorumcu" |
| `WEEKLY_MOVERS` Haftanın Değişkenleri | en çok değişen seçeneğin yüzde puan farkı (günlük snapshot'lardan) | iki uçta ≥ 30 oy, ikinci pencerede ≥ 10 aktif hesap | KV-29 (#31): [KV-29_SNAPSHOTS_MOVERS.md](./KV-29_SNAPSHOTS_MOVERS.md) |

- Eşitlikte yeni anket önce, sonra `id` (deterministik).
- Aynı veride dört formatın dört farklı sırası testte doğrulanıyor (`apps/worker/test/trends.test.ts`, ilk test).

## Kötüye kullanıma karşı sınırlar

| Kural | Nasıl |
|---|---|
| Oy hesap başına bir | `votes (poll_id, user_id)` tekil. Oy değiştirmek yeni oy değildir (`votes.created_at` ilk oyun zamanı): değiştirme patlaması puanı büyütmez |
| Yorum hesap başına en fazla 3 | Bir hesabın bir ankete penceredeki yorumlarından en fazla 3'ü sayılır; tek hesabın 50 yorumu 3 sayılır |
| Yazarın kendi yorumu sayılmaz | Anket sahibi kendi anketini konuşturamaz |
| Geçersiz oy sayılmaz | `invalidated_at` dolu oy hiçbir formatta yok (KV-43 geçersiz saydığında sonraki çalıştırmada düşer) |
| **Ham rapor ceza değildir** | Rapor sayısı puana girmez. İçerik ancak moderasyon kararıyla düşer: gizleme/kaldırma veya trendden çıkarma |

Her kural için bir test var. Mutasyon kontrolü: sınır, yazar hariç tutma, geçersiz oy filtresi ve trendden çıkarma filtresi ayrı ayrı kaldırıldığında ilgili test kırılıyor.

## Editör ve organik ayrımı

- Trend listeleri **sadece organik** sinyallerden hesaplanır. Öne çıkarma/editör seçimi (`featured_placements`, KV-42 Mehmet) ayrı bir yüzeydir ve puanı değiştirmez (DATA_MODEL §9: "Öne çıkarma organik trend puanını değiştirmez").
- **Trendden çıkarma:** `polls.trend_excluded_at` doluysa anket hiçbir trend listesine girmez; görünürlüğü değişmez. Sütun bu PR'da açıldı. Yazan işlem `EXCLUDE_FROM_TRENDS` / `INCLUDE_IN_TRENDS` moderasyonudur (KV-37, #39, Mert).
- Çalıştırmadan sonra gizlenen, kaldırılan veya trendden çıkarılan anket, sonraki çalıştırmayı beklemeden okuma anında gösterilmez.

## Katsayılar, sürüm ve zaman

- Katsayılar `apps/worker/src/jobs/trends/config.ts` içinde, **sürümlü**: herhangi biri değişirse `calculationVersion` artar. Her çalıştırma sürümünü ve pencere başlangıcı/sonunu `trend_runs`'a, hesap zamanını (`finished_at` → API'de `meta.computedAt`) yazar. Aynı sürüm aynı veriden aynı sıralamayı verir.
- **Değerler öneridir:** Plan formülün mantığını verir, sayı vermez. Mehmet teyidi bekliyor.
- **Admin'den değiştirme** (plan: "Katsayılar admin/config üzerinden değiştirilebilir olmalıdır") KV-40 (#42) ayar servisiyle gelir. O zaman değer değişikliği sürümü de artırmalı ki eski ve yeni sıralamalar karışmasın. KV-04 açık konu 9'daki "trend katsayıları kayıtta yok" maddesi bu yüzden açık kalıyor.

## Job idempotency ve dayanıklılık

- **Aynı dilim bir kez:** Aynı (format, `window_end`, `calculation_version`) için başarılı veya sürmekte olan çalıştırma varken yenisi açılmaz. pg-boss `singleton` kuyruğuna ek olarak format başına advisory lock var. Test: çalıştırmayı açan transaction commit etmeden bekletildiğinde ikinci worker yeni çalıştırma açmıyor; kilit kaldırılınca test kırılıyor.
- **Çöken worker:** 15 dakikadan uzun `RUNNING` kalan çalıştırma `FAILED` ("zaman aşımı") işaretlenir ve dilim yeniden hesaplanır.
- **Bir formatın hatası diğerlerini durdurmaz.**
- **Saklama:** 24 saatten eski çalıştırmalar silinir; her formatın güncel başarılı çalıştırması kalır.

## API: `GET /v1/trends/:format`

- `categoryId` filtresi, çalıştırmanın sıralamasını süzer. `rank`, süzülmüş listede görünür kartlar arasındaki konumdur (1'den, boşluksuz).
- **Cursor** çalıştırma kimliğini ve sıralamadaki konumu taşır: kaydırma sırasında sıra değişmez. Yeni çalıştırma gelince eski cursor 400 `INVALID_CURSOR` (sözleşme notu). Filtre değişimi ve bozuk konum da 400.
- Sayfalar arasında gizlenen anket yerini korur; gösterilmez, tekrar ve kayıp olmaz.
- Kart `PollCard`; AFTER_VOTE anketin sonucu misafire gizli. Trend puanı ve bileşenleri API'de verilmez (sözleşme).
- `movement` sadece `WEEKLY_MOVERS`'ta dolu (KV-29), diğer formatlarda `null`.

## Performans

Yerel PostgreSQL 17, 100.000 anket, 1.000.000 oy (hepsi son 48 saatte, en yeni 2.000 ankete 500'er): en kötü durum, bütün oylar pencerenin içinde.

| Format | Süre (3 ölçüm) |
|---|---|
| `DAILY_RISING` | 116–196 ms |
| `WEEKLY_RISING` | 121–131 ms |
| `WEEKLY_MOST_VOTED` | 113–119 ms |
| `WEEKLY_MOST_DISCUSSED` (yorum yok) | 36–58 ms |

Dört format birlikte ~0,5 sn / 5 dk. Pencere oyları `votes_created_at_idx` ile paralel taranıyor.

## Testler

- `apps/worker/test/trends.test.ts` (8, PostgreSQL): dört formatın sırası, bileşenler, sürüm ve pencere; kötüye kullanım sınırları ve ham rapor; görünürlük ve trendden çıkarma; aynı dilim, eşzamanlı ve kilit bekleyen çalıştırma; bayat `RUNNING`; hata; saklama. Trend hesabı bütün veritabanına baktığı için her test rastgele ve uzak bir gelecek penceresine kendi verisini kurar.
- `apps/api/test/trends.test.ts` (5, PostgreSQL): `WEEKLY_MOVERS` hareket kartı ve boş durum (KV-29); güncel başarılı çalıştırma ve meta; kategori filtresi ve sıra numarası; AFTER_VOTE kartı; sayfalar arası gizleme; cursor'un çalıştırmaya bağlılığı.

## Kalan işler

| Konu | İş |
|---|---|
| Katsayıların ürün teyidi | Mehmet |
| Katsayıları admin'den değiştirme | KV-40 (#42), Utku |
| `EXCLUDE_FROM_TRENDS` / `INCLUDE_IN_TRENDS` işlemi (sütunu yazan) | KV-37 (#39), Mert |
| Geçersiz oy sonrası yeniden hesap (sürüm artırma) | KV-43 (#45), Faruk |
| `poll.trending` olayı (listeye giren ankete bildirim) | Olay kataloğunda var (KV-04); bildirim altyapısı (KV-21, Utku) gelince job'dan üretilecek |
| Kaydetme sinyali (plan formülündeki `saves`) | Bookmark tablosu (KV-22, Mehmet) gelince |
| Feed'deki `rising` sekmesi | Bu PR'dan sonra `DAILY_RISING` çalıştırmasına bağlanabilir (KV-20'de 400 dönüyor); ayrı küçük iş |
