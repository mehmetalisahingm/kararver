# KararVer — Ürün, Ekip ve 5 Haftalık Hızlı Geliştirme Planı

> Amaç: Klasik, eksik bir MVP değil; gerçek kullanıcıya açılabilecek, premium görünen, moderasyonu güçlü, admin tarafından yönetilebilen ve büyümeye hazır bir **V1** çıkarmak.
>
> Ekip: **Faruk, Ümit, Mert, Utku, Mehmet**
>
> Çalışma modeli: **Faruk + Ümit ana üretim yükünü taşır. Mert üçüncü aktif geliştiricidir. Mehmet + Utku ana olarak review/QA/ürün kontrolü yapar; ancak ihtiyaç olduğunda doğrudan kodlamaya girer.**

---

# 1. Ürün vizyonu

KararVer; insanların karar veremedikleri konuları topluluğa sorabildiği, fotoğraf ve açıklama ile gönderi oluşturabildiği, oy ve yorum alabildiği, alternatif önerileri görebildiği, gündemde yükselen kararları keşfedebildiği Türkiye odaklı sosyal karar platformudur.

Temel ürün döngüsü:

**Sor → Oy Al → Yorumları Gör → Alternatifleri Gör → Sonucu Takip Et → Yükselenleri Keşfet → Tekrar Katıl**

Uzun vadede KararVer yalnızca bireysel soruların sorulduğu bir platform değil; üniversiteler, topluluklar ve daha sonra markaların gerçek kullanıcı görüşü alabildiği bir karar ve görüş altyapısına dönüşebilir.

---

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

# 5. Oy sistemi

- Bir kullanıcı aynı ankete yalnızca bir aktif oy verebilir.
- Çift istek çift oy üretmemelidir.
- Oy işlemi transaction-safe olmalıdır.
- Anket kapandıktan sonra oy kabul edilmez.
- Admin sistem ayarından izin verirse kullanıcı anket kapanmadan oyunu değiştirebilir.
- Sonuçlar yüzde + oy sayısı olarak gösterilir.

Her seçenek için günlük snapshot tutulmalıdır. Böylece ileride “geçen haftaya göre görüş nasıl değişti?” gösterilebilir.

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

Sistem günlük oy oranı snapshot'ları tutar ve yeterli örneklem bulunan anketleri karşılaştırır.

Bir içerik “Haftanın Değişkenleri”ne girmek için minimum oy eşiğini geçmelidir. Bu eşik admin panelinden değiştirilebilir.

## Trend puanı

Örnek mantık:

`trend_score = vote_velocity + unique_voters + comment_velocity + saves - age_decay - abuse_penalty`

Katsayılar admin/config üzerinden değiştirilebilir olmalıdır.

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

bulunabilir.

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

## FARUK — Ana Frontend / Product UI geliştiricisi

**Yük: Çok yüksek**

Ana sorumluluk:

- Tasarım sisteminin kodlanması
- Premium mor dark UI
- Responsive layout
- Ana feed
- Anket kartları
- Anket detay
- Anket oluşturma
- Oy animasyonları / sonuç görünümü
- Yorum UI
- Profil
- Search / keşfet
- Yükselenler
- Haftanın formatları
- Topluluk ekranları
- Admin panelinin frontend'i
- UI polishing

Faruk mümkün olduğunca mock data ile backend'i beklemeden ilerler.

---

## ÜMİT — Ana Backend / Veri / Sistem geliştiricisi

**Yük: Çok yüksek**

Ana sorumluluk:

- DB schema
- migration
- auth
- kullanıcı sistemi
- anket CRUD
- vote integrity
- yorum sistemi
- alternatif öneri
- rate limiting
- feed API
- search API
- trend engine
- günlük snapshot sistemi
- Haftanın Değişkenleri hesaplaması
- notification backend
- admin backend
- system settings
- audit log
- authorization
- performance / DB index

Ümit'in API kontratlarını erken çıkarması Faruk'un hızını doğrudan artırır.

---

## MERT — Moderasyon / Media / Community + Support Full-stack

**Yük: Orta-yüksek**

Ana sorumluluk:

- görsel upload pipeline
- image resize/compress
- görsel moderasyon servis entegrasyonu
- report sistemi
- moderation queue
- topluluk backend/UI entegrasyon desteği
- admin moderation araçları
- bildirim desteği
- bug fix
- gerektiğinde Faruk/Ümit'in modüllerine destek

Mert gerektiğinde üçüncü ana geliştirici gibi kritik modüllere kaydırılır.

---

## UTKU — Review / QA / Güvenlik + Destek Geliştirici

**Ana rol: Review fakat yalnızca reviewer değil**

Sorumluluk:

- tamamlanan akışları kullanıcı gibi uçtan uca test etmek
- edge case bulmak
- auth / voting / rate-limit güvenlik kontrolü
- API contract kontrolü
- responsive test
- admin yetki kontrolü
- moderasyon bypass testleri
- bug issue açmak
- kritik bug'ları doğrudan düzeltmek
- gerektiğinde backend veya frontend görev almak

Utku'nun görevi geliştirmeyi durdurmak değil, geliştiricilerin arkasındaki kalite katmanı olmaktır.

---

## MEHMET — Product Owner / Review / Integration + Destek Geliştirici

**Ana rol: Ürün yönü + review; fakat aktif kod katkısı serbest**

Sorumluluk:

- ürün kararları
- issue öncelikleri
- tasarım kabulü
- feature kabul kriterleri
- kullanıcı akışlarının kontrolü
- Faruk/Ümit/Mert'in birleşen modüllerinin entegrasyon kontrolü
- admin panelinin gerçek kullanım testleri
- feed kalitesi / ranking değerlendirmesi
- kapanmamış kritik bug'ların takibi
- gerektiğinde frontend/backend bug fix
- release kararı

