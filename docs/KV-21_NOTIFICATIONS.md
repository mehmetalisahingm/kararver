# KV-21 — Bildirim saklama, teslim ve tekrar işleme

Sahip: Utku · Issue: [#23](https://github.com/mehmetalisahingm/kararver/issues/23) · Tüketici: Mehmet (bildirim merkezi, KV-35 #37) · Tercih/sessize alma: KV-34 (#36)

Kabul koşulları: tekrarlanan olay tek bildirim üretir; başka kullanıcının bildirimine erişilemez; başarısız teslim yeniden denenir ve her modülün olay adapteri için sözleşme testi vardır.

## 1. Bölümleme

| PR | İçerik | Durum |
|---|---|---|
| PR-1 | `notifications` tablosu, okuma API'si (liste, okunmamış sayısı, okundu), kullanıcı izolasyonu | ✅ #125 |
| PR-2 | Olay outbox'ı (`domain_events`, mutation ile aynı transaction'da yazım), worker dağıtıcısı (pg-boss), retry/DEAD, saklama; ilk üretici admin-users | ✅ #128 (§5) |
| **PR-3** | `notifications` tüketicisi, modül adapter'ları, alıcı süzgeci ve KV-34 politika kancası, kitlesel fan-out, sözleşme testleri, bildirim saklaması | bu PR (§6) |
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
- **Yaptırım kaldırma (`sanction.lifted`):** V1'de bildirim yok. RESTRICT_* kaldırıldığında kullanıcıya bildirim KV-34 veya sonrasında değerlendirilir (yeni bildirim tipi gerekir).
- **PR-3 kararları (2026-10-05):** trend bildirimi anket + format başına ömür boyu bir kez; moderasyon, yaptırım ve öne çıkarma bildirimlerinde aktör gösterilmez; `poll.closed` anket sahibine de gider; BANNED ve silinmiş hesaba bildirim yazılmaz (SUSPENDED/RESTRICTED'e yazılır); teslim anında görünür olmayan içerik (yorum, cevap, öneri, anket) için bildirim yazılmaz; silinmiş hesabın bildirimleri silinmeden 30 gün sonra temizlenir. Ayrıntı §6.
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

**Tüketici kaydı:** `productionConsumers` (`jobs/events/registry.ts`; PR-3'ten beri `notifications`, §6). Tüketici yalnız kayıt olduktan sonra dağıtılan olayları alır; geriye dönük teslim yoktur.

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

## 6. Bildirim tüketicisi ve adapter'lar (PR-3)

Kod: `apps/worker/src/jobs/notifications/` (`adapters.ts`, `consumer.ts`, `write.ts`, `policy.ts`, `cleanup.ts`); kayıt `apps/worker/src/jobs/events/registry.ts` (`productionConsumers` = `notifications`). Testler: `apps/worker/test/notifications-contract.test.ts` (sözleşme, DB'siz), `notifications.test.ts` (adapter'lar, fan-out, süzgeç, politika, uçtan uca, saklama), `notifications-sql.test.ts` (ham SQL koruması).

### 6.1 Akış ve adapter'lar

Olay → adapter → alıcılar (teslim anında DB'den) → ortak süzgeç ve politika → `notifications` satırları; hepsi teslim transaction'ında (§5.2: DONE ile birlikte commit). Adapter iki parçalıdır: `draft(event)` saf (tip, konu, anket, gösterilen aktör, `data`, dedupe anahtarı; `null` = bildirim yok) ve `recipients(tx, event)` (DB; `null` = konu teslimde görünür değil; konu satırı hiç yoksa `PermanentEventError` → DEAD).

| Olay | Bildirim | Alıcı | Konu | Aktör | `data` | Dedupe |
|---|---|---|---|---|---|---|
| `comment.created` | `COMMENT_ON_POLL` | anket sahibi | yorum | yorumcu | `{}` | olay kimliği |
| `comment.replied` | `REPLY_TO_COMMENT` | üst yorumun sahibi | cevap | cevaplayan | `{ parentId }` | olay kimliği |
| `alternative.created` | `ALTERNATIVE_ON_POLL` | anket sahibi | öneri | öneren | `{}` | olay kimliği |
| `poll.milestone` | `POLL_MILESTONE` | yalnız anket sahibi; eşikler `POLL_MILESTONES` (10, 50, 100, 500, 1000, 5000, 10 000), listede olmayan yok sayılır | anket | — | `{ metric, milestone }` | doğal anahtar (eşik başına bir kez) |
| `poll.trending` | `POLL_TRENDING` | anket sahibi | anket | — | `{ format, rank }` | `poll.trending:<anket>:<format>` (ömür boyu bir kez) |
| `poll.closed` | `POLL_CLOSED` | bütün geçerli oy verenler (fan-out) + anket sahibi | anket | kapatan (OWNER) / — (EXPIRED) | `{ reason }` | doğal anahtar (anket başına bir kez) |
| `decision.updated` | `DECISION_UPDATED` | bütün geçerli oy verenler (fan-out) | anket | anket sahibi | `{ first }` (seçim yazılmaz) | olay kimliği (her güncelleme ayrı) |
| `moderation.applied` | `MODERATION_APPLIED` | içeriğin sahibi (anket/yorum; yorumda anket DB'den) | anket/yorum | **gizli** | `{ action, toStatus }` | olay kimliği |
| `community.featured` | `COMMUNITY_FEATURED` | yalnız anket sahibi (üyelere yok) | anket | **gizli** | `{ communityId }` | doğal anahtar |
| `sanction.applied` | `SANCTION_APPLIED` | yaptırım alan; yalnız `WARNING`, `RESTRICT_*` | kullanıcı | **gizli** | `{ sanctionType, endsAt }` (gerekçe yok) | doğal anahtar |

`dedupe_key` = `notifications:<naturalKey ?? event.id>` (trend hariç). UNIQUE `(recipient_id, dedupe_key)` ve `ON CONFLICT DO NOTHING`; retry'da, aynı iş olgusunun farklı kimlikle tekrarında ve aynı alıcının iki yoldan gelmesinde tek satır kalır (anket sahibi kendi anketine oy veremez, `KV_SELF_VOTE`; verseydi de tek satır). `created_at` = olayın `occurredAt`'i. `data` şemaları contracts `notificationData`'dadır.

**Üreticiler:** bugün yalnız `sanction.applied` üretiliyor (admin-users, PR-2); diğerlerinin üreticileri PR-4'te sahiplerinin modüllerinde eklenir (Faruk: polls, votes, comments, trends job'u; Mert: moderation; Mehmet: decision-updates, featured). Adapter'lar hazır ve contracts örnek olayları + gerçek DB verisiyle testlidir; PR-4'te yalnız üretici ve onun testi eklenir.

### 6.2 Alıcı süzgeci ve politika

- **Ortak süzgeç** (SQL'de): olayın gerçek aktörü alıcı olmaz (aktörü gizlenen tiplerde de); silinmiş (`deleted_at`) ve BANNED hesap bildirim almaz; SUSPENDED / RESTRICTED alır.
- **Görünürlük:** yorum, cevap, öneri ve anket konulu bildirimler konu içerik teslimde `ACTIVE` veya `LOCKED` değilse yazılmaz; moderasyon bildirimi hariç (gizlenen içeriğin sahibi bilmeli).
- **KV-34 politika kancası:** `policy.ts` (`NotificationPolicy`, bugün `allowAll`). Tüketici her alıcı diliminde çağırır; KV-34 tip tercihi ve anket sessizini (`poll_id`) yalnız bu dosyada uygular. `MODERATION_APPLIED` ve `SANCTION_APPLIED` kapatılamaz (contracts `MANDATORY_NOTIFICATION_TYPES`): politikaya hiç sorulmaz.

### 6.3 Kitlesel fan-out ve ölçüm

`poll.closed` ve `decision.updated` anketin bütün geçerli oy verenlerine (`votes.invalidated_at IS NULL`) gider: tüketici transaction'ında, 1000'lik dilimlerle (keyset `votes.created_at, user_id`; index `votes (poll_id, created_at, invalidated_at)`), olay başına en fazla 50 000 alıcı. Aşılırsa en eski oy verenler alır ve `warn` loglanır (sıra deterministik, retry aynı kümeyi seçer). Dilim başına tek `INSERT … SELECT FROM unnest($kimlikler, $alıcılar) ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`; kimlikler contracts UUIDv7 üreteciyle JS'te üretilir (`notifications.id`'nin DB varsayılanı yok). Bütün dilimler tek transaction'da: ya hepsi commit olur ya hiçbiri; retry çift kayıt üretmez. Kolon eşlemesi ham SQL olduğu için `notifications-sql.test.ts` satırı Prisma ile geri okuyup bütün kolonları karşılaştırır ve tablo/model kolon listesini sabitler.

**50 000 alıcı ölçümü** (2026-10-05; tüketici transaction sınırı 30 sn, karar eşiği 15 sn):

| Yazım yolu | İlk teslim | Retry (hepsi dedupe) |
|---|---|---|
| `createMany({ skipDuplicates })` dilimleri (ilk deneme, bırakıldı) | 36,5 sn | 35,9 sn |
| **Dilim başına tek `INSERT … SELECT unnest(...)` (uygulanan)** | **9,1 sn** | **3,7 sn** |

Makine: Intel Core i7-13700H (14 çekirdek / 20 iş parçacığı), 16 GB RAM, Samsung NVMe; Windows 11 Pro 10.0.26200; Node 24.21.0; PostgreSQL 17.11 (docker compose `postgres:17.11-alpine`; Docker 20 CPU / 7,6 GB); Prisma 7.10.0. Dilim sorgusunun kendisi ~4 ms (`EXPLAIN ANALYZE`); süre yazımda. Üretim donanımında ölçüm 15 sn'yi geçerse plan B: ayrı fan-out job'ları (cursor tablosu, dilim başına kısa transaction).

**Ölçüm script'i:** `apps/worker/scripts/notifications-fanout-bench.ts`, CI'da koşmaz. Yalnız açıkça verilen `TEST_DATABASE_URL`'e (adı `_test` ile biten) yazar, `.env`'den türetmez; ne ölçtüğü ve nasıl çalıştırılacağı dosyanın başında. O veritabanına N kullanıcı, oy ve bildirim bırakır; ardından `pnpm test:reset`.

### 6.4 Saklama

`notifications.cleanup`: her gün 04:00 Europe/Istanbul, `singleton`, 5000'lik dilimler. Okunmuş bildirim okunduktan 90 gün sonra silinir (partial index `notifications_read_at_idx`); okunmamış silinmez. Silinmiş hesabın bütün bildirimleri (okunmuş/okunmamış) hesap silindikten 30 gün sonra silinir.

### 6.5 Sözleşme testi (kabul koşulu)

`notifications-contract.test.ts`: katalogda `notification` alanı olan her olay tipinin tam bir adapter'ı var ve her adapter'ın tipi katalogdaki `notification` ile aynı (iki yönlü; adapter'sız bildirim olayı eklenemez); tüketicinin tipleri bu kümeyle aynı ve üretimde kayıtlı; her adapter'ın contracts örnek olayından (`@kararver/contracts/fixtures/events`) ürettiği taslak `NotificationView` ve tipe özgü `notificationData` şemasından geçer; `data`'da olayın hassas alanları yok; dedupe anahtarı biçimi ve uzunluğu; `created_at` = `occurredAt`; aktörü gizlenen tipler; bildirim üretmeyen durumlar (SUSPEND/BAN, listede olmayan eşik).
