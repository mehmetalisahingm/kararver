# Mehmet — V1 uygulama ve kabul ilerlemesi

15 Ekim 2026; #191, #194, #46, #48, #52 ve #189/#2. Test sonucu ile ürün/yayın kabulü ayrı tutulur.

## Gerçek staging HTTP kanıtı

API `ae3ff8f38467`, web `https://kararver-staging.vercel.app`. Bu API commit'i GitHub main'in atasıdır; kontroldeki main `8a4a6047a4c0` ile fark yalnız güvenlik workflow'u ve belgesidir. API/worker sağlıklı. 15 Ekim 2026 19:56 UTC'de kendi oturumu üzerinden HTTPS proxy kontrolü: **17 PASS / 0 FAIL**.

| Kontrol | Gerçek sonuç |
| --- | --- |
| Giriş / profil geri yükleme | 200 / 200 |
| Cookie | Secure, HttpOnly, SameSite=Lax; Domain yok |
| Özel yanıtlar | private, no-store |
| SUPER_ADMIN kullanıcı ve operasyon okuması | 200 / 200; yanıtlardaki kişisel veriler rapora alınmadı |
| Saldırgan Origin ile çıkış | 403; ardından aynı oturum /me 200 |
| Normal çıkış | 204 |
| İptal edilmiş cookie tekrarı | 401, no-store, Max-Age=0 |

Kod: `scripts/staging-session-acceptance.mjs`. Yalnız kendi test oturumunu açar/kapatır; içerik, hesap rolü veya ayar değiştirmez. Kimlik bilgilerini `KV_STAGING_EMAIL` / `KV_STAGING_PASSWORD` ortamından alır; raporda parola, cookie, kullanıcı kimliği veya e-posta bulunmaz. Başarısızlıkta da kendi oturumunu kapatır. Güvenlik birim testinde USER ve SUPER_ADMIN, CSRF hatası, cookie hatası ve ağ hatasında temizleme kontrol edilir. Gerçek staging USER rolü bu koşuda test edilmedi.

Anonim `scripts/security-acceptance.mjs`: **25 PASS / 0 FAIL**; özel uçlar 401, HSTS mevcut, saldırgan Origin yansıtılmadı. Bu iki kontrol #46 S08'e kısmi ve S09 logout/replay'e ek kanıttır. Tam S01–S10 kabulü değildir.

## Bulunan ve düzeltilen ürün sorunları

- #191: Tanıtımı geçmiş misafirin ana sayfası giriş duvarına dönüyordu. Artık tanıtımdan “Üye olmadan akışı keşfet” ile çıkabilir; sonraki ziyarette akış doğrudan açılır. Giriş istemi etkileşimde kalır; demo seçimi gerçek oy üretmez. İlgi alanı taslağı korunur.
- #191: Eksik/süresi dolmuş şifre bağlantısında yeni bağlantı isteme yolu eklendi. Doğrulama ekranından yeniden giriş ve bağlantı isteme yolu açık. Güvenli returnTo korunur; token fragment'ten temizlenir ve açık onay olmadan gönderilmez.
- #194: Rol değişiminde kullanıcı adı, kimlik ve mevcut/yeni rol açık gösterilir. Kritik rol uyarısı ve aynı işlem penceresinde MFA doğrulaması vardır. MFA başarısızsa rol isteği gönderilmez; API reddederse pencere açık kalır. İkinci onay enforcement ayarı backend'in sorumluluğundadır; bu UI onu etkinleştirmez veya atlamaz.
- #194/#48: Yönetim mutasyonu beklerken alanlar kilitlenir, tekrar submit engellenir, Escape işlemi yarıda kapatmaz. Başarı yalnız API onayıyla gösterilir.
- #52: Gerçek staging anket HTML'i `index, follow` üretiyordu. İçerik metadata'sı artık yalnız APP_ENV=production için indekslenir. Hesap/admin/auth/özel indirme ve oluşturma yollarına bağımsız noindex metadata'sı eklendi; robots.txt'deki yanlış şifre yolu gerçek yollarla değiştirildi.

## Otomatik doğrulama

- Web birim/adaptör takımı: 139 PASS, 2 PostgreSQL gerektiren test yerelde atlandı (CI database işi ayrı).
- Güvenlik betikleri: 10/10; SEO ortam politikası: 2/2; web typecheck temiz.
- WebKit masaüstü ve 360px auth kurtarma, rol işlemi ve onboarding regresyonu: 26/26. İlk turda iki yeni testin locator hatası bulundu ve düzeltildi; başarısız ilk tur kabul kanıtı değildir.
- Önceki aynı aday diliminde hesap silme, MFA, admin erişim negatif testleri: 16/16. HTTP fixture tarayıcı testi gerçek staging veya fiziksel Safari kabulü değildir.

## Kapanış için kalanlar

| Issue | Kalan somut kabul |
| --- | --- |
| #191 | Gerçek sağlayıcı e-posta teslimi; fiziksel iPhone/Safari ve son staging akışı |
| #194 | Kritik backend onaylarının bütünleşik iki yönetici kabulü; kalan admin modülleri ve gerçek cihaz QA |
| #46 | 20 paralel oy + DB uyumu, iki topluluk scope testi, model/medya kesintisi, rate limit/yaptırım, kontrollü emergency pencere, doğal TTL expiry, tam P0/P1 taraması |
| #48 | Fiziksel iOS/Android, VoiceOver/TalkBack/NVDA; kontrollü gerçek sunucu 500/toparlanma, doğal expiry ve beta sonrası kabul |
| #47 | Güvenlik GO sonrası gerçek katılımcılar ve ölçümler; mevcut beta hazırlığı gerçek beta sonucu değildir |
| #52 | X/WhatsApp gerçek önizleme/cache kabulü ve gerçek beta funnel verisi; olgun kohort olmadan D7 yok |
| #54 | #46/#47/#48/#51/#52/#53 kanıtları ve kayıtlı yayın kararı |
| #57–#59 | `MEHMET_POST_RELEASE_DESIGN.md` tasarım hazırlığı; #54, gerçek beta verisi ve ürün eşikleri bekler |

Bu kapsamlar açık tutulur; uygulanan dilimler, eksik kabul kapılarının yerine sayılmaz. #189/#2 koordinasyonu bu kanıtlarla güncellenir.
