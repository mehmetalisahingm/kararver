> 29 Eylül güncellemesi: HTTP entegrasyonu ve güncel kalan bağımlılıklar için [Frontend/backend entegrasyonu](FRONTEND_BACKEND_INTEGRATION.md) belgesine bakın. Aşağıdaki demo teslim notları ilk sürümü anlatır.

# KV-30 — Keşfet, kategori ve trend ekranları

Sahip: Ümit (@umitefe0) · Görev: #32 · UI temeli: PR #68 ve #74.

## Teslim

- `/` ve `/kesfet`: Senin İçin / Yeni / En Çok Oy, kategori filtresi, Türkçe normalize arama, gönderi/kullanıcı/kategori/topluluk sonuçları.
- `/kategoriler` ve `/kategori/[slug]`: aktif kategori dizini ve kategoriye ait akış; bulunamayan kategori durumu.
- `/yukselenler`: Günün Yükselenleri, Haftanın Yükselenleri, En Çok Oy Verilenler, En Çok Konuşulanlar, Haftanın Değişkenleri.
- Sekme/arama/filtre URL'de tutulur; geri/ileri gezinme bunları geri getirir. Filtre değişimi eski isteği iptal eder, sayfa devamını sıfırlar ve klavye odağını ana içeriğe taşır.
- Liste devamı hatası önceki kayıtları korur; tekrar deneme aynı cursor'dan sürer. `INVALID_CURSOR` açık mesaj ve listeyi baştan yükleme sunar. Oturum değişiminde eski izleyiciye ait liste yeniden kullanılamaz.

## Grafiklerin anlamı ve sonuç gizliliği

Beş trend formatı ayrı, tarihli demo sıralamalarına sahiptir. Liste sırası gerçek trend motoru tarafından hesaplanmış değildir. Rank filtrelenmeden önceki genel listedeki sıradır; kategori filtresinde numaralar atlayabilir.

İlk dört formatta grafiği gösterilen metrik **görünür güncel birikimli seçenek dağılımıdır**. Bu grafik dönem içi oy sayısı, büyüme hızı veya trend puanı diye etiketlenmez. Tartışmada seçenek oylaması yoktur. Gizli sonuçta grafik, toplam oy ve seçenek yüzdesi üretilmez. Grafikler %0–100 ölçeği, açık seçenek etiketleri, sayısal değerler ve tablo alternatifi taşır; yalnızca renkle anlam verilmez. Dokunma/klavye ile Grafik/Tablo değişir; hareket azaltma tercihi desteklenir.

Haftanın Değişkenleri iki 7 günlük dönem sonunun birikimli dağılımını karşılaştırır. Örneğin %35 → %55, **+20 yüzde puandır**; göreli yüzde artış veya yalnızca yeni oyların dağılımı değildir. İki uçtaki örneklemler ve İstanbul takvim tarihleri grafik/tablo içinde yer alır. `INSUFFICIENT_HISTORY` boş durumdur; eksik dönemler veya düşük örneklem için grafik uydurulmaz. Demo fixture'ları sabit tarihlidir; ekran bunları güncel canlı veri gibi sunmaz.

KV-03 public `TrendItem` sözleşmesi sıralama puanı içermez; notu da puan/bileşenlerin public olmadığını söyler. Issue'daki “puan” ifadesi için gizli bir değer uydurulmadı: mevcut sözleşmeyle rank ve yüzde puan farkı gösterilir. Public trend puanı istenirse önce KV-03 sözleşmesi ve görünürlük kararı değişmelidir.

## Sözleşme ve entegrasyon

