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
- **MODULE DELIVERED:** İlgili issue teknik olarak kapanmış; ürün/staging kabulünün yerine geçmez.

**GO şartı:** Bütün V1 satırları PASS; kritik/yüksek açık hata yok; #46 güvenlik ve #48 gerçek cihaz/erişilebilirlik, #51 operasyon, #47 beta, #52 SEO, #44 editöryel akış ve #42 ayarlar için kanıt hazır; teknik CI, staging gerçek HTTP, gerçek cihaz ve beta çıktıları birbirinden ayrı. Kararı yalnız Mehmet #54'te kaydeder. **NO-GO** durumunda public rollout yapılmaz.

## 1. Ortam, aday SHA ve kanıt envanteri

| Alan | Başlangıç değeri / kanıt | Durum |
| --- | --- | --- |
| Release candidate main SHA | Test öncesi SHA ve tag girilecek | NOT RUN |
| GitHub CI | .github/workflows/foundation.yml: database, web, Chromium/Firefox/WebKit, integration, storage, ui | İş bazında SHA/run ile doğrula |
| Staging web | https://kararver-staging.vercel.app (erişim ve hangi commit sorulacak) | NOT RUN |
| Staging API | https://api-staging-45cb.up.railway.app (health, /v1/config, gerçek auth) | NOT RUN |
| Sürüm/kapsam farkı | Preview, CI ve Railway/Vercel SHA'ları karşılaştırılacak; eski backend ile yeni web sonucu kabul edilmez | NOT RUN |
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

## 5. Kanıt kayıt tablosu (boş şablon)

| Gate ID | Ortam + tam SHA | UTC tarih/saat | Senaryo, beklenen/gerçek | Log/CI/screenshot URL (maskeli) | Sahip | PASS/FAIL/BLOCKED | Hata issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R__ | — | — | — | — | — | NOT RUN | — |
| F__ | — | — | — | — | — | NOT RUN | — |

Her yeni PR/commit/deploy sonrasında etkilenen gate'ler **yeniden doğrulanır**. Mert, modül sahiplerinin kanıtlarını derler; Utku #46; Ümit #48; Faruk #51; Mehmet #44/#47/#52 ve ürün kararı #54. **#53 bu kanıtlar toplanana dek açıktır.**

## 6. Başlangıç için ilk somut işler

1. Mert: Release candidate SHA + staging web/API deployment SHA'larını sabitle; [Foundation checks](https://github.com/mehmetalisahingm/kararver/actions/workflows/foundation.yml) tam yeşil run'ını ve artifact'larını bağla.
2. Utku: #46 içindeki 20 eşzamanlı oy, abuse/rate-limit, scope ve gerçek staging yetki testleri için maskeli sonuçları ekle.
3. Ümit: #48'e cihaz/OS/VoiceOver/NVDA/TalkBack kanıtı, gerçek 500→retry ve session expiry sonucu ekle.
4. Faruk: #51 içindeki worker/S3/security headers/PG sürümü/rollback ve izleme uyarılarını değerlendir; #49/#50 belgelerini güncel staging'e bağla.
5. Mehmet: #47 beta hazırlığını yürüt (davet **gönderme**, önce #46 kapısı), #44 ve #52 ürün kabulü ile onboarding-misafir akışı kararını netleştir.

**Bağlantılar:** [#53](https://github.com/mehmetalisahingm/kararver/issues/53) · [#47](https://github.com/mehmetalisahingm/kararver/issues/47) · [#54](https://github.com/mehmetalisahingm/kararver/issues/54).
