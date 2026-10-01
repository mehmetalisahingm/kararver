# KV-07 — Ürün Olay Sözlüğü, Kabul Senaryoları ve İçerik Hazırlığı

> Issue: #9  
> Sahip: Mehmet  
> Amaç: KararVer V1'in ölçüm sözlüğünü, beta kabul senaryolarını, başlangıç içerik paketini ve pilot topluluk çerçevesini tek yerde netleştirmek.

Bu doküman uygulama kodundan bağımsız bir **ürün sözleşmesidir**. Event adları, metrik tanımları ve kabul senaryoları değişirse ilgili backend/frontend tüketicileri de güncellenmelidir.

---

## 1. Ölçüm ilkeleri

1. Aynı olay yeniden işlendiğinde analitik sayıları şişmemelidir. Her event benzersiz `event_id` taşımalıdır.
2. Zamanlar UTC saklanmalı, raporlama arayüzünde Türkiye için `Europe/Istanbul` gösterimi yapılabilmelidir.
3. Test, seed ve demo hesapları production metriklerinden ayrılmalıdır: `actor_type = real | test | seed | admin`.
4. Analytics olaylarına şifre, e-posta doğrulama tokenı, serbest metin yorum içeriği, özel mesaj, raw IP gibi hassas veri yazılmamalıdır.
5. `user_id`, `poll_id`, `community_id` gibi dahili kimlikler kullanılabilir; raporlar bireysel kullanıcı davranışını ifşa edecek şekilde public edilmemelidir.
6. Bir event başarıyla tamamlanmış kullanıcı aksiyonunu temsil ediyorsa yalnızca server onayından sonra kesin event üretilmelidir. UI click eventleri ayrı tutulabilir.
7. Organik ve admin tarafından öne çıkarılmış trafik ayrılmalıdır: `discovery_source = organic | featured | search | category | community | notification | share | direct`.

---

## 2. Ortak event zarfı

Her ürün eventi mümkün olduğunca şu ortak alanları taşır:

```text
event_id        benzersiz olay kimliği
event_name      sözlükteki olay adı
event_version   ör. 1
occurred_at     UTC timestamp
user_id         anonim kullanıcıda null olabilir
session_id      oturum kimliği
actor_type      real | test | seed | admin
platform        web
surface         home | explore | poll_detail | profile | community | admin | notification
source          direct | organic | featured | search | share | notification | community
poll_id         ilgiliyse
community_id    ilgiliyse
category_id     ilgiliyse
request_id      backend idempotency / izleme kimliği
experiment_id   varsa
```

Serbest metinleri analytics payloadına kopyalamak yerine ilgili nesnenin ID'si kullanılmalıdır.

---

# 3. V1 ürün event sözlüğü

## 3.1 Hesap ve onboarding

### `user_registered`
Başarılı hesap oluşturulduğunda üretilir.

Ek alanlar:
- `registration_source`
- `referrer_type`
- `share_id` varsa

### `email_verified`
E-posta doğrulaması başarıyla tamamlandığında.

### `user_logged_in`
Başarılı login sonrası.

### `onboarding_started`
İlk onboarding ekranı açıldığında.

### `interest_selected`
Kullanıcı kategori ilgisi eklediğinde veya kaldırdığında.

Ek alanlar:
- `category_id`
- `action = add | remove`

### `onboarding_completed`
Kullanıcı onboarding'i tamamladığında.

Ek alanlar:
- `selected_interest_count`
- `skipped = true | false`

---

## 3.2 Anket / karar

### `poll_create_started`
Anket oluşturma ekranında ilk anlamlı etkileşim gerçekleştiğinde.

### `poll_created`
Anket backend tarafından başarıyla oluşturulduğunda.

Ek alanlar:
- `poll_id`
- `category_id`
- `community_id` nullable
- `option_count`
- `image_count`
- `duration_hours`
- `results_visibility`
- `comments_enabled`

### `poll_create_rejected`
Cooldown, günlük limit, validation veya yaptırım nedeniyle oluşturma reddedildiğinde.

Ek alanlar:
- `reason = cooldown | daily_limit | validation | sanction | moderation | system_disabled`

