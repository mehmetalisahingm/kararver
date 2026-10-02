# KararVer — Veri Modeli ve Migration Sözleşmesi (KV-02)

> Issue: **KV-02 / #4** · Sahip: **Faruk** · Review: **Mehmet + Utku**
> Dayandığı karar belgesi: [`TECH_DECISIONS.md`](./TECH_DECISIONS.md) (PostgreSQL 17 + Prisma 7.10.0)
> Son güncelleme: 2026-09-27

Bu belge şunları tanımlar: veritabanının ortak kuralları (ID, zaman, silme), çekirdek tablolar, oy bütünlüğü, anket kilidi, durum geçişleri, snapshot pencereleri, diğer sahiplerin tablolarıyla ilişkiler ve migration sözleşmesi.

Kaynak dosyalar: `packages/db/prisma/schema/*.prisma` ve `packages/db/prisma/migrations/`.

---

## 1. Dosyalar ve sahipleri

| Dosya | Sahip | İçerik | Durum |
|---|---|---|---|
| `schema.prisma` | Faruk | Generator ve datasource | ✅ |
| `core.prisma` | Faruk | Hesap, kategori/etiket, anket, seçenek, oy, oy geçmişi, yorum | ✅ |
| `trends.prisma` | Faruk | Günlük snapshot, trend çalıştırmaları ve skorları | ✅ |
| `media.prisma` | **Mert** | `MediaAsset`: nesne anahtarları, işlenmiş kopya metadata'sı, moderasyon sonucu ([MEDIA_MODERATION.md](./MEDIA_MODERATION.md)) | ✅ KV-16 (şema) |
| `community.prisma` | **Mert** | `Community` (slug, ad, görsel, üye sayısı, oluşturan), `CommunityMembership` (üyelik + topluluk rolü) | ✅ KV-31 (şema) |
| `moderation.prisma` | Mert | `Report`, `ModerationAction` (append-only). Engelli görsel hash listesi KV-38'de eklenecek | ✅ KV-24 (şema) |
| `admin.prisma` | Utku | `UserRole` (kullanıcı başına tek global rol), `Sanction` (değişmez yaptırım geçmişi), `AuditLog` (değiştirilemez audit). Ayarlar, bildirimler sonra | ✅ KV-12 (şema) · ✅ KV-39 (şema + yazıcı) · ⏳ KV-21 / KV-40 |
| `growth.prisma` | Mehmet | Bookmark, karar güncellemesi, takip, öne çıkarma, duyuru, ilgi alanı, ürün olayları | ✅ `UserInterest` (KV-15) · ⏳ KV-22 / KV-23 / KV-42 |

**İskelet tablolar neden var:** Çekirdek tablolar Mert'in iki tablosuna FK veriyor: `polls.community_id → communities` ve `users.avatar_media_id`, `poll_media.media_id → media_assets`. FK'nin hedefi olmadan ilk migration çalışmaz. Bu yüzden iki tablo sadece `id`, `status` ve `created_at` alanlarıyla açıldı. Geri kalan alanları, enum değerlerini ve indexleri sahibi belirler. İskeletteki `id` alanı ve "core ilişkileri" bölümü kaldırılmamalıdır.

Çekirdeğin FK verdiği başka bir sahip tablosu yoktur. Diğer sahiplerin tabloları çekirdeğe FK verir; bu yön için iskelet gerekmez (§9).

---

## 2. Ortak kurallar

### 2.1 ID
- Her tablonun birincil anahtarı **UUIDv7**'dir: Postgres `uuid` tipi, Prisma'da `@default(uuid(7))`. Zamana göre sıralanabildiği için cursor pagination'da `ORDER BY id` kullanılabilir. Tahmin edilemez olduğu için URL'de sıra numarası sızmaz.
- ID'yi uygulama üretir (Prisma client). Elle yazılan SQL'de `id` değeri açıkça verilir. PostgreSQL 17'de yerleşik `uuidv7()` fonksiyonu yok.
- Anket URL'i: `/karar/<slug>-<publicId>`. `publicId` 8 karakterlik, URL güvenli, unique bir koddur (üretimi KV-10'da). `slug` sadece okunabilirlik içindir, unique değildir.
- Join tablolarında birincil anahtar bileşiktir, ayrı bir `id` alanı yoktur: `poll_tags`, `poll_media`, `comment_reactions`, snapshot tabloları.

### 2.2 Zaman
- Her zaman kolonu **`timestamptz(3)`** tipindedir ve UTC saklanır. Sunucu, veritabanı ve job'lar UTC ile çalışır.
- Europe/Istanbul'a çevirme sadece iki yerde yapılır: ekranda gösterirken ve takvim günü gereken hesaplarda (§8). Çevirme her zaman `AT TIME ZONE 'Europe/Istanbul'` ile yapılır, **`+3` elle yazılmaz**.
- Standart kolonlar: `created_at` (varsayılan `now()`), `updated_at` (Prisma `@updatedAt`) ve soft delete olan tablolarda `deleted_at`.
- **DB oturumu UTC'dir:** `createPrismaClient` bağlantıyı `TimeZone=UTC` ile açar. Ham SQL'de `Date` parametresi saat dilimsiz bağlanabildiği için, oturum başka bir saat diliminde olursa (ör. docker-compose `TZ=Europe/Istanbul`) `timestamptz` karşılaştırmaları kayar; KV-26 arama sayfalamasında bu görüldü. Ham SQL'de zaman parametresi ayrıca `…::timestamptz` ile açıkça çevrilir.
- Sadece takvim günü tutan kolon: snapshot tablolarındaki `local_date` (`date` tipi, İstanbul günü).

### 2.3 İsimlendirme
- DB'de tablolar ve kolonlar `snake_case`, tablolar çoğul (`poll_options`). Prisma'da modeller `PascalCase`, alanlar `camelCase`; eşleme `@map` / `@@map` ile yapılır.
- Enum tipleri `snake_case`, değerleri `UPPER_CASE` (`content_status` → `'ACTIVE'`).
- Constraint adları: `<tablo>_<amaç>_check`, `<tablo>_<kolon>_fkey`. Trigger fonksiyonları `kv_` önekiyle başlar.

### 2.4 Silme kuralları

| Veri | Silme şekli | FK davranışı |
|---|---|---|
| Kullanıcı | Hard delete yok. `status` + `deleted_at` | Kullanıcıya bağlı içerik `RESTRICT` |
| Anket, yorum | Soft delete: `status = REMOVED` + `deleted_at` | `RESTRICT`; anket silinmez, gizlenir |
| Oy | Silinmez. Geçersiz sayılırsa `invalidated_at` dolar (§5.4) | `RESTRICT` |
| Oy geçmişi (`vote_events`) | Asla silinmez/güncellenmez (trigger) | `RESTRICT` |
| Session, auth token | Hard delete (süresi dolunca temizlenir) | Kullanıcıdan `CASCADE` |
| Join tabloları (etiket, galeri, beğeni) | Hard delete | Üst kayıttan `CASCADE`; medyaya `RESTRICT` |
| Snapshot, trend skoru | Yeniden hesaplanabilir türev veri | Ankete `CASCADE` |
| Seçenek | Anketle birlikte; ilk geçerli oydan sonra silinemez (§6) | Ankete `CASCADE`, oydan `RESTRICT` |

Varsayılan kural `RESTRICT`'tir. `CASCADE` sadece yukarıdaki türev ve join tablolarında kullanılır. `SET NULL` sadece `users.avatar_media_id`'de var (avatar görseli kaldırılırsa).

