# V1 kullanıcı akışı ve katılım kararları

27 Eylül 2026 ürün kararı. Bu belgedeki gereksinimler **V1 yayın kapsamıdır**.
Çelişen eski gelecek-sürüm maddeleri için bu karar esas alınır; mevcut anketler,
çoklu trendler, farklı alanlar ve kapsamlı admin korunur. Görev sahipliği issue #2'dedir.

## Keşfet → etkileşim → giriş → paylaşım

1. Misafir doğrudan ilgi çekici akışı görür; gönderileri, anketleri ve yorumları
   inceleyip aşağı kaydırır. İlk açılışta zorunlu login modalı gösterilmez.
2. İki içerik türü vardır: seçenekli **anket** ve seçenek zorunluluğu olmayan
   **tartışma/soru gönderisi**. Örnek: “Bu bütçeyle hangi arabayı almalıyım?”
   Fotoğraf her iki türde de isteğe bağlıdır; metin gönderisi birinci sınıf içeriktir.
3. Kullanıcı yorum yazabilir, gönderi/yorumu beğenebilir veya dislike verebilir;
   ankette ayrıca seçenek oyu bulunur. İçerik tepkisi ile anket oyu farklıdır.
4. Misafir oy, yorum, beğeni/dislike veya paylaşım oluşturma aksiyonunda giriş
   ekranı görür. Kapatırsa aynı yerde gezinmeye devam eder; popup tekrar tekrar açılmaz.
5. Giriş sonrası aynı içeriğe ve korunmuş yorum taslağına döner. Gönderme veya puan
   harcama otomatik yapılmaz; kullanıcı son aksiyonu onaylar.

## Başlangıç puanı ve yayın maliyeti — V1

- Yeni hesabın **ilk başarılı girişinde bir kez 20 puan** verilir. Her login'de verilmez.
- Yeni tartışma gönderisi veya anket yayımlamak **10 puandır**. Başlangıçta toplam iki yayın hakkı vardır.
- Okuma, anket oyu, yorum ve beğeni/dislike bu yayın puanını tüketmez.
- Yayın öncesi bakiye ve maliyet görünür. Yetersiz bakiyede neden açıklanır; veri kaybı olmaz.
- Grant, debit ve varsa iade/değişiklikler append-only ledger'da neden, işlem kimliği,
  hesap ve zamanla tutulur. Bakiye negatif olamaz. Tekrar/eşzamanlı istek çift grant
  veya çift harcama üretemez; içerik oluşturma ve harcama aynı transaction'a bağlanır.
- Başarısız yayın puan tüketmez. Kullanıcının kendi içeriğini silmesi otomatik iade
  doğurmaz; moderasyon iadeleri yetkili ve gerekçeli ayrı işlemle yapılır.
- 20/10 başlangıç değerleridir; admin değişiklikleri doğrulanır ve loglanır.
  Çoklu hesap ve spam korumaları puan sisteminin yanında çalışmaya devam eder.
- İleride yeni puan kazanma yolları geliştirilebilir. Satın alma, günlük hediye,
  streak veya davet ödülü bu kararla otomatik eklenmez. Bakiye bitince mevcut
  etkileşimler sürer; yetkili admin gerekçeli puan düzeltmesi yapabilir.
- Bu harcanabilir bakiye, ilerideki güven/itibar puanı ve rozetlerden ayrıdır.

## Kullanıcı ve admin logları — V1

Kullanıcının gönderi/anket/yorum oluşturması, düzenlemesi, silmesi, oy/tepki değişimi,
giriş güvenliği ve puan hareketleri izlenebilir olmalıdır. Kaydın aktörü, hedefi,
eylemi, zamanı, sonucu ve korelasyon kimliği bulunur. Yetkili admin içerik geçmişinden
kimin ne paylaştığını ve hangi sürümü değiştirdiğini inceleyebilir.

Admin ban/suspend, içerik kaldırma/geri yükleme, öne çıkarma, rol/ayar ve puan
değişiklikleri gerekçe ve önce/sonra bilgisiyle değiştirilemez audit kaydı üretir.
İçerik sürüm geçmişi erişim kontrollü veri deposunda; operasyon loglarında yalnızca
referansı tutulur. Parola, token, cookie ve sınırsız ham istek gövdesi loglanmaz.
Log erişimi de yetkili ve izlenebilir olur; saklama/silme süreleri yayından önce belirlenir.

## Görsel kalite, grafikler ve etkileşim — V1

Premium tasarım yalnızca landing için değil, akış ve etkileşimlerin tamamında uygulanır.
Metin ve fotoğraflı içerik kartları güçlü hiyerarşiyle aynı akışta yer alır. Oy,
beğeni/dislike, yorum ve kaydetme net geri bildirim verir; hata halinde görünüm geri alınır.

Bütün trend formatlarında uygun grafikler, okunabilir eksen/etiket, tarih/örneklem,
mobil dokunma ve klavye desteği bulunur. Sahte veri veya yanıltıcı ölçek kullanılmaz;
az veri durumu açık gösterilir. Hareket azaltma tercihi desteklenir. Grafik verisinin
metin/tablo alternatifi vardır. Gerçek cihaz, yavaş bağlantı, yüklenme/boş/hata,
sayfa devamı ve erişilebilirlik beta kabulüne dahildir. Mehmet görsel ürün kabulünü,
Ümit ana UI uygulamasını, modül sahipleri kendi yüzeylerini teslim eder.

## Topluluklar ve üyeler — V1

Topluluk altyapısı V1'de hazırdır; admin toplulukları istediği zaman açar/kapatır.
Katıl/ayrıl, topluluk akışı, üye sayısı ve sayfalanmış üye listesi V1 kapsamındadır.
Üye listesinde kullanıcı adı, avatar ve topluluk rolü gösterilir; e-posta, gerçek
kimlik ve özel hesap verisi gösterilmez. Listenin görünürlüğü topluluk ayarıdır ve
sunucuda uygulanır. Moderatör yalnızca yetkili olduğu topluluğu yönetir.

## Yayın kabulü

- [ ] Misafir ilk girişte popup görmeden her iki içerik türünü gezebiliyor.
- [ ] Etkileşimden login ve aynı içeriğe/taslağa dönüş çalışıyor; iptal zorlanmıyor.
- [ ] Fotoğrafsız/seçeneksiz tartışma açılıyor; yorum ve like/dislike çalışıyor.
- [ ] Tek hesapta paralel ilk girişler yalnızca 20 puan oluşturuyor.
- [ ] İki başarılı yayın sonunda bakiye sıfır; üçüncü yayın reddediliyor.
- [ ] Retry ve başarısız yayın çift harcama yaratmıyor; admin düzeltmesi auditli.
- [ ] Kullanıcı içerik geçmişi ve admin işlemleri yetkili panelden izlenebiliyor.
- [ ] Görsel/grafik kalite ve erişilebilirlik kabulü gerçek akışlarda yapıldı.
- [ ] Topluluk üyeleri, görünürlük ve moderatör sınırları doğrulandı.

Bu belge plan kararıdır; özelliklerin uygulanmış olduğunu belirtmez.
