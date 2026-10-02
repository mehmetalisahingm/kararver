# KV-43: Geçersiz oy ve trend yeniden hesaplama (#45)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/votes` (`admin-routes.ts`, `prisma-store.ts`), `apps/worker/src/jobs/snapshots/job.ts` (`recomputeStaleSnapshots`) · Sözleşme: `admin.votes.invalidate`, `admin.votes.restore` (`packages/contracts/src/domains/moderation.ts`) · Kurallar: [DATA_MODEL §5.4](./DATA_MODEL.md)

## Ürün kararları (Faruk, 2026-10-02)

- **Yetki yalnız ADMIN+** (`vote.invalidate`). Sonuçları ve trendleri geriye dönük değiştiren, yüksek riskli bir işlem olduğu için topluluk moderatörü yapamaz.
- **Hedef:**
  - Tek tek oylar (`VOTES`).
  - Hesapların oyları (`ACCOUNTS`): `pollId` verilirse o ankette, verilmezse bütün anketlerde (sahte hesap ağı).
- Gerekçeli **geri alma** da var.
- Her istek gerekçe ister. Tek istekte en fazla 100 oy veya 100 hesap.

## `POST /v1/admin/votes/invalidate`

Tek transaction'da:
1. Etkilenen anket satırları id sırasıyla kilitlenir. Oy verme (tek anket kilidi) ve başka düzeltmelerle deadlock olmaz.
2. Sadece **hâlâ geçerli** oylar güncellenir (`WHERE invalidated_at IS NULL`): `invalidated_at` ve `invalidation_reason` dolar.
3. `vote_events`'e `INVALIDATE` yazılır: aktör (yönetici), gerekçe ve hangi seçenekten düştüğü.
4. Seçenek ve anket sayaçları 1 azalır. Detay ve kartlardaki sonuç anında düzelir.
5. Anketin `snapshots_stale_since`'i, etkilenen oyun ilk verildiği ana çekilir.

Cevap `{ changed, unchanged, notFound, affectedPollIds }`.
- **Tekrar istek çift düşüm yapmaz:** zaten geçersiz oylar `unchanged`'de sayılır.
- İki yönetici aynı oyları aynı anda geçersiz sayarsa her oy bir kez düşer (test var).

Oyu geçersiz sayılan kullanıcı o ankete yeniden oy veremez (`VOTE_INVALIDATED`); detayda `viewer.voteInvalidated: true`. Bu bilinçli bir karar (§5.4).

## `POST /v1/admin/votes/restore`

Geçersiz sayılmış oylar geri gelir:
- `RESTORE` olayı (aktör, gerekçe, hangi seçeneğe döndüğü) yazılır, sayaçlar 1 artar.
- Anket kilidi (`first_valid_vote_at`) boşsa dolar: geçerli oy anketi kilitler.
- Anket kapanmış olsa da geri alınır. Geri gelen oy yine değiştirilebilir.

## Ban ve oy

Ban veya askı **tek başına** oyları geçersiz saymaz; oylar ve sayaçlar aynen kalır (test var). Geçersiz sayma her zaman bu endpoint'le yapılan ayrı ve gerekçeli işlemdir.

## Sonuç, snapshot ve trend tutarlılığı

| Yer | Ne zaman düzelir |
|---|---|
| Sayaçlar, sonuç yüzdeleri, kartlar | İşlemle aynı transaction'da |
| Günlük snapshot'lar (geçmiş günler) | Worker'ın bir sonraki çalıştırmasında (en geç 5 dk) |
| Haftanın Değişkenleri | Aynı çalıştırmada; snapshot'lar trendlerden önce yeniden üretilir |
| Diğer trend listeleri | Bir sonraki çalıştırmada; zaten sadece geçerli oyları sayıyorlar |

**Snapshot yeniden üretimi:**
- `recomputeStaleSnapshots`, `trends.refresh`'in başında ve `snapshots.daily`'de çalışır.
- İşaretli anketlerin günlerini, işaretin İstanbul gününden anketin kapanışına veya düne kadar `vote_events`'ten yeniden hesaplar.
- **İşaret, okunduğu değer değişmediyse temizlenir:** Arada yeni düzeltme geldiyse bir sonraki çalıştırma onu da işler.
- Bir çalıştırmada en fazla 50 anket işlenir.