### 2.5 Sayaçlar
- `polls.vote_count`, `poll_options.vote_count`, `polls.comment_count`, `polls.save_count`, `comments.like_count` ve `comments.reply_count` denormalize sayaçlardır. Feed ve sonuç ekranları bunları okur.
- Sayaç, olayı yazan işlemle **aynı transaction'da** güncellenir (§5.3). Hepsi `>= 0` CHECK kısıtına sahiptir.
- Sayaçların kaynağı her zaman ham tablodur. Tutarsızlık şüphesinde sayaç ham tablodan yeniden hesaplanır (KV-43).
- `save_count`'u Mehmet'in bookmark modülü günceller. Kolon çekirdekte olduğu için değişikliklerde Faruk bilgilendirilir.

---

## 3. ER diyagramı

### 3.1 Çekirdek ve trend (bu migration)

```mermaid
erDiagram
  users ||--o{ sessions : "oturum"
  users ||--o{ auth_tokens : "doğrulama/sıfırlama"
  users ||--o{ polls : "author_id"
  users ||--o{ votes : "user_id"
  users ||--o{ vote_events : "user_id"
  users ||--o{ comments : "author_id"
  users ||--o{ comment_reactions : "user_id"
  media_assets |o--o{ users : "avatar_media_id"

  categories ||--o{ polls : "category_id"
  communities |o--o{ polls : "community_id (opsiyonel)"
  polls ||--|{ poll_options : "2-6 seçenek"
  polls ||--o{ poll_tags : ""
  tags ||--o{ poll_tags : ""
  polls ||--o{ poll_media : "galeri"
  media_assets ||--o{ poll_media : "media_id"
  polls ||--o{ poll_addenda : "tarihli açıklama"

  polls ||--o{ votes : ""
  poll_options ||--o{ votes : "(poll_id, option_id)"
  votes ||--|{ vote_events : "append-only geçmiş"
  poll_options |o--o{ vote_events : "from / to"

  polls ||--o{ comments : ""
  comments |o--o{ comments : "(poll_id, parent_id) tek seviye"
  comments ||--o{ comment_reactions : "LIKE / DISLIKE"

  polls ||--o{ poll_daily_snapshots : "İstanbul günü"
  poll_daily_snapshots ||--|{ poll_option_daily_snapshots : ""
  poll_options ||--o{ poll_option_daily_snapshots : "(poll_id, option_id)"
  trend_runs ||--o{ trend_scores : ""
  polls ||--o{ trend_scores : ""

  users {
    uuid id PK
    varchar email_normalized UK
    varchar username_normalized UK
    user_status status
    uuid avatar_media_id FK
    timestamptz deleted_at
  }
  polls {
    uuid id PK
    varchar public_id UK
    uuid author_id FK
    uuid category_id FK
    uuid community_id FK
    content_status status
    results_visibility results_visibility
    timestamptz opens_at
    timestamptz closes_at
    timestamptz first_valid_vote_at "kilit"
    int vote_count
  }
  poll_options {
    uuid id PK
    uuid poll_id FK
    smallint position "0-5, UK(poll_id)"
    int vote_count
  }
  votes {
    uuid id PK
    uuid poll_id FK "UK(poll_id,user_id)"
    uuid option_id FK
    uuid user_id FK
    timestamptz invalidated_at
    varchar invalidation_reason
  }
  vote_events {
    uuid id PK
    uuid vote_id FK
    vote_event_type type
    uuid from_option_id FK
    uuid to_option_id FK
    timestamptz occurred_at
  }
  comments {
    uuid id PK
    uuid poll_id FK
    uuid parent_id FK
    comment_kind kind
    content_status status
  }
  poll_daily_snapshots {
    uuid poll_id PK
    date local_date PK
    smallint poll_day "UK(poll_id)"
    timestamptz cutoff_at
    int total_valid_votes
  }
  media_assets {
    uuid id PK "iskelet - Mert"
    media_status status
  }
  communities {
    uuid id PK "iskelet - Mert"
    content_status status
  }
```

### 3.2 Diğer sahiplerin planlanan ilişkileri (henüz tablo yok)

Bu diyagram sözleşmedir: tablolar sahiplerinin migration'larında açılır, ama FK'lerin yönü burada sabitlenir.

```mermaid
erDiagram
  users ||--o{ community_memberships : "Mert · KV-31"
  communities ||--o{ community_memberships : ""
  media_assets }o--|| users : "uploader_id · Mert · KV-16"
  reports }o--o| polls : "Mert · KV-24"
  reports }o--o| comments : ""
  reports }o--o| media_assets : ""
  reports }o--o| users : "raporlanan kullanıcı"
  users ||--o| user_roles : "Utku · KV-12 · granted_by_id da users"
  users ||--o{ sanctions : "Utku · KV-12 · created_by_id, lifted_by_id da users"
  users ||--o{ audit_logs : "actor_id · Utku · KV-39"
  users ||--o{ notifications : "Utku · KV-21"
  users ||--o{ bookmarks : "Mehmet · KV-22"
  polls ||--o{ bookmarks : ""
  polls ||--o{ decision_updates : "Mehmet · KV-23"
  polls ||--o{ poll_follows : "Mehmet · KV-23"
  polls ||--o{ featured_placements : "Mehmet · KV-42"
  users ||--o{ user_interests : "Mehmet · KV-15"
  categories ||--o{ user_interests : ""
```

---

## 4. Tablo özeti (çekirdek)

