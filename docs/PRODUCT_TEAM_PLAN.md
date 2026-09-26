# KararVer — Ürün, Ekip ve 5 Haftalık Hızlı Geliştirme Planı

> Amaç: Klasik, eksik bir MVP değil; gerçek kullanıcıya açılabilecek, premium görünen, moderasyonu güçlü, admin tarafından yönetilebilen ve büyümeye hazır bir **V1** çıkarmak.
>
> Ekip: **Faruk, Ümit, Mert, Utku, Mehmet**
>
> Çalışma modeli: **Faruk, Ümit ve Mert ana geliştirme sorumlularıdır. Mehmet ve Utku ürün/kalite görevlerinin yanında sınırları belirli modülleri doğrudan geliştirir. Her modülün tek teslim sahibi vardır.**

---

## Planın yetkisi ve V1 kapsamı

Bu belge kapsam, görev sahipliği, haftalık teslim ve yayın kabulü için ana kaynaktır. `MVP_PLAN.md` temel ürün ve güvenlik gereksinimlerini tamamlar; kapsam veya takvim farkında bu belge esas alınır.

**Farklı kategoriler ve topluluklar, anketler, yorumlar/cevaplar, alternatif öneriler, bütün trend formatları ve kapsamlı admin paneli V1 kapsamındadır.** Beş haftalık hedef görev dağılımı ve erken entegrasyonla takip edilir. Yayın tarihi kabul sonuçlarına bağlıdır; gecikme halinde kapsam sessizce düşürülmez.

# 1. Ürün vizyonu

KararVer; insanların karar veremedikleri konuları topluluğa sorabildiği, fotoğraf ve açıklama ile gönderi oluşturabildiği, oy ve yorum alabildiği, alternatif önerileri görebildiği, gündemde yükselen kararları keşfedebildiği Türkiye odaklı sosyal karar platformudur.

Temel ürün döngüsü:

**Sor → Oy Al → Yorumları Gör → Alternatifleri Gör → Sonucu Takip Et → Yükselenleri Keşfet → Tekrar Katıl**

Uzun vadede KararVer yalnızca bireysel soruların sorulduğu bir platform değil; üniversiteler, topluluklar ve daha sonra markaların gerçek kullanıcı görüşü alabildiği bir karar ve görüş altyapısına dönüşebilir.

---

## 1.1 Kullanıcı kazanımı ve tekrar katılım

Farklı ilgi alanları ortak anket altyapısında kendine özgü soru şablonlarıyla sunulur: otomobilde fotoğraf/fiyat, eğitimde bölüm tercihi, oyunda ekipman karşılaştırması, üniversitede kampüs gündemi. Her kategori kendi soruları, topluluk önerileri ve kategori filtreli trendleriyle keşfedilebilir.

- **Keşfet → katıl:** Ziyaretçi herkese açık soruları, yorumları ve toplulukları girişsiz gezebilir. Oy/yorum için giriş yaptığında seçtiği ankete geri döner; bekleyen işlem onaysız gönderilmez.
- **İlgi seçimi:** Kayıtta atlanabilir kategori seçimi ve topluluk önerileri sunulur. Seçimler değiştirilebilir; seçim yapmayan kullanıcı çeşitli kategorilerden başlangıç akışı görür.
- **Paylaş → yeni katılımcı:** Anket ve topluluk bağlantıları kolay paylaşılır. Kaynak etiketiyle ziyaret → kayıt → ilk katkı ölçülür. Bağlantıyı açmak otomatik topluluk üyeliği oluşturmaz.
- **Katıl → geri dön:** Kullanıcı ankette “Sonucu takip et” seçebilir. Kapanış ve sahibinin karar güncellemesi uygulama içi bildirim üretir. Bildirim tercihleri, sessize alma ve olay başına tek bildirim bulunur.
- **Sor → ilk yanıt:** Yeni ve az oy alan sorulara sınırlı keşif payı ayrılır; aynı yazar/kategori akışı kaplamaz. Bu pay ve tekrar sınırı admin tarafından yönetilir.

## 1.2 İçerik ve topluluk başlangıcı

Mehmet içerik takvimi ve kazanımı, Mert topluluk araçlarını sahiplenir. Bütün kategoriler açık kalır; ilk davet/içerik çalışmaları ekibin erişebildiği birkaç üniversite ve ilgi topluluğunda yoğunlaştırılır.

- Hafta 2: Her başlangıç kategorisine en az 5 özgün soru taslağı ve pilot topluluk sorumluları hazırlanır.
- Hafta 3: Ekip içi alfa ile paylaşım ve ilk katkı denenir. Demo oyları gerçek kullanıcı verisi gibi sunulmaz ve production analitiğine karışmaz.
- Hafta 4: Güvenlik/moderasyon kabulünden sonra 30–50 davetliyle kapalı beta hedeflenir. Bu bir hedef sayıdır, kazanılmış kullanıcı sayısı değildir.
- Hafta 5: İlk oy, paylaşım ve tekrar ziyaret darboğazları düzeltilir; kategori bazlı içerik takvimiyle yayın hazırlanır.

Davet ve topluluk iletişimini Mehmet koordine eder; her pilot topluluğun içerik ve moderasyon sorumlusu belirlenir.

## 1.3 Başarı ölçümü

Mehmet olay sözlüğü/dashboard'u, Utku olay teslimini sahiplenir. Ekip/test hesapları ayrılır. Aşağıdaki beta hedefleri test edilecek hipotezlerdir; kullanıcı kazanma garantisi veya tek başına yayın engeli değildir.

