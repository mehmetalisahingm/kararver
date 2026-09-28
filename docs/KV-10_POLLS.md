# KV-10: Anket CRUD, seçenekler ve kapanış kuralları (#12)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/polls` · Sözleşme: `packages/contracts/src/domains/polls.ts` ([`API_CONTRACTS.md`](./API_CONTRACTS.md))
> Veri modeli ve kilit: [`DATA_MODEL.md` §5–§7](./DATA_MODEL.md) · Temel: KV-09 (#11, `apps/api` iskeleti)

## Uygulanan endpointler

| Endpoint | Davranış |
|---|---|
| `POST /v1/polls` | Anket oluşturur. **`Idempotency-Key` zorunlu.** Aynı anahtar ve aynı gövdeyle gelen tekrar aynı anketi 201 ile döner; farklı gövde 409 `IDEMPOTENCY_KEY_REUSED`. Eşzamanlı tekrarlar da tek anket üretir. |
| `GET /v1/polls/:id`, `GET /v1/polls/lookup?publicId=` | Detay. Sonuç ve oy durumu izleyiciye göre hesaplanır (misafir, oy veren, sahip, doğrulanmamış). |
| `PATCH /v1/polls/:id` | Sahibin düzenlemesi. İlk geçerli oydan sonra başlık, açıklama, seçenekler ve sonuç görünürlüğü **409 `POLL_CONTENT_LOCKED`**. Kontrol hem API'de hem DB trigger'ında yapılır. |
| `POST /v1/polls/:id/close` | Erken kapanış. Zaten kapalıysa 200 döner ve ilk kapanış zamanı korunur. |
| `DELETE /v1/polls/:id` | Soft delete (`REMOVED` + `deleted_at`). Sonrasında GET 404 döner; tekrar silmek 204. |
| `POST /v1/polls/:id/addenda` | Tarihli ek açıklama. İlk oy kilidinden sonra da eklenebilir; kilitli ankete bilgi eklemenin tek yolu budur. `Idempotency-Key` opsiyonel. |

## Kurallar

- **Süre:** `durationHours`, sistem ayarındaki `[minDurationHours, maxDurationHours]` aralığında olmalı (varsayılan 1–720 saat, yani 1 saat–30 gün). Aralık dışı 400 `VALIDATION_ERROR` (`field: durationHours`). Ayar servisi (KV-40) gelene kadar `DEFAULT_POLL_SETTINGS` kullanılır; `buildApp({ pollSettings })` kancası hazır.
- **Seçenekler:** 2–6 tane, büyük/küçük harf farkı gözetmeden birbirinden farklı. Düzenlemede tam liste gönderilir; `id`'li seçenekler korunur, sıra dizideki sıradır.
- **Referanslar:**
  - Kategori aktif olmalı.
  - Topluluk açık olmalı ve kullanıcı üyesi olmalı; üye değilse 403.
  - Görseller kullanıcının kendi, `POLL` amaçlı ve `REJECTED` olmayan görselleri olmalı; aksi 409 `MEDIA_NOT_USABLE`. Cevapta sadece `APPROVED` görseller gösterilir; ilki `coverImage` olur.
- **Sahiplik:**
  - Sahip olmayan kullanıcının düzenleme, kapatma, silme ve ek açıklama isteği 403 alır.
  - Görünmeyen içerik (HIDDEN, UNDER_REVIEW, REMOVED) 404.
  - Moderasyon `LOCKED` durumu düzenlemede 409 `CONTENT_LOCKED`, ek açıklamada 403 döner.
- **Sonuç görünürlüğü:** `resultsVisibleTo` kullanılır. Sahip sonucu her zaman görür, oy verememe sebebi `OWN_POLL`; bu kararlar contracts 1.2.0 (#77) ile geldi.
- **URL:** `slug` başlıktan üretilir (Türkçe karakterler sadeleştirilir, en fazla 80 karakter) ve başlık değişince güncellenir. `publicId` 8 karakterdir ve hiç değişmez.

## Migration

`20260928160000_faruk_kv10_idempotency_keys`: `idempotency_keys` tablosu (API_CONTRACTS §6).
- Kapsam kullanıcı + route + anahtar; saklama 24 saat.
- Kayıt işlemle aynı transaction'da en sonda eklenir. Aynı anahtarla gelen eşzamanlı istek unique index'te bekler; çakışınca kendi işi geri alınır ve kayıtlı sonuç döner.
- Süresi dolmuş kayıtları temizleyen worker job'u henüz yok (aşağıda).

## Testler

`apps/api/test/polls.test.ts`: 26 test. Gerçek PostgreSQL gerektirir; CI'da `TEST_DATABASE_URL` ile çalışır, yerelde yoksa atlanır. Kapsadıkları:
- Idempotency: tekrar, farklı gövde, 5 eşzamanlı istek, kullanıcı kapsamı.
- Yetki ve süre sınırları.
- Şema kuralları.
- Kategori, topluluk ve görsel kontrolleri.
- Misafir, oy veren, doğrulanmamış hesap ve sahip için sonuç ve oy durumu.
- İlk oy kilidi, DB trigger'ının yarış durumunu yakalaması ve moderasyon kilidi.
- Kapanış, süre dolması, soft delete, ek açıklama ve CSRF.

```bash
TEST_DATABASE_URL=postgresql://kararver:kararver_local@localhost:5432/kararver_test pnpm api:test
```

## Kapsam dışı / kalan işler

| Konu | Durum | İş |
|---|---|---|
| Tartışma gönderisi (`kind: DISCUSSION`) | 400 `VALIDATION_ERROR` (`code: not_supported_yet`); `polls.kind` kolonu yok | #66 (Faruk) |
| Yayın başına 10 puan (`INSUFFICIENT_POINTS`) | Puan defteri yok; harcama yapılmıyor | #67 (Mehmet) |
| Cooldown, günlük limit, aynı başlık tekrarı | Yok | KV-20 #22 (Faruk) |
| Oy verme (`PUT /vote`) | Testler oyu doğrudan DB'ye yazıyor | KV-11 #13 (Faruk) |
| `poll.created` / `poll.closed` domain olayları | Olay altyapısı (outbox) yok | KV-04 #6 (Utku) |
| Sistem ayarları (süre sınırları, oy değiştirme) | Varsayılanlar; kanca hazır | KV-40 #42 (Utku) |
| Sahibin kendi `UNDER_REVIEW` içeriğini görmesi | Sözleşme notu var ama `PollCard.status` sadece ACTIVE/LOCKED alıyor, bu yüzden 404 | Sözleşme düzeltmesi (Faruk, KV-16 ile) |
| Süresi dolmuş `idempotency_keys` temizliği | Yok | Worker (KV-06 sonrası) |
| Tepki, kaydetme, takip alanları (`viewer`) | Sabit `null`/`false` | #66, KV-22, KV-23 |
