# Özel bucket üzerinden onaylı görsel sunumu

Railway bucket'ları özel olduğu için `MEDIA_PUBLIC_BASE_URL` doğrudan bucket URL'i olamaz. `public` bucket adı uygulamanın onaylı kopya ayrımını anlatır; anonim erişim yetkisi vermez. Kaynak: [Railway Storage Buckets](https://docs.railway.com/storage-buckets#connecting-to-your-bucket).

## Mevcut servislerle yapılandırma

API ve mevcut worker aynı ortam değişkenlerini kullanır; ek servis veya sağlayıcı hesabı gerekmez. Kullanım mevcut depolama/servis kotasına tabidir; sıfır ücret garantisi değildir.

```dotenv
S3_ENDPOINT=${{kararver-staging-private.ENDPOINT}}
S3_BUCKET_PRIVATE=${{kararver-staging-private.BUCKET}}
S3_BUCKET_PUBLIC=${{kararver-staging-public.BUCKET}}
S3_ACCESS_KEY_ID=${{kararver-staging-private.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{kararver-staging-private.SECRET_ACCESS_KEY}}
S3_PUBLIC_ACCESS_KEY_ID=${{kararver-staging-public.ACCESS_KEY_ID}}
S3_PUBLIC_SECRET_ACCESS_KEY=${{kararver-staging-public.SECRET_ACCESS_KEY}}
MEDIA_PUBLIC_BASE_URL=https://kararver-staging.vercel.app/api/media-public
```

Anahtarlar yazdırılmaz/kopyalanmaz; Railway değişken referansları kullanılır. Endpoint, region ve URL stili bucket'ın Credentials bilgisinden doğrulanır. İki bucket aynı S3 endpoint/region üzerinde olmalıdır. Genel S3/R2 kurulumu ayrı anahtar alanlarını boş bırakarak mevcut ortak kimlik bilgisiyle çalışır.

## İstek ve kaldırma davranışı

`GET /media-public/m/<uuid>.webp` yalnız deterministik onaylı WebP anahtarını okur. Orijinal, işlenmiş özel kopya, veri paketi, key/path veya URL parametresi kabul etmez. Her istekte APPROVED durumu ve hesabın silinmemiş olması kontrol edilir; bağlı anket/topluluk gizli veya kaldırılmışsa 404 döner. Henüz gönderiye bağlanmamış onaylı görsel oluşturma önizlemesinde kullanılabilir. Depolama okunurken moderasyon değişirse yanıt verilmeden tekrar kontrol edilir.

Yanıt ve retler `private, no-store` olur; 302 veya imzalı özel URL verilmez. Storage kesintisi maskeli 503 + Retry-After verir; sonraki istek tekrar denenebilir. Zaten indirilmiş baytların uzaktan silinebildiği iddia edilmez. API en fazla 8 MB okur; Content-Length olmasa da gerçek akış boyutu sınırlıdır. Orijinal yükleme mevcut imzalı PUT yolunu kullanır; sağlayıcı CORS kabulü ayrıca doğrulanır.

Worker onaylı kopyayı public bucket'ın kendi anahtarıyla yazar/siler. Manuel onay özel bucket'tan okur ve onaylı bucket'a yazar; diğer bucket'ın anahtarıyla CopyObject yapmaya çalışmaz. Ortak anahtarlı S3/R2 kurulumu mevcut CopyObject yolunu korur. `media:check` aynı anahtar ayrımını kullanır.

## Kabul ve geri dönüş

Otomatik testler doğru anahtar/bucket eşleşmesini, boyut sınırını, 404/503/toparlanmayı, HEAD ve moderasyon yarışını kapsar. Gerçek PostgreSQL testi onaysız → onaylı → gizli topluluk/anket → görünür → medya reddi → silinmiş hesabı sınar.

Canlı kabul ayrıca kendi sentetik görseliyle yükleme/worker/karantina-onay → misafir proxy 200 image/webp → ret → aynı URL 404 ve `media:check` ister. CI bunun yerine geçmez. Geri dönüşte uygulama sürümü, URL ve public anahtar yapılandırması birlikte değerlendirilir; özel bucket'ın doğrudan URL'ine dönmek görselleri herkese açmaz.
