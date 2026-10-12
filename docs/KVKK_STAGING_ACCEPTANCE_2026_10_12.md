# KVKK staging güvenlik kabulü — 12 Ekim 2026

## Kanıtlanan
- Railway API /health staging release `01142c93452b`, worker status ready.
- 12 Ekim deploy `26627055-d17b-4e37-b945-d38093dfe14a` SUCCESS; PostgreSQL `20261011120000_mert_sa181_data_exports` migration başarıyla uygulandı.
- Vercel `main` `01142c93452b1095844c2b91cb0d061880db5634` READY, `/veri-indir` yayında.
- CI gerçek PostgreSQL KVKK entegrasyon testlerini, API/worker şifreleme ve audit senaryolarını çalıştırır. Bunlar canlı Mailpit, S3 veya gerçek kullanıcı kabulü yerine geçmez.
- `scripts/staging-kvkk-smoke.mjs` yalnız sağlık ve oturumsuz erişim redlerini doğrular. Kişisel veri üretmez/çekmez.

## Oturum gerektiren gerçek staging kabulü — henüz doğrulanmadı
1. Yeni **ayrı test hesabı** oluştur; doğrulama zorunluysa kayıt sonrası doğrulama bağlantısını Mailpit'ten aç. Gerçek kullanıcı hesabı veya gerçek kişisel veri kullanma.
2. Doğrulamadan giriş ve oy/oluşturma yasağını, doğrulamadan sonra izinleri denetle. Staging `EMAIL_VERIFICATION_REQUIRED` ayarı ve mail gönderim modu doğrulanmalı; sadece değişken adının varlığı yeterli kanıt değildir.
3. Test SUPER_ADMIN ile gerekçeli KVKK veri talebi oluştur (`POST /v1/admin/users/:id/data-exports`); test hesabının verisiyle sınırlı tut.
4. `data-exports.build` job'ının `READY` durumuna geçmesini, özel kovada şifreli paketi ve audit'i doğrula.
5. Bağlantıyı yalnız kullanıcının e-posta kutusuna gönder; yöneticide token veya indirme içeriği olmamalı.
6. Test hesabında token + oturum ile indir; yanlış hesapla 400, oturumsuz 401; tekrar indirme sınırı 3, TTL ve süresi dolma.
7. İçerikte başka hesap kimliği, parola/token hash'i, moderasyon sırları bulunmadığını gözden geçir; özel test verisini temizle.
8. Mailpit staging içinde erişilebilir olmalı. Gerçek SMTP sevki ayrıca gereklidir; Mailpit test e-postalarının gerçekten teslim edildiği anlamına gelmez.

## Koruma
Bu belge staging hesabı erişimi olmadan `GO` demek için kullanılamaz. #46/#53/#181 açık kalır; gerçek kabul kanıtı ve kararlar issue'lara işlenir.
