# KV-40: Sistem ayarları ve acil durum anahtarları (#42)

> Sahip: Utku (iş tanımı); Utku'nun yokluğunda Mert üstlendi (Mehmet'in geçici devri, 8 Ekim). Kod: `apps/api/src/modules/settings/`, `apps/worker/src/settings.ts`. Testler: `apps/api/test/admin-settings.test.ts`, `apps/worker/test/settings.test.ts`.
> Kayıt defteri (anahtar, tip, aralık, resmî varsayılan): `packages/contracts/src/settings.ts`; liste: [KV-04 §3](./KV-04_ROLES_EVENTS.md).

## Özet

| Kabul koşulu (#42) | Sonuç |
|---|---|
| Değişiklik deploy gerektirmiyor; tip/aralık doğrulanıyor, audit kayıtlı | ✅ `PATCH /admin/settings/:key` DB'ye yazar; kayıt defteriyle doğrulanır (404/400); `settings.update` audit'i aynı transaction'da |
| Yetkisiz ayar reddediliyor; acil anahtarlar devam eden oturumlarda yeni işlemleri engelliyor | ✅ yalnız SUPER_ADMIN yazar (ADMIN okur); anahtarlar her istekte okunur, oturum süresi beklenmez |
| Her tüketici modül ayarları kullanıyor; güvenli varsayılan ve cache yenileme testi var | ✅ aşağıdaki tüketici tablosu; `admin-settings.test.ts` (önbellek, fail-safe, çok süreç) |

## Nasıl çalışır

- **Saklama:** `system_settings(key, value jsonb, version, updated_by_id, updated_at)`. Yalnız değiştirilen ayar satır olur; satırı olmayan ayar kayıt defteri (veya aşağıdaki güvenli) varsayılanıyla, **sürüm 1** olarak çalışır. `GET /admin/settings` her zaman bütün anahtarları döner (satırı olmayanın `updatedAt` değeri `1970-01-01`, `updatedBy` null).
- **İyimser kilit:** istek `version` taşır; eski sürüm 409 `VERSION_CONFLICT` (detayda güncel sürüm). Aynı değeri tekrar göndermek (ağ yeniden denemesi) 200 döner, sürüm ve audit değişmez.
- **Alanlar arası kurallar** (`minOptions ≤ maxOptions`, `minDurationHours ≤ maxDurationHours`) bütün etkin değer kümesiyle kontrol edilir; bütün ayar yazmaları tek advisory kilidiyle sıralanır, eşzamanlı iki değişiklikle kural aşılamaz.
- **Audit:** `settings.update` (hedef `SETTING/<anahtar>`, önce/sonra `{value, version}`, gerekçe zorunlu); `emergency.update` (hedef `SETTING/emergency`, önce/sonra anahtar→bool haritası). Değişmeyen tekrar istek iz bırakmaz.
- **Önbellek:** API ve worker değerleri 5 sn bellekte tutar. Değişikliği yapan süreçte **anında**, diğer API süreçlerinde ve worker'da **en geç 5 sn sonra** etkilidir (çok süreçli dağıtım; `WEB_CONCURRENCY`). `GET /config` ayrıca `Cache-Control: public, max-age=30` verir (sözleşme ≤ 60 sn): acil durum anahtarı istemciye en geç ~35 sn'de ulaşır.
- **Fail-safe:** DB okunamazsa son bilinen değerler, hiç yoksa varsayılanlar kullanılır; 1 sn sonra yeniden denenir. Ayar servisi yüzünden platform veya job durmaz.

## Acil durum anahtarları

| Anahtar (`admin.emergency.put`) | Ayar | Kapalıyken |
|---|---|---|
| `registration` | `features.registration` | `POST /auth/register` → 503 `FEATURE_DISABLED` |
| `pollCreation` | `features.pollCreation` | `POST /polls` → 503 `FEATURE_DISABLED` (başarılı isteğin idempotent tekrarı etkilenmez) |
| `comments` | `features.comments` | `POST /polls/:id/comments` → 503 `FEATURE_DISABLED` |
| `uploads` | `features.uploads` | `POST /media/uploads` → 503 `FEATURE_DISABLED` |
| `maintenance` | `maintenance.enabled` | **bütün yazma istekleri** 503 `MAINTENANCE`; okuma (GET), giriş/çıkış ve `/admin/*` açık kalır (modu kapatabilmek için) |

Devam eden oturumlar etkilenmez (okuma, profil, giriş çalışır); yalnız yeni işlem engellenir. Tek istekte birden çok anahtar tek transaction ve tek audit kaydıdır.

## Tüketiciler

| Ayar grubu | Tüketen | Not |
|---|---|---|
| `polls.minDurationHours/maxDurationHours`, `voteChangeAllowed`, yayın limitleri (`newAccount*`, `dailyLimit`, `cooldownMinutes`) | API anket/oy modülleri (`PollSettings`) | eskiden sabit/geçici varsayılan |
| `polls.minOptions/maxOptions/titleMaxLength/descriptionMaxLength`, `media.maxPerPoll` | `polls.create`, `polls.update` | sözleşme şemaları (2–6, 200, 5000, 10) üst sınırdır; kayıt defteri aralıkları da aynı üst sınırı taşıdığı için ayar yalnız daraltabilir |
| `comments.bodyMaxLength` | `comments.create`, `comments.update` | aynı kural: şema 2000 üst sınır |
| `points.publishCost`, `points.initialGrant` | yayın maliyeti, `/me/points`, ilk giriş puanı | `initialGrant = 0` ledger'a sıfır girişi yazmaz |
| `media.maxBytes/allowedTypes`, `features.uploads` | API medya + **worker** (`media.maxBytes` indirme sınırı) | |
| `trends.*` (13 anahtar) | **worker** `trends.refresh` | yorum sınırı, günlük/haftalık katsayılar ve bütün örneklem eşikleri; tek ayar görüntüsü ve hesap sürümü |
| `feed.*` | "Senin İçin" feed | |
| `limits.*` | KV-19 hız sınırlayıcı | varsayılanlar KV-19 politikasıdır |
| `features.*`, `maintenance.enabled` | yukarıdaki tablo | |

`GET /config` bütün public ayarları (`publicPath`) tek yanıtta verir; web bunu okuyabilir.

## Güvenli varsayılanlar (Mehmet teyidi bekliyor)

Kayıt defterinde resmî değeri **olmayan** ayarlar için servis şu varsayılanları kullanır (KV-04 açık konuları; kaynak: `apps/api/src/modules/settings/service.ts` → `SAFE_DEFAULTS`):

| Ayar | Varsayılan | Gerekçe |
|---|---|---|
| `features.registration/pollCreation/comments/uploads` | açık | kapalı başlamak platformu çalışmaz yapar; anahtar acil durumda kapatılır |
| `maintenance.enabled` | kapalı | |
| `polls.voteChangeAllowed` | açık | mevcut davranış (`DEFAULT_POLL_SETTINGS`) |
| `feed.explorationPercent / maxSameAuthorPerWindow / maxSameCategoryPerWindow` | 20 / 2 / 4 | Faruk önerisi (KV-27), mevcut davranış |
| `limits.*` | KV-19 politikası | Mehmet geçici limitleri onayladı (#21) |

Değerler teyit edilince `contracts settings.ts` kayıt defterine resmî varsayılan olarak işlenmeli (KV-04 §3 "yok" satırları kapanır).

## Sınırlar ve izleme

- Çok süreçli dağıtımda değişiklik diğer süreçlerde ≤ 5 sn gecikir; anlık yayılım (Postgres `LISTEN/NOTIFY`) gerekirse ayrı iş.
- Bakım modu istemciye `GET /config` ile yansır; web'in bakım ekranı bu PR'da yok (panel: ayrı PR).
- Görsel risk eşikleri (`media.risk*`) API ve worker tarafından tüketilir; orta/yüksek eşik ilişkisi doğrulanır.
- Worker kapalı olan ücretsiz dağıtımda trend hesabı kendiliğinden çalışmaz. Ayarlar saklanır; iş çalıştırıcısı etkin olduğunda kullanılır. Bu modül, ayrı worker servisi veya ücretli plan açmaz.

## Yönetim paneli (`/admin/settings`)

`apps/web/src/features/admin/settings-panel.tsx`, saf kurallar `settings-model.ts`. ADMIN salt okunur görür; **yalnız SUPER_ADMIN** değiştirir (sunucu 403 verir, düğmeler yalnız gizlenir).

- **Acil durum anahtarları:** beş anahtar, durum (bakımda açık / diğerlerinde kapalı "riskli" işaretlenir), etkisi; her değişiklik gerekçeli pencereyle `PUT /admin/emergency`.
- **Ayarlar:** gruplu tablolar (anket, yorum, görsel, puan, trend, feed, hız sınırları); açıklama, aralık, sürüm ("Varsayılan" = hiç değişmemiş), son değiştiren. "Değiştir" tipine göre giriş açar (tam sayı, açık/kapalı, görsel türü onay kutuları), aralığı istemcide de denetler; sunucu 400 verirse mesaj pencerede kalır.
- **Eşzamanlı değişiklik:** eski sürüm 409 `VERSION_CONFLICT` verir; panel listeyi güncel sürümle yeniler, pencere mesajla açık kalır.
- Anahtar ve açıklamalar contracts kayıt defterinden gelir; yeni ayar eklenince panelde otomatik görünür (testle korunur: her anahtarın açıklaması ve grubu var).

## #42 tamamlama doğrulaması — 9 Ekim 2026

- PostgreSQL 17 üzerinde 34 migration uygulanmış ayrı test veritabanında API ayarları, trend motoru ve snapshot testleri çalıştırıldı: 60 başarılı, 0 başarısız, 0 atlanan; contracts'ta önceden bulunan bir varsayılan-onay TODO'su ayrı raporlanır.
- Yeni uçtan uca test gerçek SUPER_ADMIN isteğiyle örneklem eşiğini değiştirir, worker önbelleğinin 5 saniye sonra yenilendiğini ve aynı zaman diliminde yeni hesap sürümüyle sıralamanın değiştiğini doğrular. Önceki değere dönüş tekrar hesaplanır; iki düzenlemenin audit kayıtları kontrol edilir.
- Yetkisiz değişiklik, aralık hatası, sürüm çatışması, eşzamanlı ayar yazımı ve devam eden oturumda acil anahtarların etkisi PostgreSQL testlerinden geçer.
- Admin istemcisi ve ayar modeli: 30 test başarılı. Chromium masaüstü ve 360px mobilde yeni trend ayarının görünmesi, geçersiz değer reddi, gerekçe/sürümle kaydetme ve güncel değerin gösterilmesi: 2/2 başarılı. API ve worker TypeScript kontrolleri başarılı.
- Bunlar yerel gerçek-veritabanı ve arayüz sözleşmesi kanıtlarıdır; staging güvenlik/kabul işleri #46, #53 ve üretim yayını #54 ayrıca izlenir.
