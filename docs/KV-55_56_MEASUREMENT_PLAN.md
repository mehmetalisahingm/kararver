# #57 / #58 — Ölçüm hipotezi, deney planı ve teknik alt işler

> Sahip: **Utku** (@Utkuuzun14) · Tarih: 19 Ekim 2026 · Dayanak: [`MEHMET_POST_RELEASE_DESIGN.md`](./MEHMET_POST_RELEASE_DESIGN.md) (ürün kuralları), [`KV-07_PRODUCT_EVENTS_ACCEPTANCE_CONTENT.md`](./KV-07_PRODUCT_EVENTS_ACCEPTANCE_CONTENT.md) (olay ve D7 tanımları), [`KV-45_CLOSED_BETA.md`](./KV-45_CLOSED_BETA.md) (beta paydası)
>
> Bu belge #57'nin "ölçülebilir hipotez ve uygulama alt işleri" ve #58'in "başarı metriği, deney planı ve teknik alt işler" maddelerini somutlaştırır. **Çalışan özellik, deney sonucu ya da ürün kararı değildir.** Eşik değerleri "öneri" olarak işaretlidir; deney başlamadan Mehmet onaylar ve [§5 ön kayıt](#5-deney-ön-kayıt-şablonu) dondurulur. V1 kuralları (ilk giriş 20 / yayın 10 puan, trend formülleri, oy ağırlıkları) değişmez.

## 1. Ortak ölçüm kuralları

Bu kurallar #57 ve #58'in bütün metriklerine uygulanır. Bir metrik bunlardan birini ihlal ediyorsa rapora girmez.

