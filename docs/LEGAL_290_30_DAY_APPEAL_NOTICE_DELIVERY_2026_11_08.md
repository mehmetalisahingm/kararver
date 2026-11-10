# KararVer V1 — Ret bildirimi tesliminden itibaren 30 günlük itiraz başvuru süresi

**İşletmeci kararı: Mehmet · 8 Kasım 2026.** KararVer V1'de ön moderasyon sonucu reddedilen anket için **ürün içi moderasyon itirazı, ret bildirimi kullanıcıya ulaştığı tarihten itibaren 30 gün içinde** yapılabilir. Ret kararı/olay kuyruğu oluşturulması tek başına süreyi başlatmaz. Herkese açık, hassas veriye aykırı veya silinmiş anket yanlışlıkla geri yayımlanamaz. Önceki puan kararı: başvuruda -10, moderatör reddinde +10 **tek sefer**, hatalı ret itirazla düzeltilirse aynı anket ücretsiz yayımlanır ve önceki iade kullanıcıda kalır (#333/#336).

**Kapsam ve terimlerin teknik tanımı:** KararVer V1'in uygulama içi zorunlu `MODERATION_APPLIED` bildirimi, hedef hesabın **kendi özel bildirim kutusuna kalıcı DB transaction commit'iyle eklendiğinde** “teslim edildi” kabul edilir. `notifications.created_at` domain olayının zamanı olabilir; `notifications.read_at` kullanıcının daha sonra okuyup işaretlediği andır. İkisi de **teslim zamanı değildir**. İleride gerçek e-posta tesliminden süre başlatılacaksa yalnız mailin kuyruğa yazılması/SMTP `accepted` olması yeterli kanıt sayılmaz; ayrı sağlayıcı teslim kanıtı ve kullanıcının tercih ettiği kanala ilişkin işletmeci/hukuk kararı gerekir.

**Zaman hesabı:** 30×24 saat = 720 saat, UTC teslim anından itibaren. Tam son milisaniyeye eşit başvurular **süresinde**; son tarihten 1 ms sonra **geç**. Türkiye saati gösteriminde UTC'den uygun yerel tarih-saat kullanılacak. Süre **kullanıcı itirazı açtığı anda** değerlendirilir; moderatörün haftalar sonra karar vermesi süresinde yapılmış itirazı geçersiz kılmaz.

## Uygulama adayı / mevcut limitler

- **Yeni DB tablosu `moderation_appeal_notice_receipts`**: bir `moderation_action_id` için yalnız bir `recipient_id`, `notification_id`, `delivered_at`, `appeal_deadline_at` kayıtlı; idempotent anahtar ve UTC zaman kısıtı. Yetkisiz UPDATE'leri veritabanı trigger'ı engeller. **Yasal saklama süresi ve imha koşulları onaylanınca** yetkili/denetimli temizlik imkânı korunur; süresiz saklamaya dönüşecek otomatik yasak yoktur.
- **Worker bildirim teslimi**: yalnız `MODERATION_APPLIED` + **gerçek `REMOVE: UNDER_REVIEW→REMOVED`** moderasyon kararı + doğru anket sahibi + gerçekten bildirim kutusunda bulunan zorunlu bildirim söz konusuysa teslim kanıtı aynı worker transaction'ında yazılır. SMTP olayı, outbox kuyruğu, HTTP isteği veya bildirimin okunması zaman başlatmaz. Tekrar deneme eski kanıtı güncellemez; bildirim eklenememişse kanıt da oluşmaz.
- **Süre hesaplama kuralı** `apps/api/src/modules/moderation/appeal-window.ts`: `NOT_DELIVERED/OPEN/EXPIRED`; 30 gün sonu dahil. Kişisel veri haklarıyla ilgisiz otomatik `REMOVED` geri yüklemesi yok. Yalnız teslim kanıtı varsa başvuru süresi hesaplanabilir.
- **Testler**: 30 gün sınır anı, teslim yokken sayaç başlamaması, bildirim worker tekrarının tarihi değiştirememesi, normal `ACTIVE→REMOVED` işleminin bu **ön moderasyon itiraz** süresini yaratmaması, engellenmiş kullanıcı bildirimine teslim kanıtı yazılmaması.
- **Eksik — P0:** Uygulama henüz **kullanıcı tarafından itiraz başvurusu açma ve başvuru tarihini sunucuda kalıcı kaydetme** endpoint'ine/kullanıcı ekranına sahip değil. Bu PR yalnız teslim kanıtı, 30 gün hesaplama çekirdeği ve testlerini getirir. **Bu durum otomatik olarak 30 gün sonunda hakkı reddeden eksiksiz bir altyapı sanılmamalı**; başvuru kaydı ve güvenli destek yolu hazır olmadan canlıya çıkılmaz. Aday teknik kod tek başına “kullanıcılar artık itiraz edebiliyor” iddiası değildir.