### `poll_viewed`
Anket detay ekranı kullanıcı tarafından gerçekten görüntülendiğinde. Aynı session + poll için kısa süreli tekrarlar dedupe edilmelidir.

### `poll_closed`
Süre dolması veya yetkili işlem nedeniyle anket kapandığında.

### `decision_update_created`
Anket sahibi “Kararımı verdim” güncellemesi yayınladığında.

---

## 3.3 Oy

### `vote_submitted`
Kullanıcının oyu başarıyla kaydedildiğinde.

Ek alanlar:
- `poll_id`
- `option_id`
- `is_change = false`
- `discovery_source`

### `vote_changed`
Aktif oy başka seçeneğe başarıyla taşındığında.

Ek alanlar:
- `from_option_id`
- `to_option_id`

### `vote_rejected`
Kapanmış anket, yetki, rate limit veya sistem kuralı nedeniyle oy reddedildiğinde.

---

## 3.4 Yorum ve alternatif

### `comment_created`
Başarılı yorum oluşturulduğunda.

Ek alanlar:
- `poll_id`
- `parent_comment_id` nullable
- `is_reply`

### `comment_liked`
Yorum beğenildiğinde.

### `alternative_created`
“Bunun yerine ne önerirsin?” aksiyonundan alternatif başarıyla oluşturulduğunda.

### `alternative_liked`
Alternatif öneri beğenildiğinde.

---

## 3.5 Kaydetme ve takip

### `poll_saved`
Kullanıcı anketi private listesine kaydettiğinde.

### `poll_unsaved`
Kaydı kaldırdığında.

### `poll_followed`
Sonucu/güncellemeyi takip etmeye başladığında.

### `poll_unfollowed`
Takibi bıraktığında.

---

## 3.6 Arama ve keşif

### `search_performed`
Arama backend tarafından işlendiğinde.

Ek alanlar:
- `query_length`
- `result_count`
- `filter_count`

**Not:** Raw arama sorgusu varsayılan analytics eventine yazılmamalıdır. Ürün araştırması için ayrıca güvenli, sınırlı ve retention politikası olan veri hattı gerekiyorsa ayrı tasarlanır.

### `search_result_opened`
Arama sonucundan bir ankete/kullanıcıya/topluluğa geçildiğinde.

### `feed_item_impression`
Bir feed kartı gerçekten viewport'a girdiğinde.

Ek alanlar:
- `feed_type = for_you | rising | new | most_voted | category | community`
- `position`
- `ranking_version`
- `is_featured`

### `trend_list_opened`
Günün/Haftanın Yükselenleri, En Çok Oy, En Çok Konuşulanlar veya Değişkenler ekranı açıldığında.

Ek alanlar:
- `trend_type = daily_rising | weekly_rising | most_voted | most_discussed | movers`

---

## 3.7 Topluluk

### `community_viewed`
Topluluk sayfası açıldığında.

### `community_joined`
Kullanıcı başarıyla topluluğa katıldığında.

### `community_left`
Topluluktan ayrıldığında.

---

## 3.8 Bildirim

### `notification_created`
Bildirim kaydı backend tarafından üretildiğinde.

### `notification_opened`
Kullanıcı bildirime tıklayıp hedefe gittiğinde.

Ek alanlar:
- `notification_type`
- `target_type`

### `notification_preference_changed`
Bildirim tercihi/sessize alma ayarı değiştiğinde.

---

## 3.9 Paylaşım ve büyüme

### `share_clicked`
Kullanıcı paylaşım aksiyonuna bastığında.

Ek alanlar:
- `channel = x | whatsapp | copy_link | native_share | other`
- `share_id`

### `share_landing_viewed`
Paylaşım linkinden gelen yeni session ilk sayfayı gördüğünde.

### `share_conversion_registered`
Share kaynaklı session aynı attribution penceresinde hesap açtığında.

### `share_conversion_contributed`
Share kaynaklı session/kullanıcı ilk anlamlı katkısını yaptığında.

---

## 3.10 Rapor / moderasyon

### `report_created`
Anket, kullanıcı, yorum, alternatif veya görsel raporlandığında.

