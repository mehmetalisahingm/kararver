# KararVer V1 — Ücretsiz ve reklamsız ürün modeli

**İşletmeci kararı:** 8 Kasım 2026 · **Sahip:** Mehmet · **Bağlı işler:** #285, #284, #286, #287, #51, #53, #54.

Bu belge ürün kapsamı ve hukuk/teknik inceleme kaydıdır. **Onaylı hukuki metin, vergi danışmanlığı veya yayın GO'su değildir.**

## Kesin V1 kapsamı

- Bütün kullanıcı hesapları, anketler, yorumlar, oy verme, topluluk ve erişime açık özellikler **para talep edilmeden** sunulacak.
- **Reklam, reklam SDK'sı/pikseli, kişiselleştirilmiş reklam, sponsorlu anket/gönderi, affiliate yönlendirmeleri, ücretli ürün yerleşimi ve reklam satışı yok.**
- **Ücretli üyelik, premium abonelik, uygulama içi satın alma, kredi kartı/ödeme formu, bağış/tip veya para karşılığı puan satışı yok.** Bu V1 kapsamı için yeni ödeme sağlayıcısı/hizmeti açılmayacak.
- Mevcut **oyunlaştırma puanları** uygulama içi teşvik ve yayın maliyeti mekanizmasıdır. TL değildir; para karşılığı satılmayacak, paraya çevrilmeyecek ve kullanıcıya finansal alacak doğurmayacak.
- Mevcut `premium.css`/premium UI adlandırması görsel deneyim anlamındadır; bir ödeme duvarı veya ücretli abonelik değildir.
- Mevcut `featured` / yöneticinin öne çıkardığı içerikler **organik ve editoryal** kalmalı; ödeme alan/sponsorlu sıralama algoritmasına dönüştürülmemeli. Anketlerde geçen ürün fiyatları kullanıcı sorusu verisidir, KararVer hizmet ücreti değildir.
- E-posta doğrulama, parola sıfırlama, güvenlik olayları, gerekli hizmet/hesap bildirimleri korunur. **Pazarlama/promosyon e-postası veya İYS pazarlama izni toplama akışı V1'de açılmaz**. Zorunlu hizmet iletişimine reklam eklenmez.
- İsteğe bağlı ürün içi kaynak/performans ölçümü **reklam teknolojisi sayılmaz diye otomatik muaf değildir**: mevcut #287 envanteri ve gerektiğinde geçerli tercih/işleme şartı korunur. Reklam için profil çıkarımı veya reklam hedefleme yoktur.

## Kaynak kod ve teknik sınır

| Kontrol | Durum |
| --- | --- |
| `apps/web/src/lib/v1-business-model.ts` açık V1 ürün sabitleri | Bu aday PR'da eklendi; ücret/reklam/abonelik vb. false |
| `/kayit` ekranında doğru ve kısa model beyanı | Bu aday PR'da eklendi |
| `scripts/v1-business-model.test.mjs` CI regresyonu | Bağımlılık, route/modül adları, policy ve kayıt mesajı negatif taranır; gerçek ağ analizi değildir |
| Mevcut `apps/web`, `apps/api`, `apps/worker` doğrudan bağımlılıkları | İncelenen manifestlerde bilinen ödeme/reklam SDK'sı bulunmadı |
| Ödeme, reklam, abonelik veya sponsorlu anket sunucu uçları | Dosya yolu/modül incelemesinde görünmüyor; çalışan prod/staging trafiği ve kullanıcı gerçek akışı ayrıca doğrulanmalı |
| V1 puan hesaplama | Gerçek para değil; `points` ledger korunur, kaldırılmaz |
| Ücretli sözleşme/abonelik ve veri işleme/finans | Kaydedilmiş işletmeci kararı yok; production'a gizlice eklenemez |

**Regresyonun kapsam sınırı:** Statik tarama, çalışma zamanında üçüncü taraf reklam kodunun hiç yüklenmediğini veya dış sağlayıcı hesaplarının gizli biçimde açık olmadığını kanıtlamaz. Son sürüm staging tarayıcı network paneli, CSP/iframe/script ve yüklenen third-party istekleri + ödeme/abonelik ekranı yokluğu #53 ile gerçek kanıtlanacak. Ücretli altyapı kullanımı (hosting) ile **kullanıcılara ücret çıkarılması** farklıdır; bu kararla yeni ücretli altyapı açılmamıştır.

