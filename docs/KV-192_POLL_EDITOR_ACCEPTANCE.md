# UI V2 anket kartları ve oluşturma kabulü

Bu teslim #217 ortak tema tokenlarını temel alır. Backend, auth, RBAC ve veri
sözleşmeleri değişmez. Ortak CSS yerine anket ekranlarına ait CSS modülü kullanılır.

## Kullanıcı davranışı

Akış kartı kategori, içerik durumu, varsa gerçek yayın tarihi ve yorum sayısını
gösterir. Oy toplamı yalnız API sonuçları görünür olarak döndürdüğünde gösterilir.
Seçenek ve yüzdeler yalnız veri modelinde varsa çizilir; feed sözleşmesinde seçenek
metinleri bulunmadığında tahmin edilmez veya ek detail isteği yapılmaz. Son oy veren
kişiler sözleşmede yoktur; avatar dizisi veya uydurma katılım metriği eklenmez.

Onaylı kapak yüklenemediğinde anket bağlantısı kullanılabilir kalır ve kapak için
tekrar deneme sunulur. İncelemedeki veya kaldırılmış medya public URL kazanmaz.

Oluşturma formu üç numaralı bölüm halinde ilerler. Adım düğmeleri ilgili başlığa
odak taşır; alanlar aynı formda açık kalır. Bölümler arasında taslak ve medya
durumu korunur. Önizleme soru, açıklama, seçenekler, kategori, yorum, süre,
sonuç görünürlüğü, eklenen görsel sayısı ve puan etkisini gösterir. Önizleme
yayın yapmaz; ayrı onay düğmesi gerekir. Escape düzenlemeye ve odağa döner.

Medya retry geçerli imzalı adresi kullanır. Süre dolmak üzereyse aynı idempotency
anahtarıyla yeniler. Başarılı PUT sonrası complete retry dosyayı tekrar yüklemez.
Storage HTTP reddi ve bağlantı hatası farklı mesaj alır; imzalı URL veya storage
yanıt gövdesi kullanıcıya açılmaz. Cookie storage'a gönderilmez.

## Doğrulama

- Edge desktop ve 360px: gizli/açık/kilitli kart, kapak retry ve önizleme 8/8.
- Edge desktop ve 360px: medya, galeri, PUT/complete/yayın retry 8/8.
- Medya hata ve gizli bilgi koruma birim testleri 2/2.
- Mevcut giriş/oy/taslak/yayın ve keşfet tarayıcı regresyonları 10/10.
- Web birim paketi 98 geçti, 2 PostgreSQL testi yerel DB yapılandırması olmadığı için atlandı.
- TypeScript kontrolü başarılı.
- İlk kart ve önizleme screenshot'ları, iki tema ve axe test içinde kaydedilir.

Tarayıcı kabulü gerçek HTTP adapter'ını sözleşme fixture'larıyla çalıştırır;
gerçek staging veya PostgreSQL kabulünün yerine geçmez. Chromium/Firefox/WebKit
ve gerçek API/DB regresyonları Foundation CI'da ayrıca doğrulanmalıdır.

## Kalan dış kabul

Gerçek staging storage PUT/CORS ve altı görselli anket yayınlama hâlâ ayrı
kontroldür. Retry iyileştirmesi storage altyapısını veya yeni hesap yükleme
kotasını değiştirmez. Staging'de onaylanmayan dosyalar yayımlanmış sayılmaz.
#192 kabul ve deployment kanıtı tamamlanmadan kapatılmaz; #193 ayrı teslimdir.