| Ölçüm | Tanım | Başlangıç hedefi |
| --- | --- | --- |
| İlk katkı | Yeni kayıtların 24 saatte en az bir oy veya yorum vermesi | %50+ |
| Yanıt alan soru | Yeni anketlerin 24 saatte yazar dışında en az 5 farklı katılımcıdan oy alması | %60+ |
| İlk oy süresi | Açılıştan yazar dışındaki ilk geçerli oya kadar medyan/p90 | Medyan 60 dakika altı |
| D7 katkı dönüşü | Kayıt kohortunun 7. gün yeniden oy/yorum vermesi | %15+ |
| Paylaşımdan katkı | Kaynak bazlı ziyaret → kayıt → ilk katkı | İlk beta ölçümü |

DAU/WAU, yorum alan anket oranı, kategori/topluluk dağılımı ve rapor çözüm süresi de izlenir. Oranlar pay/payda ve tarih aralığıyla gösterilir; 7 günü dolmayan kohort D7 olarak sunulmaz.

# 2. Tasarım yönü

Görsel hedef, hazırlanan demo görsellerindeki premium koyu temadır.

## Ana görünüm

- Koyu ve premium arka plan
- Mor/violet ana vurgu rengi
- Temiz beyaz tipografi
- Büyük, net kartlar
- Hafif gradient ve glow
- Gereksiz neon kullanımından kaçınma
- Fotoğraf kullanılan içeriklerde görselleri ön plana çıkarma
- Mobil kullanım öncelikli responsive tasarım

## Önerilen renk sistemi

- `background`: `#090B10`
- `surface`: `#11151D`
- `surface-2`: `#171C26`
- `primary`: `#7C3AED`
- `primary-light`: `#A855F7`
- `text-primary`: `#F8FAFC`
- `text-secondary`: `#94A3B8`
- `success`: yeşil yalnızca olumlu değişim / başarı durumlarında
- `danger`: kırmızı yalnızca silme, ban, kritik uyarı vb. durumlarda

## Desktop ana sayfa düzeni

- Sol: navigation/sidebar
- Orta: ana feed
- Sağ: Günün Yükselenleri + Popüler Kategoriler

## Mobil

Alt navigation:

- Ana Sayfa
- Keşfet
- `+` Anket Oluştur
- Bildirimler
- Profil

---

# 3. Kullanıcı sistemi

## Hesap

- E-posta ile kayıt
- E-posta doğrulama
- Kullanıcı adı
- Görünen ad
- Şifre
- Şifremi unuttum
- Oturum yönetimi

Kullanıcı gerçek kimliğini göstermek zorunda değildir. Platformda kullanıcı adı ile bulunabilir; ancak sistem tarafında hesap kayıtlıdır. Böylece dışarıdan anonim/pseudonymous kullanım mümkün olurken kötüye kullanım kontrol edilebilir.

## Profil

- Profil fotoğrafı
- Kullanıcı adı
- Görünen ad
- Biyografi
- Katılım tarihi
- Açtığı karar/anket sayısı
- Aldığı toplam oy
- Yorum sayısı
- Takip edilen topluluklar
- Kendi anketleri
- Kendi yorumları
- Kaydedilenler (yalnızca kullanıcıya özel)

V1'de takipçi sistemi zorunlu değildir. Veri modeli ileride eklenebilir şekilde tasarlanabilir.

---

# 4. Karar / anket oluşturma

Kullanıcı şu içerikleri oluşturabilir:

- Başlık
- Açıklama
- 2–6 seçenek
- Kategori
- Etiketler
- Fotoğraf / fotoğraf galerisi
- İsteğe bağlı fiyat bilgisi
- İsteğe bağlı ek bilgi alanı
- Anket süresi
- Yorumlara izin ver / kapat
- Sonuçları oy vermeden önce göster / oy verdikten sonra göster

## Fotoğraf sistemi

Fotoğraf KararVer için çekirdek özelliktir.

Örnek:

> “Bu araba bu fiyata alınır mı?”
>
> Kullanıcı hasarlı/boyalı bölgenin fotoğraflarını yükleyebilir ve topluluktan görüş alabilir.

Kurallar:

- Bir gönderiye birden fazla görsel yüklenebilir.
- Görseller yeniden boyutlandırılır ve optimize edilir.
- EXIF/metaveri mümkün olduğunca temizlenir.
- Maksimum dosya boyutu admin panelinden değiştirilebilir.
- Desteklenen MIME türleri backend tarafından doğrulanır.

---

## Karar güncellemesi

Anket sahibi “Kararımı verdim” ile seçimini ve kısa gerekçesini paylaşabilir. Bu alan topluluğun oy sonucundan ayrı gösterilir; oyları değiştirmez ve anketi otomatik kapatmaz. Sonucu takip edenlere tek bildirim gider. Güncelleme raporlanabilir ve moderasyona tabidir. Mehmet bu akışı uçtan uca geliştirir.

# 5. Oy sistemi

- Bir kullanıcı aynı ankete yalnızca bir aktif oy verebilir.
- Çift istek çift oy üretmemelidir.
- Oy işlemi transaction-safe olmalıdır.
- Anket kapandıktan sonra oy kabul edilmez.
- Admin sistem ayarından izin verirse kullanıcı anket kapanmadan oyunu değiştirebilir.
- Sonuçlar yüzde + oy sayısı olarak gösterilir.

