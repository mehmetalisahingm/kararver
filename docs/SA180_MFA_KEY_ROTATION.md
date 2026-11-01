# SA-180 / #291 — MFA anahtarını ayırma ve oturum pepper'ını kilitlenmeden değiştirme

**Durum:** Kod ve test hazır; staging'de **uygulanmadı**. Ortam değişkeni değişikliği ve deploy, Mehmet'in onayıyla ve bir bakım penceresinde yapılır. Bağlantılar: #180, #291, #51, [SA180 MFA kilitlenmesi](SA180_SUPER_ADMIN_MFA_LOCKOUT.md), [KV-48 yedek](KV-48_BACKUP_RESTORE.md).

## Neden
Bu değişiklikten önce MFA'nın iki parçası oturum pepper'ına (`AUTH_TOKEN_PEPPER`) bağlıydı:
- TOTP sırrının şifreleme anahtarı;
- kurtarma kodlarının özeti.

Railway güvenlik olayı (21 Ekim) sonrası pepper'ın değiştirilmesi gerekiyor. Pepper doğrudan değişirse MFA kaydı olan **herkes kilitlenir**: TOTP sırrı çözülemez, kurtarma kodları da geçmez. Bu, #180'deki "cihaz + kurtarma kodu kaybı" durumunu herkese birden yaşatır.

## Ne değişti (kod)
- **TOTP sırrı sürümlü şifreleniyor** (`apps/api/src/modules/security/encryption.ts`):
  - **v1:** pepper'dan türetilmiş eski biçim.
  - **v2:** ayrı `MFA_ENCRYPTION_KEY`'den türetiliyor.
  - Okurken ilk bayta göre doğru anahtar seçilir.
  - Ayrı anahtar varken yeni kurulumlar v2 yazılır. v1 kayıt, başarılı her TOTP doğrulamasında aynı transaction içinde v2'ye taşınır.
- **Kurtarma kodları:** Yeni kodlar ayrı anahtarla özetlenir. Doğrulamada hem yeni hem eski özet kabul edilir. Kodlar düz saklanmadığı için eski özetler taşınamaz; pepper değiştikten sonra eski değer `MFA_LEGACY_PEPPER`'da tutulursa çalışmaya devam eder.
- **`pnpm --filter @kararver/api mfa:rekey [--apply]`:** Bütün v1 kayıtları toplu taşır. Varsayılan deneme yazmaz, yalnız her kaydın çözülebildiğini doğrular. Çözülemeyen kayıt varsa çıkış kodu 1 ve "pepper değiştirilmez" der.
- **Yapılandırma kuralları:**
  - `MFA_ENCRYPTION_KEY` ve `MFA_LEGACY_PEPPER` isteğe bağlı, en az 32 karakter.
  - Ayrı anahtar oturum pepper'ıyla aynı olamaz.
  - `MFA_LEGACY_PEPPER` yalnız ayrı anahtarla birlikte verilir.
  - Hiçbiri verilmezse davranış bugünküyle birebir aynı.

## Uygulama sırası (staging; production'da yeni kurulumda 1. adımdan başlanır)

**0. Ön koşul (salt okuma):**
- (a) Güncel yedek + ayrı DB'ye restore doğrulaması (KV-48).
- (b) MFA kaydı sayısı ve sahibin (SUPER_ADMIN) MFA durumu, salt okuma sorguyla.
- (c) Bakım penceresi ve geri dönüş sorumlusu belli.
- (d) Bu PR'ın sürümü staging'de çalışıyor.