Ek alanlar:
- `target_type`
- `reason_code`

### `moderation_action_applied`
Yetkili bir moderasyon işlemi uyguladığında.

Ek alanlar:
- `action_type`
- `target_type`
- `reason_code`

### `featured_content_applied`
Admin bir içeriği öne çıkardığında.

Ek alanlar:
- `placement`
- `starts_at`
- `ends_at`

---

# 4. Ana metrik sözlüğü

Bu bölümdeki tanımlar dashboard ve beta değerlendirmesinde tek referans olmalıdır.

## 4.1 İlk katkı oranı

**Uygun kohort:** E-postasını doğrulamış yeni kullanıcılar.

**İlk katkı:** Kayıttan sonraki ilk 24 saat içinde şu eventlerden en az biri:
- `vote_submitted`
- `comment_created`
- `alternative_created`
- `poll_created`
- `community_joined`

**Pay:** İlk 24 saatte en az bir katkı yapan uygun kullanıcı sayısı.  
**Payda:** İlgili kayıt kohortundaki doğrulanmış kullanıcı sayısı.

`first_contribution_rate_24h = katkı_yapan / doğrulanmış_yeni_kullanıcı`

Ek olarak medyan `time_to_first_contribution` izlenir.

## 4.2 İlk oy oranı

**Kohort:** E-postasını doğrulamış yeni kullanıcılar.

**Pay:** Kayıttan sonraki 24 saat içinde `vote_submitted` yapan kullanıcılar.  
**Payda:** Aynı kohorttaki doğrulanmış kullanıcılar.

`first_vote_rate_24h = ilk_24s_oy_veren / doğrulanmış_yeni_kullanıcı`

## 4.3 Yanıt alan soru oranı

**Uygun soru:** Test/seed/admin olmayan gerçek kullanıcı tarafından açılan, en az 24 saat açık kalmış ve moderasyon tarafından kaldırılmamış anket.

**Yanıt aldı:** Oluşturucusu dışındaki en az bir benzersiz kullanıcı 24 saat içinde oy verdi **veya** yorum/alternatif bıraktı.

**Pay:** 24 saat içinde yanıt alan uygun anket.  
**Payda:** En az 24 saat gözlem süresi tamamlanan uygun anket.

`answered_poll_rate_24h = yanıt_alan_anket / olgun_uygun_anket`

Ayrıca `time_to_first_response` medyan/p75 takip edilir.

## 4.4 DAU

KararVer'in ana DAU metriği **engaged DAU** olacaktır.

Bir takvim gününde aşağıdakilerden en az birini yapan benzersiz gerçek kullanıcı:
- oy verme
- yorum/cevap
- alternatif öneri
- anket oluşturma
- kaydetme/takip
- topluluğa katılma

Sadece sayfa görüntülemek engaged DAU sayılmaz. Ayrı olarak `viewer_DAU` tutulabilir.

## 4.5 WAU

Son 7 takvim gününde en az bir engaged event yapan benzersiz gerçek kullanıcı.

`DAU/WAU` stickiness, aynı engaged tanım kullanılarak hesaplanır.

## 4.6 D7 retention

**Kohort:** Belirli bir günde kayıt olup e-postasını doğrulayan gerçek kullanıcılar.

**Pay:** Kayıt tarihinden tam 7 gün sonraki takvim gününde en az bir engaged event yapan kullanıcı.  
**Payda:** D7 gününü tamamlayacak kadar eski, doğrulanmış kayıt kohortu.

Test/seed/admin hesapları hariçtir. Henüz D7'ye ulaşmamış kullanıcılar paydaya alınmaz.

Ek ürün metriği olarak `rolling_d7` ayrıca tutulabilir: D+1 ile D+7 arasında herhangi bir gün geri dönen kullanıcı.

## 4.7 Paylaşım → kayıt dönüşümü

Attribution penceresi başlangıçta 7 gündür ve config ile değiştirilebilir.

**Pay:** `share_landing_viewed` ile gelen benzersiz sessionlardan 7 gün içinde kayıt olanlar.  
**Payda:** Bot/preview trafiği çıkarılmış benzersiz share landing sessionları.