Her seçenek için günlük snapshot ve oy değişikliklerinin zaman bilgisi tutulur. Haftalık karşılaştırmanın veri tanımı bölüm 8'dedir.

- İlk geçerli oydan sonra soru, seçenekler ve sonuç görünürlüğü dondurulur. Açıklamaya tarihli ek bilgi eklenebilir. Admin düzeltmeleri de oyların anlamını değiştiremez; gerekiyorsa içerik kaldırılır ve yeni anket açılır.
- Kapanış sunucu saatiyle denetlenir. Tek aktif oy DB kısıtıyla korunur; tekrar istek/eşzamanlı oy değişimi toplamları bozmaz.
- Gizli sonuçlar yetkisiz kullanıcıya API, cache, HTML veya paylaşım kartıyla sızmaz. Kapanış sonrası sonuçlar herkese açılır; kaldırılmış içerik bu kurala dahil değildir.
- Hesap banı geçmiş oyları otomatik silmez. Doğrulanmış manipülasyonda yetkili işlem oyları geçersiz sayar, gerekçe kaydeder ve toplam/trend hesaplarını yeniden üretir.
- Bireysel oy tercihleri public profilde veya katılımcı listesinde yayımlanmaz.

---

# 6. Yorum ve alternatif öneri sistemi

## Normal yorum

- Yorum yaz
- Yoruma cevap ver
- Yorumu beğen
- Yorum düzenle
- Kendi yorumunu sil
- Yorum raporla

V1'de maksimum 1 cevap seviyesi yeterlidir.

## Alternatif öner

Normal yorumdan ayrı bir aksiyon bulunabilir:

**“Bunun yerine ne önerirsin?”**

Kullanıcı alternatif ürün/karar yazabilir.

Örneğin:

> “3 milyon TL'ye Tesla alınır mı?”
>
> Alternatif: “Bu bütçede BMW i4’e de bakılabilir.”

Bu cevaplar ayrıca sıralanabilir ve topluluk tarafından beğenilebilir.

---

# 7. Feed ve keşfet

Ana feed sekmeleri:

- Senin İçin
- Yükselenler
- Yeni
- En Çok Oy Alanlar

V1'de “Senin İçin” yapay zekâ gerektirmez.

Sıralama sinyalleri:

- Kullanıcının ilgilendiği kategoriler
- Yeni içerikler
- Son dönemde hızlı oy alan içerikler
- Yorum aktivitesi
- İçerik yaşı

---

# 8. KararVer'e özel trend formatları

Bu alan ürünün en ayırt edici kısımlarından biri olacaktır.

## Günün Yükselenleri

Son 24 saatte hızla etkileşim alan içerikler.

## Haftanın Yükselenleri

Sadece toplam oya göre değil, oy artış hızına göre sıralanır.

## Haftanın En Çok Oy Verilenleri

Son 7 günde en fazla benzersiz oy alan anketler.

## Haftanın En Çok Konuşulanları

Yorum + cevap + benzersiz yorumcu sayısına göre hesaplanır.

## Haftanın Değişkenleri

KararVer'in farklılaşabileceği özel özellik.

Örnek:

> Geçen hafta: %82 “Alınır”
>
> Bu hafta: %46 “Alınır”
>
> Değişim: `-36 puan`

Bu format V1'de korunur. Karşılaştırmaya uygun anketlerde 14 ve 30 günlük süreler desteklenir; kısa anketler diğer trend formatlarına katılır.

Karşılaştırma iki tamamlanmış, bitişik 7 günlük pencerenin sonundaki geçerli oy dağılımlarının snapshot'ları arasındaki **yüzde puan farkıdır**. Pencereler anketin açılışından itibaren Europe/Istanbul yerel saatiyle tanımlanır; zamanlar UTC saklanır. İki uçta varsayılan en az 30 geçerli oy ve ikinci pencerede en az 10 farklı hesabın oy ekleme/değiştirme etkinliği aranır; eşikler admin ayarıdır. Tek kişinin tekrar oy değiştirmesi etkinlik sayısını büyütmez.

Ekranda tarihler, iki örneklem büyüklüğü ve “Katılımcı dağılımındaki değişim; aynı kişilerin fikir değiştirdiği anlamına gelmez” açıklaması gösterilir. Eksik snapshot uydurulmaz. Yeterli geçmiş yoksa format açıklaması ve diğer trendlere geçiş gösterilir. Canlı veride iki dönem beklenir; hesap önceden tarihli test verisiyle doğrulanır.

Bir içerik “Haftanın Değişkenleri”ne girmek için minimum oy eşiğini geçmelidir. Bu eşik admin panelinden değiştirilebilir.

## Trend puanı

Örnek mantık:

`trend_score = vote_velocity + unique_voters + comment_velocity + saves - age_decay - abuse_penalty`

Katsayılar admin/config üzerinden değiştirilebilir olmalıdır.

Her format kendi ölçümünü korur; aynı liste farklı başlıklarla sunulmaz. Tek kişinin yorum/oy değiştirme patlaması katkı tavanıyla sınırlandırılır. Ham rapor sayısı tek başına sıralama cezası oluşturmaz; doğrulanmış kötüye kullanım kullanılır. Editör öne çıkarmaları etiketlenir, organik trend puanını değiştirmez. Hesaplama sürümü ve güncellenme zamanı kaydedilir; hedef yenileme aralığı 5 dakikadır.

---

# 9. Kategoriler

