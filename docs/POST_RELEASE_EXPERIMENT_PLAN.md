# Yayın sonrası ölçüm ve uygulama planı — #57 / #58

18 Kasım 2026. Ümit'in teknik tasarım teslimidir; deney sonucu veya deney başlatma kararı değildir. Ana ürün kuralları [mevcut taslakta](MEHMET_POST_RELEASE_DESIGN.md) korunur. #54 yayın kabulü, hukuki ölçüm kararı ve aşağıdaki ön kayıt tamamlanmadan pilot açılmaz. V1 puan bakiyesi, 20/10 kuralı, oy ağırlıkları, trendler ve yetkiler değişmez.

## Ayrı deneyler ve ölçülebilir hipotezler

| Deney | Değişiklik | Birincil hipotez | Koruyucu hipotez |
| --- | --- | --- | --- |
| #57 | İsteğe bağlı profil rozeti ve kendi kazanımının açıklaması; ek yayın/oy yetkisi yok | Kullanıcı başına incelemesi tamamlanmış uygun yardımcı katkı artar | Spam/ihlal oranı artmaz; yeni kullanıcının ilk uygun katkısı kötüleşmez |
| #58 | İsteğe bağlı günlük/haftalık görev kartı; hatırlatma ayrıca isteğe bağlı | Kullanıcı başına uygun yardımcı katkı ve olgun D7 geri dönüşü artar | Spam, hatırlatmadan çıkış ve bildirim şikayeti artmaz |

İlk pilotta iki değişiklik aynı kullanıcı üzerinde üst üste açılmaz; aksi halde katkının hangi değişiklikten geldiği ayrıştırılamaz. #58, #57 kararını ve yayın kapısını bekler. İlk görev pilotu parasal/harcanabilir ödül içermez.

## Payda ve zaman tanımları

- Uygun kullanıcı: 18+ ve mevcut hesap koşullarını sağlayan gerçek kullanıcı. QA/demo/bot/staff test hesapları deney başlamadan tanımlanan kuralla dışlanır. Düşük etkinlik, olumsuz sonuç veya sonradan vazgeçme nedeniyle paydadan kullanıcı çıkarılmaz.
- Atama birimi hesaptır. Aynı hesap farklı cihaz ve sekmede aynı grupta kalır. Kayıt, mevcut rıza/ölçüm şartlarını sağlayan kullanıcıda bir kez yapılır. Kullanıcıya yeni izleme amacı veya sağlayıcı eklenirse hukuk/tercih incelemesi ayrıca gerekir.
- İki grupta da aynı isteğe bağlı katılım daveti sunulur; uygun ve katılmış kullanıcılar kararlı biçimde kontrol/tedaviye atanır. Kontrol mevcut deneyimi sürdürür. Bu sonuç tüm kullanıcılara genellenmez. Önceden rastgele atanmış grup varsa analiz atanan gruba göre yapılır; yalnız kartı tıklayanlar kıyaslanmaz.
- `t0`, sunucunun ilk atama zamanıdır. Gözlem penceresi ve inceleme olgunlaşma beklemesi ön kayıtta sabitlenir. UTC anları kullanılır. Günlük/haftalık görev döneminin saat dilimi, hafta başlangıcı ve yaz saati davranışı katalog sürümünde tanımlanır; sonradan saat dilimi değişikliği aynı dönem için ikinci tamamlanma açmaz.
- D7 geri dönüş: `t0 + 7×24 saat` dahil, `t0 + 8×24 saat` hariç aralıkta en az bir uygun ürün oturumu. Yalnız tam 8 günlük gözlem aralığı bitmiş kullanıcılar paydaya girer. Eksik kohort sıfır başarı sayılmaz; “henüz olgunlaşmadı” raporlanır. Bu tanım takvim günü D7 ile karıştırılmaz.

## Ölçüm sözlüğü

