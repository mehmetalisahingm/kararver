# SA-180 / #291 — MFA anahtarını ayırma ve oturum pepper'ını kilitlenmeden değiştirme

**Durum:** Kod ve test hazır. Staging'de (Neon + Render, #297) **uygulanmadı**. Ortam değişkeni değişikliği ve deploy, Mehmet'in onayıyla ve bir bakım penceresinde yapılır. Bağlantılar: #180, #291, #51, [SA180 MFA kilitlenmesi](SA180_SUPER_ADMIN_MFA_LOCKOUT.md), [KV-48 yedek](KV-48_BACKUP_RESTORE.md), [KV-49 sır listesi](KV-49_OPERATIONS.md).

## Neden
Bu değişiklikten önce MFA'nın iki parçası oturum pepper'ına (`AUTH_TOKEN_PEPPER`) bağlıydı:
- TOTP sırrının şifreleme anahtarı;
- kurtarma kodlarının özeti.

Bir sır sızıntısı şüphesinde ya da düzenli rotasyonda pepper'ın değiştirilmesi gerekebilir. Pepper doğrudan değişirse MFA kaydı olan **herkes kilitlenir**: TOTP sırrı çözülemez, kurtarma kodları da geçmez. Bu, #180'deki "cihaz + kurtarma kodu kaybı" durumunu herkese birden yaşatır.

## Bu değişiklik neyi çözer, neyi ÇÖZMEZ
- **Çözer:** Pepper değişiminin MFA'yı kilitlemesini. Oturum token'ları, sıfırlama bağlantıları ve hız sınırı anahtarları yeni pepper'a geçer; MFA ayrı anahtarla çalışmaya devam eder.
- **Çözmez: eski kopya riski.** Taşıma (v1 → v2) **aynı TOTP sırrını** yeni anahtarla yeniden şifreler; kurtarma kodları da aynı kalır. Eski pepper ile veritabanının (ya da bir yedeğin) bir kopyası birlikte ele geçmişse, o kopyadaki v1 kayıtlarından TOTP sırrı çözülebilir. Bu riski yalnız **yeni TOTP kaydı** (yeni sır) ve **yeni kurtarma kodları** kapatır.
- **Yeniden kayıt kararı:** Etkilenme kapsamı #291'in özel olay dosyasında değerlendirilir; bu public belgede ayrıntı yok. Karar seçenekleri ve asgari ilke:
  1. **Gerekli değil:** Değerlendirme, DB kopyası ile eski pepper'ın birlikte ele geçirilmediği sonucuna varır. Gerekçe ve tarih #291 özel dosyasına yazılır.
  2. **Yetkili hesaplar için gerekli (önerilen asgari):** `ADMIN` ve üstü her hesap, pepper değişiminden sonra yeni TOTP kurar ve yeni kurtarma kodu alır. Önce **en az ayrıcalıklı yönetici hesabıyla** prova yapılır; SUPER_ADMIN en son, kurtarma planı hazırken.
  3. **Herkes için gerekli.**
- **Bugünkü sınır (güncellendi, 7 Kasım 2026):** Kullanıcının kendi TOTP sırrını ve kurtarma kodlarını **kilitlenmeden** yenilediği akış artık var: **Hesap güvenliği → "Doğrulayıcıyı yenile"** (`me.mfa.reenroll.begin` / `me.mfa.reenroll.confirm`, ayrıntı aşağıda "Doğrulayıcı yenileme"). Akış yalnız sağlanır; ayrıcalıklı hesapların yeniden kaydı **başlatılmadı**, 5. adımdaki sırayla ve Mehmet'in onayıyla yapılır. Kalan sınırlar:
  - akış sunucuda `MFA_ENCRYPTION_KEY` yoksa kapalıdır (409 `mfa_key_required`), yani 1. adım uygulanmadan yeniden kayıt yapılamaz;
  - MFA'yı tamamen kapatma akışı yoktur (bilinçli; yenileme kapatmadan yapılır);
  - doğrulayıcısını ve bütün kurtarma kodlarını kaybetmiş hesap bu akışı kullanamaz: [SA180 MFA kilitlenmesi](SA180_SUPER_ADMIN_MFA_LOCKOUT.md).
  DB'den MFA kaydını elle silmek kabul edilmez; akış da hiçbir kaydı silmez.