İlk kategoriler:

- Teknoloji
- Otomobil
- Alışveriş
- Eğitim
- Üniversite
- Yaşam
- Seyahat
- Oyun
- Spor
- Yemek
- Ev / Emlak
- Kariyer
- Diğer

Kategori yönetimi tamamen admin panelinden yapılır.

Admin:

- kategori oluşturabilir
- düzenleyebilir
- pasife alabilir
- sırasını değiştirebilir
- ikon/görsel belirleyebilir

---

# 10. Topluluk sistemi

KararVer'in uzun vadeli büyüme motorlarından biri.

V1'de temel topluluk sistemi bulunmalıdır.

Örnek:

**Samsun Üniversitesi Topluluğu**

Öğrenciler topluluk içerisinde:

- kampüs sorunları
- yemekhane
- ulaşım
- etkinlikler
- dersler
- öğrenci hizmetleri

hakkında anket açabilir.

## V1 topluluk özellikleri

- Admin topluluk oluşturabilir.
- Kullanıcı topluluğa katılabilir/ayrılabilir.
- Topluluğun kendi feed'i olur.
- Topluluk içerisindeki anketler ayrı filtrelenebilir.
- Admin topluluk moderatorü atayabilir.

İlk public sürümde herkesin istediği topluluğu anında açması zorunlu değildir. Spam riskini azaltmak için topluluk oluşturma önce admin kontrollü olabilir.

---

# 11. Kaydetme

Kullanıcı bir anketi kaydedebilir.

- Kaydet
- Kaydı kaldır
- Profil → Kaydedilenler

Bu liste private olmalıdır.

---

# 12. Bildirimler

V1'de uygulama içi bildirim yeterlidir.

Bildirimler:

- Anketine yorum geldi
- Yorumuna cevap geldi
- Alternatif öneri geldi
- Anketin belirli oy sayısına ulaştı
- Anketin Günün/Haftanın Yükselenleri'ne girdi
- Moderasyon işlemi uygulandı
- Takip ettiği toplulukta öne çıkan bir konu oluştu

Bildirimler read/unread durumuna sahip olmalıdır.

---

# 13. Search / SEO / paylaşım

## Search

Arama:

- anket başlığı
- açıklama
- kullanıcı adı
- kategori
- topluluk

## SEO

Her anket benzersiz URL alır.

Örnek:

`/karar/tesla-model-3-3-milyona-alinir-mi-ab12cd`

Gerekli:

- dinamik title
- meta description
- canonical URL
- Open Graph
- sitemap
- robots.txt

## Sosyal paylaşım

Paylaşım kartları X, WhatsApp, Instagram link preview vb. alanlarda düzgün görünmelidir.

Paylaşım kartında:

- soru
- güncel oy yüzdesi
- toplam oy
- KararVer logosu

bulunabilir. Gizli sonuçlarda yüzde/toplam oy paylaşım kartına eklenmez. Platformların bağlantı önizlemeleri ayrıca doğrulanır.

---

# 14. Anti-spam ve kullanım limitleri

Bu limitlerin tamamı admin panelinden değiştirilebilir olmalıdır.

## Önerilen varsayılan değerler

Yeni hesap — ilk 7 gün:

- maksimum 3 anket / 24 saat
- iki anket arasında minimum 30 dakika

Normal hesap:

- maksimum 10 anket / 24 saat
- iki anket arasında minimum 10 dakika

Yorum:

- kısa aralıkta burst rate-limit
- günlük makul üst sınır

Ek kontroller:

- aynı başlığı tekrar tekrar gönderme koruması
- duplicate görsel hash kontrolü
- silinen/engellenen görseller için perceptual hash listesi
- aşırı isteklerde geçici throttle
- login brute force koruması

Bütün limitler deploy yapmadan Admin → Sistem Ayarları üzerinden değiştirilebilir.

---

# 15. Görsel moderasyon

Dışarıdan ücretli API kullanmadan, kendi sunucumuzda çalıştırabileceğimiz küçük bir görsel moderasyon modeli hedeflenir.

Akış:

`Upload → MIME/boyut kontrolü → re-encode → lokal görsel moderasyon → risk skoru → yayın / inceleme kuyruğu / red`

## Risk seviyeleri

### Düşük risk

Normal yayın.

### Orta risk

`UNDER_REVIEW` durumuna alınabilir veya yayınlanıp admin kuyruğuna işaretlenebilir. Sistem ayarı ile davranış değiştirilebilir.

### Yüksek risk

Otomatik engelle veya karantinaya al.

Modelin kararı nihai otorite olmamalıdır. Admin her zaman sonucu override edebilmelidir.

Model servisi hata verir veya zaman aşımına uğrarsa görsel karantinada kalır; incelenmeden herkese açık URL kazanmaz. Yeniden deneme ve manuel inceleme kuyruğu bulunur. Mert ilk hafta örnek görsellerle doğruluk/gecikme ve sunucu kaynak ihtiyacını ölçer; eşikler beta sonuçlarıyla ayarlanır.

---

# 16. Kullanıcı raporlama

Raporlanabilir öğeler:

- anket
- görsel
- yorum
- alternatif öneri
- kullanıcı

Rapor nedenleri:

- spam
- uygunsuz içerik
- taciz / hakaret
- kişisel bilgi paylaşımı
- yanıltıcı içerik
- telif
- diğer

Rapor direkt hard delete üretmez; moderasyon kuyruğuna düşer.

