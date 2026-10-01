# KV-09 — Auth, oturum ve profil backend (#11)

> Sahip: **Faruk** · Kod: `apps/api` · Sözleşme: `packages/contracts/src/domains/auth.ts` ([`API_CONTRACTS.md`](./API_CONTRACTS.md))
> Mimari kararlar: [`TECH_DECISIONS.md` §3.2 ve §3.4](./TECH_DECISIONS.md)

Bu belge `apps/api`'nin ilk teslimini ve web tarafının (Ümit, KV-13) auth akışını bağlarken bilmesi gerekenleri anlatır.

## Çalıştırma

```bash
cp .env.example .env              # AUTH_TOKEN_PEPPER'ı doldurun (en az 32 karakter)
docker compose up -d && pnpm db:migrate
pnpm --filter @kararver/api dev   # http://localhost:4000, sağlık: GET /health
pnpm api:test                     # DB'siz senaryolar; TEST_DATABASE_URL varsa aynıları PostgreSQL ile de koşar
```

Local'de `MAIL_TRANSPORT=console`: doğrulama ve sıfırlama mailleri API'nin stdout'una yazılır. Staging/production'da console mailer'a izin verilmez. SMTP sağlayıcısı seçilene kadar (TECH_DECISIONS §10 #2) servis staging'de açılmaz.

## Uygulanan endpointler

`auth.register`, `auth.login`, `auth.logout`, `auth.email.verify`, `auth.email.resend`, `auth.password.forgot`, `auth.password.reset`, `me.get`, `me.update`. Hepsi `/v1` altındadır.

Route'lar sözleşme registry'sinden kaydedilir (`apps/api/src/http/route.ts`). Method, path, istek şeması, yetki seviyesi ve cache politikası `@kararver/contracts`'tan gelir. Production dışındaki ortamlarda her cevap sözleşme şemasıyla doğrulanır; uymayan cevap 500 döner ve testte yakalanır.

## Web tarafı için ayrıntılar

| Konu | Davranış |
|---|---|
| Cookie | `kv_session`, `HttpOnly; SameSite=Lax; Path=/`, staging/prod'da `Secure`. İstekler `credentials: "include"` ile yapılır. |
| Oturum süresi | 30 gün (`SESSION_TTL_DAYS`), sabit. Süresi dolan veya iptal edilen cookie ile gelen istek 401 alır ve cookie silinir. |
| Doğrulama bağlantısı | `${WEB_URL}/dogrula#token=<token>` — 24 saat geçerli, tek kullanımlık. Yeniden gönderim eski bağlantıyı geçersiz kılar. |
| Sıfırlama bağlantısı | `${WEB_URL}/sifre-yenile#token=<token>` — 1 saat geçerli, tek kullanımlık. Başarılı sıfırlama bütün oturumları kapatır ve e-postayı doğrulanmış sayar. |
| Token neden fragment'ta? | `#token=` sunucuya ve `Referer` başlığına gitmez. Sayfa token'ı `location.hash`'ten okuyup `POST /v1/auth/email/verify` veya `/v1/auth/password/reset` gövdesine koyar. |
| CSRF | Mutation'larda `Origin` başlığı `WEB_URL` ile aynı olmalıdır; değilse 403 `FORBIDDEN` (`details[0].code = "origin_not_allowed"`). Tarayıcı bunu kendisi gönderir. |
| CORS | Sadece `WEB_URL` kaynağı; `Access-Control-Allow-Credentials: true`. İzin verilen başlıklar: `Content-Type`, `Idempotency-Key`, `X-Request-Id`. |
| Hesap varlığı | Kayıtlı e-postayla kayıt ve bilinmeyen e-postayla "şifremi unuttum" aynı 202'yi döner. Hesap sahibine bilgilendirme maili gider. |
| Kısıtlı hesap | BANNED/SUSPENDED: girişte 403 `ACCOUNT_RESTRICTED` ve `details[0].code = "login"`. Açık oturumla gelen istekte `details[0].code` endpoint id'sidir. |
| `roles` | RBAC (KV-04 #6, KV-12 #14) gelene kadar her hesap için `["USER"]`. |

## Güvenlik notları

- Parolalar argon2id ile hash'lenir (19 MiB, 2 tur). Bilinmeyen e-postayla girişte de hash doğrulaması yapılır, cevap süresi hesabın varlığını ele vermez.
- Oturum ve e-posta token'ları 32 byte rastgele üretilir. DB'de sadece `sha256(token + AUTH_TOKEN_PEPPER)` saklanır.
- Token tüketimi koşullu `UPDATE` ile yapılır. Aynı token'la gelen paralel isteklerden sadece biri başarılı olur (PostgreSQL ile test edildi).
- Loglarda cookie, `authorization`, `set-cookie`, `password` ve `token` alanları maskelenir. Testler parola, oturum token'ı, e-posta token'ı ve pepper'ın loglara düşmediğini kontrol eder.

## Kalan işler ve bağımlılıklar

| Konu | Durum | Sahip / iş |
|---|---|---|
| İlk girişte 20 puan (`points.granted`) | Puan defteri tablosu yok | #67 (Mehmet) |
| `registration.enabled` ayarı | `isRegistrationEnabled` kancası hazır, şimdilik hep açık | KV-40 #42 (Utku) |
| Rol listesi (`roles`) | Sabit `["USER"]` | KV-04 #6, KV-12 #14 (Utku) |
| Giriş/kayıt/mail rate limit ve brute-force koruması | Yok | KV-19 #21 (Utku) |
| `user.registered` domain olayı (outbox) | Olay altyapısı yok | KV-04 #6 (Utku) |
| SMTP ile mail gönderimi | Sağlayıcı seçilmedi | TECH_DECISIONS §10 #2 |
| Staging'de iki gerçek hesapla kabul | Staging yok | KV-06 #8 (Utku) |
