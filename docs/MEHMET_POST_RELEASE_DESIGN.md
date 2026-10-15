# Mehmet — yayın sonrası tasarım teslimi (#57–#59)

15 Ekim 2026. Bu belge uygulanabilir ürün taslağıdır; çalışan özellik veya kullanıcı deneyi sonucu değildir. #54 yayın kabulü ve ilgili tasarım kararları tamamlanmadan etkinleştirilmez. V1'in ilk girişte 20 puan / yayın başına 10 puan kuralı, trend formülleri ve oy ağırlıkları değişmez.

## #57 — Güven puanı ve rozetler

Amaç: yardımcı katkıyı görünür kılmak; çok paylaşım yapanı otomatik güvenilir ilan etmemek. İlk deney yalnız isteğe bağlı profil rozetidir. Puan; oy ağırlığı, sıralama, moderasyon yetkisi veya yayın limiti vermez.

| Durum | Önerilen kural | Kabul senaryosu |
| --- | --- | --- |
| Kazanım | Bir katkı, bağımsız kullanıcıların değerlendirmeleri ve moderasyon sonrası uygun bulunursa bir kez sayılır. Eşik ve bekleme süresi beta verisiyle kararlaştırılır. | Aynı katkının yeniden işlenmesi ikinci kazanım üretmez. |
| İptal/kayıp | Katkı spam/ihlal nedeniyle kaldırılırsa yalnız ona ait kazanım geri alınır; hesabın diğer katkıları korunur. | Hatalı moderasyon geri alındığında kayıt zincirinden tek kez telafi edilir. |
| İtiraz | Kullanıcı gerekçeyi ve katkı referansını görür, itiraz açar; aynı moderatör kendi kararının tek inceleyicisi olmaz. | Onay/red, gerekçe ve sürüm kayıtlıdır. |
| Yeni kullanıcı | Başlangıç görünürlüğü düşürülmez; rozetsiz profil düşük güven etiketi almaz. | Aynı içerik ve bağlamda yeni/eski hesap temel ürün hakları eşittir. |
| Manipülasyon | Kendi kendine değerlendirme, tekrarlı hesap çifti ve koordineli halkalar kazanım vermez; belirsiz sinyalde bekletilir. | Karşılıklı övgü halkası ve yeniden deneme ek kazanım üretemez. |

Hipotez: yardımcı katkı oranı artarken kaldırılan içerik ve yeni kullanıcıların ilk katkı oranı kötüleşmez. Ölçüm paydası yalnız uygun gerçek kullanıcılar ve tamamlanmış incelemelerdir. Eşikler, deney süresi ve durdurma sınırları deney başlamadan kaydedilir; henüz sonuç yoktur.

Teknik alt işler: (1) sürümlü rozet/kazanım/itiraz sözleşmesi, (2) idempotent ve telafi kayıtlı olay tüketimi, (3) kendi katkısının açıklaması + profil görünürlük tercihi, (4) yönetim incelemesi ve audit, (5) halka/yeni kullanıcı/iptal/silme testleri, (6) kapalı bayrakla pilot ve ölçüm raporu.

## #58 — Katkı görevleri ve günlük/haftalık akış

Amaç: kullanıcıya faydalı başlangıç seçenekleri sunmak. Görevlere katılım ve hatırlatmalar ayrı ayrı isteğe bağlıdır; vazgeçme kazanılmış temel hakları veya puan bakiyesini düşürmez. Kaçırılan gün cezası, zorunlu seri ve bildirim baskısı yoktur.

