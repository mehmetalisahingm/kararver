# KV-29: Snapshot ve Haftanın Değişkenleri (#31)

> Sahip: **Faruk** · Kod: `apps/worker/src/jobs/snapshots/job.ts` (günlük snapshot), `apps/worker/src/jobs/trends/score.ts` → `moversQuery` (Haftanın Değişkenleri), `apps/api/src/modules/trends/routes.ts` (hareket kartı) · Sözleşme: `trends.list` `format=WEEKLY_MOVERS`, `Movement`
> Kurallar: [DATA_MODEL §8](./DATA_MODEL.md) (Mehmet 2026-09-27'de onayladı: Europe/Istanbul takvim günü) · Ürün: PRODUCT_TEAM_PLAN §8 "Haftanın Değişkenleri"

## Günlük snapshot: `snapshots.daily`

- **Zamanlama:** Her gün 00:05 Europe/Istanbul (`5 0 * * *`), pg-boss `singleton` kuyruk, 3 tekrar denemesi.
- **Her çalıştırmada** dünden geriye 3 bitmiş gün yeniden hesaplanır: kaçırılan veya geç kalan çalıştırma kendini telafi eder.
- **Satır:** Bir anketin bir İstanbul günü sonundaki geçerli oy dağılımı: `poll_daily_snapshots` (toplam, `poll_day`, `cutoff_at`) ve seçenek başına `poll_option_daily_snapshots` (0 oylu seçenek de yazılır).
- **Hesap kaynağı `vote_events`:**
  - Her kullanıcının `cutoff_at`'ten önceki son olayı alınır.
  - `CAST`/`CHANGE`/`RESTORE` → `to_option_id`'ye sayılır; `INVALIDATE` → sayılmaz.
  - Şu an geçersiz sayılmış oy hiçbir günde sayılmaz (§5.4). KV-43 bir oyu geçersiz sayınca etkilenen günler yeniden üretilir.
  - Kullanıcı başına son olay alındığı için **tekrar oy değişimi kişi sayısını büyütmez**.
- **İşlenen anketler:** Gün sonuna kadar açılmış ve gün başında hâlâ açık olanlar; yani açık olanlar ve o gün kapananlar.
- **Tekrar çalışma güvenli:** `(poll_id, local_date)` üzerine upsert.
- **Eksik geçmiş uydurulmaz:**
  - Bitmemiş gün (cutoff > şimdi) ve anketin açılışından önceki gün için satır yazılmaz.
  - Satır yoksa ara değer hesaplanmaz.
  - Eksik bir gün sonradan hesaplanırsa, `vote_events`'ten tam hesap olduğu için uydurma sayılmaz (§8.2).
- **Sürüm:** `calculation_version` = 1 (`SNAPSHOT_CALCULATION_VERSION`).

## Haftanın Değişkenleri: `WEEKLY_MOVERS`

`trends.refresh` her 5 dakikada diğer formatlarla birlikte hesaplar; okuma, cursor ve saklama kuralları KV-28 ile aynıdır ([KV-28_TRENDS.md](./KV-28_TRENDS.md)).

- **Karşılaştırma:** Pencere k'nın sonu `poll_day = 7k−1` snapshot'ıdır.
  - snapshot(7k−1) ile snapshot(7(k−1)−1) karşılaştırılır, k ≥ 2: gün 6 ↔ gün 13, gün 13 ↔ gün 20 …
  - Listeye, pencere sonu son 7 gün içinde kalan karşılaştırma girer: "geçen hafta → bu hafta".
  - 14 günlük anket bir karşılaştırma verir. 30 günlük anket günler 6/13/20/27 için üç karşılaştırma verir (her hafta biri); yarım 5. pencere karşılaştırmaya girmez.
- **Eşikler (sistem ayarı, "configli"):**
  - İki uçta da en az `trends.moversMinVotes` geçerli oy (varsayılan **30**).
  - İkinci pencerede en az `trends.moversMinActiveAccounts` benzersiz aktif hesap (varsayılan **10**).
  - Değerler KV-04 ayar kayıt defterinden okunur (kaynak DATA_MODEL §8.3); KV-40 gelince admin'den değişir.
- **Aktif hesap:** İkinci pencere içinde (`from_end ≤ t < to_end`) `CAST`, `CHANGE` veya `RESTORE` olayı olan **farklı** `user_id`. Aynı kişinin 6 kez gidip gelmesi 1 hesap sayılır.
- **Hareket:** En çok değişen seçenek; eşitlikte seçenek sırası.
  - Yüzdeler 2 basamak (contracts `helpers.ts` ile aynı yuvarlama), `deltaPoints = toPercent − fromPercent`.
  - `sampleFrom` / `sampleTo` iki uçtaki geçerli oy toplamı; `windowFromEnd` / `windowToEnd` iki pencere sonu (İstanbul gece yarısı, UTC olarak).
  - Puan `|deltaPoints|`. Hareketi 0 olan anket listeye girmez.
- **Görünürlük:** Sadece sonucu herkese görünen anketler: `ALWAYS` veya kapanmış (sözleşme notu). Açık bir AFTER_VOTE anketin oranı bu listeden sızmaz. Gizli, kaldırılmış ve trendden çıkarılmış anket girmez (KV-28 kuralları).
- **API:** Kartta `movement` dolu; `activeAccounts` ve puan public değil. Çalıştırma yoksa veya eşiği geçen anket yoksa boş liste + `INSUFFICIENT_HISTORY`.

### Örnek (testteki fixture)
Pencere 1 sonunda 40 oy: A 30, B 10 (%75 / %25). Pencere 2'de 12 yeni B oyu ve 5 kişi A→B değiştirdi. Pencere 2 sonunda 52 oy: A 25, B 27 (%48,08 / %51,92).
- Hareket: A **−26,92 puan**. B de +26,92; eşitlikte ilk seçenek seçilir.
- Örneklem 40 → 52; aktif hesap 17 (12 yeni + 5 değiştiren).

## Testler

`apps/worker/test/snapshots.test.ts` (4, PostgreSQL, tarihli fixture: her test rastgele ve uzak bir gelecek gününe kurulur):
1. **Gün sonu dağılımı:**
   - Kullanıcı başına son olay; üç kez değiştiren kişi bir kez sayılır.
   - Geçersiz sayılmış oy iki günde de sayılmaz.
   - **UTC/İstanbul sınırı:** İstanbul 00:30 (UTC'de hâlâ önceki gün 21:30) ertesi güne, İstanbul 23:30 aynı güne sayılır. `cutoff_at` UTC'de önceki günün 21:00'idir.
2. **Tekrar çalışan job:** Üç kez çalışmak tek satır ve aynı sonuç verir. Bitmemiş gün ve açılış öncesi gün yazılmaz. Geç çalışan job (3 gün sonra) geçmiş günleri telafi eder.
3. **Haftanın Değişkenleri:**
   - Yüzde puan, örneklem ve iki pencere tarihi birebir doğru.
   - Listeye girmeyenler: AFTER_VOTE açık anket, bir uçta 29 oylu anket, 4 hesabın 24 değişimiyle "aktif" görünen anket.
4. **Eksik snapshot uydurulmaz:** Gün 6 snapshot'ı yokken anket listede yok; gün 6 hesaplanınca bir sonraki çalıştırmada giriyor. Pencere sonu 8 gün önce kalınca listeden çıkıyor.

**Mutasyon kontrolleri** (her biri testi kırıyor):
- Son olay yerine ilk olayı almak.
- Geçersiz oyu saymak.
- UTC günü kullanmak.
- Aktif hesabı olay sayısıyla ölçmek.
- Sonuç görünürlüğü filtresini kaldırmak.
- Oy eşiğini kaldırmak.

`apps/api/test/trends.test.ts`: `WEEKLY_MOVERS` kartında `movement` (zamanlar ISO-8601'e çevrilir; `activeAccounts` ve puan dışarı verilmez) ve boş çalıştırmada `INSUFFICIENT_HISTORY`.

## Sınırlar ve kalan işler

| Konu | İş |
|---|---|
| Geçersiz oy sonrası etkilenen günleri yeni sürümle yeniden üretmek | KV-43 (#45), Faruk |
| Eşikleri admin'den değiştirme | KV-40 (#42), Utku |
| Snapshot'ın büyük veride ölçümü: her gün açık anketlerin bütün `vote_events`'i taranır (anket en fazla 30 gün açık) | KV-47 (#49) |
| Ekran ve grafik ("geçen hafta %82 → bu hafta %46") | KV-30 (Ümit); gelişmiş grafikler V1.1 (KV-53) |
