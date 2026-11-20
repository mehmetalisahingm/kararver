# KararVer V1 — Hatalı ön moderasyon reddinin ücretsiz düzeltilmesi

**İşletmecinin kesin kararı — 8 Kasım 2026 (Mehmet):** Şüpheli anket gönderiminde **10 KararVer puanı kesilir**, moderatör ön incelemede reddederse **tek sefer +10 puan iade edilir**. İtiraz sonucunda bu ret kararının **hatalı** olduğu yetkili incelemeyle kabul edilirse **aynı anket ücretsiz yeniden yayımlanır**. Daha önce iade edilen 10 puan kullanıcıda kalır. Yeniden `PUBLISH -10` işlemi **yoktur** ve `MODERATION_REFUND +10` **geri alınmaz**.

**Bunlar nakit/para değil, ücretsiz ve reklamsız KararVer'in uygulama içi yayın puanlarıdır.** Yeni premium, ödeme veya reklam eklenmez. Bu belge KVKK/uygulama içi moderasyonun hukuki onayı değildir.

## Kullanıcı açısından işlem zinciri

| Adım | Anket statüsü | Puan defteri | Kamu görünürlüğü |
| --- | --- | --- | --- |
| Şüpheli anket gönderildi | `UNDER_REVIEW` | `PUBLISH -10` | Kapalı, 202 özel makbuz |
| Moderatör reddetti | `REMOVED` | `MODERATION_REFUND +10` (tam bir kez) | Kapalı, gerçek public 404 |
| Kullanıcı itiraz etti | `REMOVED` | Yeni hareket yok | Kapalı, inceleme sürecinde |
| Yetkili kişi hatalı reddi kabul ederek **özgül ret işlemini** geri aldı | `ACTIVE` | **Yeni kesinti yok**, iade korunur | Anket yeniden görünür, ilan edilen tam süre şimdi başlar |
| Yetkisiz/stale/yanlış içerik/eksik görsel veya geçersiz ret | `REMOVED` | Değişiklik yok | Kamuya açılmaz, yeniden inceleme gerekir |

## Teknik güvenlik ve idempotency

1. **Tek güvenli yol:** `GET /v1/admin/moderation/actions/:rejectionActionId/undo/preview` ardından `POST /v1/admin/moderation/actions/:rejectionActionId/undo` ve taze `digest` + gerekçeli karar. Mevcut `admin.moderation.actions.undo` rol ve kapsam kontrolleri sürer. `admin/polls/:id/moderation` üzerindeki **genel `RESTORE`**, iade edilmiş review reddi için **409** verir. Böylece her kaldırılan anket kendiliğinden bedava açılmaz.
2. **İlişkili ret kanıtı:** Poll satırı `FOR UPDATE` kilidinde, en güncel moderasyon kararı hedef poll için `REMOVE: UNDER_REVIEW→REMOVED` olmalı; `undoOfId` boş olmalı; `expect.actionId`, `undoOf` ve son karar kimliği aynı olmalı. `actorIsAdmin`, mevcut yetki, hesap silme engeli ve son durum ön şarttır. Moderatörün eski veya başka ankete ait action ID'siyle bypass reddedilir.
3. **Puan bütünlüğü:** İade kaydı varsa bu kaydın `userId/referenceId` değerleri anketin gerçek yazarı ve kimliğiyle eşleşmeli, `delta` gerçek ilk `PUBLISH` eksi hareketinin **tam karşılığı** olmalı. İade bulunmuyorsa (özel sentetik sıfır yayın maliyeti) sahte `+10` üretilmez. **İtiraz kabulünde hiçbir puan defteri hareketi yazılmaz**; eski `PUBLISH` ve `MODERATION_REFUND` append-only kalır.
4. **Public olmadan tekrar inceleme:** Yazar silinmiş veya `accountErasure` varsa restore imkânsız. İçerik başlığı, açıklaması, ek alanı ve seçenekler hâlâ V1 hassas kişisel veri yasağına uygun olmalı; bağlı görsellerin tamamı `APPROVED` durumunda olmalı. Sadece “yanlışlıkla reddetmiştim” notu sınırları aşamaz.
5. **Oylama zamanı:** Ön inceleme hiç public olmadığından, itirazla doğru kabul edilen anketin `opensAt` ve `closesAt` saatleri izin verilen başlangıç süresinin **tamamı** korunacak şekilde onay anına taşınır. `DISCUSSION` için `closesAt=null` kalır.
6. **Aynı transaction:** Status `REMOVED→ACTIVE`, `moderation_actions` telafi satırı `undo_of_id` ile ilk ret satırına bağlanır, audit ve outbox olayı birlikte yazılır. Eşzamanlı aynı ret kararının iki kez geri alınması `UNIQUE undo_of_id` ve durum/son karar kilidiyle engellenir. Gerçek public görünürlük işlem commit olmadan açılmaz.
7. **Toplu geri alma devre dışı:** `bulk.inverseOf(REMOVE, UNDER_REVIEW)` değişmedi; yanlış reddedilen kullanıcı anketlerinin ücretsiz geri yüklenmesi yalnız **tekil ve kanıtlı** yol üzerinden sağlanır.

