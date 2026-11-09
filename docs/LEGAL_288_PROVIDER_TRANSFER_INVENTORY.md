# KararVer — Sağlayıcı ve yurt dışı veri aktarımı envanteri (#288)

**Sahip:** Faruk (teknik envanter). **Hesap, sözleşme, imza ve resmî bildirim:** Mehmet. **Aktarım mekanizması (KVKK m.9) seçimi:** uygun hukuki inceleme.
**Son güncelleme:** 9 Kasım 2026. 31 Ekim tarihli ilk taslak ([#288 yorumu](https://github.com/mehmetalisahingm/kararver/issues/288)) Railway dönemine aitti; bu belge onun yerine geçer.

> Bu belge **hukuki görüş değildir** ve hiçbir aktarımı "uygun" ilan etmez. Yalnız hangi verinin hangi sağlayıcıdan, hangi bölgede geçtiğini teknik olarak listeler. "Doğrulanmalı" yazan her bilgi, sağlayıcı paneli veya belgesiyle teyit edilmeden kesin sayılmaz. İmzasız taslak veya web sayfası linki "sözleşme tamam" anlamına gelmez. Hesap kimlikleri, anahtarlar ve gerçek veri bu belgede yoktur.

## 1. Kural: uygunluğu doğrulanamayan aktarım kapalı kalır (karar 53A)

Mehmet'in 8 Kasım **53A** kararı: bir dış sağlayıcının ya da aktarımın uygunluğu doğrulanamıyorsa ilgili **veri aktarımı veya özellik kapalı kalır**, uygun alternatif araştırılır. Sözleşme/ülke/işleyen, bütçe ve #288 kabulü bitmeden otomatik GO yoktur. Bu belge, kararın hangi özelliği hangi sağlayıcıya bağladığını gösterir (§5).

## 2. Veri kategorileri (koddan)

| Kod | Kategori | Kaynak (kod/şema) | Not |
| --- | --- | --- | --- |
| K1 | Hesap | `users`: e-posta, kullanıcı adı, görünen ad, parola özeti (argon2), rol, `adult_declared_at` (#343) | |
| K2 | Oturum ve güvenlik | `sessions.ip_address`, `sessions.user_agent` (ham); MFA sırrı (şifreli), kurtarma kodu özetleri | Hız sınırı sayaçlarında IP **ham değil**: pepper'lı SHA-256 (`rate-limit/limiter.ts`) |
| K3 | İçerik | anket, seçenek, yorum, oy, tepki, topluluk | |
| K4 | Medya | yüklenen görseller (private orijinal + onaylı kopya) | |
| K5 | Moderasyon | rapor, yaptırım, itiraz, spam puanı (bayrak kapalı) | |
| K6 | Denetim | `audit_logs` (yapan, hedef, gerekçe, requestId) | append-only |
| K7 | E-posta | doğrulama/sıfırlama/bildirim e-postası (alıcı + tek kullanımlık bağlantı) | |
| K8 | Yedek | DB'nin tamamının şifreli kopyası (K1–K6) | Zarf şifreleme; özel anahtar sağlayıcıda değil (KV-48) |
| K9 | Trafik | her istekte IP, user-agent, çerez (proxy/CDN/barındırma katmanı) | Sağlayıcı loglarında kalır |
| K10 | Cihaz bildirimi (planlı, 45A/46A) | yetkili yöneticinin push token'ı ve cihaz kaydı | **Henüz yok** |

## 3. Şu an çalışan staging (2 Kasım'dan beri)

Staging test ortamıdır; gerçek kullanıcı verisi bulunmamalı. Taşıma kaydı: [FREE_HOSTING_MIGRATION_20261101.md](FREE_HOSTING_MIGRATION_20261101.md).

| Sağlayıcı | Rol (teknik) | Veri | Bölge (kaynak) | Sözleşme/DPA durumu |
| --- | --- | --- | --- | --- |
| Neon (PostgreSQL 18, Free) | DB barındırma | K1–K6 | **Doğrulanmalı.** Repoda DB bölgesi yok; aynı projedeki depolama `eu-central-1` (aşağıda), DB'nin de orada olduğu varsayılmamalı | Doğrulanmalı (Free planda DPA erişimi ve kapsamı) |
| Neon Object Storage (Free) | Medya depolama | K4 | `S3_REGION=eu-central-1` (`render.yaml`) | Doğrulanmalı |
| Render (Free, `kararver-api-free-preview`) | API + worker barındırma | K1–K7 bellekte/işlemde, K9 | `region: frankfurt` (`render.yaml`) | Doğrulanmalı (Free) |
| Render (Free, Mailpit test kutusu) | Test e-postası | K7 (yalnız test alıcıları) | `region: frankfurt` | Doğrulanmalı. **Production e-postası değildir** |
| Vercel (Hobby) | Web + `/api` proxy | K9; proxy üzerinden bütün API trafiği ve çerez; onaylı medya proxy'si | **Doğrulanmalı.** Repoda fonksiyon bölgesi ayarı yok (`vercel.json` yok) | Doğrulanmalı (Hobby; ticari kullanım kısıtı #51) |
| GitHub (kod, Actions, issue) | Geliştirme, CI, izleme | Kişisel veri **olmamalı**. Monitor yalnız `/health` ve ana sayfayı okur | ABD | Public repoya kişisel veri yazılmaz (kural) |

## 4. Durdurulmuş ama verisi duran sağlayıcı

| Sağlayıcı | Durum | Veri | Bölge | Yapılacak |
| --- | --- | --- | --- | --- |
| Railway | 4 dağıtım 2 Kasım itibarıyla durduruldu. **Kaynak veritabanları, 3 volume ve 2 bucket silinmedi** (bucket'lar son kontrolde boştu) | K1–K8 (staging dönemi) | KV-49 notu `sfo` (ABD); bucket ayarı `ams`. **Panelde doğrulanmalı** | 30 günlük yedek tavanı (8 Kasım) ve 53A'ya göre envanter + doğrulanmış güvenli tasfiye planı. Mehmet'in kuralı geçerli: "Veriler doğrulanmadan Railway'deki veritabanını, diskleri veya medya dosyalarını silmeyelim." |

Hesap sahibi Mehmet'tir. Silme kararı ve uygulaması ondadır; bu belge silme önermez, envanter tutar.

## 5. Planlanan aktarımlar ve 53A kapısı

| Özellik | Sağlayıcı | Veri | Durum | 53A sonucu (uygunluk doğrulanana kadar) |
| --- | --- | --- | --- | --- |
| Gece şifreli yedeği (#311, #186) | GitHub private repo, Actions artifact | K8 (yalnız `.enc`; manifest de şifreli) | Şablon hazır; private repo henüz yok | **Kapalı.** Repo, 0 $ limit, aktarım değerlendirmesi ve özel anahtar sahipliği tamamlanmadan çalışmaz |
| Production e-postası | Seçilmedi (31 Ekim adayı: Resend Free) | K7 | Seçim #51'de | **Kapalı.** Production'da gerçek e-posta gönderimi açılmaz |
| Acil güvenlik push yedeği (45A/46A) | Seçilmedi (ör. FCM / APNs / Web Push) | K10 | Karar var, uygulama yok | **Kapalı.** Push kanalı açılmaz; 49A gereği yetki devri kapalı kalır, e-posta + panel uyarısı sürer |
| CDN/DNS/proxy (production) | Seçilmedi (31 Ekim adayı: Cloudflare Free) | K9 (TLS sonlanması) | #51 | **Kapalı.** Yalnız DNS modu K9 aktarımını azaltır; karar gerekir |
| Bağımsız yedek bucket'ı (production) | Seçilmedi (31 Ekim adayı: Backblaze B2) | K8 | #51 | **Kapalı** |
| Uptime izleme | Seçilmedi (31 Ekim adayı: UptimeRobot Free) | Kişisel veri olmamalı (`/health`, ana sayfa) | #51 | Kişisel veri taşımıyorsa aktarım sayılmayabilir; teyit gerekir |
| İsteğe bağlı analitik (52A) | Yok | K9 + davranış | Varsayılan kapalı | **Kapalı** (52A ayrıca rıza/şart ister) |

## 6. Kod tarafında azaltma fırsatları

Karar Mehmet ve hukuk incelemesinde. Uygulama gerekiyorsa küçük PR'larla gelir.

| Konu | Bugün | Seçenek |
| --- | --- | --- |
| Oturum IP'si (K2) | `sessions.ip_address` ham, oturum yaşadıkça | Saklama süresi, kısaltma (/24, /48) veya pepper'lı özet. Hız sınırında özet zaten var |
| Oturum user-agent'ı (K2) | Ham, 512 karaktere kadar | Kısaltma veya yalnız tarayıcı ailesi |
| Proxy trafiği (K9) | Vercel `/api` proxy'si bütün API trafiğini taşır | Production'da doğrudan API alan adı veya yalnız DNS modu; ayrı değerlendirme |
| Yedek (K8) | Uçtan uca şifreli, özel anahtar sağlayıcıda değil | Aktarımın niteliğine dair karar hukukta; teknik koruma mevcut |
| Silinmiş kayıtların restore sonrası tekrar silinmesi | KV-48 restore 7. adım; ayrıca #322/#338 restore kapısı | #181/#321 ile bağlı |

## 7. Kabul koşulları: bugünkü teknik durum

| Koşul (#288) | Durum |
| --- | --- |
| Sağlayıcı/veri/rol/bölge haritası | **Kısmen.** Staging bu belgede; Neon DB ve Vercel bölgeleri panelde doğrulanmalı. Production sağlayıcıları #51'de seçilmedi |
| Her aktarım için m.9 mekanizması | **Açık.** Hukuki inceleme; bu belge seçim yapmaz |
| Sağlayıcı şartları gerçekten temin edildi, ücretsiz plan uygun mu | **Açık.** Free/Hobby planlarda DPA erişimi doğrulanmalı. Uygun değilse 53A gereği aktarım/özellik kapalı ya da alternatif |
| Standart sözleşme, imza ve 5 iş günü bildirim | **Açık.** Mehmet; bu issue imza veya bildirim yetkisi değildir |
| Aydınlatma/çerez metni ↔ gerçek yapılandırma | **Açık.** #286/#287 ile; production yapılandırması kesinleşince bu tablo kaynak olur |
| Minimizasyon, silme, şifreli yedek, restore sonrası tekrar silme | **Kısmen.** §6; #181/#51/#322 |
| Bütçe kapıları | **Korunuyor.** Hiçbir sağlayıcıda ücretli plana geçilmedi; uyum belgesi için plan yükseltilmez |

## 8. Değişiklik tetikleyicisi

Yeni sağlayıcı, bölge değişikliği, yeni veri kategorisi (ör. K10 push) veya production geçişi bu belgeyi ve #288 incelemesini **yeniden açar**. `render.yaml`, Vercel/Neon proje ayarı veya yeni bir dış servis entegrasyonu ekleyen PR, bu tabloyu da güncellemelidir.

**Durum: NO-GO.** Teknik envanter kısmen hazır; hukuki aktarım kararı, sözleşmeler ve production sağlayıcı seçimi açık.
