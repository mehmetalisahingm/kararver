# KV-49 — Production yapılandırması, gözlem ve yayın operasyonu (#51)

> Sahip: **Faruk** · Gözden geçiren: Utku (staging/prod güvenlik sınırları, olay müdahalesi) · Production yayın kararı: **Mehmet**
> İlgili: yedek/restore ve geri dönüş [KV-48](./KV-48_BACKUP_RESTORE.md), hız sınırı [KV-19](./KV-19_RATE_LIMIT.md), audit [KV-39](./KV-39_AUDIT.md), ayarlar [KV-40](./KV-40_SETTINGS.md)

## Kabul durumu (#51)

| Koşul | Durum | Kanıt |
|---|---|---|
| TLS/session/CORS/CSRF ve ortam ayrımı | ✅ staging · web CSP kısmen | [Staging doğrulaması](#staging-doğrulaması-2026-10-09): HTTP→HTTPS 301, HSTS, API güvenlik başlıkları, çerez `Secure; HttpOnly; SameSite=Lax`, CORS yalnız web origin'i, CSRF yabancı origin ve cross-site yazmayı 403'lüyor, hata cevabı iç ayrıntı vermiyor. Ortam ayrımı `config.ts`'te zorlanıyor (staging/production'da güvenli çerez, SMTP ve hız sınırı zorunlu; `mailpit_api` yalnız staging). Web başlıkları bu PR'da eklendi. |
| Hassas veri loglanmadan hata/kuyruk/model izleniyor | ✅ | Staging loglarında e-posta, token, parola ve çerez yok (2026-10-09 taraması). İstek logundaki IP kaldırıldı (bu PR, test). İzleme: `/health` (API, worker heartbeat, sürüm) + `staging-monitor` alarmı. Worker işleri loglanıyor (`trends.refresh` 5 dakikada bir). Model hatası görseli karantinaya alıyor (fail-closed, KV-47 Medya). |
| Staging'de rollback denendi; production smoke ve olay müdahale sorumluları hazır | ✅ veri · ⏳ uygulama | Veritabanı geri dönüşü staging'de denendi (KV-48, RTO 5,2 dk). Uygulama rollback'i aşağıdaki prosedürle denenecek (bu PR deploy olduktan sonra, SHA ile doğrulanarak). Sorumlular: [Olay müdahalesi](#olay-müdahalesi). |

## Ortamlar

| | Local | Staging | Production |
|---|---|---|---|
| Barındırma | Yerel | Railway `kararver-staging` (`sfo`), web Vercel | Henüz yok (Mehmet kararı) |
| API + worker | Ayrı süreçler | **Tek serviste**: `scripts/start-api-with-worker.mjs` (ücretsiz plan; worker çökerse 2 sn'de yeniden başlar, API çökerse servis yeniden başlar) | **Ayrı servisler** (API ve worker bağımsız ölçeklenir/yeniden başlar) |
| Deploy | — | `main`'e her push otomatik (Railpack); önce `db:deploy` (migration), sonra `/health` kapısı | Elle: onaylı SHA'nın promote edilmesi |
| E-posta | console | `mailpit_api`: Mailpit test kutusu, gerçek alıcıya gitmez | `smtp`: gerçek sağlayıcı, TLS zorunlu, SPF/DKIM'li alan adı |
| Veritabanı | PostgreSQL 17 | PostgreSQL 18.6 (Railway) | Karar: sürüm 17 mi 18 mi (aşağıda) |
| Medya | Yok / SeaweedFS | Railway bucket'ları | R2 veya Railway bucket'ları, bucket başına doğru anahtar |

## Secret ve ortam değişkenleri

- Secret'lar yalnız Railway/Vercel servis değişkenlerindedir; repoda yalnız `*.example` dosyaları bulunur. Değerler issue, PR ya da log'a yazılmaz.
- Veritabanı adresi Railway referansı olarak verilir (`${{Postgres.DATABASE_URL}}`); parola değişirse kendiliğinden güncellenir.
- Zorunlu güvenlik değişkenleri (`config.ts` staging/production'da zorlar): `SESSION_COOKIE_SECURE=true`, `MAIL_TRANSPORT≠console`, `AUTH_TOKEN_PEPPER` (≥ 32 karakter), bütün `S3_*`, `RATE_LIMIT_ENABLED` kapatılamaz.
- Geçici erişimler iş bitince kapatılır: KV-48 tatbikatında açılan Postgres TCP proxy kapatıldı.

## Deploy ve rollback

**Deploy (staging):**
1. `main`'e merge.
2. Railway build eder ve `pnpm --filter @kararver/db run db:deploy` ile migration'ları uygular.
3. Yeni sürüm `/health` 200 dönerse trafik ona geçer.
4. Doğrulama: `GET /health` → `release.sha` merge edilen commit mi? `worker.status = ready` mı?

**Rollback (uygulama):** Railway'de önceki başarılı deployment yeniden deploy edilir (dashboard → Deployments → Redeploy, ya da `railway redeploy`). `/health` → `release.sha` önceki SHA olmalı.
- **Migration'lar geri alınmaz:** Prisma'da down migration yok; eski sürüm yeni şemayla çalışır (expand/contract kuralı, KV-48). Eski sürümün `db:deploy` adımı yeni migration'ları zaten uygulanmış bulur.
- **Veri bozulduysa:** KV-48 restore runbook'u (yeni veritabanına geri yükle, `DATABASE_URL`'i çevir). Ölçülen RTO 5,2 dk.

**Deploy SHA:** `/health` → `release: { sha, env }`. SHA, Railway'in `RAILWAY_GIT_COMMIT_SHA` değişkeninden (yoksa `GIT_COMMIT_SHA`) ilk 12 hanedir.

## İzleme ve alarm

| Ne | Nasıl |
|---|---|
| API ayakta mı | Railway `/health` kapısı (deploy) ve `staging-monitor` (30 dakikada bir) |
| Worker çalışıyor mu | `/health` → `worker.status = ready`, `ageMs < 120 000` (heartbeat 10 sn'de bir) |
| Çalışan sürüm | `/health` → `release.sha` |
| Alarm | `.github/workflows/staging-monitor.yml`: sorun olunca `staging-alarm` etiketli tek bir issue açar ya da yorum ekler; düzelince kapatır. Bildirim, GitHub issue bildirimleriyle sorumluya gider. |
| Uygulama hataları | Railway logları (`railway logs --service api`): `level=50` veya `[ERROR]`, `mail gönderilemedi`, `hız sınırı aşıldı` (şüpheli işlem) |
| İş kuyruğu | Worker logları: `trends.refresh`, `snapshots.daily`, `events.dispatch`, `featured.activate`, `polls.expire`, `sanctions.expire`; `media.process` hataları (`MODERATION_TIMEOUT`, `MODEL_ERROR`) |
| Model | `MODERATION_TIMEOUT` oranı %1'i aşarsa eşzamanlılık düşürülür (KV-47 Medya) |

**Log politikası:**
- İstek logu yalnız istek kimliği, yöntem, yol ve süre içerir; IP, port ve başlık yazılmaz.
- Çerez, `authorization`, `password` ve `token` alanları redakte edilir.
- Hız sınırı logu anahtar özeti içerir (KV-19).
- Mail hatası alıcı adresi ve içerik içermez.

## Olay müdahalesi

| Rol | Kişi | Görev |
|---|---|---|
| Operasyon sahibi (ilk müdahale) | Faruk | Alarmı karşılar, etkiyi belirler, rollback ya da restore uygular |
| Güvenlik / erişim gözden geçireni | Utku | Güvenlik olayında oturum iptali, yaptırım, secret rotasyonu |
| Ürün ve yayın kararı | Mehmet | Production yayını, bakım modu, kullanıcı iletişimi |
| Medya ve moderasyon | Mert | Görsel hattı ve moderasyon kuyruğu sorunları |

**Akış:**
1. Alarm issue'su ya da kullanıcı bildirimi gelir.
2. `/health` ve loglara bakılır.
3. Gerekirse bakım modu açılır (`maintenance.enabled`, KV-40) ya da ilgili acil durum anahtarı kapatılır.
4. Hatalı deploy ise rollback, veri sorunuysa KV-48 restore uygulanır.
5. `/health` ve smoke ile doğrulanır.
6. Alarm issue'suna zaman çizelgesi ve kök neden yazılır.

## Production'a geçiş listesi (Mehmet'in yayın kararından önce)

- [ ] **Hosting kararı:** Production projesi ve bölgesi. Türkiye'deki kullanıcılar için `sfo` yerine Avrupa bölgesi önerilir.
- [ ] **API ve worker ayrı servis:** Worker imajında NudeNet için Python ortamı gerekir. Staging'deki tek servis ücretsiz plan içindir.
- [ ] **Gerçek SMTP:** `MAIL_TRANSPORT=smtp`, `SMTP_URL` (STARTTLS/TLS), doğrulanmış alan adı ve SPF/DKIM; `MAIL_FROM` o alan adından olmalı.
- [ ] **Alan adı, DNS, TLS ve Cloudflare:** API ve web alan adları; `WEB_URL` ve `API_URL` production değerleri; `SESSION_COOKIE_DOMAIN`.
- [ ] **Bucket anahtarları:** Bucket başına doğru anahtar. Staging'de API anahtarı public bucket'a 403 alıyordu (KV-48 bulgusu); production'da onaylanan görselin yayına kopyalandığı doğrulanmalı.
- [ ] **PostgreSQL sürümü:** Staging 18.6; proje kararı ve CI 17. Production için tek bir sürüm seçilmeli, yedek araçları da o sürümde olmalı.
- [ ] **Web CSP:** Script ve görsel kısıtlayan sıkı CSP (nonce/SRI). Bu PR yalnız çerçeveleme ve temel başlıkları ekliyor.
- [ ] **Zamanlanmış yedek ve ayrı yedek bucket'ı** (KV-48 politikası); sağlayıcı PITR'ının doğrulanması.
- [ ] **Production smoke:** `pnpm smoke --api … --web … --strict` ve e-posta doğrulama uçtan uca (gerçek kutu).
- [ ] **İzleme:** `staging-monitor`'ün production kopyası (`PROD_API_URL`); alarm sorumlusu.

## Staging doğrulaması (2026-10-09)

Railway `api` deployment `53cebc1` (main'in bir commit gerisi; arada yalnız beta araçları, #175).

**E-posta doğrulama uçtan uca (Mailpit, `@example.test` test hesabı):**

| Adım | Sonuç |
|---|---|
| Kayıt | 202 |
| Doğrulama maili | Mailpit'e düştü ("KararVer — e-posta adresini doğrula") |
| Doğrulamadan önce giriş | 200 |
| Doğrulamadan önce anket yayını | 403 `EMAIL_NOT_VERIFIED` (kapı çalışıyor) |
| Yeniden gönderim | 202, ikinci mail düştü |
| En son token ile doğrulama | 200 |
| Anket yayını | 201 |

**Güvenlik:**
- HTTP→HTTPS 301.
- API: HSTS `max-age=31536000; includeSubDomains`, `nosniff`, `X-Frame-Options: DENY`, katı CSP, `Referrer-Policy: no-referrer`.
- Çerez `Secure; HttpOnly; SameSite=Lax`.
- CORS: web origin 204, yabancı origin 403.
- CSRF: yabancı origin 403, Origin'siz cross-site istek 403.
- Hata cevabı iç ayrıntı vermiyor.
- **Web:** HSTS var (Vercel). CSP, `nosniff` ve `X-Frame-Options` yoktu; bu PR'da eklendi.

**Worker:**
- `/health` → `worker: ready`, heartbeat birkaç saniyelik.
- `trends.refresh` 5 dakikada bir `SUCCEEDED`.

**Loglar:** Son kayıtlarda e-posta, token, parola ve çerez yok. İstek loglarında IP vardı; bu PR kaldırıyor.