---

# 17. GELİŞMİŞ ADMIN PANELİ

Admin paneli bu projenin en önemli modüllerinden biridir.

Admin sistemi sonradan eklenen küçük bir panel değil, V1'in çekirdeğidir.

## 17.1 Roller

- Moderator
- Admin
- Super Admin

Yetkiler backend tarafından doğrulanmalıdır.

## 17.2 Genel Bakış Dashboard

Metrikler:

- toplam kullanıcı
- günlük aktif kullanıcı
- haftalık aktif kullanıcı
- yeni kayıt
- toplam anket
- bugün oluşturulan anket
- toplam oy
- bugün verilen oy
- toplam yorum
- bekleyen rapor
- moderasyon kuyruğu
- yüklenen görsel sayısı
- engellenen görsel sayısı
- son 7/30 gün büyüme grafikleri

## 17.3 İçerik yönetimi

Admin bütün anketlerde:

- görüntüle
- düzenle
- gizle
- yayından kaldır
- geri yükle
- kilitle
- yorumları kapat
- kategori değiştir
- etiketi değiştir
- topluluk değiştir
- trending'den çıkar
- rapor geçmişini gör

uygulayabilir.

## 17.4 Admin tarafından içerik öne çıkarma

Admin istediği içeriği öne çıkarabilmelidir.

Öne çıkarma türleri:

- Ana Sayfa Spotlight
- Ana Feed Üst Sıra
- Günün Öne Çıkanı
- Kategori Öne Çıkanı
- Topluluk Öne Çıkanı
- Editörün Seçimi

Admin şunları belirleyebilir:

- başlangıç tarihi
- bitiş tarihi
- hangi yüzeylerde görüneceği
- sıralama önceliği
- özel badge/etiket

Admin ayrıca bir içeriğin algoritmik yükselen sıralamasına girmesini engelleyebilir.

**Sponsorlu içerik ileride eklenirse mutlaka “Sponsorlu” olarak açıkça etiketlenmelidir.**

## 17.5 Duyuru sistemi

Admin:

- site duyurusu oluşturabilir
- banner gösterebilir
- belirli kullanıcı gruplarına bildirim gönderebilir
- duyuruyu başlangıç/bitiş tarihi ile planlayabilir

## 17.6 Kullanıcı yönetimi

Admin:

- kullanıcı arayabilir
- profil + aktivite geçmişini görebilir
- uyarı verebilir
- yorum yetkisini geçici kapatabilir
- anket açma yetkisini geçici kapatabilir
- suspend edebilir
- banlayabilir
- banı kaldırabilir
- kullanıcının rapor geçmişini görebilir

## 17.7 Moderasyon kuyruğu

Filtreler:

- görsel riski
- rapor sayısı
- kategori
- tarih
- içerik türü
- kullanıcı

İşlemler:

- onayla
- gizle
- kaldır
- kullanıcıyı uyar
- kullanıcıya yaptırım uygula

## 17.8 Kategori / topluluk yönetimi

Admin:

- kategori oluşturur
- kategori sıralar
- topluluk oluşturur
- topluluk moderatorü atar
- topluluk kapatır
- topluluk açıklaması/görseli düzenler

## 17.9 Sistem ayarları

Admin deploy gerektirmeden değiştirebilir:

- anket cooldown
- günlük anket limiti
- yorum rate limit
- minimum/maksimum anket süresi
- maksimum seçenek sayısı
- maksimum görsel sayısı
- görsel boyut limiti
- moderasyon risk eşikleri
- trend katsayıları
- haftanın değişkenleri minimum oy eşiği
- yeni kayıt aç/kapat
- anket oluşturmayı aç/kapat
- yorumları global aç/kapat
- görsel upload aç/kapat
- bakım modu

## 17.10 Acil durum kontrolleri

Super Admin tek işlemle:

- yeni kayıtları durdurabilir
- anket oluşturmayı durdurabilir
- yorumları kapatabilir
- upload'ı kapatabilir
- siteyi bakım moduna alabilir

Bu özellik kriz anında çok değerlidir.

## 17.11 Audit log

Kritik admin işlemleri değiştirilemez şekilde kayıt altına alınmalıdır.

Kayıt:

- kim yaptı
- ne yaptı
- hangi öğe üzerinde yaptı
- önceki durum
- sonraki durum
- zaman

Admin kendi işlem geçmişini silememelidir.

---

# 18. Admin içerik durumları

İçerik durumları:

- `ACTIVE`
- `HIDDEN`
- `UNDER_REVIEW`
- `LOCKED`
- `REMOVED`

Kullanıcı durumları:

- `ACTIVE`
- `RESTRICTED`
- `SUSPENDED`
- `BANNED`

Hard delete yerine mümkün olduğunca soft delete tercih edilir.

---

# 19. Gelecek özellikleri — mimari hazır olacak

İlk public V1'de zorunlu olmayabilir ancak mimari bunları engellememelidir.

## Kullanıcı puanı

Örnek:

- oy ver → puan
- faydalı yorum → puan
- yorumu faydalı bulundu → bonus
- günlük katkı → streak

## Sponsorlu kararlar

Markalar ileride gerçek kullanıcılardan görüş almak için sponsorlu anket açabilir.

Sponsorlu içerik normal içerikten açıkça ayrılır.

## Kurumsal topluluklar

Üniversite / kurum doğrulanmış topluluğu.

## Topluluk içgörüleri

