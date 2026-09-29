# KV-17: Yorum, tek seviye cevap ve alternatif öneri API (#19)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/comments` · Sözleşme: `packages/contracts/src/domains/comments.ts` ([`API_CONTRACTS.md`](./API_CONTRACTS.md))

## Endpointler

| Endpoint | Yetki | Davranış |
|---|---|---|
| `GET /v1/polls/:id/comments?kind=&sort=&cursor=&limit=` | Misafir | Üst seviye yorumlar (`kind=COMMENT`, varsayılan) veya alternatif öneriler (`kind=ALTERNATIVE`) **ayrı** listelenir. `sort=new` yeniden eskiye, `sort=top` beğeniye göre. |
| `GET /v1/comments/:id/replies` | Misafir | Tek seviye cevaplar, eskiden yeniye. |
| `POST /v1/polls/:id/comments` | Doğrulanmış | Yorum, cevap (`parentId`) veya alternatif (`kind: ALTERNATIVE`, sadece üst seviye). `Idempotency-Key` opsiyonel. |
| `PATCH /v1/comments/:id` · `DELETE /v1/comments/:id` | Sahip | Düzenleme (`editedAt`) · soft delete. Tekrar silmek 204 döner. |
| `PUT` / `DELETE /v1/comments/:id/reaction` | Giriş | Beğeni/dislike. Kullanıcı + yorum başına tek aktif tepki; `LIKE ↔ DISLIKE` sayaçları taşır. |

## Kurallar

- **Yorum kapalı:** Anketin `allowComments=false` olması → 409 `COMMENTS_DISABLED`. Moderasyon kilidi (`LOCKED`) → 409 `CONTENT_LOCKED` (yeni yorum ve düzenleme). Acil durum anahtarı `features.comments` kapalı → 503 `FEATURE_DISABLED`. Anket kapandıktan sonra yorum serbest.
- **Derinlik:** Cevaba cevap → 400 `COMMENT_DEPTH_EXCEEDED`. Kontrol hem API'de (satır kilitli) hem DB trigger'ında (`KV_COMMENT_DEPTH`) var; trigger'ın hatası da aynı koda eşlenir.
- **Sahiplik:** Başkasının yorumu düzenlenemez veya silinemez (403); görünmeyen yorum 404.
- **Görünürlük:**
  - Sadece `ACTIVE` yorumlar listelenir; `HIDDEN` ve `UNDER_REVIEW` yorumlar gösterilmez.
  - Kaldırılmış ama cevabı olan üst yorum **tombstone** olarak kalır: `deleted: true`, `body` ve `author` null. Cevapları görünmeye devam eder.
  - Anket görünmüyorsa 404.
- **Sayaçlar:** `polls.comment_count` (aktif yorum + cevap), `comments.reply_count`, `like_count` ve `dislike_count` işlemle aynı transaction'da güncellenir. Kilit sırası her yerde aynıdır: önce anket, sonra yorum. Bu yüzden deadlock oluşmaz.
- **Tepki tekrarı:** Yorum satırı kilitlenir. 10 eşzamanlı `LIKE` tek beğeni üretir (test var; kilit kaldırılınca kırılıyor).
- **Pagination:** Opak cursor (`apps/api/src/http/cursor.ts`); anket, tür ve sıralamaya bağlı. Filtre değişip eski cursor gelirse 400 `INVALID_CURSOR`.

## Migration

`20260928210000_faruk_kv17_comment_reactions`:
- `reaction_value` enum'u, `comment_reactions` tablosu ve `comments.dislike_count` kolonu eklendi.
- `comment_likes` tablosu kaldırıldı; hiçbir kod kullanmıyordu. Varsa satırları önce `LIKE` olarak taşınır.
- Contracts 1.6.0: `reactions.comment.*` artık `ready`.

## Testler

`apps/api/test/comments.test.ts`, 14 senaryo. Gerçek PostgreSQL gerektirir (CI'da `TEST_DATABASE_URL`).

## Kalan işler

| Konu | Durum | İş |
|---|---|---|
| `comment.created` / `comment.replied` / `alternative.created` olayları (bildirim, analytics) | Outbox tablosu yok | KV-04 #6 / KV-21 #23 (Utku) |
| Yorum sürüm geçmişi (`admin.revisions.comments`) | Düzenleme eski metni saklamıyor | #66 |
| Anket tepkileri (`reactions.poll.*`) | Planlı | #66 |
| Yorum spam / hız sınırı | Yok | KV-19 #21 (Utku) |
| Sahibin kendi `UNDER_REVIEW` yorumunu görmesi | Gösterilmiyor | Moderasyon (KV-24/KV-37, Mert) |
| Idempotency yardımcısı iki kopya (`http/idempotency.ts` ve `polls/prisma-store.ts`) | Ayrı bir refactor PR'ında tek yere taşınacak | Faruk |
