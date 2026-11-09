# Güven rozeti ve katkı görevleri deney planı

8 Kasım 2026. #57 ve #58 teknik tasarım teslimidir. Temel kurallar
[mevcut ürün taslağında](MEHMET_POST_RELEASE_DESIGN.md) tanımlıdır.
Deneyler #54 yayın kabulünden sonra, #285 ölçüm kararı ve aşağıdaki
ürün kararları onaylanınca başlayabilir. Sonuç verisi henüz yoktur.

## Ortak deney yöntemi

Deney birimi hesaptır. Uygun ve ölçüme katılmayı seçmiş hesaplar kontrol
ve deney grubuna bir kez atanır. Atama sürümü sabittir. Başka gruba
geçiş ve tekrar kayıt aynı dönemde ikinci ödül üretemez.
Ölçüme katılmayan kullanıcı temel ürüne erişmeye devam eder.
Opt-in örneklemden çıkan sonuçlar tüm kullanıcı kitlesine genellenmez.

Demo, QA, test runner, ekip ve bilinen otomasyon hesapları deneyden çıkarılır.
Sonradan tespit edilen dışlamalar her iki gruba aynı sürümlü kuralla uygulanır.
Aktif kullanıcı tanımı, uygunluk penceresi ve deney başlangıcı raporda yer alır.
Yalnız oturumu açık kalmış olmak katkı sayılmaz.

Pilot öncesinde Mehmet ürün etkisi alt sınırını, Mert moderasyon etiketinin
tanımını, ölçüm sahibi örneklem/güç hesabını ve rapor tarihini kaydeder.
Bu alanlardan biri boşsa sonuç başarı/başarısızlık diye yorumlanmaz.
Sabit ufuklu analiz yapılır. Günlük dalgalanmaya bakarak erken başarı ilan edilmez.
Pay, payda, grup büyüklüğü ve belirsizlik aralığı birlikte verilir.

## #57 güven rozeti

İlk UI dilimi isteğe bağlı profil rozeti ve kişisel açıklama ekranıdır.
Kullanıcı kendi katkısının neden uygun bulunduğunu, bekleyen incelemeyi,
iptali ve itiraz yolunu görür. Kamuya açık yüzey ham puan, inceleme nedeni
ve başka hesapların değerlendirmelerini açmaz.
Rozetsiz profil temel görünürlüğünü korur.

| Ölçüm | Hesaplama | Yorum |
|---|---|---|
| Birincil yararlı katkı oranı | Bağımsız incelemede yararlı bulunan katkılar / incelemesi tamamlanmış uygun katkılar | Her katkı tek kez sayılır. İnceleme kriteri ve bekleme penceresi iki grupta aynıdır. |
| Moderasyon koruması | Spam/ihlal nedeniyle kaldırılan uygun katkılar / aynı pencerede yayımlanan uygun katkılar | İncelemesi geciken katkılar ayrıca raporlanır. |
| Yeni kullanıcı adaleti | İlk uygun katkısını tamamlayan yeni hesaplar / uygun yeni hesaplar | Yeni hesap yaşı pilot öncesi sabitlenir. Kontrol ve deney farkı raporlanır. |
| İtiraz doğruluğu | Kararı bozulan itirazlar / sonuçlanmış itirazlar | Açık itirazlar paydada yer almaz. Yanlış rozet kaybı ayrıca incelenir. |

Hipotez, yararlı katkı oranının artması ve iki koruyucu metriğin önceden
onaylanan toleransları aşmamasıdır. Kazanım eşiği beta dağılımından seçilir.
Halka şüphesi ve kendi katkısını değerlendirme kazanım oluşturmaz.
Yanlış karar geri alınınca aynı katkıya tek telafi kaydı yazılır.

## #58 günlük ve haftalık görevler