`share_to_registration = share_kaynaklı_kayıt / geçerli_share_landing`

## 4.8 Paylaşım → katkı dönüşümü

**Pay:** Share landing sonrası 7 gün içinde ilk anlamlı katkıyı yapan benzersiz kullanıcı/session.  
**Payda:** Geçerli benzersiz share landing sessionları.

Bu metrik sadece “linke tıkladı” değil, platforma gerçek katkıya dönüştü mü sorusunu cevaplar.

## 4.9 Soru başına katılım

- `median_unique_voters_per_poll`
- `median_comments_per_poll`
- `polls_with_3plus_unique_voters_rate`
- `polls_with_comment_rate`

Kategori ve topluluk bazında ayrıca raporlanmalıdır.

---

# 5. Beta kabul senaryoları

Her senaryo gerçek staging ortamında, mümkün olduğunda en az iki farklı kullanıcı hesabı ile denenmelidir.

## B01 — Yeni kullanıcı ilk katkı
1. Kullanıcı kayıt olur ve e-postasını doğrular.
2. Onboarding'de ilgi seçer veya atlar.
3. Feed açılır.
4. Bir ankete oy verir.
5. `user_registered`, `onboarding_*`, `vote_submitted` doğru kullanıcı/session ile görünür.

**Başarı:** Kullanıcı yardım almadan ilk oyunu tamamlayabilir ve duplicate analytics event oluşmaz.

## B02 — Anket oluşturma
1. Kullanıcı başlık, açıklama, 2–6 seçenek ve kategori girer.
2. Görsel opsiyonel eklenir.
3. Süre/sonuç/yorum tercihleri seçilir.
4. Anket yayınlanır.

**Başarı:** `poll_created` yalnızca backend başarı verdikten sonra bir kez oluşur; yeni anket feed/detayda görünür.

## B03 — Cooldown ve günlük limit
1. Yeni kullanıcı izin verilen sayıda anket açar.
2. Cooldown dolmadan tekrar dener.
3. Günlük limit aşıldığında tekrar dener.

**Başarı:** İşlem sunucuda reddedilir, anlaşılır kalan süre gösterilir, `poll_create_rejected` doğru nedenle oluşur.

## B04 — Oy bütünlüğü
1. İki kullanıcı aynı ankete oy verir.
2. Bir kullanıcı aynı isteği tekrar yollar.
3. Ayar açıksa oyunu değiştirir.

**Başarı:** Tek aktif oy korunur; toplam/yüzde bozulmaz; tekrar istek çift event/oy üretmez.

## B05 — Gizli sonuç
1. Sonucu oy öncesi gizli bir anket açılır.
2. Oy vermemiş kullanıcı detay ve paylaşım kartını açar.
3. Oy verdikten sonra sonuç görünür.

**Başarı:** Gizli sonuç API, HTML, cache veya OG üzerinden sızmaz.

## B06 — Yorum, cevap ve alternatif
1. Kullanıcı yorum yapar.
2. Başka kullanıcı tek seviye cevap verir.
3. Alternatif önerir.

**Başarı:** İkinci seviye nested cevap reddedilir; normal yorum ile alternatif UI ve event olarak ayrıdır.

## B07 — Kaydet ve takip et
1. Kullanıcı anketi kaydeder.
2. Başka hesap kaydedilenler listesini erişmeye çalışır.
3. Kullanıcı anketi takip eder.

**Başarı:** Kaydedilenler private kalır; duplicate kayıt oluşmaz; takip state'i doğru tutulur.

## B08 — Bildirim geri dönüşü
1. Ankete yorum/alternatif gelir.
2. Sahibe tek bildirim oluşturulur.
3. Bildirime tıklanır.

**Başarı:** Doğru içeriğe gider, unread sayaç tutarlıdır, aynı olay duplicate bildirim üretmez.

## B09 — Arama ve keşif
1. Türkçe karakter içeren arama yapılır.
2. Kategori filtresi uygulanır.
3. Sonuçtan ankete girilir.

**Başarı:** Görünmez/kaldırılmış içerik sızmaz; arama eventinde raw kişisel metin analytics'e taşınmaz.