## Gerçek yayından önce P0 kabul işleri

1. **Mert (#290/#327):** İtiraz başvuru kaydı (`appealCaseId`, `targetPollId`, `rejectionActionId`, server `submittedAt`, `deliveredAt`, `deadlineAt`, kimlik doğrulaması, sıralı durumu); imzalı/idempotent tekrar; başvuru anında `now <= deadline` kontrolü ve **teslim kanıtı yoksa süre doldu diye reddetmeme**; gerçek ret/itiraz nedenleri, gerekçeli insan cevabı, gerekiyorsa ikinci göz ve itirazı karar verme arayüzü.
2. **Utku:** Diğer kullanıcının `notificationId/actionId` değerinden itiraz hakkı çıkarmama, cross-account 404, banned/erased kullanıcı güvenli destek kanalı, geç gelen/outbox retry, teslimi uydurma veya yeniden kaydetme, UTC sınır, eşzamanlı başvuru, expired case, audit/PII/log güvenliği. İki moderatörün yanlış ret kararı telafisi #336'nın tekil `undoOfId` koşulunu kullanmalı.
3. **Ümit:** Kullanıcı bildirim kutusunda `MODERATION_APPLIED` ret nedeni + “İtiraz için son tarih” + uygun buton/başvuru durumu ve 18+ kullanıcı UX; yalnız kendi hesaba gösterilir, genel anket URL'si yanlışlıkla açılmaz; klavye/ekran okuyucu/mobil. Son tarih görülemiyorsa uydurma tarih gösterme.
4. **Faruk:** API idempotent form başvurusu, gerçek notification delivered receipt ve case verisi aynı sistemde; uygulama içi bildirim kabulü, saf zaman hesabı, migration/Prisma, worker/outbox retry, 30 günlük operasyonel DB backup geri yüklemelerinde **yanlışlıkla yeni süre üretme / teslimi geri alma** önleme; yedekten dönen silinmiş kullanıcı içeriğinin yeniden çıkması engeli #311/#322.
5. **KVKK/hukuk (#285):** İşletmecinin kimliği, içerik gerekçesi ve başvuru meta verilerinin amaç/işleme şartı ve minimum erişimi; teslim kanıtının, itiraz dosyasının, ledger'ın ve yedeklerin **ayrı ayrı yasal saklama / silme** şartı; 30 günlük itiraz süresi dolunca ilgili kişinin kanuni haklarının sona ermediği açık metin. **Sırf 30 gün politikası yüzünden otomatik veri silme veya saklama emri yok.** Hesap silme 30 gün yedek, restore engeli, legal hold #181/#311/#322 ile uzlaştırılmalı.
6. **Staging/release #53/#54:** Gerçek same-SHA DB migration + Worker + API + web test, 200/403/404 ve kimlik, olay gecikmesi, in-app notification oluşumu, 30. gün sınırı, send-fail/retry, başka hesaba sızmama, iptal/itiraz kabulü, hukuki metin bağımsız review. **Bu PR stacked: #336 üstünde; #333, #328, #326 merge olmadan bu PR main'e merge edilmez.**

## Hukuki ayrım

**Ürün içi moderasyon itiraz süresi** KararVer V1'in sözleşmesel ürün kuralıdır. KVKK kapsamındaki **ilgili kişi veri erişim/düzeltme/silme başvurusu** farklı haktır ve sırf bu 30 günlük ürün süresi doldu diye reddedilemez. Veri sorumlusunun gerçek başvuru yanıt yükümlülükleri ayrı değerlendirilir. Aydınlatma metni bu ayrımı ve bildirimin hangi kanalda teslim edilmiş sayılacağını kullanıcıya açıkça anlatmalıdır.

Resmî kaynaklar:
- [KVKK — ilgili kişi başvuru hakkı](https://www.kvkk.gov.tr/Icerik/2062/Basvuru-Hakki)
- [KVKK — başvuruların cevaplanma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2046/Ilgili-Kisiler-Tarafindan-Yapilan-Basvurularin-Cevaplanmasi-Yukumlulugu)
- [KVKK — aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)

**Durum: DRAFT / NO-GO.** Mevcut kullanıcılara gerçek bildirim, itiraz son tarihi veya production DB mutasyonu uygulanmadı.