Yeterli ve anonimleştirilmiş veri varsa genel eğilimler gösterilebilir.

---

# 20. Teknik prensipler

- Frontend ve backend sözleşmeleri baştan tanımlanır.
- Validation backend tarafında zorunludur.
- Kritik işlemler idempotent tasarlanır.
- DB migration sistemi kullanılır.
- Liste endpoint'lerinde pagination vardır.
- Görseller ayrı object storage mantığına hazır tasarlanır.
- Dosya URL'leri DB'ye yazılır; binary DB'ye yazılmaz.
- Audit log ve moderasyon logları baştan düşünülür.
- Admin yetkisi yalnızca frontend kontrolüne bırakılmaz.

---

# 21. Ekip dağılımı

Her sahip kendi modülünün API, veri modeli, ekran, test ve entegrasyon teslimini takip eder. Ortak tasarım bileşenleri Faruk'tan, auth/DB sözleşmesi Ümit'ten alınır. Bütün ekranlar Faruk'a, bütün endpoint'ler Ümit'e bırakılmaz.

| Kişi | Birincil sorumluluk | Somut teslim |
| --- | --- | --- |
| Faruk | Tasarım sistemi ve ana kullanıcı arayüzü | App shell, auth ekranları, anket oluştur/detay/oy, yorum/alternatif UI, feed, arama/kategori ve tüm trend ekranları |
| Ümit | Çekirdek veri ve keşif backend'i | Auth/profil API, anket/oy bütünlüğü, yorum/alternatif API, feed/search/kategori API, trend motoru, snapshot, DB performansı |
| Mert | Medya, moderasyon ve topluluklar; uçtan uca ana sahip | Upload/model servisi, rapor ve moderasyon kuyruğu, anket/yorum admin işlemleri, topluluk üyeliği/feed/moderatör yetkileri ve ilgili kullanıcı/admin ekranları |
| Utku | Yönetim güvenliği ve bildirim altyapısı + QA | Ortak RBAC, kullanıcı yaptırımları/admin users, audit log API/UI, sistem ayarları/acil anahtarlar API/UI, bildirim teslimi, CI/E2E |
| Mehmet | Büyüme ve geri dönüş akışları + ürün | İlgi seçimi, profil/kaydedilenler UI ve bookmark API, karar güncellemesi API/UI, bildirim merkezi UI, paylaşım/SEO, admin dashboard, öne çıkarma/duyuru API/UI, kategori yönetim UI |

Utku bildirim teslimi/tekrar denemeden, her modül sahibi kendi olayını üretmekten sorumludur. Mehmet metrik sözlüğü/dashboard endpoint'lerini uygular; Ümit sorgu/index desteği verir. Ümit kategori API'sini, Mehmet yönetim ekranını teslim eder. Mert topluluk yetkilerini Utku'nun ortak RBAC altyapısıyla sınırlar.

**Kapasite kuralı:** Faruk, Ümit ve Mert ana geliştirme hattıdır. Mehmet ve Utku haftalık kapasitelerinin yaklaşık yarısını belirtilen modüllere, kalanını ürün/QA/entegrasyona ayırır. Bu başlangıç varsayımı ilk hafta gerçek uygunlukla güncellenir. Kişi başına aynı anda en fazla bir büyük geliştirme işi ve bir küçük düzeltme açık tutulur. Taşan iş haftalık kontrolde başka sahibe açıkça devredilir; Mert'in kendi teslimleri varken belirsiz destek kuyruğuna atılmaz.

---

# 22. Hızlı workflow

Amaç ağır kurumsal süreç değil, hızlı ama kontrollü geliştirmedir.

## Branch

- `main`: her zaman çalışır durumda
- `feat/...`
- `fix/...`

## Review politikası

Her küçük değişiklik için uzun review beklenmez.

### Düşük risk

Örnek:

- metin
- spacing
- UI düzeni
- küçük bug

Geliştirici test edip merge edebilir; Mehmet/Utku sonradan review edebilir.

### Yüksek risk

En az bir Mehmet/Utku hızlı review önerilir:

- auth
- vote integrity
- DB migration
- permissions
- admin yetkileri
- moderation
- rate limit
- production config

Review'ın amacı bloklamak değil, kritik hata yakalamaktır.

---

# 23. 5 haftalık paralel geliştirme planı

Beş hafta hedef takvimdir. Haftalık çıkışlar staging'de gerçek entegrasyonla kabul edilir; mock ekran tamamlanmış özellik sayılmaz. Hafta 5 kapasitesinin en az %30'u beta hataları/yayın tamponudur. Her hafta kişi-gün kapasitesi kontrol edilir; taşmada sahip/tarih güncellenir, korunan V1 kapsamı değişmez.

## Hafta 1 — Sözleşmeler ve çalışan ilk akış

| Sahip | Teslim |
| --- | --- |
| Faruk | Design tokens, ortak bileşenler, mobil app shell, auth ve temel anket/oy ekranları |
| Ümit | DB/migration, auth, profil sözleşmesi, temel anket oluştur/oku/oy endpoint'leri, kapanış ve tek oy kısıtı |
| Mert | Upload/model teknik denemesi, medya/rapor şeması ve sözleşmesi, ortak admin layout'u |
| Utku | CI/staging, ortak RBAC temeli, kayıt/oy smoke testleri, bildirim olay sözleşmesi |
| Mehmet | İlgi seçimi UI/veri sözleşmesi, olay sözlüğü, kabul senaryoları, içerik/topluluk listesi |

