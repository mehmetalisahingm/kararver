# UI V2 keşfet profil ve bildirim kabulü

Bu teslim #217 tema ve #218 anket kartı teslimi üzerine kuruludur. Ortak global
CSS veya backend sözleşmeleri değiştirilmez. Ekran yüzeyleri scoped CSS modülüyle
fildişi, antrasit ve şampanya tema değişkenlerini kullanır.

Keşfet/kategori/trend başlıkları, kategori kartları, sonuç türü vurguları, profil
istatistikleri ve bildirim kartları aynı boşluk ve yüzey düzenini kullanır.
Kullanıcı arama sonucu gerçek username ile profile açılır. Boş bildirim ekranı
keşfet bağlantısı sunar. Hesap düzenleme alanları ortak erişilebilir input stilini
kullanır. Profil sayısı, yorum/oy istatistiği ve topluluk üye sayısı API verisidir;
uydurma katılım, demo sayısı veya tarayıcıda hesaplanan üyelik eşiği eklenmez.

Topluluk erişimi, üyelik, yedi günlük eşik ve kapalı/açık durum backend'in mevcut
kararına bağlı kalır. Bu teslim topluluk yaşam döngüsünü yeniden tanımlamaz.
Trend grafiklerinin zaman etiketleri ve tablo alternatifleri korunur. Bildirim
okundu/mute/sayfalama işlemleri ile profil/kaydedilenler loading/error/retry
akışları değiştirilmez.

## Yerel kanıt

- Edge desktop 1440px ve mobile 360px: yeni yüzey ve bildirim testleri 16/16.
- Yedi ekran, iki tema, iki viewport: 28 axe ve yatay taşma denetimi.
- Keşfet/arama/kategori/trend 500 retry, profil 404/sayfalama, hesap taslak 12/12.
- Beş trend formatı, tablo alternatifi, arama/filtre/pagination ve mobil tema regresyonu 5/5.
- Son mobil profil/bildirim görünümü ayrıca yeniden doğrulanır; PNG'ler test çıktısında.
- TypeScript kontrolü başarılı.

Testler gerçek HTTP adapter'ını sözleşme fixture'larıyla kullanır; staging veya
PostgreSQL kabulü olarak raporlanmaz. Chromium/Firefox/WebKit ve gerçek API/DB
Foundation CI'da ayrıca doğrulanmalıdır. Fiziksel cihaz/ekran okuyucu kabulü
yapılmış sayılmaz. #193 CI ve gerçek ortam kabulü tamamlanmadan kapatılmaz.