## B10 — Trend formatları
Günün Yükselenleri, Haftanın Yükselenleri, En Çok Oy Verilenler, En Çok Konuşulanlar ve Haftanın Değişkenleri ayrı fixturelarla test edilir.

**Başarı:** Beş ekran aynı sıralamanın kopyası değildir; tarih/örneklem ve organik/featured ayrımı gösterilebilir.

## B11 — Topluluk
1. Kullanıcı pilot topluluğa katılır.
2. Topluluk feedini görür.
3. Topluluk içi anket açar.
4. Ayrılır.

**Başarı:** Üyelik duplicate olmaz; topluluk verisi ve moderatör yetkisi başka topluluğa taşmaz.

## B12 — Rapor ve moderasyon
1. Kullanıcı içeriği raporlar.
2. Moderatör kuyruğunda görür.
3. Gerekçeli işlem uygular.

**Başarı:** Rapor direkt hard delete yapmaz; işlem auditlenir; public görünürlük beklenen state'e geçer.

## B13 — Admin öne çıkarma
1. Admin anketi `Ana Sayfa Spotlight` olarak tarihli öne çıkarır.
2. Süre başlar ve biter.

**Başarı:** İçerik doğru yüzeyde etiketli görünür, organik trend puanı değiştirilmez, süre bitince otomatik kalkar.

## B14 — Ban/suspend
1. Admin kullanıcıya süreli yaptırım uygular.
2. Kullanıcının açık oturumundan kısıtlı işlem denenir.

**Başarı:** Backend reddeder; yalnızca UI gizleme ile yetinilmez; audit kaydı vardır.

## B15 — Share funnel
1. Kullanıcı X/WhatsApp/copy link ile anket paylaşır.
2. Yeni session share linkten gelir.
3. Kayıt olur ve oy verir.

**Başarı:** `share_id` zinciri landing → registration → first contribution boyunca attribution penceresi içinde takip edilir.

---

# 6. Başlangıç kategori içerik paketi

Aşağıdaki içerikler **demo/seed taslağıdır**. Gerçek kullanıcı gönderisi gibi gösterilmemeli; üretimde seed içerik kullanılacaksa `actor_type=seed` ile açıkça ayrılmalıdır.

## Teknoloji
1. 30–35 bin TL bandında telefon alırken kamera mı pil ömrü mü daha önemli?
2. Üniversite için 16 GB RAM laptop 2026'da hâlâ yeterli mi?
3. Mekanik klavyeye ekstra para vermeye değer mi?
4. Akıllı saat günlük kullanımda gerçekten işe yarıyor mu?
5. Aynı bütçede güçlü Windows laptop mu daha hafif ultrabook mu?

## Otomobil
1. İkinci el araçta düşük kilometre mi temiz ekspertiz mi daha önemli?
2. Şehir içi kullanım için hibrit araca geçmeye değer mi?
3. 5 yaşında premium araç mı sıfır orta segment mi?
4. Otomatik araçta küçük motor turbo uzun kullanım için mantıklı mı?
5. Bir araç piyasanın %10 altında ise risk almaya değer mi?

## Alışveriş
1. Aynı ürün için resmi mağazaya %15 fazla vermeye değer mi?
2. İkinci el elektronik alırken kutu/fatura ne kadar önemli?
3. Ucuz ürünü iki kez almak mı kaliteli ürünü bir kez almak mı?
4. İnternetten mobilya almak mı mağazada görerek almak mı?
5. İndirim beklemek mi ihtiyacı hemen almak mı?

## Eğitim
1. Bir yazılım öğrencisi için sertifika mı gerçek proje mi daha değerli?
2. Zor seçmeli ders mi kolay yüksek not alınan ders mi?
3. İngilizce teknik kaynakla öğrenmek başlangıçta daha mı verimli?
4. Her gün 1 saat çalışma mı haftada iki uzun oturum mu?
5. Mezun olmadan staj sayısını artırmak mı tek uzun staj yapmak mı?

