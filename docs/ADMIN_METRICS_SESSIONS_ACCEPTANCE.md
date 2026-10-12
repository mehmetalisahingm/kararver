# Yönetim metrikleri ve oturum kabulü

## Operasyon metrikleri (#179)

`GET /v1/admin/metrics?range=7d|30d` gerçek PostgreSQL verisini tek RepeatableRead transaction ve tek saat kesitiyle okur. Dönem günleri Europe/Istanbul takvimine göre oluşturulur. Son 24 saat kayıt ve etkinlik pencereleri gelecekteki olayları dışlar.

- Hesaplar: silinmemiş toplam, ACTIVE ve SUSPENDED ayrı sayaçlar.
- Aktif kullanıcı/24s: silinmemiş ACTIVE hesapların iptal edilmemiş, süresi geçmemiş oturumlarında son kullanım veya yeni oturum; kullanıcı tekilleştirilir.
- Günlük kullanıcı: o gün oturum açan silinmemiş tekil hesaplar. Tarihsel giriş olayıdır, çevrimiçi kişi sayısı değildir.
- Topluluk üyeleri: ACTIVE topluluklardaki silinmemiş ACTIVE hesaplar; birden çok topluluğa üyelik bir kez sayılır.
- Medya: PENDING ve QUARANTINED ayrı sayaçlar. Moderasyon: son 24 saatte kaydedilen işlem sayısı.
- Operasyon toplamları yönetici ve test hesaplarını da kapsar. KV-07 ürün analitiğinin `actor_type` dışlama kuralı bu operasyon endpoint'inden bağımsızdır; ürün analitiği toplama hattı #55'te izlenir.

Worker gecikmesi ve servis hata oranı henüz bu endpoint'te sunulmaz. #179'un tüm kabul koşullarını tamamlamak için ayrıca operasyon sağlık entegrasyonu ve staging kontrolü gerekir.

## Oturum yönetimi (#180)

Yalnız SUPER_ADMIN hedef hesabın geçerli oturumlarını listeler ve gerekçeli tekil/toplu iptal yapar. Liste açık alan seçimi kullanır: token/password hash veya ek store alanları yanıta sızmaz. `ipAddress` uyumluluk alanı IPv4 /24 veya IPv6 /48 ağını; `userAgent` bilinen tarayıcı/işletim sistemi kategorisini taşır. Tam IP ve ham cihaz tanımlayıcısı arayüze gönderilmez.

İptal hedef kullanıcı ve isteğe bağlı oturum ID'siyle aynı transaction'da sınırlandırılır; audit'e aktör, hedef, kapsam, sayı, gerekçe ve request ID yazılır. Eski cookie sonraki istekte geçersizdir. Yetki transaction içinde yeniden okunur. Cursor başka kullanıcı listesinden taşınamaz.

Yönetici kendi oturumlarını bu yönetim endpoint'iyle sonlandıramaz; #180/#182 yeniden doğrulama akışı tamamlanana kadar 403 ile kapalıdır. Normal kullanıcının kendi çıkış akışı kullanılabilir.

#180 için MFA/yeniden kimlik doğrulama, güvenlik olayları ve anomali görünümü henüz tamamlanmamıştır.

## Kanıt

- `admin-sessions-routes.test.ts`: hassas alanların sızmaması, IPv4/IPv6 maskeleme ve cihaz kategori testleri.
- `admin-sessions-postgres.test.ts`: gerçek PostgreSQL ile rol sınırları, cursor kapsamı, yanlış hedef oturumunun korunması, toplu iptal, cookie reddi, audit ve rol geri alma.
- `admin-metrics-postgres.test.ts`: gerçek PostgreSQL ile İstanbul gece yarısı, 7/30 günlük seri, aktif kullanıcı tekilleştirme, iptal/süre/durum filtreleri, medya ve topluluk sayaçları.

PostgreSQL testleri CI'da TEST_DATABASE_URL ile çalışır. Yerel makinede veritabanı erişimi yoksa atlanan test başarı kanıtı sayılmaz. Tarayıcı fixture testi staging verisinin doğruluğunu kanıtlamaz.
