# KV-37 — Spam uyarı puanı, operatör incelemesi ve yanlış pozitif itirazı: karar listesi (#183)

> **Durum: karar bekliyor. Bu belgede kod, migration veya sözleşme değişikliği yoktur.** #183'ün kalan son işi budur; ürün ve hukuk kararları verilmeden uygulanmamalıdır. Sahipler: ürün **Mehmet**, itiraz kanalı ve admin arayüzü **Utku**, KVKK değerlendirmesi **hukuk**. Uygulama Mert'te.
>
> İlke (mevcut, [KV-37 §7](./KV-37_BULK_MODERATION.md)): **otomatik kalıcı ban yoktur.** Aşağıdaki öneriler bu ilkeyi bir adım ileri taşır: V1'de puan hiçbir kullanıcıya otomatik bir etki yapmaz.

## 1. Bugün elimizde olanlar

| Var | Yok |
|---|---|
| Yayın bekleme süresi, günlük yayın sınırı, aynı başlıkla açık gönderi engeli ([KV-20](./KV-20_COOLDOWN_FEED.md)) | Tekrarlı/spam içerik **puanı** |
| Yorum hız sınırı, genel hız sınırı | Puandan beslenen **operatör kuyruğu** |
| Görsel hash ve algısal hash kontrolü ([MEDIA_MODERATION](./MEDIA_MODERATION.md)) | Kullanıcının moderasyon/yaptırım kararına **itiraz kanalı** ([KV-04 açık madde #1](./KV-04_ROLES_EVENTS.md), Utku'ya ertelenmişti) |
| Yaptırımlar (`WARNING`, `RESTRICT_*`, `SUSPEND`, `BAN`), rapor kuyruğu, kullanıcı birleşik geçmişi ([KV-33 §13](./KV-33_ADMIN_USERS.md)) | Yaptırım/itiraz **bildirim türü** ([KV-04 açık madde #5](./KV-04_ROLES_EVENTS.md)) |
| Karar geri alma: toplu, tekil ve ikinci onay ([KV-37 §5, §8, §10](./KV-37_BULK_MODERATION.md)) | |
| İtiraz kalıbı örneği: [KV-54 §4](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md) (14 gün, bir kez, farklı karar verici) | |

## 2. Kararlar

Her satırda **önerilen** seçenek ve gerekçesi vardır. Kabul için "Karar" sütununa tarih ve karar veren yazılır; farklı seçilirse yeni değer yazılır.

### A. Puan

| # | Karar | Seçenekler | Öneri | Karar |
|---|---|---|---|---|
| 1 | Puan hangi sinyallerden çıkar? | Kural tabanlı ve açıklanabilir / istatistiksel-ML | **Kural tabanlı.** Sinyaller: aynı veya benzer metni tekrar gönderme, yorum patlaması, hesap yaşı, aynı görsel hash'i, hakkındaki raporların işleme dönüşme oranı, kısa sürede çok içeriğin gizlenmesi. **IP ve cihaz bilgisi kullanılmaz** (veri minimizasyonu, [KV-33 §13.3](./KV-33_ADMIN_USERS.md)). Ağırlıklar ayar olarak tutulur. Beta örneklemi ML için yetersizdir. | ☐ |
| 2 | Puan neye ait, ne zaman hesaplanır? | Hesap / içerik; istekte / worker'da | **Hesap başına**, olaylar üzerinden **worker** hesaplar (istek süresini etkilemez). **30 günlük kayan pencere:** eski sinyal puandan düşer. | ☐ |
| 3 | Eşik aşılınca ne olur? | (a) yalnız operatör kuyruğu, (b) içerik otomatik gizlenir, (c) yayın sınırı sıkılaşır | **(a)** V1'de **yalnız kuyruğa düşer.** Otomatik gizleme, yaptırım veya sınır değişikliği yok. İnsan kararı olmadan kullanıcıya hiçbir etkisi olmaz; bu aynı zamanda KVKK'daki yalnız otomatik işlemeye dayalı karar riskini ortadan kaldırır (bkz. 13). | ☐ |
| 4 | Kullanıcı puanı veya sinyalleri görür mü? | Gösterilir / gösterilmez | **Gösterilmez.** Sinyal ve eşik açıklanırsa aşılması kolaylaşır. İnsan karar verince **gerekçe** kullanıcıya yazılır (mevcut moderasyon/yaptırım bildirimi). | ☐ |

### B. Operatör incelemesi

| # | Karar | Öneri | Karar |
|---|---|---|---|
| 5 | Kim inceler? | **Moderatör** kendi topluluğunda, **ADMIN+** hepsinde (mevcut kapsam kuralı). Hesap düzeyi (topluluğa bağlı olmayan) kayıtlar yalnız ADMIN+. | ☐ |
| 6 | Operatör hangi kararları verebilir? | **"Spam değil", uyarı (`WARNING`), içeriği gizleme.** Kısıtlama, askı, ban yalnız ADMIN+ (mevcut yaptırım kuralı, ikinci onay gerekirse [KV-37 §8](./KV-37_BULK_MODERATION.md) mantığı). Her karar gerekçeli ve audit'li. | ☐ |
| 7 | Bekleme süresi ve sıralama | Beta için **48 saat hedefi**, en yüksek puan önce. Süre aşımı yalnız panelde görünür; **otomatik işlem yok.** | ☐ |
| 8 | "Spam değil" kararı ne yapar? | **Puanı sıfırlar**; aynı sinyalle **30 gün** yeniden kuyruğa düşmez. Karar audit'e yazılır ve eşik kalibrasyonunda yanlış pozitif olarak sayılır. | ☐ |

### C. Yanlış pozitif itirazı

| # | Karar | Öneri | Karar |
|---|---|---|---|
| 9 | Hangi kararlara itiraz edilir? | Spam gerekçesiyle verilen **uyarı, içerik gizleme ve kısıt** (oturumlu kullanıcı). **Askı ve ban** itirazı V1'de **destek e-postası** ile yürür: kullanıcı oturum açamadığı için oturumsuz akış ayrı bir iştir (KV-04 açık madde #1). | ☐ |
| 10 | İtiraz kuralları | [KV-54 kalıbı](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md): karar tarihinden itibaren **14 gün** içinde **bir kez**, gerekçeli; **ilk kararı veren kişiden farklı** biri inceler; sonuç kesindir. **Açık soru:** tek ADMIN varsa ikinci karar verici kim (dış inceleme mi, süre uzatma mı)? | ☐ |
| 11 | İtiraz kabul edilirse | İçerik mevcut **geri alma altyapısıyla** geri açılır ([KV-37 §10](./KV-37_BULK_MODERATION.md)). Uyarı kaydı **silinmez**, "iptal edildi" olarak işaretlenir (denetim izi). Puan düzeltilir. | ☐ |
| 12 | Kullanıcı nasıl bilgilendirilir? | İtiraz alındı / sonuçlandı için **yeni bildirim türü** (minör sözleşme değişikliği). KV-04 açık madde #5 ile aynı iş. | ☐ |

### D. Veri, hukuk ve yayın

| # | Karar | Öneri | Karar |
|---|---|---|---|
| 13 | Puan ve sinyaller kişisel veri/profilleme sayılır mı? Saklama? | **Hukuk değerlendirmesi gerekir.** Öneri: **90 gün** saklama, **KVKK veri paketine dahil**, hesap anonimleştirilince temizlenir. İnsan kararı olmadan etki olmadığından (3) otomatik karar itirazı hakkı doğmaz; yine de hukuk onaylamalı. **Bu karar canlıya çıkışı bloklar** (gölge modda puan saklanıyorsa dahil). | ☐ |
| 14 | Topluluk sahibi puanı görür mü? | **Hayır.** Yalnız operatörler görür (sahip kullanıcıyı profilleyemez). | ☐ |
| 15 | Yayına alma | **Gölge mod önce:** puan hesaplanır, **hiçbir kullanıcıya etkisi yoktur**, yalnız ADMIN görür. ~2 hafta sonra eşik gerçek veriye göre ayarlanır, sonra operatör kuyruğu **bayrakla** (varsayılan kapalı) açılır. 40 kişilik pilotta istatistik anlamsız olacağından ilk eşikler elle belirlenir. | ☐ |

## 3. Bağımlılıklar ve dilimleme

| Dilim | Gerekli kararlar | Not |
|---|---|---|
| **S1 — Gölge mod:** sinyal toplama + puan hesabı + yalnız-ADMIN görünümü, bayrak arkasında | 1, 2, 3, 15, **13** (saklama) | Kullanıcıya hiçbir etkisi yok. Bayrak varsayılan kapalı. |
| **S2 — Operatör kuyruğu:** eşik aşan hesaplar, kararlar (6, 8), SLA göstergesi | S1 + 5–8 | Mevcut yaptırım ve moderasyon yolundan geçer; yeni yazma yolu açmaz. |
| **S3 — İtiraz kanalı:** oturumlu kullanıcı için itiraz, farklı inceleyici, bildirim | 9–12 | Büyük kısmı spam puanından bağımsız gerekli (KV-04 açık madde #1). Utku ile ortak. |
| **S4 — Kalibrasyon:** yanlış pozitif oranı raporu, eşik önerisi | S2'den veri | İlk eşik güncellemesi yalnız ADMIN kararıyla. |

## 4. Kapsam dışı (bu belge veya V1)

- Otomatik gizleme, yaptırım veya yayın sınırı değişikliği (3).
- ML tabanlı puan (1).
- Oturumsuz (askı/ban) kullanıcı itiraz akışı (9) ve dış inceleme (10).
- Topluluk sahibine puan görünürlüğü (14).

## 5. Kabul ölçütü

Kararlar yukarıdaki tabloya işlendiğinde ve 13 için hukuk görüşü alındığında #183'ün kalan işi dilimlere (S1–S4) ayrılıp sırayla uygulanır. Bu belge birleştirilince **#183 kapanmaz**; S1–S3 uygulanıp doğrulanınca kapatılabilir.