## Üniversite
1. Kampüste yemekhane menüsü fiyatına göre yeterli mi?
2. Ders programında uzun boşluklar yerine günleri sıkıştırmak daha mı iyi?
3. Üniversite kütüphanesi gece daha geç saate kadar açık olmalı mı?
4. Bölüm içi proje takımları krediyle desteklenmeli mi?
5. Kampüs ulaşımında ring sıklığı artırılmalı mı?

## Yaşam
1. Şehir merkezinde küçük ev mi uzakta büyük ev mi?
2. Günlük planı uygulamayla mı kağıt ajandayla mı tutmak daha sürdürülebilir?
3. Evde spor ekipmanı almak spor salonu üyeliğine alternatif olur mu?
4. Sosyal medya bildirimlerini tamamen kapatmak faydalı mı?
5. Haftada bir gün tamamen plansız bırakmak verimliliği artırır mı?

## Seyahat
1. 3 günlük şehir gezisinde merkezi pahalı otel mi uzak uygun otel mi?
2. Uçak bileti için esnek tarih seçmek gerçekten tasarruf ettiriyor mu?
3. İlk kez yurt dışına çıkan biri turla mı bireysel mi gitmeli?
4. Kısa tatilde araç kiralamak toplu taşımaya değer mi?
5. Tek büyük valiz mi iki kabin bagajı mı daha pratik?

## Oyun
1. Yeni çıkan oyunu tam fiyat almak mı indirim beklemek mi?
2. Rekabetçi oyun için 144 Hz'den 240 Hz'e geçmeye değer mi?
3. Co-op oyunda 4 kişilik yapı mı 2 kişilik yapı mı daha eğlenceli?
4. Grafik kalitesi mi stabil FPS mi öncelikli olmalı?
5. Oyun aboneliği mi tek tek oyun satın almak mı daha mantıklı?

## Spor
1. Kas kazanmak için 4 gün kaliteli antrenman 6 günden daha iyi olabilir mi?
2. Evde kardiyo ekipmanı almak düzenli kullanım sağlar mı?
3. Sabah antrenmanı mı akşam antrenmanı mı sürdürülebilir?
4. Yeni başlayan biri serbest ağırlık mı makine mi ağırlıklı çalışmalı?
5. Spor salonu seçerken yakınlık mı ekipman kalitesi mi daha önemli?

## Yemek
1. Öğle yemeğinde daha pahalı ama proteinli seçenek almaya değer mi?
2. Airfryer gerçekten günlük mutfakta zaman kazandırıyor mu?
3. Dışarıda kahvaltı mı evde hazırlamak mı fiyat/performans?
4. Haftalık yemek hazırlığı yapmak lezzetten ödün veriyor mu?
5. Aynı bütçede büyük porsiyon mu daha kaliteli malzeme mi?

## Ev / Emlak
1. Kirada merkezi eski bina mı yeni ama uzak bina mı?
2. Ev alırken manzara için ekstra fiyat vermeye değer mi?
3. Açık mutfak mı kapalı mutfak mı günlük kullanımda daha iyi?
4. Küçük balkonu olan ev mi daha büyük salonsuz balkon mu?
5. Yeni projeden erken almak mı bitmiş daire almak mı daha güvenli?

## Kariyer
1. İlk işte yüksek maaş mı güçlü mentorluk mu daha önemli?
2. Küçük şirkette geniş sorumluluk mı büyük şirkette uzmanlaşma mı?
3. Remote iş için daha düşük maaş kabul etmeye değer mi?
4. Portföyde 3 kaliteli proje mi 10 küçük proje mi?
5. Mezuniyet öncesi backend'de derinleşmek mi full-stack ilerlemek mi?

## Diğer
1. Bir karar verirken çoğunluk görüşü fikrini ne kadar değiştirmeli?
2. Yeni bir hobiye ekipman almadan önce bir ay denemek mantıklı mı?
3. Arkadaş grubunda tatil planını oylamayla belirlemek daha adil mi?
4. Büyük bir alışverişten önce en az 24 saat bekleme kuralı işe yarar mı?
5. Bir hizmeti seçerken puan mı yorumların içeriği mi daha güvenilir?

Toplam: **13 kategori × 5 taslak = 65 başlangıç sorusu.**

