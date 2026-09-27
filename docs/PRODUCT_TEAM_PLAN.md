# KararVer — Ürün, Ekip ve 5 Haftalık Hızlı Geliştirme Planı

> Amaç: Klasik, eksik bir MVP değil; gerçek kullanıcıya açılabilecek, premium görünen, moderasyonu güçlü, admin tarafından yönetilebilen ve büyümeye hazır bir **V1** çıkarmak.
>
> Ekip: **Faruk, Ümit, Mert, Utku, Mehmet**
>
> Çalışma modeli: **5 kişinin toplam yükü mümkün olduğunca dengeli tutulur. Faruk, Ümit ve Mert ana geliştirme hatlarında sürekli üretim yapar. Utku ve Mehmet review/QA/ürün kontrolünü sahiplenir; ancak bunun yanında belirli teknik modüllerin doğrudan geliştiricisidir. Review rolü onların kod yazmasını engellemez.**

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

## Mobil alt navigation

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

V1'de takipçi sistemi zorunlu değildir; veri modeli ileride eklenebilir şekilde tasarlanır.

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

Örnek: Kullanıcı ikinci el bir aracın hasarlı/boyalı bölgelerinin fotoğraflarını yükleyip “Bu araba bu fiyata alınır mı?” diye sorabilir.

Kurallar:

- Bir gönderiye birden fazla görsel yüklenebilir.
- Görseller yeniden boyutlandırılır ve optimize edilir.
- EXIF/metaveri mümkün olduğunca temizlenir.
- Maksimum dosya boyutu admin panelinden değiştirilebilir.
- Desteklenen MIME türleri backend tarafından doğrulanır.
- Dosya binary verisi ana DB'de tutulmaz; storage URL'si saklanır.

---

# 5. Oy sistemi

- Bir kullanıcı aynı ankete yalnızca bir aktif oy verebilir.
- Aynı isteğin iki kez gelmesi çift oy üretmemelidir.
- Oy işlemi transaction-safe ve idempotent olmalıdır.
- Anket kapandıktan sonra oy kabul edilmez.
- Admin sistem ayarından izin verirse kullanıcı anket kapanmadan oyunu değiştirebilir.
- Sonuçlar yüzde + oy sayısı olarak gösterilir.

Her seçenek için günlük snapshot tutulur. Böylece geçen haftaya göre görüş değişimi ölçülebilir.

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

Örnek: “3 milyon TL'ye Tesla alınır mı?” sorusunda kullanıcı “Bu bütçede BMW i4’e de bakılabilir.” şeklinde alternatif önerebilir.

Alternatifler topluluk tarafından beğenilebilir ve sıralanabilir.

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
- Kaydetme aktivitesi
- İçerik yaşı

---

# 8. KararVer'e özel trend formatları

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
> Bu hafta: %46 “Alınır”  
> Değişim: `-36 puan`

Sistem günlük oy oranı snapshot'ları tutar ve yeterli örneklem bulunan anketleri karşılaştırır. Minimum oy eşiği admin panelinden değiştirilebilir.

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

Admin kategori oluşturabilir, düzenleyebilir, pasife alabilir, sırasını değiştirebilir ve ikon/görsel belirleyebilir.

---

# 10. Topluluk sistemi

KararVer'in uzun vadeli büyüme motorlarından biridir.

Örnek: **Samsun Üniversitesi Topluluğu**

Öğrenciler topluluk içerisinde kampüs, yemekhane, ulaşım, etkinlikler, dersler ve öğrenci hizmetleri hakkında anket açabilir.

## V1 topluluk özellikleri

- Admin topluluk oluşturabilir.
- Kullanıcı topluluğa katılabilir/ayrılabilir.
- Topluluğun kendi feed'i olur.
- Topluluk içerisindeki anketler ayrı filtrelenebilir.
- Admin topluluk moderatorü atayabilir.

İlk public sürümde topluluk oluşturma admin kontrollü olabilir.

---

# 11. Kaydetme ve bildirimler

## Kaydetme

- Anketi kaydet
- Kaydı kaldır
- Profil → Kaydedilenler

Kaydedilenler private olur.

## Uygulama içi bildirimler

