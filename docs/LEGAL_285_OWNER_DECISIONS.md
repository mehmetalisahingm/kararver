## 8 Kasım 2026 — yeni anketlerde sonuç görünürlüğü kararı

Mehmet'in kesin ürün kararı: **Yeni anketlerde `ALWAYS` (herkese açık sonuçlar) varsayılan**; daha önce oluşturulmuş ve `AFTER_VOTE` seçilmiş anketler **otomatik değiştirilmez**. Yeni anket sahibi yine `AFTER_VOTE` seçebilir. Misafirler yalnız mevcut görünürlük projeksiyonunun izin verdiği sonuçlara erişebilir; kişiye bağlanabilir tekil oy/veri geçmişi veya gizli anketlerin yeniden görünmesi bu karara dahil değil. [Teknik, SEO, KVKK ve kabul matrisi](LEGAL_52_PUBLIC_RESULTS_DEFAULT_2026_11_08.md). #52/#53/#285/#289 ve #54 kabulü kapanmadı.

# #285 — İşletmeci kararı ve veri işleme karar paketi

1 Kasım 2026. Bağlantılar: #284, #285–#291, #181, #183, #51/#53/#54. Bu dosya teknik hazırlık ve açık karar kaydıdır; onaylı aydınlatma/sözleşme metni veya hukuki kabul değildir.

## 8 Kasım — 18+ ürün politikası (yeni, kesin karar)

Mehmet, KararVer'de **yeni kayıtların 18 yaş ve üzeriyle sınırlandırılmasını** seçti. Bu ürün kuralı, genel bir yasal yaş eşiği olduğu iddiası değildir. Teknik ürün kararı ve güçlü yaş doğrulaması arasındaki fark, mevcut hesapların geçişi ve hukuki değerlendirmede kalan #289 kapıları [ayrı dosyada](LEGAL_289_AGE18_PRODUCT_POLICY.md) açıklıdır. #285/#286 yasal metinleri onaylanmadan bu ürün tercihi tek başına hukuki GO değildir.

İletişim için `karariniverdestek@gmail.com` hesabı açılacağı bildirildi. **Açıldığı ve işletildiği henüz onaylanmadığından** önceki eksik/henüz public olmayan kanal durumu sürer.

## 8 Kasım 2026 — hesap ve içerik silme işletmeci kararı

Mehmet'in yeni kararı: Hesabını silen kişinin **hesabı, yazdığı anketler ve yorumları** silinsin; yalnız **geri ilişkilendirilemeyen anonim toplu istatistikler** kalabilsin. Kanuni saklama zorunlulukları (ör. imha işlem kaydı) ayrı, amaçla sınırlı ve açıklanmış istisna olarak değerlendirilir; anonim istatistik diye gösterilmez.