| Metrik | Pay / payda | Yorum ve sınır |
| --- | --- | --- |
| Uygun katkı / kullanıcı | Pencerede oluşturulup inceleme beklemesi sonunda uygun bulunan benzersiz katkı / atanmış uygun kullanıcı | Katkı sayısı oy/yorum hacmine göre otomatik ödül değildir; bağımsız uygunluk ve moderasyon kuralı sürümlüdür |
| İhlal oranı | İncelemesi tamamlanıp spam/ihlal kararı verilen benzersiz katkı / incelemesi tamamlanmış katkı | Bekleyen incelemeler pay/paydaya eklenmez; bekleyen miktarı ayrıca raporlanır |
| İnceleme kapsamı | İncelemesi tamamlanmış katkı / penceredeki değerlendirmeye uygun katkı | İki grubun farklı inceleme gecikmesinin sahte iyileşme üretmesini görünür kılar |
| Yeni kullanıcı ilk katkı oranı | Önceden uygun katkısı olmayan ve pencerede ilk uygun katkısını veren kullanıcı / başlangıçta uygun katkısı olmayan atanmış kullanıcı | Geçmişi ve pencere kuralı gruplarda aynıdır |
| Olgun D7 | Tanımlı D7 aralığında geri dönen kullanıcı / gözlem aralığı bitmiş atanmış kullanıcı | Grup bazında olgun kişi sayısı ve gözlem tarihleri birlikte verilir |
| Görev tamamlama | Sunucunun doğruladığı benzersiz kullanıcı–görev sürümü–dönem / aynı göreve uygun atanmış kullanıcı–dönem | Tekrar istekleri ve istemci tıklamaları tamamlanma sayılmaz |
| Katılımdan / hatırlatmadan çıkış | İlgili tercihi geri çeken kullanıcı / o tercihi açmış kullanıcı | İki tercih ayrı raporlanır; deneyden ayrılma geçmiş atamayı analizden silmez |
| Bildirim şikayeti | Şikayet kaydı oluşan kullanıcı / en az bir deney hatırlatması teslim edilen kullanıcı | Sıfır teslim veya bilinmeyen teslimde oran “hesaplanamıyor”; sıfır gösterilmez |

Sıfır payda `N/A` olur. Grup sonucu, pay/payda, mutlak fark ve belirsizlik aralığı birlikte raporlanır; tek bir yüzde veya p-değeri başarı kararı değildir. Günlük bakıp anlamlılık oluşunca bitirme yapılmaz. Hesap silme/izin geri çekme sonrası kişisel olayların saklanması ayrı hukuki dayanak gerektirir; silme nedeniyle eksilen gözlem anonim toplamlarla ve analiz sınırlamasıyla belirtilir, gölge kimlik tutulmaz.

## Minimum olay ihtiyacı — henüz API sözleşmesi değildir

Mevcut olay envanteriyle önce eşleme yapılır; aşağıdaki isimler öneridir. Üretime doğrudan yeni analitik eklenmez.

| Olay | Asgari işlev | Tekillik / güven kaynağı |
| --- | --- | --- |
| Deney ataması | Deney ve kural sürümü, grup, sunucu zamanı | Hesap + deney sürümü bir kez; istemci grubu seçemez |
| Katkı uygunluk kararı | Katkı referansı, karar sürümü, uygun/bekliyor/iptal | Sunucu ve audit; yeniden işleme aynı kazanımı tekrarlamaz |
| Görev tamamlandı / geri alındı | Katalog sürümü, sabit dönem, uygun olay referansı | Atomik kullanıcı + görev sürümü + dönem; geri alma yalnız bağlı kazanımı etkiler |
| Tercih değişti | Katılım veya hatırlatma tercihi ve sunucu zamanı | Tercihler ayrı; geri çekme sonraki isteğe bağlı işlemleri durdurur |
| Hatırlatma teslim / şikayet | Deneyle ilgili teslim sonucu veya şikayet varlığı | Yalnız gerekli özet; e-posta/mesaj gövdesi ölçüme taşınmaz |

