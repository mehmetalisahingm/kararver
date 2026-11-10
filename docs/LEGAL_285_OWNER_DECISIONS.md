## 8 Kasım 2026 — moderasyon reddine itiraz için 30 günlük BAŞVURU süresi

**Mehmet'in kesin işletmeci kararı:** KararVer V1'de anketin ön moderasyon reddine ürün içi itiraz, **ret bildiriminin kullanıcıya ulaşmasından itibaren 30 gün** içinde yapılır. Karar/outbox tarihi süreyi başlatmaz; V1 uygulama içi zorunlu bildirim **ilgili kullanıcının özel inbox'ına transaction commit ile kaydedildiğinde** ulaşmış sayılır. 720 saat sonu dahil, sunucu başvuru zamanı esas; başvuru süresinde yapılmışsa sonuçlandırma gecikmesi başvuruyu düşürmez. Başvuru ve teslim kanıtı eksikse otomatik “süre doldu” reddi yok.

[30 günlük teknik, bildirim, veri güvenliği, saklama ve KVKK kabul dosyası](LEGAL_290_30_DAY_APPEAL_NOTICE_DELIVERY_2026_11_08.md). **Ürün içi itiraz KVKK ilgili kişinin kanuni başvurusundan ayrı**. Gerçek kayıt/itiraz UI + hukuk ve staging #290/#285/#53 açık, release #54 NO-GO.

## 8 Kasım 2026 — hatalı ön moderasyon reddine itiraz kabulünde ücretsiz yayın

**Mehmet'in kesin kararı:** Şüpheli anketin ön moderasyon başvurusunda 10 puan kesilir; ret sonrası bir kez 10 puan iade edilir. İtiraz haklı bulunup yanlış ret düzeltilirse **aynı anket ücretsiz yeniden yayımlanır**, iade edilen 10 puan kullanıcıda kalır; yeniden kesinti, otomatik iade geri alma veya yeni anket talebi yok. [Teknik, test, KVKK ve operasyona dair kabul belgesi](LEGAL_327_FREE_ACCEPTED_APPEAL_REINSTATEMENT_2026_11_08.md).

Yalnız özgül, güncel `UNDER_REVIEW→REMOVED` kararının yetkili ADMIN+ tarafından gerekçeli **tekil undo** yoluyla düzeltilmesi geçerlidir; genel `RESTORE` ve toplu geri alma yok. Yeni puan defteri hareketi oluşmaz; `PUBLISH -10` ve `MODERATION_REFUND +10` kalır, anketin tam süresi onay anında başlar. **Kullanıcının itiraz gönderme ekranı ve bildirim operasyonu #290/#327 kapsamında hâlâ açık**; sentetik ve staging/CI kabulü olmadan public GO yok.

## 8 Kasım 2026 — moderasyon reddinde uygulama içi yayın puanının iadesi

**Mehmet kararı:** Gönderim sırasında **10 KararVer puanı** kesilir. `UNDER_REVIEW` konumundaki şüpheli anket moderatör tarafından `REMOVE` ile reddedilirse **gerçek kesilen tutar yalnız bir kez** kredi olarak geri verilir. Bunun nakit/para iadesi olmadığı; yetkisiz ret, normal public anketin kaldırılması, sıfır maliyetli gönderi veya yinelenen taleplerde ilave puan üretilemeyeceği; `PUBLISH` ile `MODERATION_REFUND` hareketlerinin append-only defterde ve aynı DB transaction'ında tutulacağı [uygulama/hukuki kararda](LEGAL_327_REJECTED_REVIEW_POINTS_REFUND_2026_11_08.md) ayrıntılı. Önceki kararlar (V1 ücretsiz/reklamsız, 18+, misafir erişimi, hassas içerik yasak, risk bazlı moderasyon) sürer.

**İtiraz sonrası geri açma** henüz karara bağlanmadı; daha önce kredi edilmiş `REMOVED` anketin puan düşmeden kamuya açılması şimdilik kapalı. PR #333 taslak, #328/#326 bağımlı; staging/hukuk #53/#285/#290, yayın #54 NO-GO devam eder.

## 8 Kasım 2026 — V1 hassas kişisel veri soran anketleri açmama kararı

Mehmet'in **kesin ürün kararı**: KararVer V1'de siyasi görüş, din/mezhep, sağlık veya benzeri hassas kişisel bilgileri açıklamaya yönlendiren anketler **yayımlanmaz**. Kategori listesi ve güncel KVKK m.6 yorumuna ilişkin ayrım, API korumasının kapsamı ve eksikleri [V1 hassas anket karar dosyasında](LEGAL_285_V1_SENSITIVE_SURVEY_POLICY_2026_11_08.md). Genel bir konunun tartışılması ile katılımcının kendi özel nitelikli verisini istemek aynı kabul edilmez.

Yeni anket ve tartışma gövdesi, değişiklik ve ek açıklama için **taslak server-side kural** hazırlandı; yalnız basit kalıpları yakalar. Eski içerik, yüklenen görsel, yorum, dolaylı sorular, bütün diller, küçük grup/tekil oy çıkarımı, şikâyet/itiraz ve saklama-imha koruması için #183/#290/#321/#53 ayrı kabul gerektirir. **Tüm hassas içeriklerin engellendiği, onaylı hukuki metin veya public GO iddia edilmez.** Ürün kararı geçmiş kullanıcı içeriğini topluca silme yetkisi değildir.

# #285 — İşletmeci kararı ve veri işleme karar paketi

1 Kasım 2026. Bağlantılar: #284, #285–#291, #181, #183, #51/#53/#54. Bu dosya teknik hazırlık ve açık karar kaydıdır; onaylı aydınlatma/sözleşme metni veya hukuki kabul değildir.

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