- İlk dilim parasal/harcanabilir ödül içermez. Yeni kazanım önerisi mevcut puan defterine bağlanmadan önce #57 ve ekonomi kararı gerekir.
- Görev örnekleri: bir kararın sonucunu açıklamak, uygun bir tartışmaya yardımcı yanıt vermek, seçtiği toplulukta rehberi okumak. Oy/yorum adedine sınırsız ödül verilmez.
- Tamamlanma sunucudaki uygun olaydan doğrulanır. `user + taskVersion + period` benzersizdir; istemci sayacı veya çift gönderim ödül üretemez. Kendi içeriği, silinen/ihlal edilen katkı ve eş hesaplar uygun sayılmaz.
- Çoklu hesap şüphesi incelemeye gider; yalnız paylaşılan IP nedeniyle ortak ev/okul kullanıcıları cezalandırılmaz. İtiraz ve açıklama #57 ile ortak çalışır.
- Kullanıcının saat dilimi sabit dönem tanımına dönüştürülür; saat dilimi değiştirme veya gece yarısı yarışı iki tamamlama üretmez. Dönem tanımı deney başlamadan yayımlanır.

Hipotez: uygun yardımcı katkı ve olgun D7 kohortu geri dönüşü artar. Koruyucu metrikler: spam/kaldırma oranı, bildirimden çıkış, yeni kullanıcı tamamlanması. Aktivasyon üzerinden yedi gün geçmemiş kişi D7 paydasına alınmaz; demo ve QA hesapları dışlanır.

Teknik alt işler: (1) görev kataloğu ve dönem sözleşmesi, (2) atomik tamamlama/iptal kaydı, (3) tercih ve sessiz hatırlatma, (4) profil/akış kartı, (5) dönem/tekrar/çoklu hesap testleri, (6) katılım kontrollü deney ve ölçüm. Başarı/durdurma eşikleri beta sonrası karardır.

## #59 — Sponsorlu kararlar ve toplu içgörüler

Keşif kapsamıdır; V1'e ödeme/reklam altyapısı eklemez. İlk gereksinim görüşmeleri için soru seti: hangi karar araştırılıyor, hangi örneklem yeterli, sponsor hangi çıktıyı istiyor, katılımcı neyi kabul ediyor, araştırmayı kim denetliyor? Henüz müşteri, gelir veya doğrulanmış ihtiyaç iddiası yoktur.

- Sponsor etiketi kart, detay ve paylaşım önizlemesinde görünür. Ücretli yerleşim organik trend alanından ayrıdır; ödeme organik puanı ve oy ağırlığını değiştirmez.
- Sponsor bireysel oy, kullanıcı kimliği, iletişim bilgisi veya ham olay dışa aktarımı alamaz. Yalnız önceden onaylanmış toplu metrikler sunulur.
- Asgari örneklem, küçük hücre bastırma ve zaman aralığı politikası kararlaştırılmadan içgörü yayımlanmaz. Birbirine çok yakın filtreler/sürümler arasındaki farktan tek kişi çıkarımı da test edilir.
- Varsayılan koruma: yetersiz örneklemde “Yetersiz veri”; sıfır olarak gösterilmez. Silme/itiraz ve moderasyon sonrası rapor yenileme davranışı kayıtlı olmalıdır.
- Ticari kapsam; sponsor kimlik kontrolü, içerik kabul/red, ücret/iade, ödeme sağlayıcısı ve veri saklama kararlarından sonra ayrı uygulama işlerine ayrılır.

Teknik alt işler: (1) sponsor etiketli içerik ve ayrı yerleşim sözleşmesi, (2) yönetim onay/red ve audit, (3) küçük örneklem/diferans saldırısı testli toplulaştırma, (4) sponsor ekranı ve erişim sınırı, (5) ödeme/iade tasarımı, (6) sınırlı pilot. Başarı metriği doğrulanmış araştırma ihtiyacı ve rapor faydasıdır; organik katılımın zarar görmemesi ayrıca ölçülür.

## Kapanış sınırı

#57–#59'un tasarım hazırlığı ilerletildi. Gerçek beta verisi, ürün eşikleri, #54 bağımlılığı ve pilot kabulü bulunmadığından bu üç issue kapanmaz; yukarıdaki alt işler uygulama sırasını somutlaştırır.