Temel: [main f23c836 API sözleşmeleri](https://github.com/mehmetalisahingm/kararver/blob/f23c836/docs/API_CONTRACTS.md), `packages/contracts/src/domains/discovery.ts` / `polls.ts`. Bu değişiklik diğer üyelerin API, DB, hesaplama veya ortak sözleşme dosyalarını değiştirmez. Yeni bağımlılık eklemez.

| UI adaptörü     | Gerçek uç ve bağlanacak alanlar                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCategories` | `GET /categories`: id/slug/name/description; demo kimlikleri slug, gerçek kimlik UUID'dir.                                                              |
| `getFeed`       | `GET /feed?tab=for_you\|new\|top&categoryId=...&cursor=...`; `PollCard` → mevcut UI `Poll` kart projeksiyonu.                                           |
| `search`        | `GET /search?q=...&type=polls\|users\|categories\|communities&cursor=...`; ayrı result discriminator'ları.                                              |
| `getTrends`     | `GET /trends/:format?categoryId=...&cursor=...`; `rank/poll/movement`, `meta`, `reason`, `page` korunur.                                                |
| Görünürlük      | `results={visible:false}` aynen taşınır. `WEEKLY_MOVERS` yalnızca ALWAYS/kapanmış anket içindir; giriş yapmış kullanıcının oy vermesi yeterli değildir. |

UI filtreleri slug/id mapping katmanıyla gerçek kategori UUID'lerine çevrilmelidir. Demo `Poll` ile wire `PollCard` aynı tip değildir. `AbortSignal` gerçek HTTP isteğine iletilmeli; auth, hata zarfı, cache ve no-store kuralları gerçek istemcide uygulanmalıdır. Kategori bulunamadı demo ekranı istemcide gösterilir; gerçek sunucu rotasında API 404'ü Next `notFound()` ile eşlenmelidir.

Demo cursor'ları sayfanın belleğinde, filtre/izleyiciye bağlı snapshot tutar (3 kayıt/sayfa). Veri eklenince mevcut sayfa dizisi değişmez; süresi dolan cursor hata verir. Bu, backend cursor/çalıştırma kimliği güvenliğinin uygulaması değildir. Senin İçin ve popüler sıraları seçilmiş fixture'lardır; kişiselleştirme veya trend algoritması eklenmedi. Yeni sekmesi oluşturma tarihine göre sıralanır. Kullanıcı ve topluluk araması public özet gösterir; başka modülün profil/topluluk sayfasına sahte bağlantı eklenmedi.

## Deneme

Node 24 ve pnpm 10.34.5 ile `pnpm --filter @kararver/web dev:demo`. Gerçek hesap/servis kullanılmaz, bellekteki örnekler yenilemede sıfırlanır. Demo varsayılan üretim modunda kapalıdır.

1. Keşfet'te sekmeleri değiştir, kategori seç, Daha fazla göster'e bas; URL ve geri tuşunu dene.
2. `sicak isik`, `egitim`, kullanıcı alanında `isik`, topluluk alanında `rota` ara. Eşleşmeyen sorgu ve tek karakter doğrulamasını kontrol et.
3. Beş trend görünümünü karşılaştır; Haftanın Değişkenleri'nde Grafik/Tablo, tarihler ve +20/−10 yüzde puan örneklerini incele. Seyahat filtresi bu formatta yetersiz geçmiş gösterir.
4. Demo test araçlarıyla Kategori/Keşfet/Arama/Trend/Liste devamı hatalarını tetikle. Liste süresini doldur → Daha fazla göster → Listeyi baştan yükle akışını dene.

## Kapanış kapısı

Bu PR #32'nin demo UI teslimidir. Gerçek #28/#29/#30/#31 servisleri ve staging kabulü olmadan issue kapanmaz. Önce #68 ve #74 ana dala alınmalı; bunlara bağlı bu PR daha sonra main'e yönlendirilmelidir. Gerçek trend sonuçları, pagination ve görünürlük iki hesap/misafir ile ayrıca doğrulanmalı; gerçek cihaz ve Safari/Firefox kabulü ayrı yapılmalıdır.

## Doğrulama kanıtı

- Node 24 / pnpm 10.34.5 ile üretim derlemesi ve TypeScript kontrolü başarılı.
- 19 birim/adaptör testi geçti (12 mevcut + 7 keşif testi): cursor snapshot/filtre/oturum bağlama, Türkçe arama ve sonuç türleri, gizli veri projeksiyonu, beş ayrı trend sırası, tarih/örneklem/yüzde puan, iptal/tekrar ve URL doğrulaması.
- 14 Playwright senaryosu geçti (9 mevcut + 5 keşif senaryosu). Filtre etiketleri ve hızlı trend/kategori geçişindeki eski sorgu sorunu düzeltildi; testlerin veri beklentisi ve gezinme beklemeleri netleştirildi. Etkilenen testler hedefli olarak tekrar çalıştırıldı.
- 9 yeni görünüm × 2 genişlik (360/1440) × 2 tema = 36 yeni axe denetimi; mevcut 20 denetim ve mobil grafik tablosu kontrolüyle toplam 57 denetimde ihlal yok.
- Liste devamı hatası/expired cursor, geri gezinme, gizli sonuç, yetersiz geçmiş, boş arama, kategori/arama/trend hataları, klavye ve dokunma, hareket azaltma ve yatay taşma kontrolleri geçti.
- Keşfet masaüstü, değişkenler mobil/masaüstü ve mobil tablo görsel olarak incelendi. Görsel denemede runtime hatası yok.
- Bu kanıt Chromium/Edge demo kapsamıdır; gerçek API, fiziksel cihaz veya Safari/Firefox kabulünü doğrulamaz.