**Açıklanabilirlik:**
- Snapshot satırının `calculation_version`'ı hesap formülünün sürümüdür ve değişmez. Düzeltmenin zamanı `computed_at`'tedir.
- **Nedeni `vote_events`'tedir:** Hangi oy, hangi yönetici, hangi gerekçe, ne zaman. Bu kayıtlar değiştirilemez (append-only).
- DATA_MODEL §8.2'deki "sürüm artırılarak" ifadesi buna göre güncellendi.
- **Saat kaynağı:** Düzeltme olayının zamanı, oy olaylarıyla aynı kaynaktan, veritabanı saatinden gelir. Böylece olay sırası tek kaynaktan belirlenir.

## Veri modeli: `20261002090000_faruk_kv43_vote_invalidation`

- **`vote_events.actor_id`:** INVALIDATE/RESTORE'u yapan yönetici, FK `users`.
  - `vote_events_actor_check` kısıtı: INVALIDATE/RESTORE'da aktör ve gerekçe zorunlu; CAST/CHANGE'de aktör boş.
  - Kısıt `NOT VALID` ile eklendi: yeni satırlarda zorunlu, ama test ortamlarında önceden kalmış aktörsüz satırlar migration'ı kırmaz. Üretimde eski satır yok.
- **`polls.snapshots_stale_since`:** Kısmi index'le (`WHERE ... IS NOT NULL`) worker düzeltme bekleyen anketleri hızlı bulur.

## Testler

`apps/api/test/votes-admin.test.ts` (6):
- Tek oy: sayaç, sonuç, olay, işaret, tekrar istek, yeniden oy yasağı.
- Hesap bazında ve geri alma.
- Yetki ve doğrulama.
- Ban'ın oyları geçersiz saymadığı.
- Eşzamanlı iki yönetici ve aynı anda gelen yeni oylar.
- DB kısıtı.

`apps/worker/test/snapshots.test.ts` (yeni senaryo):
- Geçersiz sayılan oydan sonra geçmiş günler 2/3/3'ten 1/2/2'ye düşüyor ve işaret temizleniyor.
- Geri alınca trend job'u günleri tekrar 2/3/3 yapıyor.

**Mutasyon kontrolleri** (her biri testi kırıyor):
- `WHERE invalidated_at IS NULL`'ı kaldırmak (3 test).
- Trend job'undan yeniden üretim çağrısını kaldırmak.

**Yazarken bulunan hata:** Yeniden üretim döngüsü "dün"e kadar gidiyordu. Kapanmış bir anket için on binlerce boş gün taranabiliyordu (test 10 dk'da bitmedi). Döngü artık anketin kapanış gününe sınırlı.

## Audit (KV-39)

Geçersiz sayma ve geri alma, düzeltmeyle **aynı transaction'da** `audit_logs`'a yazılır. Audit yazılamazsa düzeltme de geri alınır.

- **Kayıt:** Etkilenen her anket için bir kayıt. `action = vote.invalidate`, `operation = invalidate | restore`, hedef `POLL`, gerekçe, aktör, `request_id` (X-Request-Id).
- **Özet:** `before: { validVotes }`, `after: { validVotes, changedVotes, accounts, by: VOTES | ACCOUNTS }`. Oy ve seçenek kimlikleri özete yazılmaz, çünkü oy seçimi hassas veridir (KV-04). Oy başına iz `vote_events`'te durur.
- **Durum değişmezse kayıt yok:** Tekrar istek ve zaten geçersiz oylar audit kaydı üretmez.
- **Test:** `votes-admin.test.ts` kayıt içeriğini, istek kimliğini, tekrar istekte kayıt olmamasını ve eşzamanlı iki yöneticide toplam düşümü kontrol eder. Audit yazımı kaldırılınca 3 test düşüyor.

## Kalan işler ve kapanış

| Konu | İş |
|---|---|
| `vote.invalidated` olayı (trends/metrics tüketicileri) | Olay outbox'ı gelince (KV-04); şu an worker DB işaretiyle çalışıyor |
| Yönetici arayüzü | Mert (KV-37, #39) / Utku (KV-33, #35): "sahte hesap ağı" tespiti ve bu endpoint'i çağıran ekran |
| **#45'in kapanışı** | İş tanımına göre gerçek bağımlılıklarla (#35 yaptırımlar, #39 moderasyon) doğrulanmadan tamamlanmış sayılmaz. Bu PR backend'i hazırlıyor, issue'yu kapatmıyor |
