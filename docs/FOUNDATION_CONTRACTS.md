# Ortak entegrasyon temeli — KV-03 / KV-04 / KV-06

Bu belge uygulanabilir ortak sözleşme başlangıcıdır. Endpointlerin kendisi henüz
uygulanmadı; KV-03/04/06'nın bütün kabul koşullarının tamamlandığı anlamına gelmez.
Teknik kararlar `TECH_DECISIONS.md`, DB alanları `DATA_MODEL.md` ile birlikte kullanılır.
Güncel sahiplik: Faruk core/backend, Ümit frontend, Mert medya/topluluk/moderasyon,
Utku güvenlik/platform, Mehmet büyüme/ürün yüzeyleri.

> **Endpoint bazlı tam sözleşme:** [`API_CONTRACTS.md`](./API_CONTRACTS.md) (KV-03, #5). Her endpoint'in
> şeması, yetkisi, hata kodları, idempotency ve cache davranışı oradadır ve `@kararver/contracts`
> 1.0.0'dan üretilir. Bu belgedeki kurallar orada da geçerlidir; ayrıntıda çelişki olursa API_CONTRACTS esas alınır.

## Wire formatı

- API prefix `/v1`; JSON, camelCase; DB snake_case alanları doğrudan yayınlanmaz.
- İç ID UUIDv7, zaman UTC ISO-8601 `Z`. Public slug yetki kanıtı değildir.
- Tekil cevap `{data: resource}`, liste `{data: [], page: {nextCursor, hasMore}}`.
- Cursor opaktır; `limit` varsayılan 20, üst sınır 100. Sabit sıralama + ID tie-breaker.
- Hata `{error: {code, message, details}, requestId}`. `details` alan hatalarıdır;
  SQL, stack, parola, session ve token içermez. Kod/status eşlemesi contracts paketinde.
- Cookie session: credential gerektiren istemciler `credentials: include` kullanır.
  Mutationlarda sunucu Origin/CSRF doğrulaması yapar; CORS allowlist kullanılır.
- Oy: `PUT /v1/polls/:id/vote` gövdesi `{optionId}`. Aynı seçeneğe tekrar aynı sonucu
  döndürür. İlk oy 201, tekrar/değişim 200; kapalı 409, yetkisiz 401/403.
- Diğer create işlemlerinde `Idempotency-Key`; actor + route + key kapsamında saklama.
  Aynı key/farklı body 409; aynı key/aynı body aynı sonucu döndürür. TTL 24 saat.
  Anahtar sunucu transaction/unique kısıtlarının yerine geçmez.
- Gizli sonuç sadece `{visible:false}`; oy sayısı/yüzdesi/katılımcı verisi bulunmaz.
  Kişiye göre değişen auth/sonuç cevapları shared cache'e konmaz (`private, no-store`).
- Hata 429 için `Retry-After` saniye. UI bekleyen mutationı sessizce tekrarlamaz.

## Modül route sınırları

| Sahip | Route grubu | Teslim |
| --- | --- | --- |
| Faruk | `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/email/verify`, `/auth/email/resend`, `/auth/password/forgot`, `/auth/password/reset`, `/me` | Auth ve session; POST mutation, GET/PATCH me |
| Faruk | `/polls`, `/polls/lookup`, `/polls/:id`, `/polls/:id/vote`, `/polls/:id/reaction`, `/polls/:id/addenda`, `/polls/:id/comments`, `/comments/:id`, `/comments/:id/reaction` | Anket/tartışma GET/POST/PATCH/DELETE, vote PUT, like/dislike PUT/DELETE (#66, eski `/comments/:id/like`'ın yerine), yorum/alternatif GET/POST/PATCH/DELETE |
| Faruk | `/feed`, `/search`, `/categories`, `/trends/:format`, `/polls/:id/history` | GET liste ve grafik verisi |
| Faruk | `/admin/categories` | Kategori yönetimi API'si (KV-26); ekranı Mehmet (KV-41) |
| Mert | `/media`, `/reports`, `/communities`, `/communities/:id/membership` | Upload/rapor POST; topluluk GET, üyelik PUT/DELETE |
| Mert | `/admin/polls`, `/admin/comments`, `/admin/reports`, `/admin/media`, `/admin/communities` | Moderasyon komutları gerekçe/audit ile, scoped yetki |
| Utku | `/config`, `/notifications`, `/notifications/preferences`, `/notifications/mutes/:pollId`, `/admin/users`, `/admin/settings`, `/admin/emergency`, `/admin/audit` | Public config GET; bildirim GET/PATCH, sessize alma; ayar/yaptırım/rol mutation; audit read-only |
| Mehmet | `/profiles/:username`, `/me/bookmarks`, `/polls/:id/bookmark`, `/polls/:id/follow`, `/polls/:id/decision`, `/polls/:id/shares`, `/announcements/active` | Profil/kaydet GET; bookmark/follow PUT/DELETE; karar PUT; paylaşım POST |
| Mehmet | `/me/interests`, `/me/points`, `/admin/metrics`, `/admin/featured`, `/admin/announcements`, `/admin/users/:id/point-adjustments` | İlgi GET/PUT, puan (#67), metrik GET, içerik yönetimi CRUD. Kategori ekranı (KV-41) Faruk'un `/admin/categories` API'sini kullanır |

Yukarıdaki tablo route sahipliğini sabitler. Her feature PR'ı alan bazlı request/response
şeması, validation ve endpoint contract testini ekler. `/admin` prefix'i tek başına yetki değildir.
Yeni alanlar eklemeli/opsiyonel; kırıcı değişiklik tüm tüketici PR'larıyla koordineli ve sürümlüdür.

## Yetki matrisi

| İşlem | USER | MODERATOR | ADMIN | SUPER_ADMIN |
| --- | --- | --- | --- | --- |
| Public içerik okuma | Evet (misafir de) | Evet | Evet | Evet |
| Oy/yorum/oluşturma | Aktif hesap + işlem limiti | Aynı | Aynı | Aynı |
| Kendi profil/içerik/kaydetme | Sahiplik | Sahiplik | Sahiplik | Sahiplik |
| İçerik/rapor moderasyonu | Hayır | Atandığı topluluk | Tümü | Tümü |
| Global kullanıcı yaptırımı | Hayır | Hayır | Normal/moderatör hesaplar | Tümü |
| Kategori/featured/duyuru | Hayır | Hayır | Evet | Evet |
| Sistem ayarı/acil anahtar/rol atama | Hayır | Hayır | Hayır | Evet |
| Audit okuma | Hayır | Hayır | Evet | Evet |
| Audit silme/değiştirme | Hayır | Hayır | Hayır | Hayır |

Kendi rolünü yükseltme ve son aktif Super Admin'i kaldırma reddedilir. Topluluk rolü
client claiminden değil DB üyeliğinden okunur. BANNED/SUSPENDED hesap mutation yapamaz;
RESTRICTED işlem bazlı kısıtlanır. Public okuma ve itiraz kanalı yaptırım durumundan ayrıdır.
LOCKED anket yeni oy/yorum kabul etmez; mevcut sonucu görme görünürlük politikasına bağlıdır.
İlk oy sonrası içerik kilidi (`first_valid_vote_at`) ile moderasyon LOCKED durumu farklıdır.

## Olay ve ayar sözleşmesi

Domain olayları `{version:1,id,type,occurredAt,actorId,subject:{type,id},payload}`.
Kimlik producer tarafından oluşturulur ve retry boyunca değişmez. Aynı mutation ve olay
transaction/outbox ile bağlanır. Consumer id + handler kapsamında dedupe yapar; bildirimde
ayrıca recipient kontrol edilir. Teslim en az bir kezdir; exactly-once iddiası yoktur.
Oy seçimi/kişisel veri notification payloadına gereksiz kopyalanmaz. Analytics sözlüğü
KV-07 PR #60'taki ürün metrikleriyle eşlenir; domain ve analytics isimleri adapterla ayrılır.

Settings namespace'leri: `polls.*`, `comments.*`, `media.*`, `trends.*`, `feed.*`,
`registration.enabled`, `maintenance.enabled`. Tip, alt/üst sınır, varsayılan ve sürüm
KV-40'da saklanır. Bilinmeyen anahtar reddedilir; değişiklik auditli ve cache invalidationlıdır.

## Bağımsız çalışma ve doğrulama

`packages/contracts` runtime helperları ve `fixtures/polls.json` frontend/mock kullanımına
hazırdır. Fixture üretim verisi değildir; auth/servis implementasyonu değildir.
DB gerektirmeyen kontrol: `pnpm contracts:test`.
DB kontrolü: local Docker açıkken `docker compose up -d`; `.env.example` değerlerini
yerel ortam için kullanıp `pnpm test`. Test yalnızca `_test` son ekli DB'yi sıfırlar.
Arayüz: `npm ci --prefix ui/design-system`, `npx --prefix ui/design-system playwright install chromium`,
`pnpm ui:test`. Test komutu kendi geçici localhost sunucusunu açar/kapatır.
Storage: `python -m pip install boto3==1.42.0`, `python scripts/storage-smoke.py`.

CI DB, statik UI ve S3 smoke işlerini ayrı raporlar. `apps/api` iskeleti ve auth/`/me`
endpointleri KV-09 ile geldi ([`KV-09_AUTH_BACKEND.md`](./KV-09_AUTH_BACKEND.md)). Henüz `apps/worker`,
gerçek staging deployment veya auth→anket→oy E2E yoktur; bunların yerine
mock başarısı kabul edilmez. Tam endpoint şemaları KV-03 ile [`API_CONTRACTS.md`](./API_CONTRACTS.md)
ve `packages/contracts` içinde tamamlandı; bağımsız çalışan uygulama/mock servisleri KV-04/06'nın
kalan teslimleridir.
