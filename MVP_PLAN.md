# KararVer — Güçlü V1 MVP Ürün Planı

> Bu doküman klasik “en az özellikli MVP” değildir. Hedef; ilk günden gerçek kullanıcıya açılabilecek, güven veren, moderasyonu olan, büyümeye hazır ve veri toplayabileceğimiz güçlü bir V1 çıkarmaktır.

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
- Kategori sistemi
- Arama
- Haftanın yükselenleri
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

Admin isterse minimum ve maksimum süreleri değiştirebilmelidir.

## 4.2 Oy verme

- Bir hesap aynı ankete yalnızca bir kez oy verebilir.
- Oy işlemi transaction-safe olmalıdır.
- Aynı isteğin tekrar gönderilmesi çift oy oluşturmamalıdır.
- Anket bittikten sonra yeni oy kabul edilmez.
- Sonuçlar yüzdelik ve toplam oy olarak gösterilir.

Tercihen kullanıcı, anket kapanmadan önce oyunu değiştirebilir. Bu davranış sistem ayarı olarak açılıp kapatılabilir.

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
- Kategori Bazlı Yükselenler

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

`/anket/iphone-17-alinir-mi-abc123`

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

Ekip modeli: 3 ana geliştirici + gerektiğinde geliştirmeye giren 2 reviewer/developer.

## Hafta 1 — Temel altyapı

- Proje kurulumu
- Database schema
- Auth
- Kullanıcı profili
- Anket CRUD
- Oy sistemi
- Temel UI design system
- CI / branch / PR düzeni

Çıkış: Kullanıcı kayıt olur, anket açar ve oy verebilir.

## Hafta 2 — Sosyal ürün

- Yorumlar
- Cevaplar
- Kategoriler
- Ana akış
- Arama
- Profil ekranları
- Kaydetme
- Bildirim altyapısı

Çıkış: Ürün gerçek bir sosyal platform gibi kullanılmaya başlar.

## Hafta 3 — Keşfet ve yükselenler

- Günün yükselenleri
- Haftanın yükselenleri
- Trend score
- Keşfet sayfası
- En çok oy alanlar
- Feed sıralaması
- Pagination/cache iyileştirmeleri

Çıkış: İçerik keşfi ve geri dönüş döngüsü oluşur.

## Hafta 4 — Admin, moderasyon ve güvenlik

- Admin dashboard
- User management
- Poll/comment management
- Reports queue
- Ban/suspend sistemi
- Sistem ayarları
- Audit logs
- Rate limiting
- Spam kontrolleri
- Güvenlik kontrolleri

Çıkış: Platform yönetilebilir ve gerçek kullanıcıya açılmaya yakın hale gelir.

## Hafta 5 — Production hazırlığı

- Bug fixing
- UI/UX polish
- Mobil testler
- Performans testleri
- SEO
- Analytics event’leri
- Backup stratejisi
- Error logging
- Production deploy
- Domain/DNS/SSL/Cloudflare ayarları
- Kapalı beta
- Kritik bug düzeltmeleri

Çıkış: Public V1 MVP.

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

---

# 25. Ürün prensibi

KararVer’in ilk sürümündeki amaç çok fazla özellik koymak değil; kullanıcı için şu döngüyü kusursuz hale getirmektir:

**Sor → Oy Al → Sonucu Gör → Tartış → Yükseleni Keşfet → Tekrar Katıl**

Yeni bir özellik bu döngüyü güçlendirmiyorsa ilk V1’e eklenmemelidir.

Bu kapsam klasik bir MVP’den daha güçlüdür; fakat 5 kişilik hibrit ekip ve yapay zekâ destekli geliştirme ile doğru görev bölümü yapıldığında yaklaşık 5 haftalık hedefe göre planlanmıştır.
