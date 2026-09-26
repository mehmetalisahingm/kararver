# KararVer — Güçlü V1 MVP Ürün Planı

> Bu doküman klasik “en az özellikli MVP” değildir. Hedef; ilk günden gerçek kullanıcıya açılabilecek, güven veren, moderasyonu olan, büyümeye hazır ve veri toplayabileceğimiz güçlü bir V1 çıkarmaktır.

## Planların birlikte kullanımı

Güncel kapsam, ekip görevleri, büyüme akışları ve haftalık teslimler için [Ürün ve Ekip Planı](docs/PRODUCT_TEAM_PLAN.md) ana kaynaktır. Bu belge temel işlev/güvenlik gereksinimlerini tamamlar. Farklılık olduğunda ana plan esas alınır. Anketler, yorumlar, farklı kategoriler/topluluklar, bütün trend formatları ve kapsamlı admin V1 içinde korunur.

## 1. Ürün fikri

KararVer; kullanıcıların bir konuda kısa sürede topluluğun fikrini alabildiği, anket/karar gönderileri oluşturabildiği ve gündemde yükselen konuları keşfedebildiği Türkiye odaklı sosyal karar platformudur.

Temel döngü:

1. Kullanıcı bir karar/anket açar.
2. Topluluk oy verir ve isterse yorum yapar.
3. Sonuçlar anlık olarak görünür.
4. Etkileşim alan gönderiler yükselenler ve kategori akışlarında görünür.
5. Kullanıcı yeni sorular keşfeder ve platformda kalır.

---

## 2. V1 hedefi

İlk sürümün hedefi sadece “anket oluştur ve oy ver” değildir.

V1 sonunda platformda şunlar çalışır durumda olmalıdır:

- Kayıt / giriş sistemi
- Profil sistemi
- Anket/karar oluşturma
- Oy verme ve sonuç sistemi
- Yorumlar ve cevaplar
- Ana akış
- Kategori ve temel topluluk sistemi
- Fotoğraf galerisi ve lokal görsel moderasyon
- Alternatif öneriler
- Karar güncellemesi ve sonucu takip etme
- Arama
- Haftanın yükselenleri
- Haftanın En Çok Oy Verilenleri / En Çok Konuşulanları / Değişkenleri
- Günün yükselenleri / trendler
- Kaydetme
- Bildirimler
- Raporlama ve moderasyon
- Gelişmiş admin paneli
- Spam ve kötüye kullanım koruması
- Temel güvenlik ve loglama
- Mobil uyumlu hızlı arayüz
- Gerçek kullanıcıya açılabilecek production deployment

---

# 3. Kullanıcı sistemi

## 3.1 Kayıt ve giriş

- E-posta ile kayıt
- Kullanıcı adı
- Şifre
- E-posta doğrulama
- Şifremi unuttum
- Oturum yönetimi
- Çıkış yap

Kullanıcı adı benzersiz olmalıdır.

### Güvenlik

- Şifreler güçlü hash algoritması ile saklanmalı.
- Login endpoint’inde brute-force rate limit bulunmalı.
- E-posta doğrulanmadan bazı işlemler sınırlandırılabilmeli.

---

## 3.2 Kullanıcı profili

Profilde:

- Profil fotoğrafı
- Kullanıcı adı
- Görünen ad
- Kısa biyografi
- Katılma tarihi
- Açtığı anket sayısı
- Aldığı toplam oy
- Yaptığı yorum sayısı
- Kaydedilmiş anketler sadece kullanıcıya özel

Sekmeler:

- Anketler
- Yorumlar
- Beğenilen/Kaydedilen içerikler (özel)

İleride rozet sistemi eklenebilecek şekilde veri modeli hazırlanmalıdır.

---

# 4. Anket / Karar sistemi

Platformun ana özelliğidir.

## 4.1 Anket oluşturma

Bir kullanıcı aşağıdaki alanlarla anket açabilir:

- Başlık
- Açıklama
- 2–6 seçenek
- Kategori
- İsteğe bağlı görsel
- Anket bitiş süresi
- Yorumlara izin ver / verme

Örnek süreler:

- 1 saat
- 6 saat
- 24 saat
- 3 gün
- 7 gün
- 14 gün / 30 gün (haftalık karşılaştırmaya uygun anketler)

Admin isterse minimum ve maksimum süreleri değiştirebilmelidir.

## 4.2 Oy verme

- Bir hesap aynı ankete yalnızca bir kez oy verebilir.
- Oy işlemi transaction-safe olmalıdır.
- Aynı isteğin tekrar gönderilmesi çift oy oluşturmamalıdır.
- Anket bittikten sonra yeni oy kabul edilmez.
- Sonuçlar yüzdelik ve toplam oy olarak gösterilir.

Kullanıcı anket kapanmadan, sistem ayarı izin veriyorsa oyunu değiştirebilir. İlk oy sonrası soru/seçenekler ve sonuç görünürlüğü dondurulur. Gizli sonuçlar API/cache/paylaşım kartında da korunur; kapanış sonrası görünür olur. Manipülasyonla geçersiz sayılan oylar ve haftalık karşılaştırma için ana plandaki kurallar uygulanır.

---

# 5. Spam önleme ve yayınlama limiti

Bu özellik V1 için zorunludur.

Amaç: Bir kullanıcının bir dakika içinde çok sayıda anket açıp ana akışı bozmasını engellemek.

Limitler kodun içine sabit yazılmamalı; admin panelinden değiştirilebilir olmalıdır.

## Varsayılan öneri

### Yeni kullanıcı

İlk 7 gün:

- En fazla 3 anket / 24 saat
- İki anket arasında minimum 30 dakika

### Normal kullanıcı

- En fazla 10 anket / 24 saat
- İki anket arasında minimum 10 dakika

### Ek korumalar

- Aynı başlığın tekrar tekrar paylaşılması engellenir.
- API seviyesinde rate limit uygulanır.
- Aşırı yorum gönderimine ayrı rate limit uygulanır.
- Çok sayıda başarısız login girişimi geçici olarak engellenir.
- Şüpheli davranışlar admin loguna düşer.

İleride güven puanı arttıkça limitlerin otomatik gevşetilebilmesine uygun yapı kurulabilir.

---

# 6. Ana akış

Ana sayfa yalnızca kronolojik liste olmamalıdır.

Sekmeler:

- Sana Özel / Önerilen
- Yükselenler
- Yeni
- En Çok Oy Alanlar

İlk sürümde “Sana Özel” karmaşık makine öğrenmesi gerektirmez. Kullanıcının seçtiği kategoriler + yakın tarihli popüler içeriklerden oluşturulabilir.

---

# 7. Haftanın Yükselenleri

KararVer’in ayırt edici alanlarından biri olacaktır.

Ayrı bir sayfa ve ana sayfada özel bölüm bulunur.

Sadece toplam oy sayısına göre sıralama yapılmamalıdır. Aksi halde eski ve büyük hesaplar sürekli üstte kalır.

Yükselme puanı aşağıdaki sinyalleri dikkate alabilir:

- Son 24/48 saatte gelen benzersiz oy sayısı
- Oy artış hızı
- Yorum sayısı
- Benzersiz katılımcı sayısı
- Gönderinin yaşı
- Rapor / spam cezası

Basit başlangıç mantığı:

`trend_score = oy_hizi + yorum_etkisi + benzersiz_katilim - zaman_cezasi`

Puanın gerçek katsayıları uygulama içinde config olarak tutulmalı ve sonradan değiştirilebilmelidir.

Listeler:

- Günün Yükselenleri
- Haftanın Yükselenleri
- Haftanın En Çok Oy Verilenleri
- Haftanın En Çok Konuşulanları
- Haftanın Değişkenleri
- Kategori Bazlı Yükselenler

Her formatın ayrı ölçümü vardır. Haftanın Değişkenleri iki tamamlanmış 7 günlük pencere sonundaki geçerli dağılımları karşılaştırır; örneklem eşikleri, snapshot ve gizlilik kuralları ana planda tanımlıdır. Ham rapor sayısı doğrudan ceza değildir; editör öne çıkarmaları organik puandan ayrı tutulur.

---

# 8. Kategoriler

Başlangıç kategorileri örneği:

- Teknoloji
- Oyun
- Spor
- Eğitim
- Alışveriş
- Eğlence
- Yaşam
- Otomobil
- Yemek
- Diğer

Kategori listesi admin panelinden yönetilebilir olmalıdır.

Her kategorinin:

- slug
- isim
- açıklama
- ikon/görsel
- aktif/pasif durumu

olmalıdır.

---

# 9. Yorum sistemi

- Ankete yorum yapma
- Yoruma cevap verme
- Yorum silme
- Kendi yorumunu düzenleme
- Yorum raporlama
- Yorum beğenme

V1’de maksimum 1 seviye cevap zinciri yeterlidir. Sonsuz nested comment yapılmamalıdır.

Spam yorum koruması bulunmalıdır.

---

# 10. Arama ve keşfet

Arama aşağıdakilerde çalışmalıdır:

- Anket başlığı
- Açıklama
- Kullanıcı adı
- Kategori

Keşfet ekranında:

- Popüler kategoriler
- Yeni anketler
- Yükselen anketler
- En çok oy alanlar

bulunur.

---

# 11. Kaydetme sistemi

Kullanıcı bir anketi daha sonra görmek için kaydedebilir.

- Kaydet
- Kaydı kaldır
- Profilde “Kaydedilenler” alanı

Bu alan yalnızca hesap sahibi tarafından görülebilir.

---

# 12. Bildirim sistemi

İlk sürümde uygulama içi bildirim yeterlidir.

Bildirim örnekleri:

- Anketine yorum geldi
- Yorumuna cevap geldi
- Anketin belirli oy kilometre taşına ulaştı
- Anketin yükselenlere girdi
- Moderasyon işlemi uygulandı

Okundu / okunmadı durumu tutulmalıdır.

E-posta bildirimleri daha sonra opsiyonel olarak eklenebilir.

---

# 13. Raporlama ve moderasyon

Her anket, yorum ve kullanıcı için rapor sistemi bulunmalıdır.

Rapor nedenleri:

- Spam
- Hakaret / taciz
- Uygunsuz içerik
- Yanıltıcı / sahte içerik
- Nefret söylemi
- Kişisel bilgi paylaşımı
- Diğer

Bir içerik raporlandığında direkt silinmemelidir. Moderasyon kuyruğuna düşmelidir.

Aşırı rapor alan içerikler geçici olarak görünürlüğü azaltılabilecek şekilde tasarlanabilir.

---

# 14. Gelişmiş Admin Paneli

Admin paneli V1’in önemli parçalarından biridir ve sonradan yapılacak ek özellik gibi görülmemelidir.

## 14.1 Dashboard

Gösterilecek metrikler:

- Toplam kullanıcı
- Günlük aktif kullanıcı
- Yeni kayıtlar
- Toplam anket
- Bugün açılan anketler
- Günlük oy sayısı
- Günlük yorum sayısı
- Bekleyen raporlar
- Son 7 gün büyüme grafiği

## 14.2 Kullanıcı yönetimi

Admin:

- Kullanıcı arayabilir
- Profil detayını görebilir
- Kullanıcıyı uyarabilir
- Geçici suspend verebilir
- Banlayabilir
- Banı kaldırabilir
- Kullanıcının içeriklerini inceleyebilir

Roller:

- User
- Moderator
- Admin
- Super Admin

## 14.3 Anket yönetimi

- Anket arama
- Görüntüleme
- Yayından kaldırma
- Geri yükleme
- Kilitleme
- Kategori değiştirme
- Öne çıkarma

## 14.4 Yorum yönetimi

- Yorum arama
- Silme / geri yükleme
- Raporlanan yorumları inceleme

## 14.5 Rapor kuyruğu

Admin ve moderator:

- Raporları filtreler
- İçeriğe gider
- İşlem uygular
- Raporu sonuçlandırır

## 14.6 Sistem ayarları

Kod deploy etmeden değiştirilebilecek ayarlar:

- Günlük anket limiti
- Anket cooldown süresi
- Yorum rate limit
- Minimum / maksimum anket süresi
- Maksimum seçenek sayısı
- Dosya yükleme limiti
- Bakım modu
- Yeni kayıt açık/kapalı
- Yorum sistemi açık/kapalı