**Çıkış:** Staging'de gerçek hesapla anket oluşturulur ve ikinci hesap oy verir. İlk iki günde API/hata formatı, roller, ID'ler ve modül sahipliği belirlenir. Teknoloji/hosting, repo yapısı ve CI komutları Ümit + Utku tarafından kısa teknik kararda kaydedilir.

## Hafta 2 — Sosyal katılım ve geri dönüş

| Sahip | Teslim |
| --- | --- |
| Faruk | Anket galerisi/sonuç, yorum/cevap/alternatif UI, feed entegrasyonu |
| Ümit | Yorum/alternatif API, oy değiştirme/idempotency, sonuç gizliliği, cooldown ve feed temeli |
| Mert | Gerçek upload/optimizasyon/karantina, rapor API/modalı, moderasyon kuyruğu ilk sürümü |
| Utku | Bildirim saklama/teslim/tekrar deneme, login/yorum rate limit, oy/auth testleri |
| Mehmet | Profil/kaydedilenler, bookmark API, karar güncellemesi API/UI, paylaşılabilir anket URL/metadata |

**Çıkış:** Oluştur → oy ver → yorum/alternatif → kaydet → kararı takip et akışı çalışır. Riskli görsel servis hatasında açılmaz. Temel rapor/kaldırma akışı ekip içi testte kullanılabilir.

## Hafta 3 — Farklı alanlar, bütün trendler ve topluluklar

| Sahip | Teslim |
| --- | --- |
| Faruk | Günün/Haftanın Yükselenleri, En Çok Oy Verilenler, En Çok Konuşulanlar, Haftanın Değişkenleri, search/kategori UI |
| Ümit | Tüm trend hesapları, snapshot işleri, dönem karşılaştırması, search/kategori API, çeşitli feed sıralaması |
| Mert | Topluluk katıl/ayrıl/feed, topluluk ekranları/admin yönetimi ve topluluk moderasyonu |
| Utku | Bildirim tercihleri/sessize alma API, kullanıcı yaptırımları/admin users ekranı, topluluk yetki testleri |
| Mehmet | Bildirim merkezi UI, onboarding entegrasyonu, paylaşım kaynak ölçümü, dashboard metrik API/UI temeli |

**Çıkış:** Bütün keşif formatları gerçek API'yle çalışır. Haftanın Değişkenleri tarihli fixture ile doğrulanır; canlı geçmiş yetersizse açıklayıcı boş durum gösterir. Topluluk yetkileri ayrıdır. Ekip içi alfa başlar.

## Hafta 4 — Kapsamlı admin ve kapalı beta

| Sahip | Teslim |
| --- | --- |
| Faruk | Ortak admin bileşen desteği, ana akış mobil/erişilebilirlik iyileştirmeleri, trend açıklamaları |
| Ümit | Trend yeniden hesaplama/geçersiz oy desteği, sorgu/index iyileştirmeleri, çekirdek entegrasyon düzeltmeleri |
| Mert | Tam moderasyon paneli, anket/yorum yönetimi, görsel risk/hash işlemleri, topluluk moderatörü yönetimi |
| Utku | Audit log API/UI, sistem ayarları/acil anahtarlar, admin yetki ve upload bypass testleri |
| Mehmet | Öne çıkarma zamanlaması/duyurular API/UI, kategori yönetimi, dashboard tamamlama, beta içerik/davet koordinasyonu |

**Çıkış:** Kapsamlı admin modülleri kullanılabilir. Yetki, oy, upload ve temel moderasyon kapıları geçince kapalı beta açılır. Geçilmezse davet tarihi ötelenir; ekip içi doğrulama sürer.

## Hafta 5 — Beta bulguları ve public V1

| Sahip | Teslim |
| --- | --- |
| Faruk | Gerçek cihaz/mobil polish, loading/empty/error durumları, erişilebilirlik düzeltmeleri |
| Ümit | Yük altında oy/trend doğruluğu, sorgu performansı, migration ve backup/restore |
| Mert | Medya kaynak/gecikme ölçümü, moderasyon eşik ayarı, topluluk/rapor regresyonları |
| Utku | Regresyon, browser/device matrisi, hata alarmları, geri alma tatbikatı, production doğrulaması |
| Mehmet | Paylaşım/SEO doğrulaması, ilk katkı hunisi/içerik takvimi, beta ürün düzeltmeleri, yayın kararı |

**Çıkış:** Bölüm 24 tamamlandığında public V1. Eksik kabulün sahibi ve yeni tarihi kaydedilir; takvim test kanıtının yerine geçmez.

---

# 24. Public V1 release checklist

