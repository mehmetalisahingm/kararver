# KV-21 — Bildirim saklama, teslim ve tekrar işleme

Sahip: Utku · Issue: [#23](https://github.com/mehmetalisahingm/kararver/issues/23) · Tüketici: Mehmet (bildirim merkezi, KV-35 #37) · Tercih/sessize alma: KV-34 (#36)

Kabul koşulları: tekrarlanan olay tek bildirim üretir; başka kullanıcının bildirimine erişilemez; başarısız teslim yeniden denenir ve her modülün olay adapteri için sözleşme testi vardır.

## 1. Bölümleme

| PR | İçerik | Durum |
|---|---|---|
| **PR-1** | `notifications` tablosu, okuma API'si (liste, okunmamış sayısı, okundu), kullanıcı izolasyonu | bu PR |
| PR-2 | Olay outbox'ı (`domain_events`, mutation ile aynı transaction'da yazım) ve worker dağıtıcısı (pg-boss) | sırada |
| PR-3 | Teslim job'u (`notifications.deliver`), modül adapter'ları, retry/dead letter, sözleşme testleri, saklama temizliği | sırada |
| PR-4 | Üretici modüllerde olay yazımı (comments, votes, polls, trends, moderation; sahipleri reviewer) | sırada |

V1'de teslim **uygulama içi bildirim satırı yazmaktır**; e-posta/push yoktur (MVP §12).

## 2. Saklama ve tekrar koruması (PR-1)

Tablo, kolonlar ve DB kısıtları: [DATA_MODEL §9.3](./DATA_MODEL.md#93-bildirimler-utku-kv-21).

- Satırı yalnız teslim job'u yazar; API satır oluşturmaz.
- **Tekrarlanan olay tek bildirim:** UNIQUE `(recipient_id, dedupe_key)`, teslim `INSERT … ON CONFLICT DO NOTHING`. `dedupe_key` = `notifications:<event.id>`; olayın `naturalKey`'i varsa `notifications:<naturalKey>` (aynı iş farklı olay kimliğiyle yeniden üretilse de tek satır). Bu, contracts `dedupeKey(event, "notifications", recipientId)` anahtarına denktir: alıcı ayrı kolondadır.
- Kimse kendi işlemi için bildirim almaz (CHECK `actor_id <> recipient_id`).
- `data` tipe göre küçük özet nesnesidir; oy seçimi, serbest metin (yorum, gerekçe) ve kişisel veri yazılmaz (KV-04 §2.1).
- KV-34'e yer: `type` (tip tercihi) ve `poll_id` (sessize alma) kolonları; filtre teslim anında uygulanır (PR-3).

## 3. Okuma API'si ve kullanıcı izolasyonu (PR-1)

Endpoint'ler contracts'ta hazırdı (`packages/contracts/src/domains/notifications.ts`); PR-1 ilk uygulamadır. Modül: `apps/api/src/modules/notifications/`.

| Endpoint | Davranış |
|---|---|
| `GET /notifications` | Oturumdaki kullanıcının bildirimleri, `created_at ↓, id ↓`; cursor bu ikiliden. `unreadOnly=true` yalnız okunmamışlar; filtre değişince eski cursor 400 `INVALID_CURSOR`. Silinmiş aktör `actor: null` |
| `GET /notifications/unread-count` | Okunmamış sayısı (partial index) |
| `POST /notifications/read` | `{ids: [...≤100]}` veya `{all: true}`; yalnız kullanıcının okunmamış satırları işaretlenir, `updated` yeni okunanların sayısıdır (tekrar çağrı 0) |

**İzolasyon:** her sorgunun ilk koşulu `recipient_id = oturumdaki kullanıcı`. Tekil bildirim endpoint'i yoktur. Başka kullanıcının id'si okundu işaretine verilirse satır değişmez, `updated`'a girmez ve hata dönmez; böylece bildirim id'sinin varlığı sızmaz. Testler: `apps/api/test/notifications.test.ts`.

Kapsam dışı: `notifications.preferences.*`, `notifications.mutes.*` (KV-34; route kaydedilmez).

## 4. Kararlar (2026-10-03)

- **Yaptırım bildirimi (KV-04 açık konu 5):** `WARNING` ve `RESTRICT_COMMENTS` / `RESTRICT_POSTING` bildirim gönderir (kullanıcı uyarıldığını/kısıtlandığını bilmeli); `SUSPEND` / `BAN` göndermez (kullanıcı girişte hatayı görür). PR-3'te yeni bildirim tipi ve `sanction.applied` tüketicisiyle uygulanır (contracts minor).
- **Saklama:** okunmuş bildirim 90 gün; okunmamış silinmez. Outbox 30 gün, yalnız işlenmiş satırlar silinir, işlenmemiş satır asla (PR-2).
- **Bekleyen (Mehmet):** kitlesel bildirim (kapanış/karar → oy verenler, öne çıkarma → topluluk üyeleri) ve oy kilometre taşı eşikleri. Tasarım ikisine açık: alıcılar teslimde DB'den çözülür, kitlesel alıcılar dilimli fan-out işiyle yazılır (PR-3).
- **Not:** `apps/worker/src/main.ts`, KV-33 PR-C ile birlikte değişecek; çakışma birleştirmede çözülür.
