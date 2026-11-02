# KararVer — Neon + Render Free staging (2 Kasım 2026)

Staging trafiği yeni altyapıya taşındı. Railway'deki dört dağıtım durduruldu; kaynak veritabanları, üç volume ve iki bucket silinmedi. Production yayın ve hukuki/insan kabul kapıları #51, #53, #54 ve #284 kapsamında ayrıca takip edilir.

## Çalışan altyapı

| Bileşen | Hedef | Plan |
|---|---|---|
| Web | https://kararver-staging.vercel.app | Vercel Hobby |
| API + worker | https://kararver-api-free-preview.onrender.com | Render Free, Frankfurt |
| PostgreSQL | Neon kararver-staging-free / kararver_staging, PostgreSQL 18.6 | Free |
| Medya | Neon Object Storage, iki private bucket | Free |
| Test e-postası | kararver-mailpit-free-preview.onrender.com | Render Free |

- Neon project: `broad-rain-56203802`; branch: `br-weathered-firefly-b9nrb2au`.
- Önceki Neon kopyası `kararver_staging_snapshot_20261101` adıyla korundu. Son kaynak yedeği önce boş hedefe yüklendi; doğrulamadan sonra canonical DB adı atomik olarak değiştirildi.
- Vercel production kapsamındaki server-only `API_URL`, Render API'sini gösterir. Tarayıcı `/api` üzerinden aynı origin ile çalışır.
- API ve worker aynı Free web servisinde ayrı Node süreçleridir. Runtime pnpm/Corepack indirilmez; launcher sinyalleri doğrudan Node'a iletir. `NODE_OPTIONS` her süreç için 96 MB old-space / 4 MB semi-space sınırı koyar; medya eşzamanlılığı 1'dir.
- `/health` DB, worker heartbeat ve gerçek Render commit SHA'sını gösterir. Manuel deploy kullanılmaktadır; otomatik Render deploy kapalıdır.

## Güncel yedek ve veri kanıtı

2 Kasım'da kaynak API+worker durdurulduktan sonra yalnız Railway **Postgres** servisinden yeni custom-format pg_dump alındı. 5 Ekim yedeği kullanılmadı. Dump ve satır özetleri aynı REPEATABLE READ snapshot'ına aittir.

- Railway'den bağımsız yerel yedek kullanıcıya özel ACL ile korunur. AES-256-GCM ve RSA-OAEP-SHA256 zarf şifrelemesinin açılması/SHA-256 roundtrip kontrolü geçti; private key buluta veya repoya yüklenmedi.
- Restore yalnız boş hedefte `--single-transaction --exit-on-error --no-owner --no-acl` ile yapıldı. Kaynak veri silinmedi, mevcut DB üzerine yazılmadı.
- **78 tablonun** kaynak/hedef satır sayıları ve sıralı satır içerik özetleri eşleşti.
- Temiz yerel PG18 restore ile Neon şeması da eşleşti: **52 migration, 66 public tablo**, trigger/constraint/index/fonksiyon tanımları ve altı tutarlılık kontrolü.
- Kaynak iki medya bucket'ı son durdurmadan önce tekrar listelendi ve boş bulundu. DB medya kayıtları korundu; kaynakta bulunmayan eski dosyalar yeniden yüklenmelidir.
- Ham dump, manifestler, satır özetleri ve ayrıntılı raporlar özel yerel kanıt dizinindedir. PII, bağlantı parolası, token, signed URL ve private key GitHub'a yüklenmez.

## İşlev ve güvenlik kontrolleri

- Mevcut `AUTH_TOKEN_PEPPER` korundu; bu anahtar oturumları ve mevcut MFA verisini etkiler. Ayrıştırma/kurtarma doğrulanmadan gelişigüzel döndürülmez.
- Neon S3 path-style + SigV4 kullanır. Orijinal ve approved-copy bucket'ları private kalır; onaylı görsel API'nin güncel DB kontrolünden geçerek proxy ile sunulur.
- Gerçek API kabulü geçti: kayıt, yakalanan doğrulama e-postası ve token doğrulaması, login/logout, güvenli oturum, yabancı Origin reddi, anket oluşturma, kendi anketine oy yasağı, tekrar güvenli oy sayacı, presigned upload, worker moderasyonu ve WebP proxy okuması.
- Vercel üzerinden ana sayfa, API health, onaylı WebP ve anonim `/me` reddi doğrulandı. Railway durduktan sonra Vercel API health yine 200 döndü; DB ve worker sağlıklıydı.
- Salt okunur API güvenlik kapısı: 25 PASS / 0 FAIL. Bu sonuçlar production veya SUPER_ADMIN insan kabulü yerine geçmez.
- Mailpit UI ve send API ayrı kimlik bilgileriyle korunur. Test kutusu gerçek alıcılara e-posta teslim etmez. Uyanışta 502/503 için en çok 8 deneme / toplam 90 saniye bütçesi vardır; 401 tekrar edilmez, provider body/token loglanmaz.
- Mailpit ephemeraldir; restart/uykuda test mesajları kaybolabilir. Gerçek transactional mail/SMTP, production kapısı olarak kalır.

## Ücretsiz sınırlar ve kalan operasyon işleri

Mevcut hosting planlarının ücreti **0**'dır. Ücretli plan, disk, ayrı worker veya cron açılmadı. Render'a ödeme yöntemi eklenmediği kullanıcı tarafından doğrulandı; Railway'de ödeme yöntemi ve aktif abonelik olmadığı API'den kontrol edildi.

- İki Render Free web servisi ortak **750 instance-saat/ay** kullanır. Uyuyan servis saat tüketmez. 15 dakika inbound trafik olmazsa servis uyur; API ile worker birlikte durur ve cron işleri uyku sırasında zamanında çalışmaz. Keep-alive eklenmedi.
- Render Free'de SMTP 25/465/587 engellidir; staging capture HTTPS kullanır. Ödeme yöntemi olmayan hesapta ücretsiz trafik/instance kotası biterse servisler, build kotası biterse yeni build'ler durur. Kart ekleme/plan yükseltme ayrıca owner kararı gerektirir.
- Neon Free: proje başına 100 CU-saat/ay, 1 GB PostgreSQL, 5 GB Object Storage ve ortak 5 GB network transfer. Compute/egress sınırı compute'u durdurur; DB storage sınırı yazmayı engeller. Plan yükseltmesi yapılmaz.
- `BACKUP_ENABLED=false` kalır. Geçiş için bağımsız manuel yedek doğrulandı; zamanlanmış bağımsız yedek ve offline kurtarma anahtarı kabulü #51 kapsamında ayrıca tamamlanmalıdır.
- Staging monitor `STAGING_API_URL` değişkenini kullanır; güvenlik ve medya kontrolleri yeni Render adresini izler.
- Railway GitHub kaynak bağlantısı kesildi; main push'u eski API'yi yeniden başlatmaz. Kaynaklar korunmuştur. Volume/bucket silme ayrıca değerlendirilir.
- Rollback öncesinde güncel Neon verisini yedekleyin; iki ayrı DB'ye eşzamanlı yazım açmayın. Restore ve pg-boss için pooler olmayan, TLS certificate doğrulamalı bağlantı kullanın.

Kaynaklar: [Render Free](https://render.com/docs/free), [Neon fiyatlandırma](https://neon.com/pricing), [Neon S3](https://neon.com/docs/storage/s3-compatibility), [Mailpit API](https://mailpit.axllent.org/docs/api-v1/).
