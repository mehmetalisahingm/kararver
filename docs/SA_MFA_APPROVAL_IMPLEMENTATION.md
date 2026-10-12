# SUPER_ADMIN MFA / bağımsız onay tasarım kontratı (SA #180, #182)

**Durum: AŞAMA 1 (yalnız algoritma ve saf politika).** Bu PR hiçbir kullanıcıyı MFA'lı yapmaz, mevcut role grant yetkisini değiştirmez ve güvenlik kabulünü kapatmaz.

## Sunulan
- RFC 4226/6238 TOTP SHA1, 30 sn/6 hane; 20 bayt rastgele secret, canonical Base32, sabit-zamanlı OTP karşılaştırma.
- `matchTotpStep` kabul edilen tek zaman sayacını verir; `lastAcceptedStep` tekrarını reddeder. Servis bu değeri **aynı PostgreSQL row lock transaction'ı içinde** yazmadan MFA doğrulandı saymayacak.
- İki ayrı SUPER_ADMIN onayında aynı aktör, aynı onaylayan, süresi dolmuş istek, eski hedef rol/revizyon ve geçersiz MFA step-up engellenir. `canApproveRoleChange` ancak store'un DB'den ürettiği verified bağlamla kullanılabilir.
- RFC test vektörü, replay/skew, stale-role, impersonation ve TTL testleri.

## Zorunlu sonraki aşama — yapılmadan etkinleştirme
1. Migration: `user_mfa_credentials` (KMS-encrypted TOTP secret, **hash** recovery codes, last_accepted_step); `session_stepups` (session binding, expires, revoked); `role_change_approvals` (context binding/version, state, actors, expiry, uniqueness) ve audit olayları.
2. Enrollment: doğrulanmış e-posta + mevcut parola + TOTP doğrulama. QR/secret yalnız enrollment sırasında; logger/audit cevabına secret düşmeyecek. Recovery codes tek sefer gösterilecek.
3. Verification: actor/session/step-up fresh+one-use, eşzamanlı kodu yalnız bir DB transaction kabul edecek; MFA reset, session revocation, brute-force limit, kurtarma politikası.
4. Rol atama ve kritik işlemlerin mevcut backend endpoint'leri bu gate'i **transaction içinde** zorunlu kılacak; feature enable ancak tüm mevcut SUPER_ADMIN hesapları güvenli enrollment yoluna sahip olunca. Başarısız/boş state fail-closed.
5. İkinci approver isteği **farklı SUPER_ADMIN**, server-side hedef rol/sürüm/actor binding, tek tüketim; son aktif SUPER_ADMIN asla düşürülemez.
6. Gerçek PostgreSQL eşzamanlı testleri, staging iki hesap MFA/approval + rate limit/audit/401/403, mobil accessible UI, rollback planı.

## Güvenlik notu
Bu aşamada henüz gerçek MFA veya çift onay uygulanmıyor. Sadece saf yardımcılar var; PR merge edilse bile #180/#182 ve #46 açık kalır. Server-side backend gate tamamlanmadan "MFA korumalı" ibaresi kullanılmaz.
