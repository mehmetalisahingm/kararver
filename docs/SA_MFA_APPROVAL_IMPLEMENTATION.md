# MFA ve bağımsız kritik rol onayı (#180, #182)

Bu dilim, PostgreSQL store'ları ve hesap güvenliği ekranını içerir. `ROLE_APPROVALS_REQUIRED=false` varsayılanı korunur: kodun bulunması kritik rol değişikliklerinin canlı ortamda korunduğunu göstermez. #180/#182 ve yayın güvenlik kabulü ayrı izlenir.

## Kurulum ve kurtarma

- `/hesap/guvenlik`: mevcut parola → doğrulayıcıya eklenen Base32 anahtar → 6 haneli TOTP onayı. Kurulum 10 dakika, başlatan oturuma bağlıdır. E-posta kontrolü mevcut `EMAIL_VERIFICATION_REQUIRED` politikasını izler.
- RFC 6238 SHA1, 30 saniye, 6 hane. Hesap satırı kilidi ve `last_accepted_step` aynı kodun eşzamanlı veya sonradan tekrarını reddeder. Beş başarısız deneme 15 dakika kilitler.
- Secret AES-256-GCM ile, kullanıcı UUID'si AAD olarak şifrelenir. Anahtar mevcut `AUTH_TOKEN_PEPPER` değerinden ayrı alan adıyla türetilir; KMS entegrasyonu yoktur. Bu değer değiştirilirse eski TOTP secret'ları çözülemez; rotasyon öncesi kontrollü yeniden kurulum gerekir.
- Kurulum onayında 10 rastgele, 128 bit kurtarma kodu **yalnız bir kez** gösterilir. Veritabanında kullanıcıya bağlı HMAC-SHA256 özetleri bulunur. Kurtarma mevcut parola, aktif oturum ve kullanılmamış kod ister; aynı hesap kilidini paylaşır. TOTP'yi kapatmaz, kısa süreli yeniden doğrulama sağlar.
- Kurulum, etkinleştirme, başarılı doğrulama/kurtarma, ret ve kilit audit olayları aynı transaction'da yazılır. Secret, OTP, kurtarma kodu, parola ve oturum numarası audit özetine yazılmaz. Ekran kimlik değiştiğinde hassas state'i bırakır; localStorage kullanılmaz.

## İki yönetici rol değişimi

1. İki farklı aktif SUPER_ADMIN kendi doğrulayıcılarını kurar.
2. Başlatan `/hesap/guvenlik` ekranında yeniden doğrular; hedef kullanıcı UUID'si, yeni rol ve gerekçeyle onay talebi açar. Yeniden doğrulama tüketilir.
3. Farklı yönetici onay UUID'siyle hedefi, önceki/yeni rolü ve gerekçeyi inceler, kendi MFA yeniden doğrulamasıyla onaylar. Başlatan ve hedef onaylayamaz.
4. Başlatan tekrar MFA doğrular; kullanıcı yönetiminde aynı hedef, rol, gerekçe ve onay UUID'siyle uygular.
5. Mutation transaction'ı hedef rolü/revizyonunu, 10 dakika TTL'yi, her iki yöneticinin güncel yetkisini ve oturumunu kontrol eder; onay ve MFA bir kez tüketilir. Son aktif SUPER_ADMIN koruması devam eder.

`ROLE_APPROVALS_REQUIRED=true` yalnız SUPER_ADMIN verme/alma işlemlerini kapsar. Topluluk sahipliği, hesap silme ve diğer kritik işlemler bu rol onayını kendi izinleri yerine kullanamaz. Bunların güvenlik entegrasyonu ayrı kabul gerektirir.

## Etkinleştirme ve kabul

- Otomatik kabul: RFC vektörleri, gerçek PostgreSQL replay/eşzamanlılık, hesap/oturum bağlama, kurtarma tek kullanımı ve kilit, eski/değişmiş/silinmiş hedef, son yönetici ve audit mahremiyeti.
- Tarayıcı kabulü: masaüstü/mobil kurulum, kodları gizleme, kurtarma hatası/tekrar deneme ve onay ayrıntısı inceleme. Fixture testi gerçek staging hesabı yerine geçmez.
- Canlı etkinleştirme öncesi iki bağımsız yöneticiyle staging akışı, negatif yetki, tek kullanım ve audit kanıtı gerekir. Sürekli yetkili yöneticilerin kendi enrollment/kurtarma kodlarını güvenli saklaması ayrıca gereklidir.
- Rollback: önce enforcement'ı kapatıp önceki doğrulanmış uygulamaya dön; şifreleme anahtarını ve MFA kayıtlarını koru. Migration/tablo silinmez. Enforcement kapalıyken yeni ikinci-onay güvencesi var sayılmaz.

Gerçek staging kabulü tamamlanmadan bu PR draft kalır; genel MFA zorunluluğu veya tüm kritik işlemler tamamlandı diye issue kapatılmaz.