| Kural | Tanım |
|---|---|
| **Uygun kullanıcı** | E-postası doğrulanmış, `ACTIVE`, silinmemiş/anonimleştirilmemiş hesap. Demo, QA (#47 dışlama listesi), seed, test fixture'ı, yönetici ve moderatör hesapları **hariç**. Ölçüm penceresinde yaptırım (BAN/SUSPEND) alan hesap paydadan çıkarılmaz, ayrıca raporlanır (aksi halde kötü davranış metrikten "temizlenir"). |
| **Olgun kohort** | Süreye bağlı metrik (D7, 14 gün) yalnız süresi dolmuş kohorttan hesaplanır. Olgun kohort yoksa değer `N/A`; hiçbir zaman `0%` yazılmaz. |
| **Kaynak** | Yalnız sunucuda yazılmış `domain_events` (outbox) ve DB durum tabloları. İstemci olayı, sayfa görüntüleme ya da yerel sayaç tek başına metrik üretmez. |
| **Tekillik** | Metrikler kullanıcı başına tekildir (aynı kullanıcı 10 katkı yapsa da "katkı yapan kullanıcı" payında 1). Olay tekrarı `domain_events.id` ile ayıklanır. |
| **Gizlilik** | Raporlar yalnız toplu sayı içerir; kullanıcı kimliği, kullanıcı adı, IP, cihaz bilgisi rapora girmez. Bir hücrede **10'dan az** kullanıcı varsa değer `<10` gösterilir (küçük hücre bastırma). Ham analiz dosyaları repo dışında, gitignore'lu klasörde tutulur (beta-report ile aynı kural). |
| **Atama** | Deney kolu `HMAC(experimentKey, userId) mod 100` ile **sunucuda**, kalıcı atanır. Kullanıcı kolunu değiştiremez; atama tablosu append-only'dir ve atama anı audit'e değil `domain_events`'e (`experiment.assigned`) yazılır. |
| **Dürüst güç** | Kapalı beta (≈40 kişi) istatistiksel deney için **yetersizdir** (§4). Beta yalnız güvenlik/kötüye kullanım ve kullanılabilirlik kanıtı üretir; "etkili/etkisiz" sonucu yayın sonrası, yeterli örneklemde çıkar. |

## 2. #57 — Güven puanı ve rozetler

### 2.1 Hipotez

**H57:** İsteğe bağlı "yardımcı katkı" rozeti görünür olduğunda, uygun kullanıcılar arasında **14 günde en az bir yardımcı katkı yapan kullanıcı oranı** artar; kaldırılan içerik oranı ve yeni kullanıcıların ilk katkı oranı kötüleşmez.

Rozet hiçbir yetki vermez: oy ağırlığı, sıralama, moderasyon yetkisi ve limit değişmez (tasarım belgesi kuralı). Bu yüzden hipotez yalnız **davranış** değişikliğini ölçer.

### 2.2 Metrikler

| Tür | Metrik | Pay | Payda | Kaynak |
|---|---|---|---|---|
| **Birincil** | 14 günlük yardımcı katkı oranı | Atama sonrası 14 gün içinde ≥1 **onaylanmış yardımcı katkı** yapan uygun kullanıcı | Atamadan 14 günü dolmuş uygun kullanıcı | `badge.contribution.qualified` (yeni, S57-2) |
| Koruyucu | Kaldırılan içerik oranı | Kolun içeriklerinden `moderation.applied` (REMOVE/HIDE) alanlar | Kolun yayımladığı içerik | `poll.created`, `comment.created`, `moderation.applied` |
| Koruyucu | Yeni kullanıcı ilk katkı oranı | Kayıttan 7 gün içinde ilk oy/yorum/yayın yapan yeni kullanıcı | 7 günü dolmuş yeni kayıt | `user.registered`, `vote.submitted`, `comment.created`, `poll.created` |
| Koruyucu | Halka/manipülasyon sinyali | Halka kuralına (S57-5) takılan kazanım denemesi | Toplam kazanım denemesi | `badge.contribution.held` (yeni) |
| Koruyucu | İtiraz oranı | Açılan itiraz | Verilen + geri alınan kazanım | `badge.appeal.opened` (yeni) |
| Bilgi | Rozet görünürlüğünü kapatan kullanıcı | Profil tercihinde rozeti gizleyen | Rozet kazanmış kullanıcı | tercih tablosu |

"Yardımcı katkı" tanımı (kazanım kuralı) tasarım belgesindeki gibidir: bağımsız kullanıcıların değerlendirmesi + moderasyon sonrası uygunluk; kendi kendine değerlendirme ve eş hesap halkası sayılmaz. Sayısal eşik (kaç bağımsız değerlendirme, kaç saat bekleme) **açık karar K1**.

### 2.3 Durdurma koşulları (öneri)

Herhangi biri tetiklenirse bayrak kapatılır, rozet görünümü durur, kazanımlar korunur ve olay incelenir:

1. Deney kolunda kaldırılan içerik oranı kontrol koluna göre **mutlak +2 puan** veya **göreli %25** yükselirse (hangisi önce).
2. Yeni kullanıcı ilk katkı oranı kontrol koluna göre **göreli %15** düşerse.
3. Halka sinyali bir haftada toplam kazanım denemesinin **%5'ini** aşarsa.
4. Herhangi bir P0/P1 güvenlik bulgusu (kazanımın tekrarlanması, başkası adına kazanım, rozetin yetki sızdırması).

### 2.4 Deney tasarımı

| Aşama | Ne | Kimde | Çıkış koşulu |
|---|---|---|---|
| **Faz 0: Gölge** | Kazanım kuralı arka planda hesaplanır, **hiç gösterilmez**. Halka/manipülasyon kurallarının yanlış pozitif oranı ölçülür. | Tüm uygun kullanıcılar (beta dahil) | 14 gün; yanlış pozitif örnekleri moderatör incelemesinde ≤%10; P0/P1 yok |
| **Faz 1: Pilot** | Bayrak açık, %50 deney / %50 kontrol, rozet yalnız profilde ve isteğe bağlı. | Yayın sonrası uygun kullanıcılar | Ön kayıttaki örneklem (§4) dolana kadar; en az 14 gün, en çok 8 hafta |
| **Faz 2: Karar** | Birincil metrik + koruyucular raporlanır; Mehmet "genişlet / değiştir / kapat" kararını verir. | — | Karar issue'ya yazılır |

Erken bakış: birincil metrik için ara analiz **yapılmaz**. Koruyucular günlük izlenir (durdurma için).

### 2.5 Teknik alt işler

Her biri ayrı küçük PR. Yetki yalnız backend RBAC; her veri değiştiren işlemde gerekçe, requestId ve append-only audit.

| ID | İş | Kabul kriteri | Bağımlılık |
|---|---|---|---|
| S57-1 | Sürümlü sözleşme: rozet, kazanım, itiraz, deney ataması (contracts + migration) | `ruleVersion` her kazanım satırında; `user + contributionId + ruleVersion` benzersiz | — |
| S57-2 | Olay tüketicisi: `comment.created` / değerlendirme / `moderation.applied` → kazanım veya geri alma | Aynı olay iki kez işlenince tek kazanım; kaldırılan katkının kazanımı telafi kaydıyla geri alınır, diğerleri korunur | S57-1 |
| S57-3 | Halka ve kendi kendine değerlendirme kuralları (gölge modda) | Karşılıklı değerlendirme çifti ve ≥3'lü kapalı halka kazanım vermez, `held` olur; ortak IP tek başına ceza sebebi değildir | S57-2 |
| S57-4 | Kullanıcı ekranı: "neden kazandım/kaybettim" açıklaması + profil görünürlük tercihi | Kullanıcı yalnız kendi kayıtlarını görür; tercih kapatılınca rozet herkese gizli | S57-2 |
| S57-5 | İtiraz ve yönetim incelemesi | Kararı veren moderatör kendi itirazının tek inceleyicisi olamaz; her karar audit'te; RBAC negatif testleri | S57-2, #185 |
| S57-6 | Deney ataması ve bayrak (`trustBadges`, varsayılan kapalı) | HMAC ataması deterministik ve kalıcı; bayrak kapalıyken hiçbir rozet görünmez; acil kapatma #186 anahtarına bağlı | S57-1 |
| S57-7 | Ölçüm raporu (salt okuma script, beta-report deseni) | §1 dışlamaları, olgun kohort, `<10` bastırma testli; çıktıda kimlik yok | S57-2, S57-6 |
| S57-8 | Güvenlik/abuse testleri | Tekrar, yarış (eşzamanlı aynı olay), silinen hesap, anonimleştirme sonrası kazanım, halka, rozetin yetki/oy ağırlığına etkisizliği | Hepsi |

## 3. #58 — Katkı görevleri ve günlük/haftalık akış

### 3.1 Hipotez

**H58:** İsteğe bağlı günlük/haftalık katkı görevleri sunulduğunda, görevlere katılan kullanıcıların **olgun D7 geri dönüş oranı** ve **yardımcı katkı oranı** artar; spam/kaldırma oranı, bildirim aboneliğinden çıkış ve yeni kullanıcı tamamlaması kötüleşmez.

Katılım isteğe bağlı olduğundan "katılanlar vs katılmayanlar" karşılaştırması **seçim yanlılığı** taşır. Bu yüzden karşılaştırma, görevlerin **sunulduğu** kol ile **sunulmadığı** kol arasındadır (intention-to-treat); katılanların sonuçları yalnız ikincil olarak raporlanır.

### 3.2 Metrikler

| Tür | Metrik | Pay | Payda | Kaynak |
|---|---|---|---|---|
| **Birincil** | Olgun D7 geri dönüş (ITT) | Atamadan sonraki 7.–13. günlerde en az bir oturumu/olayı olan kullanıcı | Atamadan 14 günü dolmuş uygun kullanıcı (kol bazında) | KV-07 §4.6 tanımı |
| İkincil | Yardımcı katkı oranı (ITT) | 14 günde ≥1 yardımcı katkı | Aynı payda | #57 S57-2 olayı (hazırsa), yoksa `comment.created` − kaldırılan |
| İkincil | Görev katılımı | Görevleri açan kullanıcı | Deney kolu | `task.optin.changed` (yeni) |
| Koruyucu | Spam/kaldırma oranı | Kolun içeriklerinden kaldırılan | Kolun içeriği | `moderation.applied` |
| Koruyucu | Bildirimden çıkış | Görev hatırlatması aldıktan sonra 7 gün içinde bildirimi kapatan | Hatırlatma alan | KV-21 tercih değişiklikleri |
| Koruyucu | Yeni kullanıcı tamamlaması | §2.2'deki "ilk katkı" metriği | — | — |
| Koruyucu | Çoklu hesap şüphesi | İncelemeye düşen tamamlama | Toplam tamamlama | `task.completion.held` (yeni) |

### 3.3 Durdurma koşulları (öneri)

1. Spam/kaldırma oranı kontrol koluna göre **mutlak +2 puan** veya **göreli %25** yükselirse.
2. Bildirimden çıkış oranı kontrol koluna göre **göreli %30** yükselirse.
3. Yeni kullanıcı ilk katkı oranı **göreli %15** düşerse.
4. Aynı `user + taskVersion + period` için ikinci tamamlama/ödül görülürse (P0, anında durdur).

### 3.4 Deney tasarımı

Aynı fazlar (#57 §2.4). Farklar:

- **Ön koşul:** #57 Faz 1'den en az bir hafta sonra başlar ve **aynı kullanıcı aynı anda iki deneyde olmaz** (çapraz etkileşim). Atama, #57 kontrol kolundaki kullanıcılardan yapılır ya da #57 kapandıktan sonra yeni atama yapılır. Hangisi seçileceği **açık karar K4**.
- **Dönem:** Kullanıcının kayıtlı saat dilimiyle hesaplanan, sunucuda sabitlenmiş gün/hafta. Dönem tanımı deney başlamadan yayımlanır; dönem içinde saat dilimi değişirse mevcut dönem eski dilimle kapanır.
- **İlk dilim ödülsüzdür:** yalnız tamamlama işareti ve görünür ilerleme; puan defterine bağlanmaz (tasarım belgesi kuralı). Puan bağlantısı ayrı bir karar ve ayrı deneydir.

### 3.5 Teknik alt işler

| ID | İş | Kabul kriteri | Bağımlılık |
|---|---|---|---|
| S58-1 | Görev kataloğu ve dönem sözleşmesi (`taskVersion`, dönem tanımı, saat dilimi kuralı) | Katalog sürümlü; dönem sınırı testleri (gece yarısı, DST yok ama dilim değişimi var) | — |
| S58-2 | Atomik tamamlama/iptal kaydı | `user + taskVersion + period` benzersiz; uygun sunucu olayından doğrulanır; istemci sayacı/çift gönderim tamamlama üretmez; katkı kaldırılırsa tamamlama telafi edilir | S58-1, S57-2 olay deseni |
| S58-3 | Katılım ve hatırlatma tercihleri (ayrı ayrı) | İkisi de varsayılan kapalı; kapatmak hiçbir hakkı/puanı düşürmez; hatırlatma ayrı bir bildirim tipidir, KV-34 tip tercihiyle kapatılabilir (zorunlu tiplere eklenmez), günde en çok 1 | KV-21, KV-34 |
| S58-4 | Profil/akış görev kartı | Seri cezası, "kaybediyorsun" dili, geri sayım baskısı yok; erişilebilir | S58-2 |
| S58-5 | Çoklu hesap ve kötüye kullanım kuralları | Kendi içeriği, silinen/ihlal edilen katkı ve eş hesap tamamlama saymaz; şüphe incelemeye gider; ortak IP tek başına ceza değil | S58-2, S57-3 |
| S58-6 | Deney ataması ve bayrak (`contributionTasks`, varsayılan kapalı) | #57 ile çakışmayan atama (K4); acil kapatma | S57-6 |
| S58-7 | Ölçüm raporu | ITT ve katılımcı analizleri ayrı; olgun D7; `<10` bastırma | S58-2, S58-6 |
| S58-8 | Güvenlik/abuse testleri | Dönem sınırı yarışı, saat dilimi değiştirerek çift tamamlama, eşzamanlı tamamlama, silinen hesap, bildirim tercihi kapalıyken hatırlatma gitmemesi | Hepsi |

## 4. Örneklem büyüklüğü (neden beta yetmez)

İki oran karşılaştırması, α = 0,05 (iki yönlü), güç = %80:

| Varsayılan taban oran | Saptanmak istenen fark | Kol başına gereken kullanıcı |
|---|---|---|
| %20 | +5 puan (%20 → %25) | ≈ 1 100 |
| %20 | +10 puan (%20 → %30) | ≈ 290 |
| %30 (D7) | +5 puan | ≈ 1 380 |

Kapalı beta ≈ 40 kişidir; en iyimser satırda bile gereken sayının %15'inin altındadır. Bu yüzden:

- Beta'da yalnız **Faz 0 (gölge)** çalışır: kuralların doğruluğu, yanlış pozitifler, güvenlik testleri.
- Faz 1, yayın sonrası **taban oran beta verisinden ölçüldükten sonra** gerçek örneklem hesabıyla ön kayda yazılır.
- Örneklem dolmadan "işe yaradı" ya da "yaramadı" denmez; durdurma yalnız koruyucu metriklerle olur.

## 5. Deney ön kayıt şablonu

Her deney başlamadan bu tablo doldurulur, issue'ya yorum olarak eklenir ve **değiştirilmez** (değişiklik = yeni deney).

| Alan | Değer |
|---|---|
| Deney anahtarı / bayrak | `trustBadges-v1` / `contributionTasks-v1` |
| Hipotez | H57 / H58 (bu belge) |
| Birincil metrik ve tanım sürümü | |
| Koruyucu metrikler ve durdurma eşikleri | |
| Taban oran (kaynak, tarih) | |
| Saptanacak en küçük fark | |
| Kol başına örneklem ve hesap | |
| Atama oranı ve yöntemi | HMAC, %50/%50 |
| Başlangıç / en geç bitiş | |
| Dışlamalar | §1 |
| Karar sahibi | Mehmet |
| Analiz sahibi | Utku |

## 6. Açık kararlar (Mehmet)

| No | Karar | Etkilediği |
|---|---|---|
| K1 | "Yardımcı katkı" eşiği: kaç bağımsız değerlendirme, kaç saat bekleme | S57-2, birincil metrik |
| K2 | §2.3 ve §3.3 durdurma eşiklerinin onayı ya da değişikliği | Ön kayıt |
| K3 | Faz 1 pilotun kullanıcı oranı (%50/%50 yerine daha küçük deney kolu?) | Örneklem süresi |
| K4 | #58'in #57 ile çakışmama yöntemi (ayrık kol mu, ardışık mı) | S58-6 |
| K5 | Görevlerin ileride puan defterine bağlanıp bağlanmayacağı (ekonomi kararı) | #58 ikinci dilim |

## 7. Kapanış sınırı

Bu belge #57'nin 3. ve #58'in 3. kabul maddesinin **tanım** kısmını karşılar. Issue'lar, gerçek beta verisi, §6 kararları ve #54 yayın bağımlılığı tamamlanmadan kapanmaz. Alt işler (S57-*, S58-*) ayrı issue olarak açılmadan uygulamaya başlanmaz.