- Anketine yorum geldi
- Yorumuna cevap geldi
- Alternatif öneri geldi
- Anketin belirli oy sayısına ulaştı
- Anketin Günün/Haftanın Yükselenleri'ne girdi
- Moderasyon işlemi uygulandı
- Takip ettiği toplulukta öne çıkan konu oluştu

Read/unread durumu tutulur.

---

# 12. Search / SEO / paylaşım

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

X, WhatsApp ve diğer platformlarda paylaşım kartı düzgün görünmelidir.

Kartta:

- soru
- güncel oy yüzdesi
- toplam oy
- KararVer logosu

bulunabilir.

---

# 13. Anti-spam ve kullanım limitleri

Bu limitlerin tamamı admin panelinden değiştirilebilir olmalıdır.

## Önerilen varsayılan değerler

### Yeni hesap — ilk 7 gün

- maksimum 3 anket / 24 saat
- iki anket arasında minimum 30 dakika

### Normal hesap

- maksimum 10 anket / 24 saat
- iki anket arasında minimum 10 dakika

### Ek kontroller

- yorum burst rate-limit
- aynı başlığı tekrar tekrar gönderme koruması
- duplicate görsel hash kontrolü
- engellenen görseller için perceptual hash listesi
- aşırı isteklerde throttle
- login brute-force koruması

Bütün limitler deploy yapmadan **Admin → Sistem Ayarları** üzerinden değiştirilebilir.

---

# 14. Görsel moderasyon

Dışarıdan ücretli API kullanmadan, kendi sunucumuzda çalıştırılabilecek küçük bir görsel moderasyon modeli hedeflenir.

Akış:

`Upload → MIME/boyut kontrolü → re-encode → lokal görsel moderasyon → risk skoru → yayın / inceleme kuyruğu / red`

## Risk seviyeleri

- **Düşük:** normal yayın
- **Orta:** `UNDER_REVIEW` veya işaretli yayın
- **Yüksek:** otomatik karantina / engel

Model nihai otorite değildir. Admin sonucu override edebilir.

---

# 15. Kullanıcı raporlama

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

# 16. GELİŞMİŞ ADMIN PANELİ

Admin paneli V1'in çekirdeğidir.

## Roller

- Moderator
- Admin
- Super Admin

Yetkiler backend tarafından doğrulanır.

## Dashboard metrikleri

- toplam kullanıcı
- günlük/haftalık aktif kullanıcı
- yeni kayıt
- toplam ve günlük anket
- toplam ve günlük oy
- toplam yorum
- bekleyen rapor
- moderasyon kuyruğu
- yüklenen / engellenen görsel sayısı
- 7/30 günlük büyüme grafikleri

## İçerik yönetimi

Admin bütün anketlerde:

- görüntüle
- düzenle
- gizle
- yayından kaldır
- geri yükle
- kilitle
- yorumları kapat
- kategori / etiket / topluluk değiştir
- trending'den çıkar
- rapor geçmişini gör

uygulayabilir.

## Admin tarafından içerik öne çıkarma

Admin istediği içeriği öne çıkarabilir.

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

Sponsorlu içerik ileride eklenirse mutlaka açıkça **Sponsorlu** olarak etiketlenir.

## Duyuru sistemi

Admin:

- site duyurusu oluşturabilir
- banner gösterebilir
- belirli kullanıcı gruplarına bildirim gönderebilir
- başlangıç/bitiş tarihi planlayabilir

## Kullanıcı yönetimi

Admin:

- kullanıcı arayabilir
- profil + aktivite geçmişini görebilir
- uyarı verebilir
- yorum yetkisini geçici kapatabilir
- anket açma yetkisini geçici kapatabilir
- suspend / ban uygulayabilir
- yaptırımı kaldırabilir
- rapor geçmişini görebilir

## Moderasyon kuyruğu

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

## Kategori / topluluk yönetimi

- kategori oluştur / sırala / pasife al
- topluluk oluştur / kapat
- topluluk moderatorü ata
- topluluk açıklaması ve görselini düzenle

## Sistem ayarları

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
- Haftanın Değişkenleri minimum oy eşiği
- yeni kayıt aç/kapat
- anket oluşturmayı aç/kapat
- yorumları global aç/kapat
- görsel upload aç/kapat
- bakım modu

## Acil durum kontrolleri

Super Admin tek işlemle:

