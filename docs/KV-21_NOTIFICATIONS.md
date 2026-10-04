# KV-21 — Bildirim saklama, teslim ve tekrar işleme

Sahip: Utku · Issue: [#23](https://github.com/mehmetalisahingm/kararver/issues/23) · Tüketici: Mehmet (bildirim merkezi, KV-35 #37) · Tercih/sessize alma: KV-34 (#36)

Kabul koşulları: tekrarlanan olay tek bildirim üretir; başka kullanıcının bildirimine erişilemez; başarısız teslim yeniden denenir ve her modülün olay adapteri için sözleşme testi vardır.

## 1. Bölümleme

| PR | İçerik | Durum |
|---|---|---|
| PR-1 | `notifications` tablosu, okuma API'si (liste, okunmamış sayısı, okundu), kullanıcı izolasyonu | ✅ #125 |
| **PR-2** | Olay outbox'ı (`domain_events`, mutation ile aynı transaction'da yazım), worker dağıtıcısı (pg-boss), retry/DEAD, saklama; ilk üretici admin-users | bu PR (§5) |
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
- **Ürün kararları (Mehmet onayladı, 2026-10-04; PR-3'te uygulanır):**
  - **`poll.closed` ve karar güncellemesi (`decision.updated`):** anketin bütün geçerli oy verenlerine bildirim. Alıcılar teslimde DB'den çözülür ve 1000'lik dilimlerle yazılır (fan-out); olay başına en fazla 50 000 alıcı.
  - **Topluluk öne çıkarma (`community.featured`):** üyelere bildirim **yok**.
  - **Oy kilometre taşları (`poll.milestone`):** yalnız anket sahibine; eşikler 10, 50, 100, 500, 1000, 5000, 10 000.
- **PR-2 → PR-3 arası olaylar:** PR-2'de üretimde kayıtlı tüketici yoktur; bu arada üretilen olaylar (şu an admin-users'ın `sanction.*` / `role.changed` olayları) **abonesiz dağıtılır** ve 30 gün sonra silinir. PR-3'teki `notifications` tüketicisi onları **geriye dönük almaz** (bildirim üretilmez). Genel kural: tüketici, kayıt olmadan önce dağıtılmış olayları görmez (§5.2).

## 5. Olay outbox'ı ve dağıtıcı (PR-2)

