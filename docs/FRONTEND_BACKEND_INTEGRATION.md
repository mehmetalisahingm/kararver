# Ümit frontend / backend entegrasyonu

## #68: HTTP ve oturum

`apps/web/.env.example` dosyasını `apps/web/.env.local` olarak kopyalayın.
`NEXT_PUBLIC_KV_DATA_MODE=api` ve `NEXT_PUBLIC_API_URL` API origin'ini belirtir.
`pnpm --filter @kararver/web dev` ile açın. Backend `WEB_URL` değeri web origin'iyle
birebir aynı olmalı: varsayılan web komutu `http://127.0.0.1:3000` kullanır.
`localhost` ve `127.0.0.1` cookie/CORS açısından karıştırılmamalıdır. Staging'de
HTTPS ve backend'in Secure/SameSite cookie ayarları ayrıca doğrulanmalıdır.
Next public değişkenleri build sırasında sabitlenir. Repo kökündeki `.env`, web
uygulaması tarafından kendiliğinden yüklenmez.

Demo yalnızca `pnpm --filter @kararver/web dev:demo` ile açıkça etkinleştirilir.
API hatasında demo adapter'a dönüş yapılmaz. API adresi yoksa bağlantı hatası görünür.

HTTP istemcisi `/v1`, `credentials: include`, `cache: no-store`, ortak sözleşmenin
yanıt doğrulaması ve alan hatalarını kullanır. Token veya oturum localStorage'a
yazılmaz. E-posta token'ı fragment'tan okunup adres çubuğundan temizlenir; yalnızca
kullanıcı onayıyla POST edilir. Sayfa açılışında `/me` tamamlanmadan içerik açılmaz;
401 oturumu temizler ve izleyici değişiminde içerik yeniden yüklenir.

Yayın categoryId ve UUID Idempotency-Key gönderir. Aynı kullanıcı ve aynı taslak
tekrarında anahtar korunur. Backend bakiye döndürmediği için gerçek modda bakiye,
puan düşümü veya ilk giriş puanı uydurulmaz. Oy yetkisi viewer.canVote ve
voteBlockedReason'dan gelir; gizli sonuçlar yalnızca `{visible:false}` olarak kalır.

## Sağlayıcı durumu ve kalan doğrulama

1 Ekim 2026, main `5c3acea` ile birleştirildi:

- #68 ve #74 birleştirilmiş durumda. Kalan sosyal HTTP adapter ve keşfet/trend
  entegrasyonu açık #79 dalında toplanıyor. Main'deki ilgi alanları ekranı ve
  onboarding API çağrıları korunmuştur.
- Auth, anket CRUD, feed, oy, yorum, kategori, arama, trend, snapshot ve tepki
  sağlayıcıları main'de. Auth adapter gerçek Fastify route/Argon2/cookie koduyla
  test edildi; testte bellek içi store ve mail yakalayıcı kullanıldı.
- Kategori listesi gelmeden oluşturma formu yayın açmaz; demo kategori göndermez.
- HTTP sözleşme testleri PostgreSQL transaction, eşzamanlı oy veya staging
  doğrulaması değildir. Kalıcı verilerle yayın, oy ve sosyal akışların kabul testi
  ayrıca çalıştırılmalıdır.
- Staging'de cookie/CORS, kayıt-mail, yayın-tekrar istek, oy-gizlilik ve hesaplar
  arası görünürlük doğrulanmalıdır. Mock API bu kabulün kanıtı değildir.

`pnpm --filter @kararver/web test` HTTP sözleşme ve auth entegrasyon testlerini;
`pnpm --filter @kararver/web build` üretim/TypeScript kontrolünü çalıştırır.
Bu yerel doğrulamalar staging kabulünün tamamlandığı anlamına gelmez.

## #74 ve #79: sosyal / keşfet

Yorum, alternatif, yanıt, yorum düzenleme/silme ve tepki çağrıları sözleşmedeki
HTTP yöntemleriyle gönderilir. Yorum ve yanıt sayfaları açık bir devam düğmesiyle
yüklenir; bir sayfa başarısız olursa görünür yorumlar ve cursor korunur. Başarılı
yazıdan sonra ikinci bir GET'in başarısız olması nedeniyle yazı başarısızmış gibi
gösterilmez. Oturum değişiminde adapter'ın yorum belleği temizlenir.

Keşfet, dört arama türü, kategoriler ve beş trend formatı gerçek HTTP adreslerini
kullanır. Cursor/UUID ve tarihli trend meta alanları sunucudan aynen gelir. Trend
kartı sözleşmesinde seçenek etiketleri olmadığından görünen kartların ayrıntıları
da yüklenir. Kart veya ayrıntı sonuçları gizliyse grafik açılmaz; hareket verisi
yalnızca herkese açık veya kapanmış anketlerde kullanılır. Bu ek detay istekleri
gözlemlenmeli; gelecekte sağlayıcı kart DTO'suna etiket eklerse kaldırılabilir.

Tepki ve trend sağlayıcıları main'e alınmıştır. HTTP modunda yerel sıralama veya
sentetik oy üretilmez. Trend sonuçları worker üretimine ve mevcut verilere bağlıdır;
boş sonuç ayrı bir durumdur. Tam kabul için PostgreSQL ve staging testi gerekir.

`node node_modules/@playwright/test/cli.js test --config playwright.api.config.ts`
gerçek auth route'larına ayrı yerel test portlarından bağlanır (web 3002, API 4011).
Test sunucusu bellek içi store ve yalnızca yerel testte erişilen mail yakalayıcı
kullanır; production/staging sunucusuna eklenmez. Docker/PostgreSQL bu ortamda
bulunmadığından kalıcı veriyle yayın/oy/yorum smoke doğrulaması henüz yapılmadı.

## KV-30 gerçek sağlayıcı kabul testi

`TEST_DATABASE_URL` izole, adı `_test` ile biten PostgreSQL veritabanını göstermeli.
`pnpm --filter @kararver/web test` içindeki `discovery-backend.test.mjs`, gerçek
Fastify HTTP sunucusu ve Prisma store'larıyla kategori, üç feed sekmesi, cursor,
Türkçe arama, beş ayrı trend sıralaması, tarih/örneklem, gizli sonuç ve yetersiz
geçmiş davranışını sınar. Trend job çıktıları veritabanına test verisi olarak
konur; worker hesaplama doğruluğu kendi testlerinin sorumluluğudur.
Veritabanı yoksa bu test açıkça atlanır. Foundation checks database işi testi
PostgreSQL ile çalıştırır; yerel skip sonucu kabul kanıtı değildir.