## Hukuki kapsam ve uygulama kararı

| Başlık | Bu modelin etkisi | Sonuç / sorumlu |
| --- | --- | --- |
| ETBİS | V1'de KararVer üzerinden **mal/hizmet siparişi veya satış sözleşmesi kurulmuyor**. Bakanlık ETBİS kapsamını satış/sipariş ve elektronik ticaret aracılığına göre tanımlar. | **İlk değerlendirme: satış odaklı ETBİS kaydı bu modelde beklenmez;** fiilî iş modeli/sosyal ağ statüsü incelemesi Faruk ve gerektiğinde hukuk incelemesiyle doğrulanır. Satış/komisyon/bağış/ödeme eklenirse yeniden değerlendir. |
| İYS ve ticari elektronik ileti | **Reklam/pazarlama kampanyası gönderilmiyor.** Zorunlu hesap/güvenlik mesajları ayrı işlemsel iletilerdir; promosyon içermez. | **İlk değerlendirme: pazarlama onayı/İYS kampanya iş akışı gerekli değil**, ancak fiilî gönderim şablonları ve güncel yükümlülükler incelemeyi gerektirir. Pazarlama açılmadan önce yeniden incele. |
| Gelir / vergi / işletmeci statüsü | Para alınmaması doğrudan uygulama içi gelir olmadığını gösterir; diğer faaliyet, sponsorluk, bağış veya üçüncü taraf kazanç varsayılmaz. | Vergi muafiyeti ya da mükellefiyet yokluğu **ilan edilmez**; işletmecinin gerçek kişisel/faaliyet koşulları, sağlanan hizmet ve varsa diğer gelirler ayrıca değerlendirilir. |
| KVKK / aydınlatma / çerez | Ücretsiz ve reklamsız olsa da hesap, oy, içerik, IP/oturum, medya, log, analytics/veri aktarımı olabilir. | **#285/#287/#288 açık**, amaç/hukuki şart/veri aktarımı/saklama ve onaylı metin hazırlanır. Şirket yok diye yükümlülük kalkmaz. |
| Yaş politikası | Önceden seçilen **18+ ürün politikası** devam eder. | #289/#318 teknik aday ve gerçek mevzuat/yaş doğrulama kapsamı ayrıca onaylanır. |
| Yasal iletişim | `karariniverdestek@gmail.com` için kullanıcı **hesap oluşturacağını** bildirdi. | Açıldığı ve çalıştığı henüz teyit edilmedi; yasal metinlere onaylı gerçek iletişim diye eklenmez. |

### Resmî kaynaklar (8 Kasım 2026 kapsamında okundu)

- Ticaret Bakanlığı ETBİS/e-ticaret SSS: https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/elektronik-ticaret
- Ticaret Bakanlığı İYS ve ticari elektronik iletiler: https://ticaret.gov.tr/ic-ticaret/ticari-elektronik-iletiler/genel-bilgiler
- Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik: https://kayseri.ticaret.gov.tr/yayinlar/tuketici/ticari-iletisim-ve-ticari-elektronik-iletiler-hakkinda-yonetmelik
- KVKK aydınlatma yükümlülüğü: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- KVKK aydınlatma/kabul ayrılığı: https://www.kvkk.gov.tr/Icerik/4132/aydinlatma-yukumlulugunun-yerine-getirilmesinde-uyulacak-usul-ve-esaslar-hakkinda-teblig

## Release kapısı ve yeniden değerlendirme

- [ ] #53 aday SHA'da kaynak kod, entegrasyon testleri ve **gerçek tarayıcı ağında reklam/ödeme isteği yokluğu** doğrulansın.
- [ ] #285 hukuki işletmeci/iletişim/metin ve ETBİS/İYS/vergi değerlendirmesi açık iş akışlarıyla tutarlı biçimde imzalanıp sürümlensin.
- [ ] #284/#54 güvenlik, staging ve diğer P0 kabul kanıtlarıyla aynı adayda bütün koşullar PASS olmadan **public GO yok**.
- [ ] İleride reklama/sponsorlu içeriğe/gelire geçiş için **yeni, açık işletmeci kararı**, şeffaf gösterim, uygun hukuk/vergi/çerez/İYS ve izin incelemesi, yeni API/UI testleri ve rollout planı hazırlanacak. Bu belge yetki devri veya otomatik onay değildir.