İlk UI dilimi görev kataloğu, isteğe bağlı katılım, dönem bitişi,
tamamlandı/bekliyor/iptal/hata durumları ve geçmiş ekranıdır.
Hatırlatma ayrı tercihtir. Katılımdan çıkış temel puan bakiyesini azaltmaz.
İlk pilotun ödülü ilerleme gösterimidir. Harcanabilir puan eklenmesi ayrı
ekonomi kararı ve sunucu defteri sözleşmesini bekler.

| Ölçüm | Hesaplama | Yorum |
|---|---|---|
| Birincil yararlı katkı | Bağımsız incelemede uygun bulunan görev katkıları / atanmış uygun hesaplar | Yalnız görevi tamamlayanları paydaya almak önlenir. |
| D7 geri dönüş | Aktivasyondan sonraki yedinci gün ürün etkinliği olan hesaplar / tam yedi günlük gözlem penceresi olgunlaşmış aktive hesaplar | Saat dilimi ve aktivasyon tanımı pilot öncesi sabitlenir. Olgunlaşmamış kohort bekler. |
| Görev tamamlama | Sunucunun doğruladığı tekil tamamlama / katılımı kabul edilmiş uygun görevler | İstemci tıklaması tamamlama sayılmaz. |
| Spam ve tercih | Kaldırılan görev katkısı oranı ve hatırlatmadan çıkış oranı | İki ayrı payda ve oran raporlanır. |

Tamamlama kimliği hesap + görev sürümü + dönemdir.
İki eşzamanlı istek tek kayıt oluşturur. Geç gelen olay aynı dönem kuralıyla
işlenir. Saat dilimi değişikliği yeni kazanım oluşturmaz.
İptal ve telafi eski kayıtları silerek uygulanmaz.

## Teknik teslimler ve doğrulama

| İş | Sorumluluk | Bitti ölçütü |
|---|---|---|
| #57 sözleşme | Backend sahibi ile Ümit | Rozet durumu, sürüm, kullanıcı açıklaması ve itiraz alanları incelenmiş. Ham değerlendirici kimliği public yanıtta bulunmuyor. |
| #57 olay defteri | Backend sahibi | Tekrarlı ve eşzamanlı olay, silme, kaldırma, itiraz ve telafi PostgreSQL testlerinden geçiyor. |
| #57 profil UI | Ümit | Görünürlük tercihi, açıklama, loading/empty/error/retry, klavye ve reduced-motion testleri geçiyor. |
| #57 abuse kabulü | Mert ve bağımsız güvenlik incelemesi | Kendi kendini değerlendirme, hesap çifti, halka, yeni kullanıcı ve ortak ev/okul senaryoları kayıtlı. Yalnız IP ortaklığı ceza üretmiyor. |
| #58 katalog ve dönem | Backend sahibi ile Ümit | Görev sürümü, uygun olay ve saat dilimi sözleşmesi net. Gece yarısı ve geç gelen olay testleri geçiyor. |
| #58 tamamlama defteri | Backend sahibi | Çift gönderim, çoklu sekme, iptal ve telafi tek kazanım üretiyor. Mevcut V1 puan kurallarıyla uyumlu. |
| #58 görev UI | Ümit | Katılım ve hatırlatma ayrı. Erişilebilir dönem etiketi, pending/error/retry ve çıkış akışı testli. |
| Ortak rapor | Ümit ve ölçüm sahibi | Grup bazında pay/payda, QA dışlama, olgun D7 ve inceleme gecikmesi raporlanıyor. Sunucu yalnız onaylı ölçüm alanlarını topluyor. |

Ödül çoğalması, özel veri sızıntısı veya itirazla geri alınamayan yanlış
yaptırım görülürse pilot durdurulur ve olay incelenir.
Diğer koruyucu metriklerin sayısal durdurma eşikleri pilot kaydında
onaylanır. Kararsız veya yetersiz örneklem sonucu açıkça belirtilir.

Ümit tasarım/UI ve kabul koordinasyonunu devralır. API/DB işi ilgili modül
sahibiyle planlanır. #57 ve #58'in uygulama/pilot kapanışı #54 sonrasındaki
bu teslimlerin kabulünü gerektirir.