Mehmet ve Utku yalnızca kenardan yorum yapan reviewer değildir. Gerektiğinde istedikleri modülde kod yazabilirler.

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

# HAFTA 1 — Temel sistem + UI iskeleti

## Faruk

- design tokens
- global dark/purple theme
- responsive app shell
- navigation
- login/register UI
- feed mock
- poll card component
- poll create UI

## Ümit

- DB schema v1
- migrations
- auth backend
- session/token yapısı
- user model
- poll model
- options model
- vote model
- ilk API contracts

## Mert

- upload mimarisi
- image metadata/model tasarımı
- report schema
- moderation schema
- admin panel route/layout başlangıcı

## Utku

- auth threat/edge case listesi
- API contracts review
- test skeleton
- kritik akış checklist

## Mehmet

- UI/UX review
- acceptance criteria
- issue prioritization
- seed içerik örnekleri
- entegrasyon kontrolü

### Hafta 1 çıkışı

Kullanıcı kayıt olabilir, login olabilir, temel feed'i görebilir ve anket oluşturma ekranını kullanabilir.

---

# HAFTA 2 — Karar döngüsü

## Faruk

- poll detail
- oy verme UI
- sonuç animasyonu
- comments UI
- alternative suggestion UI
- profile
- saved polls

## Ümit

- poll CRUD tamamlama
- vote idempotency
- vote change policy
- comments
- comment replies
- alternative suggestions
- save/bookmark
- notification event temeli
- poll cooldown

## Mert

- gerçek image upload
- resize/compress
- report endpoints
- moderation queue temeli

## Utku

- duplicate vote test
- spam/cooldown test
- auth bypass test
- mobile UI test
- bug fix desteği

## Mehmet

- create → vote → comment → result uçtan uca test
- UI kabulü
- admin ihtiyaçlarını doğrulama
- destek kodlama

### Hafta 2 çıkışı

KararVer'in temel döngüsü uçtan uca çalışır.

---

# HAFTA 3 — Keşfet, trend ve topluluk

## Faruk

- Yükselenler ekranı
- Günün Yükselenleri
- Haftanın Yükselenleri
- En Çok Oy Verilenler
- En Çok Konuşulanlar
- Haftanın Değişkenleri UI
- search UI
- category pages
- community page UI

## Ümit

- trend score
- vote velocity
- daily snapshots
- week-over-week delta
- minimum sample threshold
- search API
- feed sorting
- category APIs
- community backend

## Mert

- community membership
- community moderation
- notifications
- admin community management desteği

## Utku

- trend hesaplama edge-case testleri
- query/performance review
- community permission testleri
- gerektiğinde implementation desteği

## Mehmet

- ranking sonuçlarını ürün gözüyle değerlendirme
- yanlış yükselen örneklerini bulma
- kategori/topluluk UX review
- bug/feature prioritization

### Hafta 3 çıkışı

Platform sadece anket sitesi değil, keşfedilebilir sosyal ürün haline gelir.

---

# HAFTA 4 — Güçlü Admin + Moderasyon

## Faruk

Admin frontend:

- dashboard
- users
- polls
- comments
- reports
- moderation queue
- categories
- communities
- featured content
- system settings
- audit log UI

## Ümit

Admin backend:

- RBAC
- user sanctions
- content hide/restore/lock
- featured placement
- scheduled feature start/end
- system config
- emergency switches
- audit log
- metrics endpoints

## Mert

- lokal image moderation entegrasyonu
- risk levels
- moderation actions
- rejected image hash list
- report workflow
- admin queue entegrasyonu

## Utku

- admin privilege escalation testleri
- moderation bypass
- file upload abuse testleri
- ban/restriction testleri
- kritik açıkları doğrudan fix

## Mehmet

- admin paneli gerçek operasyon senaryosu testi
- “10 saniye içinde kötü içeriği bulup kaldırabilir miyiz?” testi
- featured post akışı testi
- acil durum switch testi

### Hafta 4 çıkışı

Gerçek kullanıcı trafiğini yönetebilecek admin/moderasyon sistemi hazır olur.

---

# HAFTA 5 — Production / Polish / Kapalı Beta

## Faruk

- mobile polish
- desktop polish
- loading/skeleton
- empty states
- error states
- paylaşım kartları
- SEO UI detayları

## Ümit

- DB index
- pagination
- performance
- analytics events
- production config
- backup plan
- error logging

## Mert

- image/storage production test
- moderation tuning
- admin queue polish
- community bug fix

## Utku

- regression suite
- security checklist
- mobile/browser matrix
- load/abuse senaryoları
- bug fixing

## Mehmet

- release checklist
- UX acceptance
- content seeding
- closed beta review
- final priorities
- public release kararı

### Hafta 5 çıkışı

**Public V1**

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

Faruk ve Ümit'in akışı bekletilmemelidir.

- Faruk backend'i bekliyorsa mock contract ile UI'a devam eder.
- Ümit frontend'i bekliyorsa API + test + contract üretir.
- Mert blokaj olan yere kaydırılır.
- Utku ve Mehmet review kuyruğu oluşturmaz; kritik noktaları hızlı kontrol eder ve gerekirse kendileri düzeltir.
- Bir iş başka kişiyi 1 günden fazla bloke edecekse görev bölünür veya reviewer'lardan biri implementasyona girer.

Hedef: **5 kişinin aynı dosyaya saldırması değil, 3 paralel üretim hattı + 2 hareketli kalite/destek hattı oluşturmak.**
