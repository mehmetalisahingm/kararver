# #181 / #321 — Silinen anketlerde üçüncü kişilere ait yorumların gizliliği

**İşletmeci kararı:** 8 Kasım 2026, Mehmet.

> Hesabını silen kişinin açtığı anket ve o anketin bütün yorumları **herkese kapatılır**. Anket altına yorum yazmış diğer kullanıcılar **yalnız kendi yorumlarına** kişisel verilerine erişim/aktarım başvurusu sürecinde erişebilir. Yorum sahibinin içerik silme/itiraz hakkı korunur. Üçüncü kişinin yorumları, anket sahibi hesabını sildi diye doğrudan kalıcı olarak silinmez.

**Bu ürün tercihidir; tek başına veri işleme hukuki şartı veya süresiz veri saklama yetkisi değildir.**

## Kamuya kapatma ile kişisel veri erişimi ayrımı

| Yüzey | Davranış | Kanıt / kalan iş |
| --- | --- | --- |
| Anket detay, publicId/slug, feed/SEO/OG/sitemap | Kaldırılmış anket 404 / erişilemez; indeks/cache/CDN güncelleme gerekir. | API'de `polls.status=REMOVED` zaten public 404 ve Next fetch `no-store`. Arama motoru/cache/og önbelleğinin gerçekten kaybolması #321/#53 kapsamında. |
| Üst seviye yorum ve cevapların normal API'si | Anket durumundan **ve** anket sahibinin silinmiş hesabından bağımsız kontrole tabi 404/boş; misafir, yorum yazarı veya başka oturum bypass yapamaz. | Bu PR `CommentStore` sorgularına `poll.status ACTIVE/LOCKED` + `poll.author.deletedAt IS NULL` koşulu ekliyor. API route guard'ları sürüyor. |
| Yorum oluşturma, düzenleme ve tepki | Gizlenmiş anket için yeni etkileşim yok. | Mevcut transaction'lar `poll.status` görünürlüğünü denetliyor; regresyonla sınanıyor. |
| Yorumun DB satırı | Başka kullanıcının yazdığı içerik hemen silinmez; güvenli hukuk/veri hakkı süreci için erişimi sınırlandırılmış geçici veri olarak değerlendirilir. | Bugünkü model `comments.poll_id` FK'sine bağlı: anket satırını fiziksel silince üçüncü kişi yorumu da silinmesin diye **ayrı kişisel erişim arşivi** veya kanıtlı eşdeğer yapı #321'de tasarlanmalı. Mevcut tombstone anketin fiziksel silinmesi değildir. |
| Kişisel veri paketi / ilgili kişi başvurusu | Yalnız yorum sahibi için `collectPackage(..., userId)` ile `authorId = userId` yorum metinlerini sağlar. Pakette başka kişilerin yorumları yoktur. | Mevcut şifreli export, doğru oturum + süreli token + yetkili destek akışıyla teslim ediliyor. Bu PR izole sentetik testte anket kaldırıldıktan sonra da yalnız doğru kişinin verisinin pakete girdiğini doğrular. |
| Giriş yapamayan, yasaklı veya hesabı silinmiş yorum yazarı | Başvuru hakkı genel olarak kaybolmaz. | Mevcut `dataExport` akışı giriş yapamayan/banned kullanıcıda kısıtlı; destek kimlik doğrulaması ve güvenli alternatif yol #181/#285'te **açık P0**. Başkalarının içeriklerini paylaşmadan başvuru sonuçlandırılmalı. |
| İmha ve yedekler | Yorumun haklı işleme şartı kalmadığında ayrı imha veya geçerli başka hak gerekçesi; yedekler için işletmeci **30 gün** üst sınır tercihi, restore'da geri görünmeme güvencesi ve kanunî kayıt istisnası ayrı. | #311, #322, #321. Veri saklama süresi, üçüncü kişi yorumunun hukuki şartına göre ayrı belirlenmeli; otomatik 30 gün/3 yıl varsayılmaz. |

## Uygulama kabul koşulları

- [ ] Hesap silme **tek DB transaction'ında** anketi ve yorumlarını public API'den kapatıyor; eski yorumun reply route, list, autocomplete, public profile, notification, search, sitemap, OG, feed, CDN/cached response gibi yollardan içeriği sızmıyor.
- [ ] Anket sahibi hesabı silinse de üçüncü kişinin yorumu, sadece kendi erişim paketinde bulunuyor; başka kişi paketi, sırları, raporlama veya admin olmayan API'lere sızmıyor; yorum sahibinin kendi silme başvurusu ayrıca korunuyor.
- [ ] #321 fiziksel anket/yorum temizliğinde üçüncü kullanıcıya ait metni **başkasının silme kararı nedeniyle silmiyor**; kontrollü/şifreli, erişimi kısıtlı, süreli bağımsız veri hakları alanına taşıma tasarımı var; arşiv ne kamuya ne anket sahibine açılıyor.
- [ ] Silinmiş anket üzerine yazan kişiler için erişim talebinin güvenilir biçimde sahibine sunulması; oturumu olmayan ve kısıtlanmış hesaplarda güvenli destek/kimlik doğrulama alternatifi; hukuken gerekli sürede cevap, yanlış kişiye teslimi önleme, audit ve silme hakkı.
- [ ] Eski 30 günlük yedekten geri yükleme, bağımsız silme günlüğü ve içerik ilişkileriyle tekrar test ediliyor; cache/revoked API/deleted author koşulu izole ve staging'de fail-closed.
- [ ] Negatif test: misafir, başka hesap, yorum sahibi normal public URL ve doğrudan repository metodu erişimi **0**; hak başvurusu çıktısı sadece kendi yorumu, hiçbir başkasının kimliği/yorumu değil.

## KVKK çerçevesi ve sınırlamalar

- [KVKK — Başvuru hakkı](https://www.kvkk.gov.tr/Icerik/2062/Basvuru-Hakki): ilgili kişi işlenen kendi verisine erişme, usulüne göre silme/yok etme talebinde bulunma hakkına sahiptir.
- [KVKK — Başvuruların cevaplanması](https://www.kvkk.gov.tr/Icerik/2046/Ilgili-Kisiler-Tarafindan-Yapilan-Basvurularin-Cevaplanmasi-Yukumlulugu): başvurunun niteliğine göre en kısa zamanda, **en geç 30 gün**; kimlik doğrulama ve üçüncü kişi gizliliği korunur.
- [KVKK — Silme/Yok etme/anonimleştirme Yönetmeliği](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK): işlemenin hukuki şartları ortadan kalkınca silme/yok etme/anonimleştirme; imha işlemi kanıtı için, diğer yükümlülükler saklı kalmak üzere **en az 3 yıllık** kayıt; gerçek anonimlik başka verilerle ilişkilendirilmemeyi gerektirir.

**İstisna:** Geçerli yasal saklama gereksinimi varsa, amaç/erişim/süre/gerekçe kayıt altına alınarak yalnız zorunlu veri saklanabilir. Bu yorumların ticari analiz veya kullanıcıya açık içerik için tekrar kullanılmasını meşrulaştırmaz.

**NO-GO:** Bu PR yalnız public erişimi derinlemesine kapatır ve mevcut kişisel export kapsamını regresyonla doğrular. Fiziksel bağımsız arşiv, saklama süresi, alternatif hak başvurusu, cache/backup ve gerçek staging kabulü henüz kapanmadı. Canlı veri silme, privacy key veya ücretli kaynak işlemi yapılmadı.
