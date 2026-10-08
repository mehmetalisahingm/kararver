# KV-19 — Hız sınırı ve brute-force koruması (#21)

> Sahip: **Faruk** (Utku'nun geçici inaktifliği süresince devralındı) · Kod: `apps/api/src/modules/rate-limit/` · Tablo: `rate_limit_counters` (`packages/db/prisma/schema/security.prisma`) · Ayarlar: contracts `limits.*` · Test: `apps/api/test/rate-limit.test.ts`

## Özet

| Kabul koşulu (#21) | Durum |
|---|---|
| Çoklu süreçte limit tutarlı; hata ve tekrar deneme zamanı sözleşmeli | ✅ Sayaçlar PostgreSQL'de, tek ifadeyle atomik artırılıyor. İki API örneği aynı veritabanına 40 eşzamanlı istek gönderiyor: tam limit (10) kadarı geçiyor, gerisi 429 alıyor (test). Cevap `429 RATE_LIMITED` + `Retry-After` (saniye) + `details[0] = { code: "retry_after_seconds" }`; biçim anket cooldown'uyla (KV-20) aynı. |
| Yeni/normal kullanıcı politikası ve admin ayar anahtarları | ✅ Yeni hesap = açılıştan sonraki ilk `polls.newAccountPeriodDays` (7) gün (Mehmet kararı, #21). 18 ayar anahtarı contracts `limits.*` altında. KV-40 (#42) ayar servisi gelince panelden değiştirilebilir; o zamana kadar API önerilen değerleri kullanıyor. |
| Başarısız giriş ve yoğun yorum testli; hassas bilgi loglanmıyor | ✅ Testler: giriş kaba kuvvet (e-posta ve IP), başarılı girişte sıfırlama, kayıt, şifre sıfırlama, yorum burst ve günlük sınır, oy, genel yazma. Sayaç anahtarı ve log ham IP/e-posta/kullanıcı kimliği içermiyor (pepper'lı sha256 özeti, test). |

## Değerler (geçici)

Plan (PRODUCT_TEAM_PLAN §13 "Ek kontroller") sınırları ister ama sayı vermez. Mehmet geçici limitleri onayladı (#21, 2026-10-07). Aşağıdaki sayılar Faruk'un önerisi; contracts'ta `default: null` + öneri olarak yazılı, teyit gelince resmîleşir (KV-04 açık konu 10).

| Kural | Kimin sayıldığı | Pencere | Normal hesap | Yeni hesap | Ayar |
|---|---|---|---|---|---|
| Giriş (yalnız **başarısız** denemeler) | e-posta | 15 dk | 5 | 5 | `limits.loginFailuresPerEmail` |
| Giriş (yalnız başarısız) | IP | 15 dk | 20 | 20 | `limits.loginFailuresPerIp` |
| Kayıt | IP | 1 saat | 5 | — | `limits.registerPerIpHour` |
| Şifre sıfırlama isteği | e-posta | 1 saat | 3 | 3 | `limits.recoveryPerEmailHour` |
| Doğrulama e-postası tekrarı | hesap | 1 saat | 3 | 3 | `limits.recoveryPerEmailHour` |
| Şifre sıfırlama + doğrulama tekrarı | IP | 1 saat | 10 | 10 | `limits.recoveryPerIpHour` |
| Oy (`votes.put`) | hesap | 1 dk | 30 | 15 | `limits.votesPerMinute`, `limits.newAccountVotesPerMinute` |
| Yorum (`comments.create`) | hesap | 1 dk | 6 | 3 | `limits.commentsPerMinute`, `limits.newAccountCommentsPerMinute` |
| Yorum | hesap | 1 gün (UTC) | 200 | 30 | `limits.commentsPerDay`, `limits.newAccountCommentsPerDay` |
| Şikâyet (`reports.create`) | hesap | 1 saat | 10 | 5 | `limits.reportsPerHour`, `limits.newAccountReportsPerHour` |
| Görsel yükleme (`media.uploads.create`) | hesap | 1 saat | 20 | 5 | `limits.uploadsPerHour`, `limits.newAccountUploadsPerHour` |
| Arama (`search.query`) | hesap, oturum yoksa IP | 1 dk | 60 | 60 | `limits.searchesPerMinute` |
| Diğer bütün yazma işlemleri (POST/PUT/PATCH/DELETE) | hesap, oturum yoksa IP | 1 dk | 60 | 30 | `limits.writesPerMinute`, `limits.newAccountWritesPerMinute` |
| Okuma (GET), arama hariç | — | — | sınırsız | sınırsız | — |

Anket yayın limitleri (cooldown, günlük sınır) ayrıdır: KV-20, `polls.*`.

## Davranış

- **Sabit pencere:** Sayaç pencere başında sıfırlanır (epoch'a hizalı; gün = UTC günü). Pencere sınırında kısa süreli 2 katına kadar çıkış olabilir; ürün sınırları için kabul edilebilir, gerekirse kayan pencereye geçilir.
- **Reddedilen istek de sayılır:** Sınıra dayanan istemci istek atmayı sürdürdükçe pencere dolana kadar bekler.
- **Giriş akışı farklı:**
  - Sınır doluysa parola hiç doğrulanmaz: doğru parola da `Retry-After` kadar bekler, argon2 yükü de oluşmaz.
  - Var olmayan e-posta da sayılır: sınırın davranışı hesabın varlığını ele vermez.
  - Başarılı giriş e-postanın sayacını sıfırlar, IP sayacına dokunmaz.
  - E-posta büyük/küçük harf ve boşluk farkından bağımsızdır (`normalizeEmail`).
- **Sıra:** Oturum çözülür → hız sınırı → yetki → gövde doğrulama → handler. Böylece yetkisiz ya da geçersiz istek yağmuru da sınırlanır.
- **IP:** `request.ip`. Staging/production'da `trustProxy` açıktır (proxy arkasındaki gerçek istemci IP'si).
- **Şüpheli işlem logu:** Sınır aşılınca `warn` seviyesinde `{ rateLimit: { endpoint, rules, keys, newAccount } }` yazılır. `keys` pepper'lı sha256 özetidir; IP, e-posta, kullanıcı kimliği ve parola yazılmaz. Aynı özet, istenirse sayaç tablosuyla eşleştirilebilir.
- **Temizlik:** Süresi geçen pencereler artırmaların ortalama 1/200'ünde, 1.000'erli silinir (`expires_at` index'i).

## Yapılandırma

- `RATE_LIMIT_ENABLED` (varsayılan `true`): Yalnız local/test'te kapatılabilir, örneğin KV-47 yük testi (tek IP'den 50 sanal kullanıcı). Staging/production'da `false` verilirse servis açılmaz.
- Testler: Harness varsayılanı gevşektir (diğer testler aynı IP'den çok hesap açar); `rate-limit.test.ts` gerçek değerleri açar.
- Web'in auth-only test sunucusu (`apps/web/scripts/test-auth-server.mjs`) store vermediği için sınırsızdır.

## Doğrulama

- `apps/api/test/rate-limit.test.ts`: 16 test, memory ve PostgreSQL backend'lerinde. Çoklu süreç senaryosunda iki ayrı API örneği aynı veritabanını kullanıyor.
- Mutasyon kontrolleri (her biri testleri kırıyor):

  | Kaldırılan | Düşen test |
  |---|---|
  | Giriş öncesi kontrol | 8 |
  | Başarılı girişte sıfırlama | 2 |
  | Anahtar özetleme (e-posta loga sızıyor) | 2 |

- Boş veritabanında bütün API testleri: 446 geçti. Düşen 2 test `kv21-e2e`'de ve bu işle ilgisiz (#151 düzeltiyor).

## Kalanlar

- **Değerlerin teyidi:** Mehmet (KV-04 açık konu 10). Teyit gelince contracts'ta `default` ve kaynak yazılır.
- **Panelden ayar:** KV-40 (#42) ayar servisi `limits.*` değerlerini okuyunca `rateLimitSettings` oradan beslenir.
- **Bypass:** Admin veya servis hesapları için ayrı bir istisna yok. Gerekirse eklenir; şu an admin yazma sınırı da 60/dk.
- **Fastify istek logu:** Fastify'ın kendi `incoming request` logu istemci adresini (`remoteAddress`) yazar. Bu KV-19 öncesi davranış; log saklama politikası #51 kapsamında.