---

# 7. Pilot topluluk listesi

V1'de topluluk oluşturma admin kontrollüdür. Aşağıdakiler ilk beta için **aday pilotlardır**; kurumlarla resmi bağlantı varmış gibi sunulmamalıdır.

| Pilot | Amaç | İlk içerik alanları | Moderasyon sahibi |
|---|---|---|---|
| Samsun Üniversitesi Öğrenci Kararları — resmî olmayan pilot | Yoğun, gerçek hayata bağlı öğrenci kararları | yemekhane, ulaşım, kampüs, dersler, etkinlikler | Beta başlamadan atanacak topluluk moderatörü + merkezi admin |
| Teknoloji Alım Kararları | Satın alma niyeti yüksek kararları test etmek | telefon, laptop, kulaklık, aksesuar | Merkezi moderasyon |
| Otomobil Kararları | Fotoğraf + fiyat + alternatif öneri akışını test etmek | ikinci el, donanım, fiyat, ekspertiz | Merkezi moderasyon |
| Oyun Topluluğu | Hızlı oy/yorum ve geri dönüş davranışını test etmek | oyun seçimi, ekipman, co-op, performans | Merkezi moderasyon |

## Pilot sorumlulukları

Her pilot için beta açılmadan önce şu alanlar doldurulur:
- `community_owner` veya merkezi admin sahibi
- en az 1 aktif moderatör
- başlangıçta 10–20 seed/demo konu taslağı
- hangi içeriklerin gerçek kullanıcı, hangilerinin seed olduğu ayrımı
- rapor SLA hedefi
- pilot başlangıç/bitiş tarihi
- gözlemlenecek ana metrikler

İlk beta aşamasında üniversite pilotu hiçbir kurumun resmî görüşünü temsil ediyor gibi sunulmaz.

---

# 8. Beta değerlendirme kartı

Her beta oturumunda aşağıdaki sonuçlar kaydedilir:

```text
Tarih:
Build/commit:
Katılımcı sayısı:
Gerçek / test hesap ayrımı:

Akışlar:
[ ] kayıt + doğrulama
[ ] onboarding
[ ] anket oluşturma
[ ] oy verme / değiştirme
[ ] yorum / cevap
[ ] alternatif öneri
[ ] kaydet / takip
[ ] bildirimden geri dönüş
[ ] arama
[ ] trend ekranları
[ ] topluluk
[ ] rapor
[ ] admin moderasyonu
[ ] admin öne çıkarma

Metrikler:
- first_contribution_rate_24h:
- first_vote_rate_24h:
- answered_poll_rate_24h:
- median_time_to_first_response:
- engaged_DAU:
- D7 (yalnızca olgun kohort):
- share_to_registration:
- share_to_contribution:

Kritik bulgular:
1.
2.
3.

Her bulgu için:
- severity
- owner
- issue linki
- yeniden üretme adımları
- hedef düzeltme aşaması
```

---

# 9. KV-07 tamamlanma kontrolü

- [x] İlk katkı metriğinde pay/payda/kohort tanımlı.
- [x] İlk oy metriğinde pay/payda/kohort tanımlı.
- [x] Yanıt alan soru metriğinde pay/payda ve 24 saat olgunlaşma kuralı tanımlı.
- [x] D7 retention kohortu ve henüz olgunlaşmamış kullanıcıların hariç tutulması tanımlı.
- [x] DAU/WAU aynı engaged event sözlüğüne bağlandı.
- [x] Share → kayıt ve share → katkı dönüşümleri attribution penceresiyle tanımlı.
- [x] 13 başlangıç kategorisi için 5'er özgün soru taslağı hazırlandı (65 toplam).
- [x] Demo/seed ile gerçek kullanıcı içeriğinin ayrımı tanımlı.
- [x] Pilot topluluk adayları ve moderasyon sorumluluk çerçevesi hazırlandı.
- [x] Beta kabul senaryoları ürünün ana akışlarını kapsıyor.

Bu dokümanın uygulanması sırasında event isimleri değiştirilirse analytics, admin dashboard ve test fixtureları aynı sürümde güncellenmelidir.