Şema ve DB kuralları: [DATA_MODEL §9.4](./DATA_MODEL.md#94-olay-outboxı-utku-kv-21-pr-2). Kod: `apps/api/src/modules/events/write.ts` (yazım), `apps/worker/src/jobs/events/` (dağıtım, tüketici arayüzü, saklama). Testler: `apps/api/test/admin-events.test.ts`, `apps/worker/test/events.test.ts`, `admin-roles.test.ts` yarış testleri.

### 5.1 Yazım (producer)

```ts
await writeEvent(tx, createEvent({ id: newEventId(now), type: "sanction.applied", occurredAt: now.toISOString(),
  actorId, subject: { type: "USER", id: userId }, payload: { sanctionId, type, endsAt } }));
```

- Mutation'ın transaction'ında, audit'in yanında çağrılır; commit olursa olay vardır, geri alınırsa yoktur.
- **Kimlik:** `newEventId(now)` (contracts, UUIDv7) producer'da bir kez üretilir; `domain_events.id` olur. API tekrarında (`Idempotency-Key`) mutation yeniden çalışmadığı için ikinci olay oluşmaz.
- **Doğal anahtar:** `naturalKey(event)` varsa UNIQUE; aynı iş olgusu ikinci kez yazılmaz (`written: false`, mutation devam eder).
- **Dedupe katmanları:** tablo (`natural_key`, saklama süresince) → dağıtıcı (`event_id + consumer`, contracts `dedupeKey(event, consumer)`) → tüketici (bildirimde alıcı başına `dedupe_key`, kalıcı).
- **Worker:** `apps/api`'yi import etmez. Dağıtıcı tabloyu `@kararver/db` ve contracts `parseEvent` ile okur. Worker job'ları olay üretmeye başladığında (PR-4: `poll.closed` EXPIRED, `poll.trending`, `poll.milestone`) `writeWorkerAudit` emsalindeki gibi küçük bir eş (`jobs/events/write.ts`) eklenir; doğrulama yine contracts'tadır.

**İlk üretici (bu PR):** admin-users (`prisma-store.ts`): `sanction.applied`, `sanction.lifted`, `role.changed` (yalnız rol değiştiğinde; `previousRoles`/`roles` API gösterimiyle, tek elemanlı). Reddedilen işlem (403, 409) olay yazmaz. Olay INSERT'i KV-33 kilitlerinden sonradır ve FK'sizdir; kilit sırasına yeni kilit eklemez. Yarış testleri tam bir olay görür.

### 5.2 Dağıtım ve teslim (worker)

| Adım | Ne yapar |
|---|---|
| Dağıtma | Dağıtılmamış olayları `ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED` ile alır; tipine abone her tüketici için teslim satırı açar (`ON CONFLICT DO NOTHING`); `dispatched_at` doldurur. Abonesiz olay teslimsiz dağıtılmış sayılır. Ayrıştırılamayan satır `dispatch_error` alır (log `error`, döngüye girmez, silinmez) |
| Kiralama | Vadesi gelen teslimi `SKIP LOCKED` ile alır; deneme +1 ve `next_attempt_at` = şimdi + 2 dk kira (handler'dan önce: çöken worker'ın denemesi de sayılır) |
| İşleme | Tek transaction (30 sn sınırı): önce teslimi `DONE` yapar, yalnız kiradaki deneme numarası hâlâ geçerliyse (fencing; kira dolup başka işleyici devraldıysa hiçbir şey yazmaz), sonra tüketiciyi çağırır. Tüketicinin DB yazımı `DONE` ile birlikte commit olur |
| Hata | İşleme geri alınır; ayrı transaction'da `last_error` ve backoff yazılır. 8. hata veya `PermanentEventError` → `DEAD` (log `error`) |

**Retry:** 1. hatadan sonra 10 sn, sonra 30 sn, 2 dk, 10 dk, 30 dk, 1 sa, 3 sa; 8. hata `DEAD` (toplam ≈ 4,7 sa). Her (olay, tüketici) satırı bağımsızdır: bir tüketicinin hatası aynı olaydaki diğer tüketiciyi ve kendi kuyruğundaki diğer olayları engellemez (sıra `next_attempt_at`'e göre). `DEAD` satır otomatik silinmez ve yeniden denenmez; elle yeniden kuyruğa alma:

```sql
UPDATE domain_event_deliveries SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = NULL
WHERE event_id = '<olay>' AND consumer = '<tüketici>' AND status = 'DEAD';
```

**pg-boss:** `events.dispatch` kuyruğu `stately` (en fazla 1 aktif + 1 bekleyen), dakikalık cron; her job 90 sn boyunca dağıt → işle döngüsünü çalıştırır (iş yokken 1 sn bekler, kapanışta durdurma sinyalini dinler). Döngü dakikadan uzun olduğu için sonraki cron job'u hazır bekler: dağıtım kesintisiz, gecikme ≈ 1 sn. `SKIP LOCKED` birden fazla dağıtıcıyı yine de güvenli kılar (testli: iki eşzamanlı dağıtıcı/işleyici, 200 olay, her teslim tam bir kez).

**Saklama:** `events.cleanup`, her gün 03:30 Europe/Istanbul, 5000'lik dilimlerle: bütün teslimleri `DONE` olan ve son `DONE`'u (teslimsiz olayda dağıtım anı) 30 günden eski olaylar silinir. Dağıtılmamış, ayrıştırılamamış, `PENDING` veya `DEAD` teslimi olan olay asla silinmez. Her çalışmada `DEAD` teslim, 10 dk'dan eski `PENDING`, 10 dk'dan eski dağıtılmamış ve ayrıştırılamamış olay sayısı loglanır; biri 0'dan büyükse `warn`.

**Tüketici kaydı:** `productionConsumers` (şu an boş; PR-3 `notifications`'ı ekler). Tüketici yalnız kayıt olduktan sonra dağıtılan olayları alır; geriye dönük teslim yoktur.

### 5.3 Tüketici arayüzü (PR-3 adapter'ları buna takılır)

```ts
type EventConsumer = {
  name: string;                       // contracts dedupeKey handler kuralı; teslim satırının consumer'ı
  types: readonly EventType[];
  handle(event: DomainEvent, ctx: { tx: Prisma.TransactionClient; attempt: number; log }): Promise<void>;
};
class PermanentEventError extends Error {} // yeniden denenmeden DEAD
```

- `handle` teslim transaction'ında çalışır; idempotent olmalıdır (teslim en az bir kez).
- **Sıralama garantisi yok** (contracts `eventDelivery.ordering = "none"`): tüketici delta uygulamaz, güncel durumu DB'den okur veya tekdüze bir alanla (`occurredAt`, `version`) eskiyi yok sayar. Bildirimde `created_at` olayın `occurredAt`'i olur (PR-3), böylece ters sırada işlenen iki olay listede doğru sırada görünür.
- **Kilit:** `users` satırı kilitlemesi gerekirse yalnız `FOR NO KEY UPDATE` ve KV-33 sırası; asla `FOR UPDATE` (FK'lerin `FOR KEY SHARE`'i ile çakışır). Bildirim INSERT'inin FK kilidi (`FOR KEY SHARE`) KV-33'ün `FOR NO KEY UPDATE`'iyle çakışmaz.