- yeni kayıtları durdurabilir
- anket oluşturmayı durdurabilir
- yorumları kapatabilir
- upload'ı kapatabilir
- siteyi bakım moduna alabilir

## Audit log

Kritik admin işlemleri kayıt altına alınır:

- kim yaptı
- ne yaptı
- hangi öğe üzerinde yaptı
- önceki durum
- sonraki durum
- zaman

Admin kendi işlem geçmişini silemez.

---

# 17. İçerik ve kullanıcı durumları

İçerik:

- `ACTIVE`
- `HIDDEN`
- `UNDER_REVIEW`
- `LOCKED`
- `REMOVED`

Kullanıcı:

- `ACTIVE`
- `RESTRICTED`
- `SUSPENDED`
- `BANNED`

Hard delete yerine mümkün olduğunca soft delete tercih edilir.

---

# 18. Gelecek özellikleri — mimari hazır olacak

İlk public V1'de zorunlu olmayabilir:

- kullanıcı güven puanı
- rozet / streak
- katkı puanı
- sponsorlu kararlar
- markaların araştırma anketleri
- doğrulanmış üniversite/kurum toplulukları
- üniversite e-posta doğrulama
- topluluk içgörüleri
- gelişmiş kişiselleştirilmiş feed

---

# 19. Teknik prensipler

- Frontend/backend sözleşmeleri baştan tanımlanır.
- Validation backend tarafında zorunludur.
- Kritik işlemler idempotent tasarlanır.
- DB migration sistemi kullanılır.
- Liste endpoint'lerinde pagination vardır.
- Görseller object storage mantığına hazır tasarlanır.
- Dosya URL'leri DB'ye yazılır; binary DB'ye yazılmaz.
- Audit log ve moderasyon logları baştan düşünülür.
- Admin yetkisi yalnızca frontend kontrolüne bırakılmaz.
- Kritik sorgular index'lenir.
- N+1 sorgular önlenir.
- Production error logging bulunur.

---

# 20. DENGELİ EKİP DAĞILIMI

## Temel kural

**Toplam iş yükü yaklaşık %20 / %20 / %20 / %20 / %20 hedeflenir.**

Bu eşit sayıda issue anlamına gelmez; işlerin zorluğu ve review sorumluluğu da hesaba katılır. Utku ve Mehmet'in review/QA yükü teknik iş yüklerinin bir parçasıdır.

Hiçbir kişi tüm kritik altyapıyı tek başına taşımamalıdır.

---

## FARUK — Core Backend / Data

**Toplam hedef yük: ~%20**

Ana sahiplik:

- DB schema ve migration çekirdeği
- auth backend
- user/session modeli
- poll/options modeli
- poll CRUD
- vote integrity + idempotency
- comments/replies çekirdeği
- bookmark/save backend
- temel API contracts
- core DB indexleri

Paylaşılan / devredilen işler:

- trend engine → **Mehmet** ana sahip
- search/feed ranking → **Mehmet** ana sahip
- admin backend/RBAC/settings → **Utku** ana sahip
- community backend → **Mert** ana sahip
- media/moderation backend → **Mert** ana sahip
- notifications → **Mert + Mehmet**

Faruk'un görevi çekirdek veri ve karar bütünlüğüdür; bütün backend'i tek başına taşımaz.

---

## ÜMİT — Product UI / Frontend

**Toplam hedef yük: ~%20**

Ana sahiplik:

- design system ve premium mor/dark tema
- app shell / navigation
- ana feed
- anket kartları
- anket detay ekranı
- anket oluşturma UI
- oy verme ve sonuç UI
- yorum / alternatif öneri UI
- profil / kaydedilenler UI
- responsive/mobile polish
- loading / empty / error states

Paylaşılan işler:

- Mehmet ile keşfet/trend ekranları
- Utku ile admin frontend'in kritik ekranları
- Mert ile topluluk/media UI

Ümit bütün admin + trend + community frontend'ini tek başına taşımayacaktır.

---

## MERT — Media / Community / Moderation Full-stack

**Toplam hedef yük: ~%20**

Ana sahiplik:

- image upload pipeline
- image resize/compress
- EXIF cleanup
- storage entegrasyonu
- lokal image moderation entegrasyonu
- risk seviyeleri
- rejected image hash / perceptual hash
- report sistemi
- moderation queue backend
- community backend
- community membership / permissions
- community moderation
- topluluk yönetimi entegrasyonu