## Hukuki ve operasyonel kalan işler

- [ ] **Mert (#290/#327):** Gerçek bir itiraz başvuru kaydı, kullanıcı/itiraz sahibi doğrulama, içeriğin ve önceki ret gerekçesinin yetkili personelce tekrar incelenmesi, açıklamalı gerekçe, sonuç ve güvenli kullanıcı bildirimi, yanlış retleri ölçme, işlem süresi ve destek escalasyonu. **Bu PR bugünkü mevcut yetkili karar düzeltme API'sini hazırlar, kullanıcıların başvuru yaptığı self-service itiraz ekranı henüz tamamlanmadı.**
- [ ] **Faruk:** İtiraz kabulünde sayı değişmeden kalan puan ledger, `undoOf` ve audit kıyaslaması; staging gerçek PostgreSQL, ortam tutarlılığı, şema/model doğrulaması, eski backup+restore'dan dirilen ret kararları ve puan defteri tekrarı (#311/#322).
- [ ] **Utku:** Admin/MODERATOR RBAC, son karar değişince stale `digest`, farklı ankete/başka kullanıcıya ait ret ID, silinmiş/yasaklı yazar, onaysız medya veya yeni hassas V1 içeriği, paralel iki itiraz; otomatik toplu undo bypass ve gizlilik denetimi.
- [ ] **Ümit:** Kullanıcıya ret bildirimi, `-10/+10` puan geçmişi ve itiraz sonucunda “ücretsiz yeniden yayımlandı” açıklaması. RESTORE işleminde public anket bağlantısı yalnız gerçek commit sonrası paylaşılır; yanlışlıkla başkasının gerekçesi gösterilmez.
- [ ] **Hukuk (#285):** Ürün kuralları, itiraz ve bildirim yöntemleri açık dilde; moderator kararı/puan geçmişi/başvuru kayıtları için işleme amaçları, hukuki sebepler, minimum erişim, saklama/imha ve ilgili kişi hakları ayrı. Meşru KVKK başvurusu ile **ürün içi moderasyon itirazı birbirinden farklı süreçlerdir**. KVKK kapsamında resmi ilgili kişi başvuru yanıtı en geç 30 gün olabilir; moderasyon itirazının süresi bu kuraldan otomatik türetilmez.
- [ ] **V1 release (#53/#54):** Gerçek testler, bağımsız inceleme, mevcut/gelecek politikalar (#318 18+, #323 silinen hesap/yazar, #324 misafir SEO, #325 açık sonuç, #326 hassas içerik, #328 risk kuyruğu, #333 tek sefer iade) ve içerik/cache/storage/worker bütünlüğü; bu PR önceki stacked PR'lara bağımlı. **Merge/üretim GO henüz yok.**

## Resmî kaynaklar

- [KVKK — Aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-): kimlik, veri işleme amacı/hukuki sebep, alıcılar ve ilgili kişi hakları.
- [KVKK — İlgili kişi başvuru hakkı](https://www.kvkk.gov.tr/Icerik/2062/Basvuru-Hakki): veri erişimi/düzeltme/silme gibi kişisel veri hakları.
- [KVKK — Başvuruların cevaplanma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2046/Ilgili-Kisiler-Tarafindan-Yapilan-Basvurularin-Cevaplanmasi-Yukumlulugu): ilgili kişi başvurusunun şartları ve cevap süresi.

**NO-GO:** Bu teknik uygulama taslağıdır; imzalı gerçek moderatör itiraz kabulü, tamamlanmış bildirim/başvuru UX'i, bütün CI ve gerçek staging kabulü olmadan canlıya alınmaz.