Bu tablo yeni kişisel veri toplama izni değildir. Ham oy, serbest metin, e-posta, IP, cihaz parmak izi, token veya hassas anket konusu deney çıktısına eklenmez. Operasyonel kayıtla ölçüm verisi ayrılır; erişim, saklama süresi, silme ve küçük grup bastırma #285/#287/#288 kararına bağlanır. Public profilde deney grubu, iç risk puanı veya gizli moderasyon nedeni gösterilmez. Aylık/hukuki saklama süreleri burada uydurulmaz.

## Uygulama dilimleri ve doğrulama

| Dilim | Teslim ve bağımlılık | Somut kabul |
| --- | --- | --- |
| E1 — sözleşme | Backend ve ürün sahibiyle rozet/görev/itiraz/tercih sürümü; mevcut ledger ve anonimlik kurallarıyla eşleme | Örnek durum şemaları, eksik alan listesi; yayın/oy/MFA yetkisine etki yok |
| E2 — sunucu kayıtları | Atama, tekil kazanım/tamamlama, iptal/telafi; backend sahibinin ayrı PR'ı | Çift istek, replay, yarış ve worker retry tek sonuç; iptal ve geri alınan karar doğru bağlı kaydı etkiler |
| E3 — web | Kendi kazanım açıklaması, isteğe bağlı görünürlük/katılım, ayrı hatırlatma, loading/error/retry/expired | 360/390/1440px, klavye, reduced-motion, axe; başarısız API başarı göstermez, isteksiz kullanıcıya ceza yok |
| E4 — abuse ve adalet | Bağımsız güvenlik incelemesi | Öz değerlendirme, halka, çok hesap, ortak IP'de masum kullanıcı, kaldırılan katkı, yeni kullanıcı ve dönem sınırı testleri |
| E5 — ölçüm doğruluğu | Ön kayıt ve hukuki kabul sonrası izole test verisi | Tekil atama, dedupe, geciken karar, sıfır payda, olgunlaşmamış D7, silme/geri çekme; demo/QA dışlama ve gruplar arası aynı kurallar |
| E6 — pilot | #54 sonrası owner kararı; varsayılan kapalı açma/kapama ve geri alma planı | Küçük onaylı kohort, yayınlanan rapor ve kayıtlı karar; puan bakiyesi veya temel ürün hakkı geri alınmaz |

Bu dilimler #57/#58 altında ayrı PR'lara ayrılacak iş paketleridir; backend sahibine atanmış veya uygulanmış sayılmaz. Ümit E3 ile E5'in web/ölçüm tasarımını yürütür; API/ledger, bağımsız güvenlik ve yayın kararını ilgili sahipler teslim eder.

## Pilot öncesi doldurulacak karar kaydı

| Karar | Şu an | Tamamlanma kanıtı |
| --- | --- | --- |
| #54 GO, aday SHA, kohort uygunluğu ve atama planı | Bekliyor | Owner karar bağlantısı ve sürüm |
| Birincil metrik, pencere, olgunlaşma süresi ve tek analiz tarihi | Yukarıdaki tanımlar öneri; onay bekliyor | Sürüm kontrollü ön kayıt |
| Beta taban oranı, asgari anlamlı fark, örneklem/güç hesabı | Veri yok | Gerçek olgun beta raporu + hesap varsayımları; sayı tahmin edilmez |
| Koruyucu metriklerin sayısal durdurma sınırları | Kararlaştırılmadı | Ürün/güvenlik sahibi onayı |
| Hukuki dayanak, saklama/silme ve küçük grup kuralı | Bekliyor | #285/#287/#288 onayları |
| Hesap silme, puan/anonimlik veya yetki ihlali | Pilot durur, güvenlik incelemesi gerekir | Olay kaydı ve kapatma/geri alma kanıtı |
| Son karar | Başlatılmadı | Başarılı / başarısız / yetersiz veri ve gerekçesi; sonuç uydurulmaz |

Bu teslim ölçülebilir hipotezleri ve teknik alt işleri ayrıntılandırır. Onaylanmış eşik, gerçek pilot sonucu ve #54 olmadan #57/#58 kapanmaz.