Ek sorumluluk:

- notification delivery altyapısına destek
- admin moderation araçlarının entegrasyonu
- media/community UI'da Ümit'e destek

Mert sadece destek geliştirici değildir; bağımsız iki büyük alanın sahibidir: **Media/Moderation + Community**.

---

## UTKU — Admin / Security / QA + Full-stack

**Toplam hedef yük: ~%20 (kod + review birlikte)**

Ana teknik sahiplik:

- admin RBAC / permissions
- user sanctions
- ban / suspend / restrict
- content hide / restore / lock
- system settings backend
- emergency switches
- featured content backend
- scheduled feature start/end
- audit log backend
- rate-limit/security ayarları
- admin frontend'in users/reports/settings bölümlerinde Ümit'e destek

Review/QA sahipliği:

- auth bypass
- vote integrity
- privilege escalation
- rate-limit bypass
- moderation bypass
- file upload abuse
- security checklist
- regression testleri

Utku yalnızca reviewer değildir. **Admin + security hattının doğrudan geliştiricisidir.**

---

## MEHMET — Trends / Search / Integration / Product + Review

**Toplam hedef yük: ~%20 (kod + ürün/review birlikte)**

Ana teknik sahiplik:

- trend score motoru
- vote velocity hesapları
- günlük snapshot işleri
- week-over-week delta
- Haftanın Değişkenleri backend mantığı
- minimum sample threshold
- search API / search entegrasyonu
- feed ranking / sorting
- Günün/Haftanın Yükselenleri veri akışı
- analytics event şeması
- trend/keşfet frontend'inde Ümit'e destek
- notification kurallarında Mert'e destek

Product/review sahipliği:

- acceptance criteria
- UI/UX kabulü
- ranking kalitesi
- entegrasyon kontrolü
- issue önceliği
- release checklist
- final release kararı

Mehmet yalnızca kenardan review yapmaz. **Trend/Search/Ranking hattının doğrudan geliştiricisidir.**

---

# 21. Hızlı workflow

Amaç ağır kurumsal süreç değil, hızlı ama kontrollü geliştirmedir.

## Branch

- `main`: her zaman çalışır durumda
- `feat/...`
- `fix/...`

## Review politikası

Her küçük değişiklik uzun review beklemez.

### Düşük risk

- metin
- spacing
- UI düzeni
- küçük bug

Geliştirici test edip merge edebilir; Mehmet/Utku sonradan kontrol edebilir.

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

Review'ın amacı bloklamak değil kritik hata yakalamaktır.

---

# 22. 5 HAFTALIK DENGELİ PARALEL GELİŞTİRME PLANI

# HAFTA 1 — Temel sistem + paralel iskelet

## Faruk

- DB schema v1
- migrations
- auth backend
- user/session
- poll/options/vote modelleri
- ilk core API contracts

## Ümit

- design tokens
- global dark/purple theme
- responsive app shell
- navigation
- login/register UI
- feed mock
- poll card component

## Mert

- upload/storage mimarisi
- image metadata modeli
- report/moderation schema
- community schema + membership modeli

## Utku

- admin route/layout başlangıcı
- RBAC modeli
- admin user/role endpoint başlangıcı
- auth threat/edge-case checklist
- test skeleton

## Mehmet

- trend/snapshot veri modeli
- search/ranking contract
- acceptance criteria
- seed içerik örnekleri
- entegrasyon checklist

### Hafta 1 çıkışı

Kullanıcı kayıt olabilir, login olabilir, temel feed'i görebilir; anket modeli ve beş paralel çalışma hattı hazırdır.

---

# HAFTA 2 — Karar döngüsü

## Faruk

- poll CRUD
- vote idempotency
- vote change policy
- comments/replies
- save/bookmark
- cooldown çekirdeği

## Ümit

- poll create UI tamamlama
- poll detail
- oy verme UI
- sonuç animasyonu
- comments UI
- alternative suggestion UI

## Mert

- gerçek image upload
- resize/compress/EXIF cleanup
- report endpoints
- moderation queue temeli
- community create/read altyapısı

## Utku

- admin users temel ekran/API
- sanction altyapısı
- rate-limit config altyapısı
- duplicate vote / auth bypass testleri
- kritik bug fix