Karar ve mevcut kod arasındaki **uyumsuzluklar** (anket/yorum tombstone DB satırları, tekil oy zamanları/event geçmişi, async medya, yedek/restore ve audit retention) [#181 uygulama karar dokümanında](LEGAL_181_OWNER_ERASURE_POLICY_2026_11_08.md) listelendi. Silme feature flag'i ve gerçek kullanıcı verisi bu karar kaydı nedeniyle açılıp silinmedi. #181/#285/#287/#288/#53/#54 kapıları kapanmadı. Tam uygulamayı destekleyen gerçek DB/cihaz/yedek ve hukuki kabul olmadan GO verilmez.

## Hesap sahibinden alınmış gerçek karar

- **Kesinleşti:** şirket bulunmuyor; hizmet kendi adına gerçek kişi olarak yayımlanacak. Bu karar kullanıcının 1 Kasım 2026 cevabıdır. Bir şirket/unvan/vergi kaydı uydurulmaz.
- **Eksik:** kamuya açık başvuru e-postası henüz yok (kullanıcının aynı gün cevabı). Mevcut özel Gmail hesapları otomatik olarak public iletişim adresine dönüştürülmez. Faaliyete uygun başvuru yöntemi ve yayımlanması gereken gerçek kimlik/iletişim bilgileri ayrıca kesinleştirilir; kimlik/adres belgeleri public repoya konmaz.
- **Bütçe:** ilk 12 ay tüm hizmetler/vergiler/ödeme masrafları dahil en fazla 750 TL; otomatik kullanım aşımı yok. Ücretli hukuk danışmanlığı veya resmî başvuru harcaması onaylanmış değildir. Bu bütçe yükümlülüklerin karşılandığı veya uygulanmadığı kararı sayılmaz.
- **Yayın:** gerçek SUPER_ADMIN güvenlik kabulü ve hukuki/operasyon kapıları açık; public GO verilmedi. Bir tercih panelinin eklenmesi bu durumu değiştirmez.

## Onaylanacak veri-amaç-şart-saklama matrisi

Hukuki şart sütunları kasıtlı olarak açık: KVKK m.5/6 şartı gerçek amaç/işleyişe göre belirlenmeli; her satıra otomatik açık rıza yazılmaz. Koddan görülen teknik süre, onaylı hukuki saklama süresi değildir. Sağlayıcı/bölge/sözleşme için Faruk'un #288 envanteri temel alınır ve hesap panelinde doğrulanır.

| Veri / kod dayanağı | Gerçek teknik amaç / akış | Süre ve silmede açık nokta | Karar / sahip |
| --- | --- | --- | --- |
| Hesap, e-posta, kullanıcı/görünen adı, parola özeti; auth routes, core.prisma | Hesap açma/doğrulama/giriş ve hizmet sunumu; parola düz metin olarak DB'de tutulmaz | Hesap kapanışı #181; yasal istisna/anonimleştirme ve başarısız işlerin sonlandırılması kabulü | m.5 şartı, kamuya açık profil bilgisi ve metin: Mehmet; teknik veri hakları Mert |
| Oturum IP/cihaz/UA/zaman, MFA ve recovery/step-up; auth/security şeması | Oturum ve yetkili erişim güvenliği; MFA materyali şifreli/özetli alanlarda | Cookie varsayılan 30 gün; DB güvenlik log saklama ve silme ayrı karara bağlı | Mehmet + Faruk/Utku; ham sır/e-posta/IP public kanıta konmaz |
| Anket, yorum, oy, topluluk/ilgi ve tepkiler; core.prisma | Ürünün esas anket/topluluk işlevi; sonuç görünürlüğü ve moderasyon | Hesap bağlantısı/anonimleşme, içerik ve özel nitelikli veri ihtimali ayrı | Mehmet + Mert; m.5/6, veri minimizasyonu ve gerekli tedbir kararı açık |
| Görseller, karantina, onaylı kopyalar; media modülleri | Upload, yerel otomatik model ve insan moderasyonu, yayın | REJECTED saklama, legal hold, DB/nesne/cache kopyaları tutarlılığı açık | Mert + Faruk; #290/#181 |
| Rapor, yaptırım, itiraz, audit; moderation/admin/audit şemaları | Kötüye kullanım önleme, karar ve itirazın izlenmesi | Süresiz audit/saklama varsayımı kabul edilmiş değil; spam karar 13 ve sinyal süresi ayrı | Mehmet + Mert/Utku; #183/#185/#290 |
| Doğrulama/reset/veri paketi e-postası ve token | Kullanıcının hesap ve veri hakları işlemi; pazarlama ile birleştirilmez | Token ömrüyle sağlayıcı mail/log saklama ayrı; gerçek SMTP ve aktarım #288 | Faruk + Mehmet; promosyon/İYS kapsamı ayrıca |
| Tarayıcı tema/onboarding/form/export-token/ölçüm tercihi | Tam anahtar ve ağ listesi `LEGAL_287_STORAGE_INVENTORY.md` | Mevcut süresiz işlev kayıtları, 30 günlük teknik tercih ve ölçüm süresi onayı açık | Mehmet + Ümit; #287/#286 |
| Şifreli DB/medya yedeği ve restore | Afetten kurtarma; salt canlı DB'den silme yeterli değil | Ayrı sağlayıcı, rotasyon, restore sonrası tekrar silme ve legal hold istisnası açık | Faruk + Mehmet/Mert; #51/#181 |
| Web/API/CDN/proxy/mail altyapısının trafik/log verisi | Barındırma, ağ güvenliği ve hata teşhisi | Gerçek bölge, alt işleyen, log erişimi/saklama ve m.9 mekanizması açık | Faruk #288, Mehmet sözleşme kararı |

## Metin paketi ve mevzuat kapsamı: kapanmamış kararlar

| Karar | Gereken çıktı | Bağımlılık |
| --- | --- | --- |
| Veri sorumlusu ve başvuru | Gerçek kişi için gerekli yayımlanabilir kimlik/iletişim ve işleyen başvuru kanalı; kapsamı/kimlik doğrulama yöntemi | Mehmet; #181/#286/#290 |
| İşleme şartı ve bilgilendirme | Yukarıdaki her amaç için kaynaklı m.5/6 şartı, alıcı/ülke, süre, silme ve haklar | Mehmet + uygun hukuki inceleme |
| Hukuki metinler | Aydınlatma/gizlilik, kullanım/üyelik, çerez, topluluk/telif/şikâyet/itiraz ve yalnız gerekiyorsa ayrı rıza; sürüm/tarih/karar sahibi | Onaylı bilgilerle Ümit #286; bu dosya production metni değildir |
| VERBİS | Gerçek kişi faaliyeti, çalışan/mali büyüklük ve asıl faaliyet verileriyle uygulanır/istisna/koşullu kararı | Mehmet; şirket olmaması tek başına sonuç değildir |
| 5651/sosyal ağ/yaş | Güncel birincil mevzuat, faaliyete uygulanma, yürürlük/geçiş, kimlik/kanal ve gerekirse teknik yaş yöntemi | Faruk #289; doğrulanmamış düzenleme/yaş eşiği bu PR'da kodlanmadı |
| Yurt dışı aktarım | Tüm gerçek sağlayıcılarda m.9 kapsamı, uygun mekanizma, gerektiğinde sözleşme/bildirim ve alt işleyen kanıtı | Faruk #288; genel DPA veya AB bölgesi otomatik yeterli sayılmaz |
| ETBİS/İYS/vergi | Fiili satış, sponsorluk, gelir ve pazarlama planına göre ayrı uygulanabilirlik; uygulanmıyorsa kaynaklı gerekçe | Mehmet; şirket yok diye otomatik muafiyet yok |
| Olay/ihlal | Gerekçeli ve tarihli bildirim değerlendirmesi, gerektiğinde uygun bildirim; sır rotasyonu bunun yerine geçmez | #291, yalnız özel kanal. Özel mailin içeriği ve hesap sayıları bu dosyada yok |

## İlerleme ve kanıt sınırı

1. Bu dosya ve #287 teknik envanteri karar hazırlığını somutlaştırır. İsim, e-posta, adres, işleme şartı veya saklama süresi tahmin edilerek metin yayımlanmaz.
2. Ümit, #286 arayüzünü geliştirebilir; eksik gerçek kimlik/kanal ve onaysız metni nihai hukuki paket diye yayımlamaz. Faruk sağlayıcı seçimi/bölge/yaş kapsamı ve özel olay dosyasını; Mert haklar/itiraz/saklama kanıtını tamamlar.
3. Onaylı metin/sürüm, gerçek API ve cihazdaki akış, kabul kayıtları ve olumsuz senaryolar #53'te aynı aday sürümle doğrulanır. #285/#284/#54 bu belgeyle kapanmaz.

Resmî dayanaklar: [aydınlatma](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-), [özel nitelikli veriler](https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler), [VERBİS kararının uygulama esasları](https://www.kvkk.gov.tr/Icerik/8577/kisisel-verileri-koruma-kurulunun-04-09-2025-tarihli-ve-2025-1572-sayili-kararinin-uygulama-esaslarina-iliskin-kamuoyu-duyurusu), [ETBİS](https://ticaret.gov.tr/ic-ticaret/bilgi-sistemleri/elektronik-ticaret-bilgi-sistemi-etbis-ve-e-ticaret-bilgi-platformu).