**Karar (Mehmet, 7 Kasım 2026, #300):** Eski DB+pepper ifşası şüphesi olan **ayrıcalıklı MFA hesapları** için yeni TOTP sırrı ve yeni kurtarma kodlarıyla **kontrollü yeniden kayıt** (2. seçenek). Kullanıcıyı kilitleyecek zorunlu toplu işlem yok; önce alternatif doğrulanmış bir ADMIN ve owner kurtarma planı hazırlanır. Kod merge'i anahtar ya da pepper rotasyonunu onaylamaz: staging/production anahtarları ve mevcut pepper bu aşamada **değiştirilmez**. Ön koşul: yukarıdaki "bugünkü sınır" kalkmalı, yani kullanıcının kendi TOTP sırrını ve kurtarma kodlarını yenileyebildiği akış (#180, ayrı PR) yazılmalı. **Durum:** akış #300'e bağlı ayrı PR'da yazıldı; bu PR yeniden kaydı başlatmaz.

## Doğrulayıcı yenileme (#180/#291)
Kullanıcı kendi MFA'sını kapatmadan yeni TOTP sırrı ve yeni kurtarma kodları alır. Tasarım ilkesi: **onaya kadar eski sır geçerli, hiçbir adımda kilitlenme yok.**
1. **Başlatma** (`POST /me/mfa/reenroll`, parola): bu oturumda taze ve **kullanılmamış** bir step-up gerekir (mevcut TOTP ya da kurtarma koduyla). Başlatma onu tüketir. Yeni sır `user_mfa_credentials.reenroll_*` bekleyen alanlarına, her zaman v2 (ayrı anahtar) ile ve başlatan oturuma bağlı olarak 10 dakikalığına yazılır. Etkin `secret_cipher` ve kurtarma kodları **değişmez**. Yeni başlatma bekleyen öncekinin yerine geçer.
2. **Onay** (`POST /me/mfa/reenroll/confirm`, YENİ sırdan kod): kod yanlışsa, eski sırdan geliyorsa, süre dolmuşsa ya da başka oturumdan geliyorsa hiçbir şey değişmez; eski sır çalışmaya devam eder. Deneme sayacı step-up ile ortaktır (5 hatada 15 dk kilit).
3. Onay başarılıysa **tek transaction'da**: yeni sır etkin olur (v2), bekleyen alan temizlenir, kullanılmamış bütün eski kurtarma kodları `revoked_at` ile **iptal edilir** (silinmez), 10 yeni kod üretilir ve bir kez gösterilir, `account.mfa`/`reenroll` audit kaydı yazılır, **diğer oturumların** açık step-up'ları düşürülür. Eşzamanlı iki onaydan yalnız biri kazanır (satır kilidi).
- **Audit:** `reenroll_begin` ve `reenroll`. Özette yalnız sayılar var (`cipherVersion`, verilen/iptal edilen kod sayısı, düşürülen step-up sayısı); sır, kod ya da şifreli kayıt yok.
- **Migration:** `20261107120000_faruk_sa180_mfa_reenroll` (yalnız sütun ekler; mevcut kayıtlara dokunmaz, geriye uyumlu).
- **Yeniden kayıt provası (5. adım):** hesap sahibi giriş yapar → step-up → "Doğrulayıcıyı yenile" → yeni anahtarı uygulamaya ekler → yeni kodla onaylar → yeni kurtarma kodlarını saklar → **yeni** kodla bir step-up daha yapar. Uygulamadaki eski kaydı ancak bundan sonra siler. Kanıt yalnız audit sayısıyla (#291) yazılır.

## Ne değişti (kod)
- **TOTP sırrı sürümlü şifreleniyor** (`apps/api/src/modules/security/encryption.ts`, ilk bayt):
  - **v1:** pepper'dan türetilmiş eski biçim.
  - **v2:** ayrı `MFA_ENCRYPTION_KEY`'den türetiliyor.
  - Ayrı anahtar varken yeni kurulum v2 yazılır. v1 kayıt, başarılı her TOTP doğrulamasında **aynı transaction içinde** v2'ye taşınır.
- **Eski sırlar bir LİSTE:** `MFA_LEGACY_PEPPERS`. Güncel `AUTH_TOKEN_PEPPER` + virgülle bütün eski pepper'lar. v1 kayıt ve v1 kurtarma kodu özetleri listedeki her değerle denenir. **Liste yalnız büyür:** A→B→C sonrası `MFA_LEGACY_PEPPERS=A,B`. Bir değer silinirse o dönemde üretilmiş kurtarma kodları **sessizce** geçersiz olur; uçtan uca test bunu gösteriyor.
- **Kurtarma kodları:** Yeni kodlar ayrı anahtarla (v2) özetlenir. Doğrulamada v2 ve listedeki her eski pepper'ın v1 özeti kabul edilir. Kodlar düz saklanmadığı için eski özetler taşınamaz; v1/v2 ayrımı özetten anlaşılamaz.
- **`pnpm --filter @kararver/api mfa:rekey [--apply]`:** Bütün v1 TOTP kayıtlarını toplu taşır.
  - Varsayılan deneme yazmaz; her kaydın çözülebildiğini doğrular.
  - Çözülemeyen kayıt varsa çıkış kodu 1 ve "pepper DEĞİŞTİRİLMEZ".
  - Kullanılmamış kurtarma kodu varsa sonuç satırı açıkça yazar: **"değiştirirken güncel pepper MFA_LEGACY_PEPPERS listesine eklenmeli"**.
- **Yapılandırma kuralları** (`config.ts`):
  - değerler en az 32 karakter;
  - ayrı anahtar pepper ile ya da eski listedeki bir değerle aynı olamaz;
  - eski liste yalnız ayrı anahtarla birlikte verilir;
  - **production'da `MFA_ENCRYPTION_KEY` zorunlu**;
  - hiçbiri verilmezse (local/staging) davranış birebir aynı.

## Sır envanteri ve yedek
- **`MFA_ENCRYPTION_KEY`:** `AUTH_TOKEN_PEPPER` kadar kritik. Kaybedilirse bütün v2 kayıtlar çözülemez ve SUPER_ADMIN dahil herkes step-up'ta reddedilir. Bu yüzden:
  - **iki kişide** (öneri: Mehmet + Faruk) şifre yöneticisinde ve **çevrimdışı** ayrı bir kopyası tutulur; yedek şifreleme anahtarıyla aynı yerde tutulmaz;
  - KV-49 sır listesinde ve KV-48 restore tatbikatında yer alır. Restore edilen DB aynı `MFA_ENCRYPTION_KEY` ve aynı `MFA_LEGACY_PEPPERS` ile açılmalı; tatbikat bir test hesabıyla step-up'ı da doğrular;
  - **değiştirilmez.** Anahtar rotasyonu (v3) ayrı bir iştir.
- **`MFA_LEGACY_PEPPERS`:** Eski pepper'lar. Yeni oturum token'ı üretmez; yalnız v1 doğrulamasında kullanılır. Kurtarma kodları 128 bit rastgele olduğu için bu değerlerle tahmin edilemez. Değerler issue, PR ya da loga yazılmaz.

## Uygulama sırası (staging; production yeni kurulumda ilk günden `MFA_ENCRYPTION_KEY` ile açılır)

**0. Ön koşul (salt okuma):**
- (a) Güncel yedek + ayrı DB'ye restore doğrulaması (KV-48).
- (b) MFA kaydı sayısı ve sahibin (SUPER_ADMIN) MFA durumu, salt okuma sorguyla.
- (c) Bakım penceresi, geri dönüş sorumlusu ve yeniden kayıt kararı belli.
- (d) Bu PR'ı içeren sürüm staging'de çalışıyor ve açılış migration kapısından (#310) geçiyor.

**1. Ayrı anahtar:**
- 48+ karakterlik rastgele bir değer üret (ör. `openssl rand -base64 48`), yukarıdaki envanter kuralıyla sakla.
- Değeri `MFA_ENCRYPTION_KEY` olarak gir, deploy et.
- **Doğrula:**
  - `/health` ok;
  - **en az ayrıcalıklı** MFA'lı test hesabıyla giriş + TOTP step-up (kayıt bu sırada v2 olur);
  - yeni MFA kurulumu çalışıyor.

**2. Toplu taşıma:** `mfa:rekey` (deneme) → `çözülemeyen: 0` ve **v2 kayıtlar anahtarla doğrulanmış** → `--apply` → `v1: 0`.
- **Yanlış anahtar koruması:** v2 kayıtlar verilen anahtarla çözülemezse CLI hiçbir şey yazmaz ve çıkış 1 verir.
- **İlk taşıma koruması:** DB'de henüz anahtarı doğrulanmış v2 kayıt yoksa toplu `--apply` reddedilir. Önce 1. adımdaki uygulama step-up'ı (kayıt uygulamanın anahtarıyla v2 olur) ya da `--only <hesap-id>` ile tek hesapta tatbikat yapılır.

**3. Pepper değişimi (A→B):**
- `MFA_LEGACY_PEPPERS = <mevcut liste>,<A>` (ilk rotasyonda yalnız `<A>`) ve `AUTH_TOKEN_PEPPER = <B>` olarak gir, deploy et. Mevcut değerler **silinmez**.
- **Beklenen:**
  - bütün oturumlar geçersiz;
  - bekleyen doğrulama ve sıfırlama bağlantıları geçersiz;
  - hız sınırı sayaçları sıfırlanır;
  - TOTP ve eski kurtarma kodları **çalışır**.

**4. Doğrulama:**
- test hesabıyla giriş + TOTP step-up;
- A döneminde üretilmiş bir kurtarma kodunun kabul edilmesi;
- `mfa:rekey` deneme raporunda `v1: 0`;
- smoke.

Kanıt yalnız sayı ve durum koduyla #291'e yazılır.

**5. Yeniden kayıt:** Karar 2 ya da 3 ise, 1. adım (ayrı anahtar) uygulandıktan sonra "Doğrulayıcı yenileme" akışıyla ve yukarıdaki prova sırasıyla: en az ayrıcalıklı yönetici → diğer yöneticiler → SUPER_ADMIN.

## Geri dönüş (kilitlenmeden)
| Durum | Yapılacak | Yapılmayacak |
|---|---|---|
| 1. adımda sorun | Anahtar **yerinde kalır**, sorun düzeltilir | `MFA_ENCRYPTION_KEY`'i kaldırmak: v2 kayıtlar (yeni kurulum, taşınan hesap) çözülemez, step-up reddedilir (test: aşama 5) |
| Uygulama rollback'i | Yalnız bu PR'ı içeren sürümlere | Bu PR'dan **önceki** sürüme dönmek: v2 okunamaz. Zorunluysa 1. adımdan önceki DB yedeğine dönülür (KV-48); sonraki veri kaybolur, karar Mehmet'te |
| 3. adımda sorun | Pepper eski değere (`AUTH_TOKEN_PEPPER=A`) döndürülür; `MFA_LEGACY_PEPPERS` olduğu gibi kalır. Oturumlar yine düşer, MFA etkilenmez | Listeden değer silmek |
| Kilitlenen hesap | [SA180 MFA kilitlenmesi](SA180_SUPER_ADMIN_MFA_LOCKOUT.md) prosedürü | DB'den MFA kaydını elle silmek |

## Yeni sağlayıcı (#297)
Bu runbook her ortamda aynı sırayla uygulanır. Yeni bir ortam ilk günden `MFA_ENCRYPTION_KEY` ile açılır; sırlar başka ortamdan kopyalanmadan yeniden üretilir. Etkilenme değerlendirmesi ve ortama özgü ayrıntılar public belgeye değil, ilgili özel olay dosyasına yazılır (#291).

## Testler
`apps/api/test/mfa-keys.test.ts`:
- **Birim:**
  - sürümler;
  - v1'in listedeki doğru pepper'la çözülmesi, listede yoksa reddedilmesi;
  - A→B→C kurtarma kodu özetleri;
  - yapılandırma kuralları (production zorunluluğu dahil).
- **PostgreSQL, gerçek MFA deposuyla uçtan uca:**
  1. ayrım öncesi kurulum (v1);
  2. anahtar eklenince step-up'ta v2'ye taşınma + eski kurtarma kodu;
  3. pepper A→B;
  4. pepper B→C'de A kodunun bozulmaması;
  5. negatif: listeden A silinirse A kodu reddedilir; anahtar kaldırılırsa v2 kayıt reddedilir ve kayıt değişmez; doğru yapılandırmaya dönülünce kalan kodlar geçer.
- **PostgreSQL toplu taşıma:** deneme yazmaz; listede olmayan eski sırla çözülemeyen kayda dokunulmaz; `--apply` sonrası yeni pepper ile çözülür.

`apps/api/test/mfa-reenroll.test.ts` (PostgreSQL, doğrulayıcı yenileme):
- step-up yokken, yanlış parolayla, MFA kapalıyken ya da ayrı anahtar yokken başlatma reddedilir; step-up tek kullanımlıktır;
- yanlış kodla, eski sırrın koduyla ya da başka oturumdan onayda etkin sır değişmez ve eski sır çalışır;
- eşzamanlı iki onaydan yalnız biri kazanır; diğer oturumun step-up'ı düşer; MFA kaydı silinmez;
- onaydan sonra eski sır ve eski kurtarma kodları geçmez, yenileri geçer; kurtarma koduyla alınmış step-up da başlatmaya yeter;
- audit kayıtlarında sır, kurtarma kodu ya da şifreli kayıt yoktur.

Mevcut `mfa.test.ts` ve step-up kullanan bütün API testleri değişmeden geçiyor.