## Mehmet

- daily snapshot job
- basic trend score v1
- search endpoint v1
- create→vote→comment entegrasyon testi
- UI/product kabulü

### Hafta 2 çıkışı

KararVer'in temel döngüsü fotoğraf dahil uçtan uca çalışır.

---

# HAFTA 3 — Keşfet, trend ve topluluk

## Faruk

- core API stabilizasyonu
- notification event hooks
- category APIs
- query/index optimizasyonu
- pagination

## Ümit

- profil / saved UI
- search/keşfet UI
- kategori ekranları
- trend kart componentleri
- community UI temel ekranları

## Mert

- community membership
- community feed backend
- community permissions
- community moderation
- notification delivery desteği

## Utku

- featured content backend v1
- admin categories/communities management
- permissions testleri
- admin content actions başlangıcı

## Mehmet

- vote velocity
- week-over-week delta
- Haftanın Değişkenleri
- Günün/Haftanın Yükselenleri
- En Çok Oy / En Çok Konuşulanlar
- feed sorting
- ranking kalite testi

### Hafta 3 çıkışı

Platform artık yalnızca anket sitesi değil; keşfedilebilir, trendleri ve toplulukları olan sosyal ürün haline gelir.

---

# HAFTA 4 — Güçlü Admin + Moderasyon

## Faruk

- core backend hardening
- transaction/data integrity test fixes
- admin metrics için core aggregate sorgular
- DB performans düzeltmeleri

## Ümit

- admin dashboard UI
- polls/comments UI
- featured content UI
- responsive/admin polish

## Mert

- lokal image moderation
- risk levels
- moderation actions
- report workflow
- rejected image hash list
- moderation queue entegrasyonu

## Utku

- RBAC tamamlama
- user sanctions
- content hide/restore/lock
- system config
- emergency switches
- featured scheduling
- audit log
- security abuse testleri

## Mehmet

- admin trend controls
- trending'den çıkarma/override entegrasyonu
- admin panel operasyon testleri
- “10 saniyede kötü içeriği bulup kaldır” senaryosu
- featured post akışı testi
- ranking/admin entegrasyon bug fix

### Hafta 4 çıkışı

Gerçek kullanıcı trafiğini yönetebilecek admin, moderasyon ve güvenlik sistemi hazır olur.

---

# HAFTA 5 — Production / Polish / Kapalı Beta

## Faruk

- DB index final
- pagination/performance final
- production DB/config
- backup planı
- core error handling

## Ümit

- mobile/desktop polish
- skeleton/empty/error states
- paylaşım kartları
- SEO UI detayları
- frontend performans

## Mert

- storage production testi
- moderation tuning
- community bug fix
- media performans ve fallback senaryoları

## Utku

- regression suite
- security checklist
- browser/mobile matrix
- load/abuse testleri
- admin/security bug fixes

## Mehmet

- analytics eventleri
- ranking final tuning
- release checklist
- seed content
- closed beta review
- final integration bug fixes
- public release kararı

### Hafta 5 çıkışı

**Public V1**

---

# 23. Public V1 release checklist

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
- [ ] Admin kullanıcı ban/suspend/restrict uygulayabiliyor
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

# 24. İlk yayın sonrası — V1.1 / V1.2

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

# 25. Ekip için temel kural

- Herkesin toplam yükü haftalık kontrol edilir.
- Bir kişinin açık işi diğerlerinin belirgin biçimde üstüne çıkarsa yeni işler en az yüklü kişiye kaydırılır.
- Faruk tüm backend'in varsayılan sahibi değildir.
- Ümit tüm frontend'in varsayılan sahibi değildir; Mert, Utku ve Mehmet kendi alanlarının UI/entegrasyonlarına girer.
- Mehmet ve Utku review kuyruğu oluşturmaz; review ile birlikte kendi teknik modüllerini geliştirir.
- Bir iş başka kişiyi 1 günden fazla bloke edecekse görev bölünür.
- Bir kişinin haftalık yükü yaklaşık **%25'ten fazla** büyürse görev yeniden dağıtılır.

Hedef: **5 kişinin aynı dosyaya saldırması değil; 5 paralel sahiplik alanı ve gerektiğinde birbirine destek olan tek ekip oluşturmak.**