- [ ] Register/login çalışıyor
- [ ] E-posta doğrulama çalışıyor
- [ ] Anket oluşturma çalışıyor
- [ ] Fotoğraf upload çalışıyor
- [ ] Image moderation çalışıyor
- [ ] Oylar duplicate üretmiyor
- [ ] Yorum/cevap çalışıyor
- [ ] Alternatif öneri çalışıyor
- [ ] Kaydetme çalışıyor
- [ ] Notification center çalışıyor
- [ ] Search çalışıyor
- [ ] Günün Yükselenleri çalışıyor
- [ ] Haftanın Yükselenleri çalışıyor
- [ ] En Çok Oy Verilenler çalışıyor
- [ ] En Çok Konuşulanlar çalışıyor
- [ ] Haftanın Değişkenleri çalışıyor
- [ ] Kategoriler çalışıyor
- [ ] Temel topluluk sistemi çalışıyor
- [ ] Rate limit/cooldown aktif
- [ ] Report sistemi aktif
- [ ] Admin içerik kaldırabiliyor
- [ ] Admin kullanıcı ban/suspend edebiliyor
- [ ] Admin istediği anketi öne çıkarabiliyor
- [ ] Öne çıkarma başlangıç/bitiş tarihi çalışıyor
- [ ] Admin trend'den içerik çıkarabiliyor
- [ ] Admin kategori/topluluk yönetebiliyor
- [ ] Admin sistem limitlerini değiştirebiliyor
- [ ] Audit log çalışıyor
- [ ] Acil durum switch'leri çalışıyor
- [ ] Mobil responsive test geçti
- [ ] Production error logging var
- [ ] Backup planı var
- [ ] SSL/DNS/Cloudflare tamam
- [ ] SEO metadata tamam
- [ ] Kritik/Yüksek bug kalmamış

---

## Kanıt gerektiren yayın kapıları

Her kontrolde test çıktısı veya staging senaryosu, tarih ve teslim sahibi release kaydına eklenir. Teknik test ve ürün kabulü ayrı kaydedilir.

- [ ] Ümit + Utku: Aynı hesaptan 20 eşzamanlı oy isteği tek aktif oy üretir; kapanış sonrası oy reddedilir; oy değiştirme toplamları bozmaz.
- [ ] Ümit + Mehmet: Gizli sonuç API/HTML/cache/OG üzerinde sızmaz; ilk oy sonrası seçenek değişimi reddedilir.
- [ ] Mert + Utku: Topluluk moderatörü başka topluluğa işlem yapamaz; normal kullanıcı admin API'sine erişemez; yaptırımlar açık oturumda da uygulanır.
- [ ] Mert: Model kesintisinde görsel karantinada kalır; kaldırılan medya public erişimden çıkar; manuel inceleme çalışır.
- [ ] Ümit: Her trend formatı tarihli fixture ile beklenen farklı sıralamayı verir; az örneklem, eksik snapshot ve geçersiz oy sonrası yeniden hesaplama doğrulanır.
- [ ] Utku + Mehmet: Tekrar işlenen olay tek bildirim oluşturur; tercih/sessize alma uygulanır; karar güncellemesi oy sonucunu değiştirmez.
- [ ] Mehmet: Süreli öne çıkarma başlar/biter ve organik trendden ayrılır; kazanım/dönüş ölçümleri pay/paydayla doğrulanır.
- [ ] Utku: Yetkisiz ayar değişimi reddedilir; acil anahtarlar yeni işlemleri durdurur; kritik admin işlemleri önce/sonra audit kaydı bırakır.
- [ ] Ümit + Utku: Yedek temiz ortama geri yüklenir ve smoke test geçer; migration/deployment geri dönüş yöntemi denenir.
- [ ] Faruk + Utku: 360 px mobil görünüm, klavye ile oy/yorum ve hata sonrası yeniden deneme doğrulanır.
- [ ] Ümit + Utku: Başlangıç yük profili 10.000 anket, 100.000 oy ve 50 eşzamanlı kullanıcıdır; feed API p95 < 800 ms, oy API p95 < 500 ms, hata oranı < %1 hedefi ölçülür. Donanım ve test süresi raporda belirtilir; bu sınırsız ölçek kanıtı değildir.
- [ ] Mehmet: Beta kullanıcıları dış yardım almadan anket açma, oy/yorum ve topluluk katılımını tamamlayabilir; açık kritik/yüksek hata yoktur.

# 25. İlk yayın sonrası — V1.1 / V1.2

İlk kullanıcı verisine göre aşağıdaki özellikler açılır:

## V1.1

- daha iyi kişiselleştirilmiş feed
- kullanıcı güven puanı
- rozetler
- topluluk sahipliği/talep sistemi
- üniversite e-posta doğrulama opsiyonu
- gelişmiş trend karşılaştırma grafikleri

## V1.2

- kullanıcı katkı puanı
- günlük/haftalık görevler
- sponsorlu karar altyapısı
- markaların araştırma anketleri
- açıkça etiketlenmiş sponsorlu içerik
- toplulaştırılmış KararVer İçgörüleri

---

# 26. Ekip için temel kural

- Her modülün bir teslim sahibi ve yazılı kabul koşulu vardır; destek veren kişi sahipliği kendiliğinden devralmaz.
- Faruk ve Ümit ortak sözleşmeleri erken sağlar; diğer geliştiriciler kendi modüllerini bunlarla üretir.
- Mert medya/moderasyon/topluluk teslimlerinin ana sahibidir.
- Mehmet ve Utku'nun geliştirme işleri haftalık tabloda yer alır; ürün/QA için ayrılan süre korunur.
- Bir bağımlılık bir iş gününden fazla bekletiyorsa iş bölünür veya kapasitesi olan kişiye açıkça devredilir.
- Her işin sahibi kendi doğrulamasını yapar. Kritik değişikliklerde kısa çapraz kontrol önerilir; tüm işler Mehmet/Utku onay kuyruğuna yığılmaz.
- Günlük kısa kontrolde teslim, engel ve sonraki entegrasyon; haftalık demoda gerçek API/veri konuşulur.

Hedef: **Üç ana geliştirme hattı ve somut modül teslim eden iki ürün/kalite geliştiricisiyle geniş V1 kapsamını birlikte tamamlamak.**