| Tablo | Unique / anahtar | Önemli index'ler | Not |
|---|---|---|---|
| `users` | `email_normalized`, `username_normalized` | `status` | Normalizasyon (lower, trim) KV-09'da. Kullanıcı adı karakter kuralı KV-09'da |
| `sessions` | `token_hash` | `user_id`, `expires_at` | Token DB'de değil, `sha256(token + pepper)` saklanır |
| `auth_tokens` | `token_hash` | `(user_id, purpose)` | Tek kullanımlık: `used_at` |
| `categories` | `slug` | `(is_active, sort_order)` | Admin ekranı Mehmet'te, API Faruk'ta |
| `tags`, `poll_tags` | `slug` · PK `(poll_id, tag_id)` | `tag_id` | |
| `polls` | `public_id` | `(status, created_at)`, `(category_id, status, created_at)`, `(community_id, status, created_at)`, `(author_id, created_at)`, `(status, vote_count)`, `closes_at`, `(opens_at DESC, id DESC)` (KV-27 aday havuzu, "Yeni" sekmesi; migration `20260930203000_mehmet_kv15_user_interests`) | CHECK: sayaçlar ≥ 0, `closes_at > opens_at`, fiyat ve para birimi birlikte. **#66:** `kind` POLL/DISCUSSION; `polls_kind_shape_check` (anket: `closes_at` ve `results_visibility` dolu; tartışma: ikisi ve `closed_at` boş); `kind` değişmez (`polls_kind_immutable`); tartışmaya seçenek/oy yazılamaz (`poll_options_check_kind`, `votes_check_kind` → `KV_NOT_A_POLL`); `like_count` / `dislike_count` |
| `poll_options` | `(poll_id, position)`, `(poll_id, id)` | | CHECK: `position` 0–5. En az 2 seçenek uygulamada |
| `poll_addenda` | | `(poll_id, created_at)` | Kilitli ankete bilgi eklemenin tek yolu |
| `poll_media` | PK `(poll_id, media_id)`, `(poll_id, position)` | `media_id` | Görsel sayısı sınırı admin ayarından (KV-40) |
| `votes` | **`(poll_id, user_id)`** | `(poll_id, option_id)`, `(poll_id, created_at, invalidated_at)` (KV-27 "Senin İçin" sinyalleri, index-only sayım; migration `20260930203000_mehmet_kv15_user_interests`), `(user_id, created_at)` | Bileşik FK `(poll_id, option_id) → poll_options(poll_id, id)` |
| `vote_events` | | `(poll_id, occurred_at)`, `(vote_id, occurred_at)`, `(user_id, occurred_at)` | Append-only; tür başına biçim CHECK'i |
| `comments` | `(poll_id, id)` | `(poll_id, parent_id, created_at)`, `(poll_id, kind, like_count)`, `(author_id, created_at)` | Bileşik FK ile cevap aynı ankette; trigger ile tek seviye |
| `comment_reactions` | PK `(comment_id, user_id)` | `user_id` | `value` LIKE/DISLIKE; `comment_likes`'ın yerine (KV-17). Sayaçlar `comments.like_count` / `dislike_count` |
| `poll_reactions` | PK `(poll_id, user_id)` | `user_id` | Gönderi (anket veya tartışma) beğeni/dislike'ı, anket oyundan ayrı (#66). Sayaçlar `polls.like_count` / `dislike_count`, gönderi satırı kilitlenerek aynı transaction'da |
| `poll_revisions`, `comment_revisions` | `(poll_id, version)`, `(comment_id, version)` | | İçerik sürüm geçmişi (#66): her oluşturma/düzenlemede `kv_poll_snapshot` / `kv_comment_snapshot` anlık görüntüsü, editör ve zaman. Append-only trigger; okuma ADMIN+ |

---

## 5. Oy bütünlüğü

### 5.1 Tek aktif oy
- `votes` tablosunda **`UNIQUE (poll_id, user_id)`** var. Bir kullanıcının bir ankette tek oy satırı olabilir. Aynı istek iki kez gelirse veya eşzamanlı 20 istek gelirse (KV-11 kabul koşulu) biri kazanır, diğerleri `23505` (Prisma `P2002`) alır. Uygulama bu hatayı yakalayıp mevcut oyu döner; böylece işlem idempotent olur.
- Oy değiştirmek yeni satır eklemez; aynı satırın `option_id` alanı güncellenir ve `change_count` artar. Oy değiştirmeye izin verilip verilmeyeceği sistem ayarıyla belirlenir (KV-11 / KV-40).
- **Bileşik FK** `(poll_id, option_id) → poll_options(poll_id, id)`: Oy başka bir anketin seçeneğine bağlanamaz.
- Trigger `votes_guard_identity`: Bir oy satırının `poll_id` ve `user_id` alanları sonradan değiştirilemez.

### 5.2 Oy geçmişi (`vote_events`)
Her oy işlemi `votes` tablosuna yazılır ve aynı transaction'da `vote_events` tablosuna bir satır eklenir:

| `type` | Ne zaman | `from_option_id` | `to_option_id` |
|---|---|---|---|
| `CAST` | İlk oy | — | seçilen |
| `CHANGE` | Oy değişimi | eski | yeni (eskisinden farklı) |
| `INVALIDATE` | KV-43 geçersiz sayma | geçersiz sayılan | — |
| `RESTORE` | Geçersiz sayma geri alınırsa | — | geri gelen |

Bu biçim `vote_events_shape_check` ile zorunludur. Tablo **append-only**'dir: trigger `vote_events_append_only`, UPDATE ve DELETE işlemlerini reddeder. Snapshot'lar ve "Haftanın Değişkenleri" bu geçmişten geriye dönük olarak yeniden üretilebilir (§8).

### 5.3 Sayaçlarla aynı transaction
KV-11'in uygulayacağı akış:

```sql
BEGIN;
-- 1) Yeni oy
INSERT INTO votes (id, poll_id, option_id, user_id, ...) VALUES (...);   -- çakışırsa 23505 → mevcut oy döner
INSERT INTO vote_events (..., type) VALUES (..., 'CAST');
UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = :option;
UPDATE polls        SET vote_count = vote_count + 1 WHERE id = :poll;
COMMIT;

-- 2) Oy değişimi: votes satırı FOR UPDATE ile kilitlenir, poll toplamı değişmez
UPDATE poll_options SET vote_count = vote_count - 1 WHERE id = :old;
UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = :new;
```

Anket açık mı kontrolü (`opens_at <= now() < LEAST(closes_at, closed_at)` ve `status = ACTIVE`) aynı transaction'da, anket satırı okunarak yapılır (KV-11).

### 5.4 Geçersiz oy (KV-43)
- `votes.invalidated_at` ve `votes.invalidation_reason` birlikte dolar veya birlikte boş kalır (`votes_invalidation_check`). İşlemi kimin yaptığı `vote_events.actor_id`'de tutulur (KV-43; `vote_events_actor_check`: INVALIDATE/RESTORE'da aktör ve gerekçe zorunlu, CAST/CHANGE'de aktör yok). Audit tablosu (KV-39, Utku) gelince işlem oraya da yazılır.
- Geçersiz sayma adımları: `invalidated_at` dolar, `vote_events`'e `INVALIDATE` satırı eklenir ve iki sayaç (`poll_options.vote_count`, `polls.vote_count`) 1 azaltılır. Hepsi tek transaction'da yapılır. İşlem `WHERE invalidated_at IS NULL` ile yazılır, böylece aynı oyu ikinci kez geçersiz saymak çift düşüm yapmaz (KV-43 kabul koşulu).
- **Geçersiz oy hiçbir yerde sayılmaz:** sayaçlar, sonuç yüzdeleri, trend puanları ve snapshot'lar sadece `invalidated_at IS NULL` olan oyları kullanır.
- Unique kısıt `(poll_id, user_id)` olmaya devam eder. Oyu geçersiz sayılan kullanıcı o ankete yeniden oy veremez; bu bilinçli bir karardır.
- Ban tek başına geçmiş oyları geçersiz yapmaz (KV-43). Geçersiz sayma her zaman ayrı ve gerekçeli bir işlemdir.
- **Geri alma (RESTORE):** `invalidated_at` boşalır, `vote_events`'e aktörlü ve gerekçeli `RESTORE` eklenir, sayaçlar 1 artar. Geri gelen geçerli oy anketi kilitler (`first_valid_vote_at` boşsa dolar).
- **Geçmiş düzeltmesi (KV-43):** İşlem `polls.snapshots_stale_since`'i etkilenen oyun ilk verildiği ana çeker. Worker (`trends.refresh` her 5 dk, `snapshots.daily`) o günden anketin kapanışına veya düne kadar günlük snapshot'ları `vote_events`'ten yeniden üretir ve işareti temizler. Satırın `calculation_version`'ı hesap formülünün sürümüdür ve değişmez; düzeltme `computed_at` ile ve nedeni `vote_events` INVALIDATE/RESTORE kaydıyla (aktör, gerekçe, zaman) açıklanır. Trendler bir sonraki çalıştırmada zaten geçersiz oyu saymaz.
- API: `admin.votes.invalidate` / `admin.votes.restore` (ADMIN+). Ayrıntı: [`KV-43_VOTE_INVALIDATION.md`](./KV-43_VOTE_INVALIDATION.md).

---

## 6. İlk geçerli oydan sonra anket kilidi

**Kural:** Anket ilk geçerli oyu aldıktan sonra **başlık (soru), açıklama (`description`), seçenekler ve `results_visibility`** değiştirilemez (KV-10 kabul koşulu; açıklama kararı Faruk, 2026-09-27). Kural uygulama kontrolüne bırakılmaz, DB trigger'ı ile korunur. Sonradan bilgi eklemenin tek yolu `poll_addenda`'dır (tarihli ek açıklama).

| Parça | Ne yapar |
|---|---|
| `polls.first_valid_vote_at` | Kilit bayrağı. Geçerli (`invalidated_at IS NULL`) ilk oy eklenince `votes_mark_first_valid` trigger'ı bir kez doldurur. |
| `polls_guard_locked` (BEFORE UPDATE ON polls) | Kilitli ankette `title`, `description` veya `results_visibility` değişirse (boşaltmak dahil), ya da `first_valid_vote_at` değiştirilmeye/boşaltılmaya çalışılırsa hata verir. |
| `poll_options_guard_locked` (BEFORE INSERT/UPDATE/DELETE ON poll_options) | Kilitli ankette seçenek eklenemez, silinemez; `label` ve `position` değişemez. Sadece `vote_count` güncellemesi serbesttir. |

- **Hata biçimi:** `SQLSTATE P0001`, mesaj `KV_POLL_CONTENT_LOCKED: ...` ile başlar. API bunu `409 POLL_CONTENT_LOCKED` hatasına çevirir (KV-03).
- **Kilit kalıcıdır:** Sonradan bütün oylar geçersiz sayılsa bile kilit açılmaz, çünkü insanlar o soruyu görüp oy vermiştir.
- **Kilidin kapsamı dışında kalanlar:** Fiyat, ek bilgi (`extra_info`), kategori, yorum ayarları, erken kapanış (`closed_at`) ve sayaçlar kilitlenmez. Kilitli ankete bilgi eklemek için `poll_addenda` kullanılır; ekler tarihle birlikte gösterilir, asıl metin değişmez.

**Yarış durumu:** İlk oy ile seçenek düzenlemesi aynı anda gelebilir.
- Oy tarafındaki trigger `polls` satırını `UPDATE` ile kilitler.
- Seçenek trigger'ı aynı satırı `SELECT ... FOR SHARE` ile okur.

Bu yüzden iki işlem sıraya girer. Önce oy commit olursa seçenek düzenlemesi kilidi görür ve reddedilir. Önce seçenek düzenlemesi commit olursa oy, düzenlenmiş seçeneklerle kaydedilir. Başlık düzenlemesi için de aynısı geçerli: PostgreSQL, bekleyen `UPDATE`'i güncel satır üzerinde yeniden değerlendirir ve trigger kilitli satırı görür.

---

## 7. Durum geçişleri

### 7.1 İçerik (`content_status`: anket, yorum; iskelette topluluk)

| Durum | Anlamı | Kim geçirebilir |
|---|---|---|
| `ACTIVE` | Normal yayında | varsayılan |
| `UNDER_REVIEW` | Moderasyon bekliyor, sadece sahibi ve moderatör görür | sistem (görsel riski, rapor eşiği), moderatör |
| `HIDDEN` | Geçici olarak gizli | moderatör, admin |
| `LOCKED` | Görünür ama yeni yorum ve düzenleme yok. Oy davranışı KV-11'de netleşecek | moderatör, admin |
| `REMOVED` | Yayından kaldırıldı (soft delete, `deleted_at` dolu) | sahibi (kendi içeriği), moderatör, admin |

```
ACTIVE ──► UNDER_REVIEW ──► ACTIVE | REMOVED
ACTIVE ──► HIDDEN ──► ACTIVE | REMOVED
ACTIVE ──► LOCKED ──► ACTIVE | REMOVED
ACTIVE ──► REMOVED ──► ACTIVE   (sadece admin geri yükler; sahip geri alamaz)
```

- **Anketin kapalı olması bir durum değildir.** Etkin kapanış zamanı `LEAST(closes_at, closed_at)`'tir. Kapalı ama `ACTIVE` bir anket görünür kalır, sadece oy almaz.
- Geçişlerin yetki kontrolü API'de ve Utku'nun RBAC katmanında yapılır (KV-04/KV-12). Her moderasyon geçişi audit'e yazılır (KV-39). DB sadece geçerli enum değerlerini zorunlu kılar.

### 7.2 Kullanıcı (`user_status`)

| Durum | Anlamı |
|---|---|
| `ACTIVE` | Normal |
| `RESTRICTED` | Belirli işlemler kapalı (yorum veya anket açma); ayrıntısı Utku'nun `sanctions` kayıtlarında |
| `SUSPENDED` | Süreli uzaklaştırma; giriş yapamaz |
| `BANNED` | Kalıcı; giriş yapamaz |

```
ACTIVE ⇄ RESTRICTED
ACTIVE | RESTRICTED ──► SUSPENDED ──► ACTIVE   (süre bitince veya admin kaldırınca)
ACTIVE | RESTRICTED | SUSPENDED ──► BANNED ──► ACTIVE   (sadece admin kaldırır)
```

- Kullanıcı `SUSPENDED` veya `BANNED` durumuna geçtiğinde aynı transaction'da açık oturumları iptal edilir (`sessions.revoked_at`) (TECH_DECISIONS §3.4).
- `users.status` hızlı kontrol için bir özettir. Yaptırımın kaynağı, süresi ve gerekçesi Utku'nun `sanctions` tablosundadır.
- Hesap silme (`deleted_at`): Kişisel alanlar anonimleştirilir, içerik ve oylar korunur. KVKK ayrıntısı açık konudur (§11).

---

## 8. Snapshot ve pencereler (Europe/Istanbul)

Haftanın Değişkenleri (KV-29) için pencereler **anketin açılışından itibaren, Europe/Istanbul takvim günleriyle** tanımlanır.

> **Onaylandı:** Mehmet, PR #63 incelemesinde 2026-09-27 tarihinde Europe/Istanbul takvim günü yaklaşımını kabul etti. Açılış günü kısmi gün, pencere sonları İstanbul gece yarısıdır; tam 168 saatlik kayan pencere kullanılmaz.

### 8.1 Tanımlar
- `open_local_date = (polls.opens_at AT TIME ZONE 'Europe/Istanbul')::date`: Anketin açıldığı İstanbul günü.
- `poll_day = local_date - open_local_date`: 0'dan başlar. Açılış günü `poll_day = 0`'dır.
- **Gün sonu (cutoff):** `cutoff_at = (local_date + 1)` günü saat 00:00, Europe/Istanbul. UTC olarak saklanır; bugünkü kurallarla bu önceki günün 21:00 UTC'sidir, ama hesap her zaman `AT TIME ZONE` ile yapılır.
- **Pencere k** (k = 1, 2, …): `poll_day` değeri `7(k−1)` ile `7k−1` arasında olan günler. Pencere k'nın sonu, `poll_day = 7k−1` gününün `cutoff_at` anıdır.

### 8.2 Snapshot bu pencerelerle nasıl eşleşir
- `poll_daily_snapshots`: Her (anket, İstanbul günü) için bir satır. `poll_option_daily_snapshots` aynı gün için seçenek bazındaki geçerli oy sayılarını tutar.
- Bir satır, o günün **`cutoff_at` anındaki** dağılımı gösterir. Yani pencere sonu ile gün sonu snapshot'ı **aynı andır**, ara değer hesaplamak gerekmez:
  - Pencere 1'in sonu = `poll_day = 6` snapshot'ı
  - Pencere 2'nin sonu = `poll_day = 13` snapshot'ı
  - Haftanın Değişkenleri = snapshot(`7k−1`) ile snapshot(`7(k−1)−1`) karşılaştırması
- `(poll_id, poll_day)` unique olduğu için bir pencere sonuna tek satır düşer.
- **Hesaplama kaynağı `vote_events`'tir, `votes` değil.** Job her kullanıcının `cutoff_at` anından önceki son olayını bulur. Son olay `CAST`, `CHANGE` veya `RESTORE` ise kullanıcı `to_option_id` seçeneğine sayılır, `INVALIDATE` ise sayılmaz. Buna ek olarak, şu an `votes.invalidated_at` dolu olan oylar hiç sayılmaz (§5.4: geçersiz oy hiçbir yerde sayılmaz). Sonuç olarak:
  - Job geç çalışsa bile sonuç o anın dağılımıdır.
  - Job tekrar çalışabilir; `(poll_id, local_date)` üzerine upsert yapar (KV-29: "tekrar çalışan job").
  - Oy değiştiren kişi bir kez sayılır, çünkü kullanıcı başına son olay alınır (KV-29: "tekrar oy değişimi kişi sayısını büyütmüyor").
  - KV-43 bir oyu geçersiz sayarsa veya geri alırsa, ilgili günler yeniden üretilir (§5.4 "Geçmiş düzeltmesi").
- **Eksik geçmiş uydurulmaz:** Bir gün için satır yoksa o gün hesaplanmamıştır; ara değer (interpolasyon) yapılmaz. Eksik gün `vote_events`'ten tam olarak yeniden hesaplanabiliyorsa bu uydurma sayılmaz. `vote_events`'ten önceki bir döneme (sistem öncesi) ait snapshot üretilmez.
- **Zamanlama:** `snapshots.daily` job'u her gün 00:05 Europe/Istanbul'da (`DAILY_SNAPSHOT_CRON`) bir önceki İstanbul günü için çalışır. Açık olan ve son 24 saatte kapanmış anketleri işler.

### 8.3 Sınırlar ve örnekler
- **Açılış günü eksik bir gündür.** Anket 14:37'de açıldıysa `poll_day = 0` sadece 9,5 saat sürer. Karşılığında bütün pencere sınırları takvimdeki gece yarısına denk gelir ve ekranda "1–7 Ekim" gibi okunabilir tarihler gösterilebilir. Açılıştan itibaren tam 168 saatlik pencereler reddedildi, çünkü günlük snapshot'larla aynı ana düşmezler.
- **14 günlük anket** 2 tam pencere içerir (günler 0–13). **30 günlük anket** 4 tam pencere artı yarım bir 5. pencere içerir; yarım pencere karşılaştırmaya girmez.
- **Eşikler:** Her iki pencere sonunda en az 30 geçerli oy ve ikinci pencerede en az 10 benzersiz aktif hesap gerekir. Bunlar varsayılan değerlerdir ve admin ayarıdır (KV-29, KV-40). "Aktif hesap" = pencere içinde `CAST`, `CHANGE` veya `RESTORE` olayı olan farklı `user_id` sayısı; sorguyla hesaplanır, snapshot'ta tutulmaz.
- Türkiye 2016'dan beri sabit UTC+3'te ve yaz saati uygulanmıyor. Yine de testler `AT TIME ZONE` kullanır ve UTC gün sınırı ile İstanbul gün sınırının farklı olduğu durumu kapsar (KV-29: "UTC/İstanbul sınırları testli").

### 8.4 Trend çalıştırmaları
- `trend_runs`: 5 dakikalık job her format için bir satır açar (`RUNNING` → `SUCCEEDED` / `FAILED`) ve `calculation_version` ile `window_start`/`window_end` alanlarını yazar.
- `trend_scores`: O çalıştırmanın sıralaması. `components` (JSON) alanı puanın bileşenlerini tutar, böylece puan açıklanabilir olur.
- Ekranlar her format için **en son `SUCCEEDED`** çalıştırmayı okur. Yarım kalan bir çalıştırma ekrana yansımaz. Eski çalıştırmaların temizlenme süresi KV-28'de belirlenecek.

---

## 9. Diğer sahiplerle ilişki sözleşmesi

| Sahip | Tablo (planlanan) | Çekirdeğe bağlantısı | Kural |
|---|---|---|---|
| Mert | `media_assets` (KV-16) | `users.avatar_media_id`, `poll_media.media_id` ona bağlanır; `uploader_id`, `reviewed_by_id → users.id` | Anket ve profilde sadece `status = APPROVED` görseller gösterilir (sorgu kuralı). `public_object_key` sadece `APPROVED` iken dolu olabilir (`media_assets_public_key_check`) |
| Mert | `communities`, `community_memberships` (KV-31) | `polls.community_id` ona bağlanır; üyelik PK'si `(community_id, user_id)`; `created_by_id → users.id`, `image_media_id → media_assets.id` | Topluluk kapatılsa (`status = HIDDEN`, `admin.communities.update` sözleşmesi) bile anketler silinmez (`RESTRICT`). Topluluk moderatörlüğü `community_memberships.role = MODERATOR`'dır; yetki istemciden değil bu satırdan okunur. `member_count` üyelikle aynı transaction'da güncellenir |
| Mert | `banned_media_hashes` (KV-38) | Reddedilmiş görselin sha256 + dHash'i, kanıt görsel `source_media_id` (Restrict; görsel silinemez). En az bir parmak izi ve biçim CHECK'leri; sha256 ve kanıt görsel başına tek kayıt. `media_assets.perceptual_hash` worker tarafından yazılır | Worker birebir eşleşmeyi reddeder, yakın eşleşmeyi incelemeye alır (docs/MEDIA_MODERATION.md §10) |
| Mert | `reports`, `moderation_actions` (KV-24) | Hedef başına ayrı nullable FK: `poll_id`, `comment_id`, `media_id`, `reported_user_id` / `target_user_id`, ve "tam olarak biri dolu" CHECK'i | Tek `target_type`/`target_id` çifti FK bütünlüğünü kaybettirdiği için önerilmez. Kullanıcı + hedef başına tek satır (unique); kapanmış raporun sahibi yeniden raporlarsa aynı satır `OPEN`'a döner (`reports.create` sözleşmesi). `moderation_actions` append-only (trigger), gerekçe zorunlu. Karar güncellemesi raporu için FK, KV-23 tablosu açılınca eklenir |
| Utku | `user_roles`, `sanctions` (KV-12) | `user_id`, `granted_by_id`, `created_by_id`, `lifted_by_id → users.id`, hepsi `RESTRICT` | Ayrıntı ve servis kuralları §9.1. Yaptırım `users.status`'u da günceller (§7.2) |
| Utku | `audit_logs` (KV-39) | `actor_id → users.id` (`RESTRICT`, NULL = sistem); hedef `target_type` + `target_id` | Append-only (trigger); polimorfik hedef burada kabul edilir. Ayrıntı §9.2 |
| Utku | `system_settings` | — | Oy değiştirme izni, trend katsayıları, snapshot eşikleri buradan okunur |
| Utku | `notifications`, `notification_preferences` | `users.id` | Olayları çekirdek modüller üretir (KV-04 olay zarfı) |
| Mehmet | `bookmarks` | `(user_id, poll_id)` PK | `polls.save_count`'u aynı transaction'da günceller |
| Mehmet | `decision_updates`, `poll_follows` | `polls.id`; seçim için `(poll_id, option_id) → poll_options(poll_id, id)` bileşik FK | Seçenek başka ankete ait olamaz |
| Mehmet | `featured_placements`, `announcements` | `polls.id` | Öne çıkarma organik trend puanını değiştirmez |
| Mehmet | `user_interests` | PK `(user_id, category_id)`; `user_id → users` CASCADE, `category_id → categories` RESTRICT; index `category_id` | KV-15 (#17), migration `20260930203000_mehmet_kv15_user_interests`. KV-27 "Senin İçin" feed'i ilgi sinyali olarak okur |

Seçenek (`poll_options`) veya yorum bağlayan her tablo, bileşik FK için hazır olan `(poll_id, id)` unique anahtarlarını kullanır.

### 9.1 Rol ve yaptırım (Utku, KV-12)

Şema `admin.prisma`, kısıtlar `…_utku_kv12_admin_roles_sanctions` migration'ının elle yazılan bölümündedir. Enum değerleri contracts `Role` ve `SanctionType` ile birebir ve aynı sıradadır; test değerleri sözleşmeden import ederek karşılaştırır.

**Silme:** `users`'a giden beş FK de `RESTRICT`'tir (`CASCADE`/`SET NULL` yok). Kullanıcı soft delete edildiği için rol ve yaptırım izi korunur; `granted_by_id` ve `created_by_id`/`lifted_by_id` boşaltılmaz.

**DB'nin zorladığı kurallar**

| Kural | Kısıt |
|---|---|
| Kullanıcı başına tek rol; satır yoksa USER, `USER` satırı yazılmaz | PK `user_id`, `user_roles_not_user_check` |
| Kimse kendi rolünü atayamaz | `user_roles_not_self_check` |
| Veren (`granted_by_id`) sadece ilk SUPER_ADMIN'de boş olabilir | `user_roles_bootstrap_check` |
| `ends_at` NULL (kalıcı) ya da `starts_at`'ten sonra | `sanctions_period_check` |
| `SUSPEND` süreli (`ends_at` dolu), `BAN` kalıcı (`ends_at` NULL) | `sanctions_suspend_ends_check`, `sanctions_ban_permanent_check` |
| Kimse kendine yaptırım uygulayamaz ve kendi yaptırımını kaldıramaz (KV-04 §4.1) | `sanctions_not_self_check`, `sanctions_lift_not_self_check` |
| Gerekçe ve kaldırma gerekçesi en az 3 anlamlı karakter; kaldırma alanları üçü birlikte dolar | `sanctions_reason_check`, `sanctions_lift_check` |
| Yaptırım silinemez ve güncellenemez; sadece `lifted_at`/`lifted_by_id`/`lift_reason` bir kez NULL'dan doluya geçer | trigger `sanctions_guard` → `KV_SANCTIONS_IMMUTABLE` |

Aktif yaptırım: `lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())`; index `(user_id, lifted_at, ends_at)` (partial index değil, §10.4).

**Servis kuralları (DB'de korunamaz; RBAC katmanı KV-12 PR-B, yaptırım servisi KV-33)**
- **Okuma:** API her istekte rolü ve aktif yaptırımları bu tablolardan, topluluk moderatörlüğünü `community_memberships`'ten okur (`apps/api/src/modules/rbac`); önbellek yoktur. Rol/yaptırım değişikliği açık oturumda bir sonraki istekte etkilidir. `SUSPEND`/`BAN` etkisi `users.status`'tan gelir (tek otorite); `RESTRICT_*` satırdan gelir.
- **`starts_at` her zaman yazma anıdır;** ileri tarihli yaptırım yoktur (sözleşmede alan yok). Aktiflik bu yüzden `starts_at`'e bakmaz.
- **`users.status` senkronu:** Yaptırım ekleme ve kaldırma aynı transaction'da `users.status`'u kalan aktif yaptırımlardan yeniden hesaplar: `BAN` > `SUSPEND` > `RESTRICT_*` → `RESTRICTED` > `ACTIVE` (`WARNING` durumu değiştirmez). `SUSPEND`/`BAN` açık oturumları iptal eder (§7.2). Süre dolumu zamana bağlı olduğu için trigger yakalayamaz; süresi dolan `SUSPEND`/`RESTRICT_*` için durumu yeniden hesaplayan bir job gerekir (KV-33, Utku). `authorize` süresi dolan `RESTRICT_*`'ı zaten yok sayar, ama `users.status = SUSPENDED` job çalışana kadar kalır. **Bilinen sonuç:** giriş kontrolü (`auth.login`) de `users.status`'a baktığı için job olmadan süresi dolan SUSPEND'li kullanıcı giriş yapamaz ve açık oturumu da 403 alır. Yaptırım endpoint'leri de KV-33'te geldiği için bu durum şu an oluşamaz; job KV-33'te birlikte gelir.
- **İlk SUPER_ADMIN:** Hiç SUPER_ADMIN yokken yalnız `admin:bootstrap` CLI'ı yazar; "tek bir kez" kuralı DB'de değil CLI'dadır (`user_roles_bootstrap_check` verensiz satırı her SUPER_ADMIN'e izin verir). Ayrıntı: [`KV-12_ADMIN_BOOTSTRAP.md`](./KV-12_ADMIN_BOOTSTRAP.md), §11.4/6.
- **Son aktif SUPER_ADMIN:** Aktiflik `users.status`'a bağlı olduğu ve eşzamanlı iki işlem (iki SUPER_ADMIN'in birbirini aynı anda düşürmesi veya yaptırıma bağlaması) sayımı birlikte geçebileceği için DB kuralı değildir. `admin.roles.put` ve SUPER_ADMIN hedefli `SUSPEND`/`BAN`, transaction içinde önce `SELECT … FROM user_roles WHERE role = 'SUPER_ADMIN' FOR UPDATE` ile kilit alır, sonra `users.status = 'ACTIVE'` olanları sayar.
- **Yetki:** Admin hedefe yaptırımın SUPER_ADMIN gerektirmesi, rol atamanın sadece SUPER_ADMIN'e açık olması `authorize` kuralıdır (KV-04), DB'de değildir.
- **Aynı tipte birden çok aktif yaptırım** DB'de engellenmez (unique index süresi dolmuş ama kaldırılmamış satırlar yüzünden yanlış reddederdi); servis mevcut aktif yaptırımı kontrol eder.
- **Lift idempotency:** `admin.sanctions.lift` "natural" idempotent'tir; zaten kaldırılmış yaptırımda servis mevcut satırı döner, DB'ye ikinci kaldırma yazmaz (yazarsa `KV_SANCTIONS_IMMUTABLE`).

**Sözleşme (contracts 1.8.0):** `dbErrorMap`'te `KV_SANCTIONS_IMMUTABLE → INTERNAL_ERROR` (kod hatası: loglanır, 500). `admin.sanctions.create` gövdesi `SUSPEND` için `endsAt` ister, `BAN` için `endsAt: null` ister; DB kısıtlarıyla (`sanctions_suspend_ends_check`, `sanctions_ban_permanent_check`) aynıdır.

### 9.2 Audit (Utku, KV-39)

Şema `admin.prisma` (`AuditLog`, enum `audit_source`), kısıtlar ve trigger `…_utku_kv39_audit_logs` migration'ının elle yazılan bölümündedir. Sözleşme: `packages/contracts/src/audit.ts`. Yazıcı: `apps/api/src/modules/audit/write.ts` (`writeAudit(tx, entry)`).

**Aynı transaction (KV-04 §4.4):** Kritik işlem audit kaydını kendi transaction'ının içinden yazar; olay tüketicisi veya ayrı transaction yoktur. İşlem geri alınırsa kayıt da yoktur; kayıt doğrulanamazsa (ör. gerekçesiz) `writeAudit` TypeError fırlatır ve işlem de geri alınır.

| Kolon | Anlamı |
|---|---|
| `actor_id` | İşlemi yapan kullanıcı (`users`, `RESTRICT`). NULL = sistem (CLI/worker) |
| `source` | `API` (aktör + `request_id` dolu), `CLI`, `WORKER` (aktör NULL) |
| `action` | KV-04 işlem kimliği (`actions`, ör. `user.sanction`) veya sistem işlemi (`systemAuditActions`: `user.status.sync`). Yalnız `auditOperations` haritasındaki katalog işlemleri audit'e yazılabilir. Katalog ve `authorize` audit için değişmez |
| `operation` | İşlemin türü, ayrı sorgulanır: `user.role.assign` → `grant` (USER'a rol verme) \| `revoke` (rolü kaldırıp USER'a düşürme) \| `change` (rolden role geçiş), `vote.invalidate` → `invalidate` \| `restore`, `community.moderator.assign` → `assign` \| `remove`, `category.manage` → `create` \| `update`, moderasyon → `hide`, `restore`, … Audit'li her katalog işleminin izinli değerleri `auditOperations`'ta açıkça yazılıdır; tek değerli işlemde `operation` verilmezse o değer yazılır, çok değerlide zorunludur. Kimliğin son parçası varsayılanı yalnız sistem işlemleri içindir (`user.status.sync` → `sync`). Contracts testi, gerekçesi zorunlu her işlemin ve değiştiren her yönetici endpoint'inin işleminin haritada olduğunu zorlar |
| `target_type`, `target_id` | Polimorfik hedef (`auditTargetTypes`: `USER`, `POLL`, `VOTE`, `SETTING`, …). FK yoktur; `SETTING`'de id ayar anahtarıdır |
| `reason` | `reasonRequiredActions` için zorunlu (servis); varsa en az 3 anlamlı karakter (CHECK) |
| `before`, `after` | Kısa özet: JSON nesnesi veya SQL NULL. Hassas alan yazılmaz (e-posta, parola, token, ip, user agent, oturum, oy seçimi: `…OptionId`); en fazla 4096 karakter (servis) |
| `request_id` | API'de `X-Request-Id` (hata gövdesindeki `requestId` ile aynı) |
| `created_at` | İşlemin zamanı (çağıranın saati; CLI'da DB saati) |

**DB'nin zorladığı kurallar**

| Kural | Kısıt |
|---|---|
| API kaydı aktörlü, CLI/WORKER kaydı aktörsüz | `audit_logs_actor_source_check` |
| API kaydında `request_id` var; boş metin yok | `audit_logs_request_id_check` |
| İşlem kimliği, tür ve hedef tipi biçimi | `audit_logs_action_check`, `audit_logs_operation_check`, `audit_logs_target_check` |
| Gerekçe varsa en az 3 anlamlı karakter; özet nesne veya NULL | `audit_logs_reason_check`, `audit_logs_summary_check` |
| Kayıt silinemez, güncellenemez, tablo boşaltılamaz (SUPER_ADMIN ve uygulama dahil) | trigger `audit_logs_append_only` (UPDATE/DELETE), `audit_logs_no_truncate` → `KV_AUDIT_LOGS_APPEND_ONLY` (`dbErrorMap`: `INTERNAL_ERROR`) |

Hangi işlemin gerekçe istediği, izinli türler ve hassas alan yasağı işleme bağlı olduğu için DB'de değil, contracts `assertAuditEntry`'dedir (API ve worker aynı fonksiyonu kullanır).

**Index'ler:** `(target_type, target_id, created_at)` hedefin geçmişi; `(actor_id, created_at)` yöneticinin işlemleri; `(action, operation, created_at)` işlem türü filtresi; `(created_at)` zaman sıralı liste. Okuma: `AuditStore.list` (keyset, en yeni önce). `admin.audit.list` endpoint'i ayrı PR'dadır (KV-39, PR-B'den sonra).

**Şu an yazanlar:** `admin:bootstrap` (KV-12): `source = CLI`, aktör NULL, `user.role.assign` / `grant` (yeni rol satırı) veya `change` (MODERATOR/ADMIN satırının yükseltilmesi), sabit gerekçe. Diğer kritik işlemler (kategori, moderasyon, medya kararı ve önizleme erişimi, rapor sonuçlandırma, oy geçersiz sayma, sürüm geçmişi okuma) kendi sahiplerinin modüllerinde `writeAudit` ile eklenir; KV-33 admin kullanıcı işlemleri PR-B'de gelir.

**Gerekçe alanı olmayan endpoint'ler:** `community.create`, `community.moderator.assign` (DELETE), `featured.manage`, `announcement.manage` ve `media.ban.manage` (DELETE) gövdede gerekçe istemediği için `reasonRequiredActions`'ta değildir; sözleşmeye gerekçe eklenirse listeye alınır (contracts testi ikisini karşılaştırır).

---

## 10. Migration sözleşmesi

### 10.1 Adlandırma
```
packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_<sahip>_<kv>_<kısa_açıklama>/migration.sql
ör. 20260927160000_faruk_kv02_core_init
    20261001093000_mert_kv16_media_assets
```
Oluşturma: `pnpm --filter @kararver/db exec prisma migrate dev --create-only --name mert_kv16_media_assets`. Zaman damgasını Prisma ekler.

### 10.2 Sahiplik: herkes kendi dosyasını değiştirir
- Schema, sahip başına ayrı dosyalara bölünmüştür (§1). Bir iş sadece kendi `*.prisma` dosyasını değiştirir; **bütün işlerin tek schema dosyasını değiştirmesi gerekmez**.
- Prisma iki taraflı ilişki istediği için, başka dosyadaki bir modele FK veren iş o modele bir ilişki alanı ekler (ör. `bookmarks` için `User.bookmarks Bookmark[]`). Bu tek satırlık ekleme serbesttir, ama PR'a o dosyanın sahibi reviewer olarak eklenir (TECH_DECISIONS §6).
- Bir migration klasörü tek bir sahibe ve tek bir işe aittir. Başkasının tablosunu değiştirmek gerekiyorsa o işin sahibiyle birlikte yapılır.

### 10.3 Sıra ve çakışma
1. Her PR en fazla **bir** migration ekler.
2. Merge etmeden önce `main`'e rebase edilir. `main`'e senin migration'ından daha yeni zaman damgalı bir migration girdiyse, kendi klasörünü silip `prisma migrate dev --create-only` ile yeniden oluşturursun. Böylece zaman damgası sırası `main`'deki uygulama sırasıyla aynı olur.
3. İki PR aynı tabloya dokunuyorsa, sonra merge eden taraf kendi migration'ını güncel `main` üzerinde yeniden üretir.
4. **Merge edilmiş bir migration dosyası asla değiştirilmez.** Düzeltme her zaman yeni bir migration ile yapılır; Prisma checksum'ı değişen dosyayı reddeder.
5. CI (KV-06), her PR'da temiz bir veritabanına `prisma migrate deploy` ile bütün migration'ları uygular. Ayrıca `prisma migrate diff --from-migrations … --to-schema … --exit-code` ile schema ve migration'ların uyuşup uyuşmadığını kontrol eder.

### 10.4 Elle yazılan SQL
- CHECK, trigger, fonksiyon ve extension gibi Prisma'nın bilmediği her şey migration dosyasının **en altında, "ELLE EKLENENLER" bölümünde** yazılır ve yorumla açıklanır.
- Prisma bunları sonraki migration'larda silmeye çalışmaz. **Partial index ve expression index** için bu garanti yok: Prisma bunları schema'da göremez ve sonraki `migrate dev` onları düşürmeye çalışabilir. Böyle bir index gerekirse (ör. KV-26 arama index'leri) önce `migrate dev --create-only` çıktısı kontrol edilir, gerekirse yöntem TECH_DECISIONS'a eklenir.
- Staging ve production'da sadece `prisma migrate deploy` çalışır. `migrate dev` ve `db push` asla kullanılmaz.

---

## 11. Testler, kanıt ve açık konular

### 11.1 DB testlerini çalıştırma

Testler `packages/db/test/db.integration.test.ts` dosyasındadır. Node 24'ün yerleşik test runner'ını ve TypeScript desteğini kullanır; ek paket gerekmez. Herhangi bir PostgreSQL 17 sunucusunda çalışır (docker compose, Windows'a kurulu Postgres, uzak bir sunucu).

```bash
# 1) Bir PostgreSQL sunucusu hazır olsun, ör. local:
docker compose up -d

# 2) Repo kökünden:
pnpm db:test
```

- **Bağlantı:** `TEST_DATABASE_URL` tanımlıysa o kullanılır. Değilse `DATABASE_URL` (ortamdan ya da kökteki `.env`) alınır ve aynı sunucuda **`<veritabanı>_test`** kullanılır. Örneğin `.env.example` ile `kararver_test`.
- **Test veritabanı her çalıştırmada sıfırlanır:** Veritabanı yoksa test onu `CREATE DATABASE` ile oluşturur (kullanıcının CREATEDB yetkisi gerekir; docker compose kullanıcısında var). Sonra `prisma migrate reset --force` ile bütün migration'lar baştan uygulanır.
- **Güvenlik:** Veritabanı adı `_test` ile bitmiyorsa test hiçbir şeye dokunmadan durur. Asıl `kararver` veritabanı etkilenmez.
- **CREATEDB yetkisi yoksa:** Boş bir `..._test` veritabanını elle açıp `TEST_DATABASE_URL` ile verin:
  ```bash
  TEST_DATABASE_URL=postgresql://kullanici:sifre@host:5432/kararver_test pnpm db:test
  ```
- **Sunucu çalışmıyorsa:** Test `PostgreSQL'e bağlanılamadı (...). Sunucu çalışıyor mu?` mesajıyla durur.

### 11.2 Test kapsamı (61 test)

| Grup | Ne doğrulanır |
|---|---|
| Migration | İlk migration temiz veritabanına eksiksiz uygulanır ve 6 trigger oluşur. `prisma migrate diff --from-config-datasource --to-schema --exit-code` fark bulmaz |
| Tek aktif oy | İkinci oy `23505` ile reddedilir. Başka anketin seçeneğine oy FK hatası verir. **Aynı hesaptan 20 eşzamanlı istek** tek oy satırı, tek `vote_events` satırı ve toplamları 1 olan sayaçlar üretir. Geçersiz saymada gerekçe zorunludur, ikinci geçersiz sayma çift düşüm yapmaz, kullanıcı yeniden oy veremez. Oyun anketi/kullanıcısı değiştirilemez |
| Kilit | Oy yokken başlık, açıklama, sonuç görünürlüğü ve seçenekler düzenlenebilir. İlk geçerli oydan sonra şunlar `KV_POLL_CONTENT_LOCKED` ile reddedilir: başlık, **açıklama (boşaltmak dahil)**, `results_visibility`, kilidi geri alma, seçenek metni/sırası, seçenek ekleme ve silme. Sayaçlar, erken kapanış, yorum ayarı ve `poll_addenda` serbesttir. Sadece geçersiz sayılmış oy anketi kilitlemez |
| Oy geçmişi | `vote_events` UPDATE/DELETE `KV_VOTE_EVENTS_APPEND_ONLY` ile reddedilir. Olay biçimi CHECK'i çalışır (aynı seçeneğe `CHANGE` olmaz) |
| Yorum | Cevaba cevap `KV_COMMENT_DEPTH` verir. Cevabı olan yorum cevaba dönüştürülemez. `ALTERNATIVE` sadece üst seviyede olabilir. Cevap başka anketteki yoruma bağlanamaz |
| `kv_normalize` | TECH_DECISIONS §3.9 tablosu ve ek örnekler: `Şişe→sise`, `IŞIK/ışık→isik`, `İstanbul→istanbul`, `ağaç→agac`, `Göz→goz`, `Üzüm→uzum`, `ÇİÇEK→cicek`, `Iğdır→igdir` |
| `media_assets` (KV-16, +6 test) | Onaylanmamış görsel public anahtar alamaz; onaylı görsel public ve işlenmiş kopya olmadan var olamaz; onaydan sonra kaldırmada public anahtar aynı UPDATE'te boşaltılmalı; risk skoru 0–1; inceleme alanları birlikte dolar; yükleyen FK'si ve galerideki görselin silinememesi |
| `reports` / `moderation_actions` (KV-24, +7 test) | Rapor tam olarak bir hedefe bağlanır; aynı kullanıcı aynı hedefi iki kez raporlayamaz; kendini raporlayamaz; sonuçlanan rapor sonuçlandıranı taşır, açık rapor taşımaz; raporlanan anket hard delete edilemez; işlem gerekçesiz/hedefsiz yazılamaz; moderasyon geçmişi `KV_MODERATION_ACTIONS_APPEND_ONLY` ile korunur |
| `communities` / `community_memberships` (KV-31, +5 test) | Aynı kullanıcı ikinci kez katılamaz, ayrılıp yeniden katılabilir; slug benzersiz ve URL biçiminde, ad boş olamaz; üye sayısı negatif olamaz; moderatör rolü üyelikte tutulur ve kaldırılabilir; anketi olan topluluk silinemez, kapatmak anketleri etkilemez |
| Enum hizalaması (+1 test) | `media_purpose`, `report_reason` ve `moderation_action_type` değerleri API sözleşmesindeki (KV-03) adlarla aynı |
| `audit_logs` (KV-39, +6 test) | Aktör FK'si `RESTRICT`, olmayan aktöre yazılamaz; API kaydı aktörlü ve `request_id`'li, CLI/WORKER aktörsüz; işlem, tür, hedef, gerekçe ve özet biçim CHECK'leri; `KV_AUDIT_LOGS_APPEND_ONLY` (UPDATE, değer değiştirmeyen UPDATE, DELETE, TRUNCATE); hedef/aktör/işlem türü/zaman index'leri; `audit_source` contracts `AuditSource` ile birebir |
| `user_roles` / `sanctions` (KV-12, +9 test) | Tek rol, `USER` satırı yok, kendine rol yok, verensiz sadece SUPER_ADMIN; var olmayan kullanıcıya FK hatası; `users`'a giden 5 FK `RESTRICT` ve izi olan kullanıcı silinemez; süre, `SUSPEND` süreli / `BAN` kalıcı; kendine yaptırım ve kendi yaptırımını kaldırma yok; gerekçe ve kaldırma alanları; `KV_SANCTIONS_IMMUTABLE` (tek izinli geçiş kaldırma, ikinci kaldırma yok); aktif yaptırım sorgusu ve index; `user_role`/`sanction_type` contracts `Role`/`SanctionType` ile birebir |

### 11.3 Bu PR'daki kanıt

| Kontrol | Sonuç |
|---|---|
| `prisma validate` | ✅ Geçerli |
| `prisma migrate diff --from-empty --to-schema prisma/schema --script` | ✅ Migration'ın 1. bölümüyle birebir aynı (20 tablo, 9 enum) |
| `prisma generate` ve `tsc` (`src` + `test`) | ✅ Hatasız |
| Test dosyası DB olmadan çalıştırıldı | ✅ Yükleniyor, 27 testi kaydediyor, anlaşılır bağlantı hatasıyla duruyor. `_test` koruması çalışıyor |
| **Gerçek PostgreSQL 17.11 testi** | ✅ 2026-09-27: GitHub Actions üzerinde 27/27 geçti; migrate reset/diff ve 20 eşzamanlı oy dahil. [Koşu](https://github.com/mehmetalisahingm/kararver/actions/runs/36335631011). Aynı koşuda storage geçti; UI hashchange bekleme hatası sonraki committe düzeltildi. |

### 11.4 Açık konular

| # | Konu | Kim |
|---|---|---|
| 1 | Snapshot pencere tanımı PR #63 incelemesinde onaylandı; §8 güncellendi | Tamamlandı |
| 2 | `LOCKED` durumundaki anket oy alabilir mi? | KV-11 |
| 3 | Hesap silmede KVKK kapsamı: hangi alanlar anonimleşir, oylar ne olur | Faruk + Utku |
| 4 | Kullanıcı adında izinli karakterler (Türkçe harf olacak mı?) | KV-09 |
| 5 | Mert, Utku ve Mehmet tablolarının §9'daki FK yönleriyle uyumu | İlgili sahipler, PR review'unda |
| 6 | **İlk SUPER_ADMIN nasıl oluşur?** **Çözüldü (KV-12):** tek seferlik CLI `pnpm --filter @kararver/api admin:bootstrap --email … [--apply]` (varsayılan dry-run; mantık `apps/api/src/modules/rbac/bootstrap.ts`). Transaction + sabit anahtarlı advisory lock; herhangi bir SUPER_ADMIN satırı varsa reddeder; hedef var olan, silinmemiş, e-postası doğrulanmış, `ACTIVE` kullanıcı olmalı; mevcut rol satırını (ör. MODERATOR) yükseltir, yoksa ekler; `granted_by_id = NULL` ile yazar (`user_roles_bootstrap_check` bunu sadece SUPER_ADMIN'e izin verir); rol satırıyla aynı transaction'da `audit_logs`'a da yazar (KV-39, §9.2; stdout'a tek satır ayrıca). Reddedilenler: `SUPER_ADMIN_EMAIL` env ile açılışta yükseltme (kalıcı yükseltme yolu), seed migration (ortama özel veri). Kullanım, çıkış kodları ve kurtarma: [`KV-12_ADMIN_BOOTSTRAP.md`](./KV-12_ADMIN_BOOTSTRAP.md) | Tamamlandı |