## 14.7 Audit log

Admin tarafından yapılan kritik işlemler kayıt altında tutulmalıdır:

- Kim yaptı?
- Ne yaptı?
- Hangi kullanıcı/içerik üzerinde yaptı?
- Ne zaman yaptı?

Admin işlemleri mümkün olduğunca geri izlenebilir olmalıdır.

---

# 15. Moderasyon durumları

İçerikler için örnek durumlar:

- ACTIVE
- HIDDEN
- REMOVED
- LOCKED
- UNDER_REVIEW

Kullanıcı durumları:

- ACTIVE
- SUSPENDED
- BANNED

Hard delete yerine mümkün olduğunca soft delete tercih edilmelidir.

---

# 16. Güvenlik

V1 yayına çıkmadan önce zorunlu minimumlar:

- Server-side input validation
- XSS koruması
- CSRF koruması (kullanılan auth mimarisine göre)
- SQL injection koruması
- Secure password hashing
- Rate limiting
- Güvenli session/cookie ayarları
- E-posta doğrulama
- Yetki kontrolü
- Admin endpoint’lerinde ayrı authorization
- Dosya upload type/size kontrolü
- Hassas bilgilerin loglara yazılmaması

Frontend kontrolü hiçbir zaman güvenlik kontrolü olarak kabul edilmemelidir; yetkiler backend’de doğrulanmalıdır.

---

# 17. Veri ve analitik

İlk günden temel ürün event’leri ölçülmelidir.

Örnek event’ler:

- user_registered
- user_logged_in
- poll_created
- poll_viewed
- vote_submitted
- comment_created
- poll_saved
- search_performed
- report_created

Takip edilecek ana metrikler:

- Günlük aktif kullanıcı (DAU)
- Haftalık aktif kullanıcı (WAU)
- Kullanıcı başına görüntülenen anket
- Kullanıcı başına verilen oy
- Anket başına ortalama oy
- Anket oluşturma → ilk oy süresi
- D1 / D7 geri dönüş oranı
- Rapor oranı

---

# 18. Performans hedefleri

İlk sürümde milyon kullanıcı optimizasyonu yapılmayacak; ancak kötü mimari de kurulmayacaktır.

Hedefler:

- Ana sayfanın hızlı açılması
- Liste endpoint’lerinde pagination
- Database index’lerinin doğru kurulması
- Gereksiz N+1 sorgularının önlenmesi
- Görsellerin optimize edilmesi
- CDN kullanımı
- Cache’e uygun veri yapısı

Infinite scroll varsa cursor-based pagination tercih edilebilir.

---

# 19. SEO ve paylaşılabilirlik

Her anketin benzersiz URL’si olmalıdır.

Örnek:

`/karar/iphone-17-alinir-mi-abc123`

Gerekli alanlar:

- Dinamik title
- Meta description
- Open Graph image/title
- Canonical URL
- Sitemap
- robots.txt

Bir anket WhatsApp, X veya başka bir yerde paylaşıldığında düzgün preview göstermelidir.

---

# 20. Responsive tasarım

Öncelik mobil web olmalıdır.

Destek:

- Telefon
- Tablet
- Desktop

Oy verme işlemi mümkün olduğunca az tıklamayla yapılmalıdır.

---

# 21. Sayfalar

V1’de en az şu ekranlar bulunur:

1. Landing / ana akış
2. Giriş
3. Kayıt
4. Şifremi unuttum
5. Anket oluştur
6. Anket detay
7. Yükselenler
8. Keşfet
9. Kategori detay
10. Arama sonuçları
11. Kullanıcı profili
12. Profil ayarları
13. Kaydedilenler
14. Bildirimler
15. Rapor modalı
16. Admin login / authorization
17. Admin dashboard
18. Admin users
19. Admin polls
20. Admin comments
21. Admin reports
22. Admin settings
23. 404 / hata sayfaları

---

# 22. V1 dışına bırakılacak özellikler

Scope’un kontrolden çıkmaması için aşağıdakiler ilk yayında zorunlu değildir:

- Native iOS / Android uygulaması
- Özel mesajlaşma / DM
- Canlı sohbet
- Karmaşık ML öneri sistemi
- Creator para kazanma sistemi
- Reklam sistemi
- Abonelik / premium üyelik
- Gelişmiş rozet/gamification
- Çoklu dil
- Canlı anket odaları

Bunlar V1.1+ roadmap’e taşınabilir.

---

# 23. 5 haftalık geliştirme hedefi

Ayrıntılı görev tablosu [ana planın 21–23. bölümlerindedir](docs/PRODUCT_TEAM_PLAN.md#21-ekip-dağılımı). Faruk kullanıcı arayüzünü, Ümit çekirdek/keşif backend'ini, Mert medya/moderasyon/toplulukları sahiplenir. Utku yönetim güvenliği/bildirim altyapısını; Mehmet büyüme, geri dönüş ve admin içerik yönetimini geliştirir. Mehmet ve Utku ürün/QA için de kapasite ayırır.

1. **Hafta 1:** Sözleşmeler, CI/staging ve gerçek hesapla oluştur → oy ver akışı.
2. **Hafta 2:** Yorum/alternatif, medya/rapor, kaydetme, karar güncellemesi ve bildirim altyapısı.
3. **Hafta 3:** Bütün trend formatları, farklı kategoriler, topluluklar ve ekip içi alfa.
4. **Hafta 4:** Kapsamlı admin/moderasyon tamamlanması; kabul kapıları sonrası kapalı beta.
5. **Hafta 5:** Beta düzeltmeleri, performans, restore/geri alma, paylaşım/SEO ve yayın kabulü.

Beş hafta hedef takvimdir; eksik kabul varsa sahibi/tarihi güncellenir. Anket, yorum, çoklu trend, topluluk veya admin kapsamı takvim uğruna sessizce çıkartılmaz.

---

# 24. Definition of Done — Yayına çıkma kriterleri

KararVer public olarak açılmadan önce:

- [ ] Kayıt/giriş sorunsuz
- [ ] E-posta doğrulama çalışıyor
- [ ] Anket oluşturma çalışıyor
- [ ] Oy verme çift oy üretmiyor
- [ ] Poll cooldown/rate limit aktif
- [ ] Yorum sistemi çalışıyor
- [ ] Yükselenler hesaplanıyor
- [ ] Arama çalışıyor
- [ ] Mobil görünüm kullanılabilir
- [ ] Admin kullanıcı yönetebiliyor
- [ ] Admin içerik kaldırabiliyor
- [ ] Rapor sistemi çalışıyor
- [ ] Ban/suspend çalışıyor
- [ ] Audit log çalışıyor
- [ ] Kritik endpoint’lerde rate limit var
- [ ] 404/500 hata ekranları var
- [ ] Database backup planı var
- [ ] Production error logging var
- [ ] SSL aktif
- [ ] Temel SEO tamam
- [ ] Analytics event’leri geliyor
- [ ] Kritik ve yüksek öncelikli bug kalmamış
- [ ] Topluluklar, alternatif öneriler ve bütün trend formatları çalışıyor
- [ ] Görsel moderasyon/karantina doğrulandı
- [ ] Karar güncellemesi, takip ve bildirim tercihleri çalışıyor
- [ ] Kapsamlı adminin öne çıkarma, duyuru ve acil durum kontrolleri çalışıyor
- [ ] Ana plandaki kanıt gerektiren yayın kapıları tamamlandı

---

# 25. Ürün prensibi

KararVer’in ilk sürümündeki amaç çok fazla özellik koymak değil; kullanıcı için şu döngüyü kusursuz hale getirmektir:

**Sor → Oy Al → Sonucu Gör → Tartış → Yükseleni Keşfet → Tekrar Katıl**

Yeni geliştirmeler bu döngüyü ve farklı alanlarda sosyal katılımı güçlendirmelidir. Ana planda tanımlı geniş V1 kapsamı korunur.

Bu kapsam klasik bir MVP’den daha güçlüdür; fakat 5 kişilik hibrit ekip ve yapay zekâ destekli geliştirme ile doğru görev bölümü yapıldığında yaklaşık 5 haftalık hedefe göre planlanmıştır.
