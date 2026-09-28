# KV-11: Transaction-safe oy sistemi ve sonuç gizliliği (#13)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/votes` · Sözleşme: `votes.put` (`packages/contracts/src/domains/polls.ts`, [`API_CONTRACTS.md`](./API_CONTRACTS.md) §4.4–4.5)
> Veri modeli: [`DATA_MODEL.md` §5](./DATA_MODEL.md) · Anket tarafı: [`KV-10_POLLS.md`](./KV-10_POLLS.md)

## `PUT /v1/polls/:id/vote`

| Durum | Cevap |
|---|---|
| İlk oy | **201**, `vote` + güncel `results` (oy veren için AFTER_VOTE sonucu artık görünür) |
| Aynı seçeneğe tekrar | **200**, değişiklik yok, yeni olay yok |
| Farklı seçenek, oy değiştirme açık | **200**, `changeCount + 1`, `CHANGE` olayı; toplam değişmez |
| Farklı seçenek, oy değiştirme kapalı | 409 `VOTE_CHANGE_DISABLED` |
| Anket sahibi | 403 `SELF_VOTE_FORBIDDEN` (API + DB trigger) |
| Anket kapalı (erken kapanış veya süre dolmuş) | 409 `POLL_CLOSED` |
| Moderasyon kilidi (`LOCKED`) | 409 `CONTENT_LOCKED` |
| Başka anketin seçeneği | 400 `VALIDATION_ERROR` (`field: optionId`, `code: not_in_poll`) |
| Oyu geçersiz sayılmış hesap | 409 `VOTE_INVALIDATED` |
| Görünmeyen/kaldırılmış anket | 404 |
| Misafir / doğrulanmamış / askıya alınmış | 401 / 403 `EMAIL_NOT_VERIFIED` / 403 `ACCOUNT_RESTRICTED` |

Hata sırası `viewer.voteBlockedReason` ile aynıdır (contracts `voteAvailability`); UI butonu ve endpoint aynı kararı verir.

## Tek aktif oy ve tutarlılık

Tek transaction içinde sırasıyla:
1. Anket satırı `SELECT … FOR UPDATE` ile kilitlenir. Aynı anketteki oylar ve kapatma işlemi sıraya girer.
2. Kullanıcının mevcut oyu `FOR UPDATE` ile okunur.
3. Oy (`votes`), oy geçmişi (`vote_events`: `CAST` / `CHANGE`) ve sayaçlar (`poll_options.vote_count`, `polls.vote_count`) yazılır.

Sonuçlar:
- Aynı hesaptan **20 eşzamanlı istek** tek oy satırı üretir: 1 × 201, geri kalanı 200.
- Çok kullanıcılı eşzamanlı oy ve değişimlerde sayaçlar, geçerli oylar ve `CAST` olayları birbirini tutar.
- Kapanış kilidi beklediği için kapanıştan sonra commit edilen oy olmaz.
- Anket başına kilit, aynı anketteki oyları sıraya koyar. V1 için yeterli; çok yüksek trafikte sayaçlar ayrı bir tabloya bölünebilir (KV-47).

`FOR UPDATE` kaldırılınca iki eşzamanlılık testi de kırılıyor (doğrulandı).

## Gizlilik

- Sonuç görünürlüğü `resultsVisibleTo`'dan gelir. Gizliyken cevapta hiçbir sayı yoktur (`{ visible: false }`); bu testle kontrol ediliyor.
- Bütün anket ve oy cevapları `Cache-Control: private, no-store` ile döner.
- Oy verenlerin kimliği ve seçimi hiçbir public cevapta yer almaz. `viewer.vote` sadece izleyicinin kendi oyudur.
- Geçersiz sayılmış oy sonucu açmaz ve sayaçlara girmez.

## Testler

`apps/api/test/votes.test.ts`, 12 senaryo. Gerçek PostgreSQL gerektirir (CI'da `TEST_DATABASE_URL`).

## Kalan işler

| Konu | Durum | İş |
|---|---|---|
| `vote.submitted` / `vote.changed` domain olayları (bildirim, analytics) | Outbox tablosu yok. Snapshot ve trend kaynağı olan `vote_events` şimdiden yazılıyor | KV-04 #6 / KV-21 #23 (Utku) |
| `polls.voteChangeAllowed` resmî varsayılanı | KV-04'te "taslak"; şimdilik `true` | KV-40 #42 |
| Oy geçersiz sayma API'si | Testlerde DB'de elle yapılıyor | KV-43 #45 (Faruk) |
| Gizli sonucun SSR HTML'e girmemesi | API tarafı `private, no-store`; web tarafı ayrıca doğrulanmalı | KV-18 #20 (Ümit) |
| İşlem bazlı kısıt (RESTRICTED + yaptırım türü) | Sadece SUSPENDED/BANNED reddediliyor | KV-33 #35 (Utku) |
| Staging'de iki gerçek hesapla uçtan uca | Staging yok | KV-06 #8 |
