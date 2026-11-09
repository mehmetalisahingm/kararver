# KararVer V1 — Yeni anket sonuç görünürlüğü varsayılanı (8 Kasım 2026)

**İşletmeci kesin kararı:** Mehmet, **yeni anketlerde sonuçların varsayılan olarak herkese açık (`ALWAYS`) olmasını**, **mevcut `AFTER_VOTE` anketlerinin sonuç gizliliğinin aynen korunmasını** seçti. Başka bir açık karar olmadığı için yeni anket sahibi yayınlamadan önce yine bilinçli olarak `AFTER_VOTE` seçebilir.

**Ürün hedefi:** Misafirler halka açık anketleri ve yayımlanmasına izin verilen sonuçları görebilir; oy/yorum katılımı 18+ hesap gerektirir (#324, #318, #289). Bu karar **tüm geçmiş oy toplamlarını yayınlamak** ya da gizlenmiş/incelemede/kaldırılmış anketi yeniden açmak için izin değildir.

## Davranış ve teknik etki

| Durum | Beklenen ve teknik kontrol |
| --- | --- |
| İlk kez açılan anket oluşturma formu | `emptyDraft().visibility === "always"`; önizlemede “Herkese açık” gösterilir. |
| Yeni kayıt isteğinde `resultsVisibility` gönderilmemiş | `CreatePollBody` Zod varsayılanı `ALWAYS`; backend **sunucu tarafında** uygular. |
| Yeni kayıt isteğinde açıkça `AFTER_VOTE` gönderilmiş | Yazarın tercihi **değişmeden** kaydedilir; misafire `{ visible: false }` dışında sayı/oy yüzdesi verilmez (normal istisna: anket kapandığında mevcut ürün kuralı sonuçları açar). |
| Eski `AFTER_VOTE` kaydı | **Herhangi bir migration / `UPDATE polls` / toplu değişim YOK.** Eski kaydın değeri aynen saklanır. |
| Demo / istemci düzenlenen ama henüz yayımlanmayan eski taslak | Geçmiş taslak özellikle `after_vote` içeriyorsa doğrudan değiştirilmez; yalnız yeni oluşturulan boş taslak varsayılanı değişir. |
| Diğer anket türü `DISCUSSION` | Oylama/sonuç yok, `null` davranışı değişmez. |
| Google, misafir, kapalı içerik | #324 yalnız backend `results.visible=true` veriyorsa SSR/Google'da sonucu gösterebilir. `AFTER_VOTE` sonuç gizliliğini SEO veya frontend nedeniyle bypass etmek yasak. |

**Veritabanı:** Eski çekirdek migration'ında `results_visibility` için DB default zaten `ALWAYS` idi; bu PR DB şemasına/migrasyona dokunmaz. Esas farklılık yeni web draft'ın `after_vote` seçmesi ve API sözleşmesinin istemciden explicit alan istemesiydi. İkisi de yeni varsayılan için uyumlandı.

## Doğrulama ve kabul

- [x] İlgili ürün kapsamı kesinleştirildi ve teknik kod değişikliği ayrı PR adayı olarak kaydedildi.
- [ ] `apps/web/test/results-visibility-default.test.ts`: yeni draft `always`, boş API body `ALWAYS`, açık `AFTER_VOTE` korunması.
- [ ] `apps/api/test/polls.test.ts`: sentetik PostgreSQL'de eski özel tercih + yeni varsayılan anket, public/guest GET, eski gizli oy sayısı sızmaz.
- [ ] `apps/web/test/states/premium-polls.spec.ts`: yeni form varsayılanı ve bilerek `AFTER_VOTE` seçilip önizlemenin koruması.
- [ ] Ümit: yeni UI erişilebilirliği (klavye/ekran okuyucu), alan metni, form state ve demo doğrulaması.
- [ ] Faruk: API v1, kontrat ve DB'deki eski kayıt davranışı; testlerin aynı SHA'da PASS olması.
- [ ] Utku ve Mert: gizli sayısal sonuçların SSR, cache, tarayıcı/SEO ve eski sosyal paylaşım meta üzerinden sızmaması; kapalı ve silinen içerik (#323), sonuç politikası için veri mahremiyeti incelemesi.
- [ ] Staging gerçek mobil + üretim adayı #52/#53 ve #54 yayın kapıları. Eski anketlerde otomatik değer değişimi test edilip **olmadığı** kanıtlanmalı.

## Hukuki ve şeffaflık çerçevesi

Anket sonucunun yayımlanması tekil oy verenlerin kimlik, oy geçmişi, zaman damgası, IP veya `anonymous_vote_groups` gibi riskli kayıtları paylaşma yetkisi **vermez**: yalnız halihazırda anonimliği / toplu istatistik eşiklerini karşılayan toplu sonuç projeksiyonu. Küçük gruplar/duyarlı konu başlıkları ve çapraz eşleştirmeyle kişiyi çıkarabilme riski #321/#285'te ayrı değerlendirilmeli; toplam sayılar bile bazı bağlamlarda kişisel veriyi açığa çıkarabilir.

- Yeni anket yaratana **yayınlamadan önce** herkese açık sonuçların misafirler ve arama motorları tarafından görülebileceği açıkça bildirilmeli, mümkünse görünürlük seçimi bir kullanıcı tercihi olarak sunulmalı. Kullanım koşulları ve kısa aydınlatma, gerçek veri sorumlusu ve onaylı metinler #285/#286 ile tutarlı olmalıdır.
- **Geçmiş `AFTER_VOTE` tercihi** kamuya açılmayacak; yeni varsayılanın geçmiş kullanıcı kararını geriye dönük değiştirdiği iddia edilmez. Geçmiş kullanıcı verisi için otomatik toplu migration yok.
- Anket oluşturma varsayılanının değişmesi reklam, ücretli üyelik veya sponsorlu gösterim anlamına gelmez (#319 ücretsiz/reklamsız V1).
- KVKK aydınlatma yükümlülüğü: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- KVKK aydınlatma usul ve esaslar: https://www.kvkk.gov.tr/Icerik/4132/aydinlatma-yukumlulugunun-yerine-getirilmesinde-uyulacak-usul-ve-esaslar-hakkinda-teblig

**DURUM:** İnceleme/test ve gerçek ortam kanıtı bekleniyor. Bu doküman hukuki kabul, merge veya production GO değildir.
