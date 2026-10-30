# #290 — İçerik/telif şikâyeti, kaldırma ve yaptırıma itiraz: mevcut durum ve karar listesi

> **Durum: karar bekliyor. Bu belgede kod, migration veya sözleşme değişikliği yoktur.** Sahip: Mert (uygulama). Hukuki kapsam, süre ve metin kararları **#285** ve hukuk uzmanından gelir; ürün/işletmeci kararları Mehmet'te. Bu belge **hukuki değerlendirme değildir**: mevzuat hükmü, süre veya yetkili kurum adı uydurmaz; yalnız kodda ne var, ne yok ve hangi karar olmadan hangi iş yapılamaz onu kaydeder. Üst kayıt: #284. Bağlı: #183 (spam puanı karar 13, itiraz S3), #185 (audit), #181 (silme/saklama), #52 (cache/OG), #46, #53.

## 1. Bugün elimizde olanlar (main `9f300cf` itibarıyla, kodla doğrulandı)

| Var | Nerede |
|---|---|
| Oturumlu kullanıcı için içerik/kullanıcı raporu; neden listesinde `COPYRIGHT` ve `PERSONAL_INFO` var; hedef başına kullanıcı başına tek rapor | `reports.create` (`auth: "user"`), `packages/contracts/src/domains/moderation.ts` |
| Rapor kuyruğu, gerekçeli moderasyon kararı (HIDE/REMOVE/RESTORE/LOCK…), append-only `moderation_actions`, audit | KV-24, KV-37 |
| Toplu işlemde ikinci onay, kararın güvenli geri alınması | #252, #254 |
| Yaptırımlar (`WARNING`, `RESTRICT_*`, `SUSPEND`, `BAN`) ve kullanıcıya **zorunlu** bildirim (`MODERATION_APPLIED`, `SANCTION_APPLIED`, kapatılamaz) | KV-33, KV-21 |
| Hesap düzeyinde saklama yükümlülüğü (`legal_hold`): silmeyi engeller | `account-erasure` (#181) |
| Kaldırılan içeriğin feed/search/OG'den düşmesinin HTTP kabulü | #258 (`KV-25_SHARE_SEO`) |
| Spam puanı gölge modu, **kapalı bayrakla**; karar 13 (hukuk) kapanmadan açılmaz | #269 |

## 2. Yok olanlar (#290 kabul maddeleriyle eşleşir)

| Eksik | #290 maddesi |
|---|---|
| Üyeliği olmayan, hesabı kısıtlı veya kaldırılmış kişi için başvuru/iletişim yolu. Mevcut rapor oturum ister; askı/ban kullanıcısı oturum açamaz (KV-04 açık madde #1) | 1 |
| Başvuru kategorileri (telif/kişilik hakkı, hukuka aykırı içerik, acil çocuk güvenliği, resmi karar), başvuranın yetkisini/kaynağı doğrulama, süre ve eskalasyon, kayıt politikası | 2 |
| Başvuru alındı/durum/karar bildirimleri ve yaptırım/karara **itiraz**, farklı yetkili insan incelemesi (`NotificationType`'ta itiraz türü yok) | 3 |
| Raporlayanın kimliğinin hedef kullanıcıya **sızmadığının** testle kanıtı (moderasyon/yaptırım bildirim adaptörlerinde raporlayan alanı yok, kodla doğrulandı; ancak bütün kullanıcı yüzeyleri için bunu kanıtlayan bir test yok) | 3 |
| **İçerik düzeyinde** legal hold (yalnız hesap düzeyinde var): gerekçeli, süreli, audit'li, otomatik süresiz değil | 4 |
| Kaldırmanın DB, private/public medya, cache/CDN/OG ve arama kopyalarında tutarlılığının gerçek staging kanıtı (HTTP kabulü var, gerçek CDN/cache kanıtı yok) | 4 |
| Yaptırım itirazı (S3, #183 §2.C) | 5 |
| Şikâyet flood'u / kötü niyetli talep / yetkisiz yönetici negatif testleri; acil talebin rate limit yüzünden kaybolmaması | 6 |
| Sentetik içerikle gerçek staging kaldırma + itiraz kanıtı | 7 |

## 3. Karar listesi

Her satırda **öneri** vardır; öneri hukuki görüş değildir. Karar sütununa karar veren ve tarih yazılır.

### A. Kapsam ve yasallık (#285, hukuk)

| # | Karar | Öneri | Sahip | Karar |
|---|---|---|---|---|
| 1 | KararVer bu şikâyet kategorilerinin hangileri için yasal bir bildirim/kaldırma usulüne tabidir ve her biri için hangi bilgi/kanıt zorunludur? | Kategori listesini ve zorunlu alanları hukuk belirler; uygulama alanları ayara bağlanmaz, sözleşmede sabit enum olur. | Hukuk / #285 | ☐ |
| 2 | Hangi süreler ve eskalasyon adımları geçerlidir? | **Sabit SLA uydurulmaz.** Belgede "hukuk kararı: …" yazan süre uygulamaya girer; o zamana kadar panelde yalnız yaş göstergesi (süre aşımı otomatik işlem yapmaz). | Hukuk | ☐ |
| 3 | Resmi/adli karar başvurusunun kaynağı nasıl doğrulanır (kurum yazısı, mahkeme kararı, e-imza)? | İnsan doğrulaması; belge uygulamada **saklanmaz**, yalnız maskeli karar kaydı (kategori, tarih, doğrulayan, sonuç) tutulur. | Hukuk + Mehmet | ☐ |
| 4 | Acil çocuk güvenliği için ayrı, hızlı kanal ve içeriğin kanıt olarak saklanması gerekir mi? | Evet kabul edilirse ayrı kategori + operatör uyarısı + içeriği **silmeden** erişim kısıtı (HIDE) ve saklama hukuk kararına göre. | Hukuk + Mehmet | ☐ |
| 5 | Mevzuattaki yaş/çocuk koruma yükümlülükleri bu akışı etkiler mi (#289)? | #289 sonucuna bağlı; bu akışın kapsamı o karardan sonra kesinleşir. | #289 (Faruk) | ☐ |

### B. Başvuru kanalı (Mert, Utku, Ümit)

| # | Karar | Öneri | Sahip | Karar |
|---|---|---|---|---|
| 6 | Oturumsuz başvuru nasıl alınır? | **V1: e-posta formu yerine yapılandırılmış form** (kategori, bağlantı, açıklama, iletişim e-postası), CAPTCHA'sız ve bot koruması **rate limit + tek kullanımlık e-posta doğrulaması** ile. Form verisi yalnız gerekli alanlardır, IP saklanmaz. Karar 6 verilmeden form yazılmaz. | Mehmet + Utku | ☐ |
| 7 | Başvuran kimliği hedef kullanıcıya hiç gösterilir mi? | **Hayır.** Hedef yalnız kararı ve gerekçeyi görür; başvuran ve eki yalnız yetkili yöneticide. Test: hiçbir kullanıcı yüzeyinde `reporterId`/e-posta yok. | Mert | ☐ |
| 8 | Başvuru kaydı saklama süresi | Hukuk belirler; öneri: karar + itiraz süresi bitince maskeleme, silme değil denetim izi. #181 saklama kararıyla birlikte ele alınır. | Hukuk | ☐ |

### C. Kaldırma, saklama ve itiraz

| # | Karar | Öneri | Sahip | Karar |
|---|---|---|---|---|
| 9 | Kaldırma = HIDE mi REMOVE mi? | Başvuruda **HIDE** (geri alınabilir, kanıt korunur); kesin karardan sonra REMOVE. Mevcut geri alma altyapısı (#254) kullanılır. | Mert | ☐ |
| 10 | İçerik düzeyinde legal hold | Yeni tablo/alan: neden, karar veren, başlangıç, **bitiş zorunlu**, audit. Hold varken içerik silme/anonimleştirme/yedek temizliği engellenir. Süre dolunca otomatik kalkar, süresiz hold yok. | Mert + Utku | ☐ |
| 11 | Hedef kullanıcı nasıl bilgilendirilir? | Mevcut zorunlu `MODERATION_APPLIED` bildirimi + yeni minör bildirim türleri (`REPORT_*`, `APPEAL_*`, KV-04 açık madde #5). Telif başvurusunda içerik sahibine karşı-bildirim hakkı gerekiyorsa karar 1'den gelir. | Mert + Utku | ☐ |
| 12 | İtiraz kuralları | #183 karar 9–12 ile **aynı iskelet** (14 gün, bir kez, farklı karar verici, sonuç kesin) kullanılır; telif/resmi karar kategorilerinde süre ve merci hukukta farklıysa karar 2'den gelir. Tek ADMIN iken ikinci karar verici sorusu (#183 karar 10) açıktır. | Mehmet + Utku | ☐ |
| 13 | Otomatik işlem | Hiçbir başvuru **otomatik** kaldırma/yaptırım üretmez; insan kararı olmadan etki yoktur (#183 karar 3 ile tutarlı). | Mehmet | ☐ |

## 4. Dilimleme ve bağımlılıklar

| Dilim | İçerik | Gerekli kararlar | Not |
|---|---|---|---|
| **L0 — Test ve doğrulama (karar gerektirmez)** | Raporlayan kimliğinin hiçbir kullanıcı yüzeyinde görünmediğini ve kaldırılan içeriğin tüm yüzeylerden düştüğünü kanıtlayan negatif/pozitif testler; flood ve yetkisiz yönetici negatifleri | — | Mevcut davranışı ölçer, yenisini eklemez. |
| **L1 — Oturumlu başvuru kategorileri** | `reports.create` kategorilerinin genişletilmesi, operatör görünümü | 1, 2, 7 | Sözleşme minör değişiklik; Utku RBAC. |
| **L2 — Oturumsuz başvuru** | Form, e-posta doğrulama, rate limit, kayıt | 1–3, 6, 8 | Ümit erişilebilir ekran. |
| **L3 — İçerik legal hold** | Tablo, kurallar, silme/yedek engelleri | 10 + hukuk (saklama) | #181 ile ortak saklama kararı. |
| **L4 — Bildirim ve itiraz** | `APPEAL_*` bildirimleri, itiraz kanalı | 11, 12 | #183 S3 ile tek iş olarak yapılır; yeniden yazılmaz. |
| **L5 — Gerçek staging kanıtı** | Sentetik içerikle kaldırma + itiraz + cache/OG/CDN | L1–L4 + #46/#52 pencereleri | Public kanıtta başvuru/PII yok. |

L0 bugün başlayabilir. L1 ve sonrası **kararlar işlenmeden uygulanmaz**; yasallık kararı geliştirici tarafından verilmez.

## 5. Kabul ölçütü

Kararlar tabloya işlendiğinde ve #285'ten doğrulanmış kapsam/süre geldiğinde #290 dilimlere ayrılıp sırayla uygulanır. Bu belge birleşince **#290 kapanmaz**: kapanış, ilgili karar + uygulama/operasyon çıktısı + aynı aday sürümde gerçek staging kabul kanıtı ister; yayın GO'su yalnız Mehmet'tedir.