**1. Ayrı anahtar:**
- 48+ karakterlik rastgele bir değer üret (ör. `openssl rand -base64 48`). Değer şifre yöneticisinde saklanır; issue, PR ya da loga yazılmaz.
- Değeri `MFA_ENCRYPTION_KEY` olarak api servisine gir ve deploy et.
- **Doğrula:**
  - `/health` ok;
  - test hesabıyla giriş + TOTP step-up çalışıyor (kayıt bu sırada v2'ye taşınır);
  - yeni MFA kurulumu çalışıyor.

**2. Toplu taşıma:** Aynı ortam değişkenleriyle `mfa:rekey` (deneme) çalıştır. Beklenen `çözülemeyen: 0`. Sonra `--apply`. Beklenen sonuç: `v1: 0` ya da "bütün kayıtlar ayrı anahtarda".

**3. Pepper değişimi:**
- `MFA_LEGACY_PEPPER = <eski AUTH_TOKEN_PEPPER>` ve `AUTH_TOKEN_PEPPER = <yeni rastgele değer>` olarak gir, deploy et.
- **Beklenen etkiler:**
  - bütün oturumlar geçersiz, herkes yeniden giriş yapar;
  - bekleyen doğrulama ve sıfırlama bağlantıları geçersiz;
  - hız sınırı sayaçları sıfırlanır.
  - TOTP ve kurtarma kodları **çalışmaya devam eder**.

**4. Doğrulama:**
- test hesabıyla giriş + TOTP step-up;
- **eski** bir kurtarma kodunun kabul edilmesi (test hesabı);
- `mfa:rekey` deneme raporunda `v1: 0`;
- smoke.

Kanıt yalnız sayı ve durum kodlarıyla #291'e yazılır.

**5. Sonra:** `MFA_LEGACY_PEPPER` artık yalnız eski kurtarma kodu özetlerini doğrular. Kodlar 128 bit rastgele olduğu için bu değerle tahmin edilemez. Kaldırılırsa eski kodlar geçersiz olur. Kaldırmadan önce kullanıcıların yeni kurtarma kodu alabileceği bir akış gerekir (bugün kodlar yalnız kurulumda veriliyor; ayrı iş).

## Geri dönüş
- **1. adımda sorun:** `MFA_ENCRYPTION_KEY` **kaldırılmaz**. Bu arada v2 yazılmış kayıtlar (yeni kurulum ya da taşınan hesap) anahtarsız çözülemez. Anahtar yerinde bırakılıp sorun düzeltilir.
- **Uygulama sürümü:** Bu PR'dan **önceki** bir sürüme rollback, v2 kayıtları okuyamaz ve o hesapları kilitler. 1. adımdan sonra uygulama rollback'i yalnız bu PR'ı içeren sürümlere yapılır. Zorunlu durumda, 1. adımdan önce alınan DB yedeğine dönülür (KV-48); o andan sonraki veri kaybedilir, karar Mehmet'te.
- **3. adımda sorun:** Eski pepper `AUTH_TOKEN_PEPPER`'a geri yazılabilir. Oturumlar yine düşer; MFA etkilenmez çünkü kayıtlar v2.
- **Kilitlenen hesap:** [SA180 MFA kilitlenmesi](SA180_SUPER_ADMIN_MFA_LOCKOUT.md) prosedürü. DB'den MFA sırrını elle silmek kurtarma yöntemi değildir.

## Yeni sağlayıcı (#297)
Arındırılmış taşımada MFA kayıtları zaten silinir (`db:sanitize`). Yeni ortamda ilk günden `MFA_ENCRYPTION_KEY` verilir, `MFA_LEGACY_PEPPER` gerekmez. Bütün sırlar staging'den kopyalanmadan yeniden üretilir.

## Testler
- `apps/api/test/mfa-keys.test.ts`:
  - sürümler;
  - taşıma;
  - pepper değişiminde v1'in çözülememesi ve v2'nin çözülmesi;
  - kurtarma kodu v1/v2;
  - yapılandırma kuralları;
  - PostgreSQL'de toplu taşıma: deneme yazmaz, yanlış eski sırla çözülemeyen kayda dokunulmaz, `--apply` sonrası yeni pepper ile çözülür.
- Mevcut `mfa.test.ts` ve step-up kullanan bütün testler değişmeden geçiyor.
