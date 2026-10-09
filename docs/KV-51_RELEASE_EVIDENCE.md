# KV-51 / #53 — V1 regresyon ve yayın kanıt matrisi (başlangıç)

**Tarih:** 8 Ekim 2026 · **Koordinasyon/nihai kanıt sahibi:** Mert (@MertKAYAR) · **Ürün/yayın kararı:** Mehmet · **Güvenlik kapısı:** Utku (#46).

> Bu belge test sonucu veya yayın onayı değildir. İlk durumlar, mevcut issue/CI kayıtlarına dayanır; yeni testler çalıştırılmadıkça PASS yazılmaz. Issue #53'te “plan bölüm 24” deniyor: güncel PRODUCT_TEAM_PLAN.md dosyasında **Public V1 checklist bölüm 23**, **bölüm 24 ise V1.1/V1.2**'dir. Ayrıca docs/V1_USER_FLOW.md → “Yayın kabulü” zorunludur.

## 0. Kanıt sözleşmesi ve karar kapısı

Her test satırı için **ortam**, **deploy SHA**, **test zamanı (UTC)**, **tarayıcı/cihaz**, **senaryo**, **beklenen ve gerçek sonuç**, **CI run/trace veya maskeli log linki**, **sorumlu**, **hata issue'su** kaydedilir. Session/cookie/token, kişisel iletişim bilgisi, ham kullanıcı verisi, veritabanı bağlantısı veya sırlar kanıta konmaz.

Durum sözlüğü:
- **PASS:** Aynı yayın adayı üzerinde gereksinime uygun doğrulama ve bağımsız kanıt var.
- **FAIL:** Doğrulama yapıldı ve kabul şartı karşılanmadı; engelleyici bulgu/sahip/öncelik kayıtlı.
- **BLOCKED:** Ön koşul veya erişim yok; eksik iş adı ve sahibi kayıtlı.
- **NOT RUN:** Henüz test yapılmadı / güncel commit üzerinde kanıt yok.
- **AUTOMATED PASS:** Aday SHA üzerinde otomatik test (gerçek PostgreSQL'li API/worker testleri veya yeşil CI işi) geçti; **staging, gerçek cihaz ve ürün kabulü yerine geçmez** ve bu belgede PASS sayılmaz. Hangi testin neyi kanıtladığı §7'de, kanıtın sınırı ayrıca yazılır.
- **MODULE DELIVERED:** İlgili issue teknik olarak kapanmış; ürün/staging kabulünün yerine geçmez.

**GO şartı:** Bütün V1 satırları PASS; kritik/yüksek açık hata yok; #46 güvenlik ve #48 gerçek cihaz/erişilebilirlik, #51 operasyon, #47 beta, #52 SEO, #44 editöryel akış ve #42 ayarlar için kanıt hazır; teknik CI, staging gerçek HTTP, gerçek cihaz ve beta çıktıları birbirinden ayrı. Kararı yalnız Mehmet #54'te kaydeder. **NO-GO** durumunda public rollout yapılmaz.

## 1. Ortam, aday SHA ve kanıt envanteri

| Alan | Başlangıç değeri / kanıt | Durum |
| --- | --- | --- |
| Release candidate main SHA | `cb82f71d230306318ba5b43192f9d4212fd653eb` (main, 9 Ekim 2026 00:37 +03:00, #160). Aday sabitlendi; sonraki her main commit'inde §7 yeniden koşulur. Tag henüz yok | SABİTLENDİ (9 Ekim) |
| GitHub CI | [Foundation checks #357](https://github.com/mehmetalisahingm/kararver/actions/runs/37848048482), commit cb82f71: database, web, integration, storage, ui, browser-accessibility (Chromium, Firefox, WebKit) hepsi **success** (9 dk 57 sn); staging-smoke yalnız elle çalışır, atlandı | AUTOMATED PASS (§7.1) |
| Staging web | https://kararver-staging.vercel.app (erişim ve hangi commit sorulacak) | NOT RUN |
| Staging API | https://api-staging-45cb.up.railway.app: `/health` 200; **`/v1/config` ve birçok yeni yönetim uç noktası 404: staging, aday SHA'nın gerisinde** (§7.2) | FAIL (sürüm farkı) |
| Sürüm/kapsam farkı | Preview, CI ve Railway/Vercel SHA'ları karşılaştırılacak; eski backend ile yeni web sonucu kabul edilmez. Railway/Vercel'in hangi SHA'yı çalıştırdığı **dışarıdan okunamıyor** (sürüm uç noktası yok); uç nokta parmak izi staging API'nin eski olduğunu gösteriyor (§7.2) | FAIL: staging aday SHA'ya yükseltilmeli (#51) |
| #49 performans | [#49 kapanış kanıtı](https://github.com/mehmetalisahingm/kararver/issues/49), [KV-47_PERFORMANCE](KV-47_PERFORMANCE.md) | MODULE DELIVERED; staging profili #51 |
| #50 backup/restore | [#50 kapanış kanıtı](https://github.com/mehmetalisahingm/kararver/issues/50), [KV-48_BACKUP_RESTORE](KV-48_BACKUP_RESTORE.md) | MODULE DELIVERED; production planı #51 |
| #66 tartışma/tepki | [#66](https://github.com/mehmetalisahingm/kararver/issues/66) | MODULE DELIVERED |
| #67 20/10 puan | [#67](https://github.com/mehmetalisahingm/kararver/issues/67) | MODULE DELIVERED; admin ayarı #42 |
| #44 featured/duyuru | [#44](https://github.com/mehmetalisahingm/kararver/issues/44) | BLOCKED: bildirim/planlama son kabulü |
| #42 admin ayarları | [#42](https://github.com/mehmetalisahingm/kararver/issues/42) | BLOCKED: bütün tüketiciler/gerçek kabul |
| #48 erişilebilirlik | [#48](https://github.com/mehmetalisahingm/kararver/issues/48), [KV-46_ACCESSIBILITY](KV-46_ACCESSIBILITY.md) | BLOCKED: fiziksel cihaz/gerçek 500/expiry |
| #46 beta güvenliği | [#46](https://github.com/mehmetalisahingm/kararver/issues/46) | BLOCKED: Utku kabulü |
| #47 gerçek beta | [#47](https://github.com/mehmetalisahingm/kararver/issues/47), [beta hazırlığı](KV-45_CLOSED_BETA.md) | NOT RUN: davet gönderilmedi |
| #51 prod operasyonu | [#51](https://github.com/mehmetalisahingm/kararver/issues/51) | BLOCKED: ayrı worker, S3 public erişimi ve güvenlik başlıkları için takip |
| #52 SEO/paylaşım | [#52](https://github.com/mehmetalisahingm/kararver/issues/52) | NOT RUN: gerçek preview/cache ve D7 kabulü |

#50 kapanışında belirtilen **worker servisinin eksikliği**, public medya bucket için **403**, staging PostgreSQL **18 / CI 17** farkı ve web security-header uyarıları #51 tarafında tekrar doğrulanmadan kapatılmaz. Bu eski kayıtlar güncel sürümde çözülmüş olabilir; yalnız güncel ortam kanıtıyla durum değiştirilir.

## 2. PRODUCT_TEAM_PLAN.md §23 — 35 maddelik release kontrol matrisi

**Başlangıç durumu:** Teknik olarak modülü teslim edilmiş satırlar da release adayı üzerinde yeniden sınanmadıysa NOT RUN olarak kalır. “Test odağı” doğrulama tasarımıdır, başarı iddiası değildir.

| ID | V1 şartı | Test odağı / kanıt türü | Bağlı iş | Başlangıç |
| --- | --- | --- | --- | --- |
| R01 | Register/login | Gerçek staging signup, doğru redirect, session/logout | #46, #48 | NOT RUN |
| R02 | E-posta doğrulama | Mailpit/test mail ile tek kullanımlık doğrulama | #46 | NOT RUN |
| R03 | Anket oluşturma | Seçenekli anket, görünürlük ve tutarlı DB | #12, #46 | NOT RUN |
| R04 | Fotoğraf upload | Tam upload→scan→görünür medya, gerçek bucket | #48, #51 | BLOCKED |
| R05 | Image moderation | Kabul/red/karantina/timeout fail-closed | #40, #46, #51 | BLOCKED |
| R06 | Oy duplicate yok | Retry + paralel 20 oy + tek aktif oy | #46, #49 | NOT RUN |
| R07 | Yorum ve cevap | Giriş kapısı, reply ve tek seviye, hata geri alma | #19, #46 | NOT RUN |
| R08 | Alternatif öner | Görünür içerik ve moderasyon | #19 | NOT RUN |
| R09 | Kaydetme | Başka kullanıcıya sızma yok, login ve retry | #48 | NOT RUN |
| R10 | Bildirim merkezi | Farklı olaylar, unread, mute, retry/duplicate | #23, #36, #44, #51 | BLOCKED |
| R11 | Search | Sorgu, zero-results, pagination, kaldırılan içerik | #30, #52 | NOT RUN |
| R12 | Günün Yükselenleri | Gerçek örneklem, sıralama, tablo/grafik | #32, #51 | NOT RUN |
| R13 | Haftanın Yükselenleri | Dönem ve doğru tarih sınırı | #32, #51 | NOT RUN |
| R14 | Haftanın En Çok Oy Verilenleri | Oy sayısı doğruluğu ve sıralama | #32, #51 | NOT RUN |
| R15 | Haftanın En Çok Konuşulanları | Yorum/katılım sayımı | #32, #51 | NOT RUN |
| R16 | Haftanın Değişkenleri | Gerçek oy değişkenliği, yetersiz veri durumu | #32, #51 | NOT RUN |
| R17 | Kategoriler | Filtre, kategori değişimi, görünürlük ve sıralama | #28 | NOT RUN |
| R18 | Topluluk | Üye listesi/gizlilik, join/leave ve moderatör scope | #33, #46 | NOT RUN |
| R19 | Rate limit/cooldown | Aşım, auth/rol ve tekrar deneme | #46 | NOT RUN |
| R20 | Rapor sistemi | Rapor aç/kapat ve yetki sınırı | #39 | NOT RUN |
| R21 | Admin içerik kaldırma | Feed/search/OG'den düşme, audit | #35, #52 | NOT RUN |
| R22 | Admin ban/suspend/restrict | Oturum iptali/rol kontrolü/audit | #35, #46 | NOT RUN |
| R23 | Öne çıkarma | Gerçek admin CRUD, audit, organik puan değişmez | #44 | BLOCKED |
| R24 | Featured zaman penceresi | Süre dolumu/erken aktivasyon/outbox idempotency | #44, #51 | BLOCKED |
| R25 | Admin trend'den çıkarma | Trendden kalkma, normal akış sınırı | #35, #32 | NOT RUN |
| R26 | Admin kategori/topluluk | Rol/yetki ve audit | #43 | NOT RUN |
| R27 | Admin sistem limitleri | Gerçek runtime ayar tüketimi/cache yenileme | #42 | BLOCKED |
| R28 | Audit log | Aktör/hedef/önce-sonra ve append-only | #41 | NOT RUN |
| R29 | Acil durum switch'leri | Fail-safe, bypass edilememe ve geri alma | #42, #46 | BLOCKED |
| R30 | Mobil responsive | 360px + gerçek iOS/Android | #48 | BLOCKED |
| R31 | Production error logging | Secret maskesi, alarm/sorumlu | #51 | BLOCKED |
| R32 | Backup planı | Restore manifest, RPO/RTO, prod operasyonu | #50, #51 | NOT RUN |
| R33 | SSL/DNS/Cloudflare | HTTPS, redirect, security headers, domain | #51 | BLOCKED |
| R34 | SEO metadata | canonical/robots/sitemap/OG, gizli/kaldırılan veri | #52 | NOT RUN |
| R35 | Kritik/yüksek bug yok | Etiketli açık issue/PR taraması + owner imzası | #46, #53 | NOT RUN |

## 3. Ek V1 kullanıcı akışı kabul matrisi

| ID | Senaryo | Kayıt | Durum |
| --- | --- | --- | --- |
| F01 | Misafir anket ve anketsiz tartışmayı gezebilir, zorunlu popup yok | #144/#145 onboarding ile eski misafir akışı arasındaki ürün kararı **açıkça teyit edilecek** | NOT RUN |
| F02 | Aksiyon→login, iptal→aynı içerik, giriş→taslak/returnTo; otomatik yayın yok | Gerçek staging tarayıcı kaydı, kullanıcı durumu | NOT RUN |
| F03 | Fotoğrafsız/seçeneksiz tartışma + yorum + like/dislike | #66 kapalı; staging davranış testi eksik | NOT RUN |
| F04 | Paralel ilk login yalnızca +20 | #67 kapalı; güncel DB ve audit kanıtı | NOT RUN |
| F05 | 2 × başarılı yayın = 0, üçüncü yayın reddi | #67 kapalı; iki farklı içerik türüyle kontrol | NOT RUN |
| F06 | Hatalı/retry yayın çift -10 yaratmaz, admin düzeltme auditli | #67 + #42; network/interruption | NOT RUN |
| F07 | Kullanıcı içerik geçmişi ve admin audit yetki sınırı | #41 ve kullanıcı history kontrolü | NOT RUN |
| F08 | Grafikler, hareket azaltma, gerçek cihaz/ekran okuyucu | #48 ve Ümit kabulü | BLOCKED |
| F09 | Topluluk üye görünürlüğü ve moderatör izolasyonu | #33/#46, private veriye erişim yok | NOT RUN |
| F10 | Demo onboarding seçimi gerçek oy/puan/analitik üretmiyor | #144/#145 gerçek staging senaryosu | NOT RUN |

**Ürün kararı uyarısı:** docs/V1_USER_FLOW.md “misafir akışta popup olmadan gezinir” diyor; #144/#145 ise ilk ziyarette premium tanıtım ve devamında login ekranı tanımlıyor. Son yayın kabulünde bu ilişki ürün sahibi tarafından yazılı karara bağlanmalı. Bir testin teknik başarısı çelişen ürün şartını kendiliğinden çözmez.

## 4. Test komutları (yetkili ortam)

~~~sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @kararver/web test
pnpm --filter @kararver/web test:e2e
KV_BROWSER=chromium pnpm --filter @kararver/web exec playwright test -c playwright.states.config.ts
KV_BROWSER=firefox pnpm --filter @kararver/web exec playwright test -c playwright.states.config.ts
KV_BROWSER=webkit pnpm --filter @kararver/web exec playwright test -c playwright.states.config.ts
~~~

Testlerde **Node 24.x ve pnpm 10.34.5**, DB entegrasyonu için izole PostgreSQL ve repo yönergeleri gerekir. Frontend HTTP interception / demo testleri **staging kanıtı değildir**. GitHub Foundation checks CI çıktısı matrise birebir run/SHA ile bağlanır. Staging smoke, CI'da yalnız elle dispatch + staging_url girdisiyle çalışır; otomatik PR CI'da SKIPPED normaldir. API/DB/staging erişiminde yetkili operatör doğrulamadan destructive işlem yapılmaz.

## 5. Kanıt kayıt tablosu (şablon; doldurulmuş otomatik kanıt §7'de)

| Gate ID | Ortam + tam SHA | UTC tarih/saat | Senaryo, beklenen/gerçek | Log/CI/screenshot URL (maskeli) | Sahip | PASS/FAIL/BLOCKED | Hata issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R__ | — | — | — | — | — | NOT RUN | — |
| F__ | — | — | — | — | — | NOT RUN | — |

Her yeni PR/commit/deploy sonrasında etkilenen gate'ler **yeniden doğrulanır**. Mert, modül sahiplerinin kanıtlarını derler; Utku #46; Ümit #48; Faruk #51; Mehmet #44/#47/#52 ve ürün kararı #54. **#53 bu kanıtlar toplanana dek açıktır.**

## 6. Başlangıç için ilk somut işler

1. Mert: ✅ aday SHA ve yeşil Foundation run'ı bağlandı (§1, §7.1); staging deployment SHA'sı dışarıdan okunamıyor ve staging API eski (§7.2): #51 sahibi yükseltmeli. Orijinal madde: Release candidate SHA + staging web/API deployment SHA'larını sabitle; [Foundation checks](https://github.com/mehmetalisahingm/kararver/actions/workflows/foundation.yml) tam yeşil run'ını ve artifact'larını bağla.
2. Utku: #46 içindeki 20 eşzamanlı oy, abuse/rate-limit, scope ve gerçek staging yetki testleri için maskeli sonuçları ekle.
3. Ümit: #48'e cihaz/OS/VoiceOver/NVDA/TalkBack kanıtı, gerçek 500→retry ve session expiry sonucu ekle.
4. Faruk: #51 içindeki worker/S3/security headers/PG sürümü/rollback ve izleme uyarılarını değerlendir; #49/#50 belgelerini güncel staging'e bağla.
5. Mehmet: #47 beta hazırlığını yürüt (davet **gönderme**, önce #46 kapısı), #44 ve #52 ürün kabulü ile onboarding-misafir akışı kararını netleştir.

**Bağlantılar:** [#53](https://github.com/mehmetalisahingm/kararver/issues/53) · [#47](https://github.com/mehmetalisahingm/kararver/issues/47) · [#54](https://github.com/mehmetalisahingm/kararver/issues/54).

## 7. Aday SHA `cb82f71` üzerinde otomatik regresyon kanıtı (9 Ekim 2026)

> Bu bölüm #53 koordinasyonunun **ilk gerçek koşusudur**. Hiçbir gate PASS yapılmadı; PASS için §0'daki staging/cihaz/ürün kanıtı şarttır. Burada yalnız "bu SHA'da otomatik testler ne gösterdi" yazılır.

### 7.1 Koşu ve ortam

| Alan | Değer |
| --- | --- |
| Aday | `cb82f71d230306318ba5b43192f9d4212fd653eb` (main) |
| Zaman (UTC) | 2026-10-08 ~21:45–22:05 (yerel koşu); CI run 8 Ekim akşamı |
| Yerel ortam | Windows 11, Node **24.11.0** (repo `engines` ≥ 24.14: CI Node 24.x kullanır, yerel koşu bir minör geride), pnpm 10.34.5, PostgreSQL (embedded, taze veritabanı, tüm migration'lar uygulanmış) |
| CI | [Foundation checks #357](https://github.com/mehmetalisahingm/kararver/actions/runs/37848048482): database, web, integration, storage, ui, browser-accessibility × 3 = success; staging-smoke atlandı |

| Komut | Sonuç | Not |
| --- | --- | --- |
| `pnpm lint` | exit 0 | |
| `pnpm typecheck` | exit 0, 0 hata | 6 paket |
| `pnpm contracts:test` | 349/350 geçti, **1 todo** | todo: `defaultSettings → PublicConfig`: resmî varsayılanı olmayan 9 ayar (aşağıda **K1**) |
| `pnpm worker:test` | 117/118 geçti, 1 atlandı | atlanan: gerçek NudeNet testi (yerelde `MODERATION_PYTHON` yok). CI `storage` işi Python kurar ve yeşil |
| `pnpm api:test` | **483/483** | gerçek PostgreSQL, `--test-concurrency=1` |
| `pnpm mock:test` | 241/241 | mock API sözleşme testleri |
| `pnpm --filter @kararver/web test` | 83/83 | birim/istemci testleri (staging kanıtı değil) |
| `pnpm db:test` | **yerelde koşmadı** | Prisma `migrate reset` onayı gerekir; CI `database` işi (success) kapsar |
| Playwright (states, a11y, e2e, media) | **yerelde koşmadı** (bu makinede tarayıcı testi yok) | CI `ui`, `integration`, `storage`, `browser-accessibility` işleri success |

### 7.2 Staging API sürüm farkı (yeni bulgu, **K2**)

Dışarıdan, kimlik doğrulamasız ve yalnız GET ile (8 Ekim ~21:47 UTC). 401/200 = uç nokta var, 404 = yok. `/health` 200 ve güvenlik başlıkları var (HSTS, CSP `default-src 'none'`, nosniff, X-Frame-Options DENY, referrer-policy no-referrer).

| Uç nokta | Staging | Aday SHA'da ne zaman geldi |
| --- | --- | --- |
| `/v1/categories`, `/v1/communities`, `/v1/feed` | 200 | eski |
| `/v1/admin/reports`, `/v1/notifications`, `/v1/me/points` | 401 (var) | eski |
| `/v1/config` | **404** | #153 (KV-40) |
| `/v1/admin/settings` | **404** | #153 |
| `/v1/admin/polls`, `/v1/admin/comments` | **404** | #139 (KV-37) |
| `/v1/admin/audit` | **404** | #157 (KV-39 okuma) |
| `/v1/admin/featured`, `/v1/admin/announcements`, `/v1/announcements/active` | **404** | #147 (KV-42) |
| `/v1/notifications/preferences` | **404** | #154 (KV-34) |

**Sonuç:** Staging API, aday SHA'dan en az #139'dan beri olan değişiklikleri içermiyor. Dolayısıyla **bütün staging tabanlı gate'ler (R01–R35'te "gerçek staging" isteyenler, F01/F02/F10) aday üzerinde NOT RUN kalır**; mevcut staging sonuçları aday için kanıt sayılmaz (eski backend ile yeni web). #51 sahibi (Faruk) staging'i aday SHA'ya yükseltmeli ve Railway/Vercel deployment SHA'sını buraya yazmalı. `/trends` uç noktası yolu parmak izinde kullanılmadı (yol biçimi farklı; yorum yapılmadı).

### 7.3 Gate bazında otomatik kanıt

Tablo yalnız başlığı açıkça okunan testlere dayanır; "kısmi" satırlar gate'in bir parçasını kapsar. **Boş bırakılan "Eksik" sütunu "tamam" demek değildir**: her satırın staging/cihaz kanıtı ayrıca NOT RUN/BLOCKED'dir.

| Gate | Otomatik kanıt (aday SHA) | Sonuç | Eksik / sınır |
| --- | --- | --- | --- |
| R01 | `auth.test.ts`: kayıt 202, giriş cookie (httpOnly/SameSite=Lax), çıkış oturumu iptal eder, oturum süresi dolunca 401, BANNED/SUSPENDED 403 | AUTOMATED PASS | gerçek staging signup/redirect (#46/#48) |
| R02 | `auth.test.ts`: token tek kullanımlık, 24 sa sonra geçersiz, paralel istekten biri başarılı | AUTOMATED PASS | gerçek posta kutusu/SMTP staging'de |
| R03 | `polls.test.ts` (oluşturma, Idempotency-Key, 5 eşzamanlı tek anket), `feed-limits.test.ts` | AUTOMATED PASS | staging görünürlük/DB |
| R04 | `media.test.ts`: imzalı PUT, PENDING kayıt, tür/boyut reddi; CI `storage` işi | KISMİ | gerçek bucket upload→scan→görünür (BLOCKED, #51) |
| R05 | worker `job.test.ts`/`policy.test.ts` (fail-closed, eşikler), KV-47 medya ölçümü (#142), CI `storage` | AUTOMATED PASS | gerçek NudeNet yerelde atlandı; production worker yok (#51) |
| R06 | `votes.test.ts`: aynı hesaptan 20 eşzamanlı istek tek aktif oy; çok kullanıcılı eşzamanlı oy | AUTOMATED PASS | #46 staging ve yük (#49 modül kanıtı) |
| R07 | `comments.test.ts`: yorum+cevap, cevaba cevap 400, misafir 401, idempotent tekrar | AUTOMATED PASS | UI giriş kapısı/hata geri alma (CI ui) |
| R08 | `comments.test.ts`: alternatif öneri kuralları | KISMİ | görünür içerik ve moderasyon akışı |
| R09 | `profiles-bookmarks.test.ts`: başka hesap private listeyi göremez, kaydetme idempotent | AUTOMATED PASS | staging |
| R10 | `notifications.test.ts`, `notification-preferences.test.ts`, `kv21-e2e.test.ts`, worker `notifications*.test.ts` | AUTOMATED PASS (API+worker) | gerçek uçtan uca: ayrı worker staging'de yok (#51) → BLOCKED |
| R11 | `search.test.ts`: Türkçe karakter, sayfalama, gizli/kaldırılmış bulunmaz, LIKE kaçışı | AUTOMATED PASS | staging |
| R12–R15 | `trends.test.ts`, worker `trends.test.ts`/`snapshots.test.ts`: güncel çalıştırma, cursor, gizlenen/trendden çıkan görünmez | AUTOMATED PASS | gerçek örneklem ve tablo/grafik ekranı |
| R16 | `trends.test.ts`: eşiği geçen yoksa `INSUFFICIENT_HISTORY` | AUTOMATED PASS | gerçek oy değişkenliği |
| R17 | `search.test.ts` (13 kategori, pasif kategori), `admin-categories.test.ts` | AUTOMATED PASS | staging |
| R18 | `communities.test.ts` (üye listesi görünürlüğü, katıl/ayrıl idempotent), `admin-communities.test.ts` | AUTOMATED PASS | #33/#46 staging, moderatör kapsamı gerçek hesapla |
| R19 | `rate-limit.test.ts` (giriş, kayıt, yorum, oy, **rapor**), `feed-limits.test.ts` (cooldown) | AUTOMATED PASS | #46 staging; `limits.*` varsayılanları resmîleşti (#158) |
| R20 | `reports.test.ts`, `admin-moderation.test.ts`, rapor hız sınırı testi (#159) | AUTOMATED PASS | rapor UI: kullanıcı hesabı raporu arayüzü yok (profil) |
| R21 | `admin-content-moderation.test.ts`: kaldırma soft delete, yalnız ADMIN+ geri yükler; `search.test.ts`; `shares.test.ts` (kaldırılmış için paylaşım kaydı yok), `moderation-trail.test.ts` (audit) | AUTOMATED PASS | OG/önizleme gerçek cache (#52) |
| R22 | `admin-users.test.ts`: SUSPEND oturumları aynı transaction'da iptal eder, audit, yetki | AUTOMATED PASS | #46 staging |
| R23 | `admin-featured.test.ts`: oluşturma, doğal tekrar tek kayıt, audit, yetki | KISMİ | "organik puan değişmez" ayrı doğrulanmadı; #44 ürün kabulü |
| R24 | `admin-featured.test.ts` (zaman penceresi, erken bildirim yok), worker `kv42-activation.test.ts` | AUTOMATED PASS | #44/#51 gerçek zamanlama |
| R25 | `admin-content-moderation.test.ts` (trendden çıkarma), `trends.test.ts` | AUTOMATED PASS | |
| R26 | `admin-categories.test.ts`, `admin-communities.test.ts`, `admin-content-ops.test.ts` (kategori/topluluk taşıma) | AUTOMATED PASS | |
| R27 | `admin-settings.test.ts`: ayarlar tüketicilerde etkili, önbellek, çok süreç TTL | AUTOMATED PASS | **staging'de ayar uç noktaları yok (K2)**; varsayılanlar K1 |
| R28 | `audit.test.ts`, `audit-list.test.ts`, `moderation-trail.test.ts`: aktör/hedef/önce-sonra, append-only | AUTOMATED PASS | |
| R29 | `admin-settings.test.ts`: acil durum anahtarları, bakım modu, devam eden oturum | AUTOMATED PASS | #46 bypass denemesi staging'de; K1 varsayılanlar |
| R30 | — | BLOCKED | gerçek iOS/Android (#48) |
| R31 | `security-headers.test.ts` yalnız başlıklar | BLOCKED | production hata günlüğü/maske/alarm (#51) |
| R32 | KV-48 tatbikatı (modül teslimi) | NOT RUN | güncel sürümde yeniden restore ve production planı (#51) |
| R33 | API başlıkları staging'de var (§7.2); `security-headers.test.ts` | KISMİ | SSL/DNS/Cloudflare ve web başlıkları (#51) |
| R34 | `shares.test.ts`; `robots.ts`/`sitemap.ts` kodda var | NOT RUN | gerçek canonical/OG/robots/sitemap çıktısı (#52) |
| R35 | açık PR: yalnız #166 (+ plan #1); CI aday SHA'da yeşil | NOT RUN | etiketli açık hata taraması ve sahip imzası |
| F03 | `discussions.test.ts`: seçeneksiz tartışma, yorum, beğeni/dislike, eşzamanlı sayaç | AUTOMATED PASS | staging davranışı |
| F04 | `points.test.ts`: ilk login +20; tekrar ve paralel login grant'i çoğaltmaz | AUTOMATED PASS | staging DB ve audit |
| F05 | `points.test.ts`: iki yayın = 0, üçüncü atomik reddedilir; tartışma da 10 harcar | AUTOMATED PASS | |
| F06 | `points.test.ts`: retry çift harcamaz, son 10 puana iki paralel yayın yalnız biri commit olur; ledger append-only | AUTOMATED PASS | gerçek ağ kesintisi senaryosu (cihaz/staging). Admin düzeltme ayrıca kanıtlı: `points-admin.test.ts` gerekçeli, idempotent, audit'li |
| F07 | `revisions.test.ts` (içerik geçmişi), `audit-list.test.ts` (yetki) | KISMİ | kullanıcının kendi içerik geçmişi ekranı |
| F09 | `communities.test.ts` (üye listesi görünürlüğü sunucuda), `admin-content-moderation.test.ts` (moderatör yalnız kendi topluluğu) | AUTOMATED PASS | #46 gerçek hesap izolasyonu |
| F01, F02, F08, F10 | CI `ui`/`browser-accessibility` yeşil (demo ve API'li Playwright) | NOT RUN / BLOCKED | gerçek staging tarayıcı akışı, cihaz, ürün kararı (`F01`) |

### 7.4 Açık bulgular ve kararlar (sahipli)

| ID | Bulgu | Önem | Sahip |
| --- | --- | --- | --- |
| **K1** | Resmî varsayılanı olmayan **9 ayar**: `polls.voteChangeAllowed`, `features.registration/pollCreation/comments/uploads`, `maintenance.enabled`, `feed.explorationPercent`, `feed.maxSameAuthorPerWindow`, `feed.maxSameCategoryPerWindow`. Servis güvenli varsayılan kullanıyor (özellikler açık, bakım kapalı, oy değiştirme açık, 20/2/4); contracts testi bunu "todo" bırakıyor. Ürün kararı kayıt defterine işlenmeli | Orta (karar) | Mehmet |
| **K2** | Staging API aday SHA'nın gerisinde (§7.2): `/v1/config`, ayarlar, yönetim içerik/audit/öne çıkarma ve bildirim tercihleri uç noktaları yok. Staging gate'leri aday için kanıt değil | **Yüksek** (yayın kapısı) | Faruk (#51) |
| **K3** | Gerçek NudeNet testi yerelde atlandı; yalnız CI `storage` işinde. Aday üzerinde gerçek model kanıtı CI loguna bağlanmalı | Düşük | Mert |
| **K4** | `F01`: misafir gezinme ile premium ilk açılış/login ürün kararı yazılı değil (§3 uyarısı) | Orta (karar) | Mehmet (#54) |
| **K5** | Kullanıcı hesabı için "Raporla" arayüzü yok (API ve kuyruk hazır; profil ekranı) | Düşük | Mehmet (profil, KV-22) |
| **K6** | `pnpm db:test` ve Playwright yerelde koşturulamıyor; yalnız CI. Aday üzerinde CI yeşil (§7.1) | Bilgi | — |

**GO için bu bölümden çıkan net iş:** K2 (staging yükseltme) olmadan staging gate'leri sınanamaz; ardından R/F satırlarındaki "Eksik" sütununa karşılık gelen staging, cihaz ve beta kanıtları (#46, #48, #51, #47, #52, #44, #42) toplanacak ve bu bölüm yeni aday SHA'da yeniden koşulacaktır.
