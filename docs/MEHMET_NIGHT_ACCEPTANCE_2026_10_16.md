# Mehmet — 16 Ekim 2026 tamamlanan işler ve kabul sınırları

## Birleştirilen incelemeler

- #240: anonimleştirme depo temizliği kuyruğu, MFA ret/kilit sinyalleri ve destek e-posta değişimi operasyon merkeziyle bağlandı.
- #241: acil durum anahtarlarının etkin değeri, son değişiklik zamanı ve yayılma süresi gerçek API'den gösteriliyor.
- #243 inceleme düzeltmesi: başarısız yedek çözme mevcut dosyayı silemez; doğrulanmamış düz metin geçici dosyada tutulur, etiket doğrulandıktan sonra üzerine yazmadan yayımlanır. Kaynak/çıktı aynı dosyaysa korunur. PEM'deki kaçışlı satır sonu düzeltilir; geçersiz yapılandırma log'a ham değer yazmaz. Anahtar/bucket/saklama kararı ve ilk gerçek yedek kurulumu ayrı kapıdır; ücretli servis açılmaz.

## Frontend düzeltmeleri (#52, #194)

- Sosyal paylaşım penceresi tıklama anında ayrılır; API onaylanan bağlantıyı döndürünce yönlenir. API hatasında boş pencere kapanır. Engellenen popup ve clipboard izni için gerçek bağlantı, güvenli harici bağlantı ve seçilebilir kopyalama alanı vardır. Paylaşım isteği sayfadan ayrılınca iptal edilir.
- Yönetim listesinde ek sayfa yüklenirken filtre değişirse eski istek iptal edilir; yeni filtrenin sayfalaması tekrar çalışır. Aynı anda ikinci ek sayfa isteği başlatılamaz.
- WebKit masaüstü + 360 px: paylaşım, yönetim sayfalama ve operasyon paneli 18/18 geçti. Web birim testleri 141 geçti, gerçek DB isteyen 2 test yerelde atlandı. Bu sonuç fiziksel iPhone veya gerçek X/WhatsApp cache kabulü değildir.

## Sınırlı gerçek staging yazma kabulü (#46)

`scripts/staging-write-acceptance.mjs` yalnız sabit staging API/web adreslerinde çalışır. Tam beklenen commit SHA, operatör hesabı ve `KV_STAGING_WRITE_ACCEPTANCE=1` olmadan yazmaya başlamaz. Önce release ve SUPER_ADMIN doğrulanır. Rastgele işaretli iki sentetik USER hesabı açılır; yalnız bunlardan birinin ADMIN rolü geçici değiştirilir. Aynı cookie ile 403 → 200 → 403 ve ADMIN'in SUPER_ADMIN alanına 403 aldığı kontrol edilir.

İki ayrı toplulukta, iki hesabın her birine ait birer sentetik anketle sahibin kendi oyunun reddi, moderatörün yalnız atandığı toplulukta işlem yapması, kilitli/kapanmış anketin reddi, misafire sonuç gizliliği, 20 eşzamanlı istekten tek oluşturma ve HTTP sonuç toplamlarının uyumu, yasaklanan hesabın açık cookie'sinin engeli kontrol edilir. Yeni hesaplara uygulanan gerçek 15 oy/dakika ve 30 dakika paylaşım aralığı korunur; 429 yanıtları ayrıca raporlanır. Limitler, hesap yaşı, kaynak IP veya e-posta doğrulama politikası değiştirilmez. Bu HTTP gözlemi doğrudan DB satır/olay/sayaç karşılaştırması değildir.

Temizlik: yalnız bu çalışmanın anketleri yönetici moderasyonuyla kaldırılır, toplulukları gizlenir, topluluk moderatörlükleri kaldırılır; sentetik hesapların yetkileri USER'a alınır ve hesaplar yasaklanır, audit için kalırlar. Yalnız bu çalışmanın açtığı operatör oturumu kapatılır. Rapor e-posta, parola, cookie, token veya kullanıcı kaydı içermez. Başarısız kontrol veya temizlik FAIL'dir. Şema/bağlantı hatası başarıya çevrilmez.

Çalıştırma: kimlik bilgilerini yerel ortam değişkenlerine yükleyip tam doğrulanmış staging SHA'sını `KV_EXPECTED_SHA` olarak ver; `node scripts/staging-write-acceptance.mjs` çıktısını özel çalışma klasörüne kaydet. Kimlik bilgilerini komut argümanına/issue'ya yazma. Scriptin koruma ve temizlik testleri `pnpm security:test` içindedir.

## Açık kabul kapıları

- #46: doğrudan staging DB invariant karşılaştırması; iki topluluk scope testi; gerçek private medya/model kesintisi; kontrollü bakım penceresi; doğal TTL; bağımsız iki yönetici MFA/onayı ve kritik/yüksek tarama.
- #48/#191/#194: fiziksel iOS/Android, VoiceOver/TalkBack/NVDA ve insan görsel kabulü.
- #47/#52: gerçek, izinli beta katılımcıları ve olgun D7 kohortu; X/WhatsApp gerçek önizleme/cache/kaldırma kabulü. Dışarıya davet veya paylaşım gönderilmedi.
- #51/#54: gerçek production adresi, mail sağlayıcısı, yedek anahtarının özel anahtar sorumlusu/bucket/saklama ve production smoke. E-posta doğrulama zorunluluğunun kullanıcı kararıyla kapalı olması korunur.
- #57–59: #54 sonrasındaki pilot ve ürün kararları; öneriler `MEHMET_POST_RELEASE_DESIGN.md` içinde. Oy/trend formülü, 20/10 puan düzeni ve ticari kurallar değiştirilmez.

Güncel CI/deployment ve canlı rapor çıktıları ilgili PR/issue'ya ayrıca eklenir. Buradaki araç/test varlığı tek başına canlı PASS veya beta GO değildir.
