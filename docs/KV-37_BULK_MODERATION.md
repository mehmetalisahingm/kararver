# KV-37 §bulk — Toplu moderasyon, güvenli geri alma ve ikinci onay (#183, dilim 1–2 ve 4)

Seçilen anket veya yorumlara **tek gerekçeyle** `HIDE` / `REMOVE` / `RESTORE`. Bu belge #183'ün ilk iki dilimini anlatır: kapsamlı (scoped) toplu işlem, önizleme, kısmi başarısızlık, parti geçmişi (§1–4) **güvenli geri alma** (§5) ve **yüksek hacimli işlemde ikinci onay** (§8). Kullanıcı bazlı birleşik geçmiş [KV-33 §13](./KV-33_ADMIN_USERS.md#13-birleşik-kullanıcı-geçmişi-183)'tedir; spam puanı sonraki dilimdir (§7).

Tekil moderasyon kuralları değişmedi: `docs/DATA_MODEL.md` §7.1 (geçiş tablosu), `docs/KV-04_ROLES_EVENTS.md` (`moderation.poll.apply` / `moderation.comment.apply`), `docs/KV-17_COMMENTS.md` (sayaçlar).

## 1. Endpoint'ler

| Endpoint | Yol | Yetki |
|---|---|---|
| `admin.moderation.polls.bulkPreview` / `.comments.bulkPreview` | `GET /admin/moderation/{polls,comments}/bulk/preview?ids=a,b,…&action=HIDE` | `moderation.poll.apply` / `moderation.comment.apply` (MODERATOR kendi topluluğu, ADMIN+ hepsi) |
| `admin.moderation.polls.bulk` / `.comments.bulk` | `POST /admin/moderation/{polls,comments}/bulk` `{ ids, action, reason, digest }` | aynı; gerekçe zorunlu |
| `admin.moderation.batches.list` | `GET /admin/moderation/batches` | `moderation.content.search` (moderatör kendi partilerini, ADMIN+ hepsini görür) |
| `admin.moderation.bulkApprovals.list` / `.get` / `.approve` / `.reject` / `.cancel` | `GET/POST /admin/moderation/bulk-approvals[/:id[/approve|reject|cancel]]` | liste/ayrıntı `moderation.content.search`; onay ve ret `moderation.bulk.approve` (ADMIN+, başlatandan farklı, MFA step-up); geri çekme `moderation.bulk.cancel` (yalnız başlatan) — §8 |
| `admin.moderation.batches.undoPreview` / `.undo` | `GET /admin/moderation/batches/:id/undo/preview`, `POST …/undo` `{ reason, digest }` | `moderation.poll.apply` (uç nokta kapısı) + kayıt başına `moderation.{poll,comment}.apply`; moderatör yalnız kendi partisini, ADMIN+ herhangi birini |

Yeni yetki veya audit işlemi **yoktur**: mevcut KV-04 işlemleri kullanılır.

## 2. Akış

1. **Önizleme (salt okuma, hiçbir şey yazmaz).** Her kayıt için `WILL_CHANGE`, `NO_CHANGE` (zaten o durumda) veya `BLOCKED` (`not_found`, `forbidden`, `invalid_transition`, `admin_required`). Yanıt `digest` taşır.
2. **Onay.** Gerekçe + aynı `ids`/`action` + önizlemenin `digest`'i gönderilir. Sunucu durumu yeniden okuyup özeti **yeniden hesaplar**; (id, durum, topluluk) listesinde herhangi bir fark varsa **409 `preview_stale`** ve hiçbir şey yazılmaz (önizleme yenilenir).
3. **Uygulama.** Kayıtlar kimlik sırasıyla, **her biri kendi transaction'ında** mevcut tekil yoldan (`ModerationStore.apply`) geçer: satır kilidi, geçiş tablosu, sayaçlar, `moderation_actions`, audit (`moderation.poll.apply` / `moderation.comment.apply`, gerekçe + requestId) ve olay outbox'ı (`moderation.applied`). Biri başarısız olursa diğerleri etkilenmez; sonuç kayıt başınadır (`APPLIED` / `UNCHANGED` / `FAILED` + neden).
4. **Parti kaydı.** `moderation_batches` (aktör, tür, işlem, gerekçe, digest, requestId, sayılar) ve `moderation_batch_items` (kayıt başına sonuç, önceki/sonraki durum, uygulanan kararın `moderation_actions` kimliği). Parti açılır, öğeler işlendikçe yazılır, sonda sayılar kapatılır: süreç ortada ölürse yarım parti görünür, uygulanmış kararlar zaten kendi kayıtlarıyla (aynı requestId) denetlenebilir.

## 3. Güvenlik ve kapsam yalıtımı

- **Yetki yalnız backend RBAC'tadır ve kayıt başınadır.** Her kaydın topluluğu DB'den okunur ve `ctx.authorize({ communityId })` (KV-04 kuralının kendisi) çağrılır. Moderatörün atanmadığı topluluktaki veya topluluksuz kayıt `forbidden` olur, **dokunulmaz** ve önizlemede **etiketi (başlık/metin) görünmez**. Bu tekil moderasyonla aynı karardır.
- **Kaldırılmış içeriği yalnız ADMIN+ geri yükler** (`admin_required`). Geçersiz geçiş (`REMOVED` → `HIDE` gibi) `invalid_transition`.
- Hiçbir kayıt bulunamazsa 404 (içerik veya yetki ipucu verilmez). Yinelenen kimlik, 50'den fazla kayıt, desteklenmeyen işlem (`LOCK`/`UNLOCK`/trend/yorum kapatma bu dilimde yok) 400.
- **Hız sınırı:** aktör başına saatte **20 parti** (429 `RATE_LIMITED`); önizleme sınırsız. Genel yazma sınırı (dakikada 60) ayrıca geçerlidir.
- Doğrulama atlama, ham token, parola veya kullanıcı verisi bu uçlarda yoktur.

## 4. Eşzamanlılık

- Önizleme ile onay arasındaki değişiklikler `digest` ile yakalanır (durum, topluluk taşıma, silinme).
- Onay anında kayıt, tekil yoldaki **kilitli yeniden okuma** ile işlenir (taşınmışsa `community_changed`): iki eşzamanlı onay veya toplu işlem ile tekil işlem aynı kaydı **bir kez** uygular, ikincisi `UNCHANGED`/409 döner; sayaçlar çift düşmez (testli).
- Kayıtlar kimlik sırasıyla ve ayrı transaction'larda işlendiğinden iki parti birbirini beklemez ve kilit sırası deterministiktir (deadlock yok).
- Aynı toplu işlemin tekrarı idempotenttir: kayıtlar `UNCHANGED`, yeni karar kaydı yazılmaz.

## 5. Güvenli geri alma (dilim 2)

Geri alma **yeni bir partidir** (`moderation_batches.undo_of_id`) ve her kayıt için bir **telafi kararıdır**: normal moderasyon yolundan (`ModerationStore.apply`) geçer, kendi `moderation_actions` + audit + olay kaydını yazar. **Geçmiş kayıtlar (audit dahil) değişmez**; geri alma geçmişi yeni kayıtların eklenmesidir.

**Önceden tanımlı telafi çiftleri** (yalnız bunlar geri alınır — kararın ÖNCEKİ durumuna tam dönüşü tek kararla sağlayanlar):

| Uygulanan karar (önceki durum) | Telafi |
|---|---|
| HIDE (ACTIVE) | RESTORE |
| REMOVE (ACTIVE) | RESTORE (**yalnız ADMIN+**, kaldırılmış içeriği yalnız yönetici geri yükler) |
| RESTORE (HIDDEN) | HIDE |
| RESTORE (REMOVED) | REMOVE |
| diğerleri (ör. REMOVE öncesi HIDDEN, RESTORE öncesi LOCKED) | `not_reversible`: tek kararla aynı duruma dönülemez, dokunulmaz |

**Sürüm koşulu (kilit altında, kontrolle yazma arasında boşluk yok):** `apply` içinde, satır kilidi alındıktan sonra doğrulanır: içeriğin şimdiki durumu kararın bıraktığı durum **ve** hedefin SON moderasyon kararı bu karar olmalıdır. Araya daha yeni karar girdiyse (durum aynı görünse bile: gizle → geri yükle → yeniden gizle) `superseded`; telafi uygulanmaz. Önizleme aynı kontrolü gösterir (`status_changed` / `superseded`) ve özeti (digest) son kararları içerir: önizlemeden sonra yeni karar gelirse 409 `preview_stale`.

**Silinmiş/anonimleştirilmiş veri asla geri üretilmez:** içerik sahibinin hesabı silinmiş/anonimleştirilmişse (`users.deleted_at`) telafi `author_erased` ile reddedilir; hem önizlemede hem uygulamada (kilit altında). Bu kural hesap silme işleminin (KV-33 §10) kaldırdığı içeriğin, bir toplu işlemin geri alınmasıyla yeniden yayına çıkmasını engeller.

**Yetki geri alma anındaki aktörle, kayıt başına yeniden verilir:** moderatör yalnız kendi partisini ve yalnız şu an kapsamındaki topluluğun kayıtlarını geri alır (içerik taşındıysa `forbidden`); ADMIN+ herhangi bir partiyi. Başkasının partisi moderatöre 404 (varlık sızmaz).

**Kurallar:**
- **Öğe başına en çok bir geri alma:** `moderation_batch_items.undone_by_batch_id` yalnız telafi gerçekten uygulandığında yazılır (DB CHECK: yalnız APPLIED öğe). Tekrar çağrı yalnız henüz geri alınmamış ve şimdi uygun kararları ele alır; hiç uygun karar yoksa 409 `nothing_to_undo` (boş parti açılmaz).
- **Geri almanın geri alması yoktur** (409 `not_undoable`); gerekirse yeni bir toplu işlem yapılır. Bitmemiş parti de geri alınamaz.
- Geri alma partisi aynı **saatlik parti sınırına** (20) dahildir. Partiye `undoOfId`, `undone` ve `undoable` alanları eklenir (liste).
- Uygulama kayıt başına ayrı transaction'dır; biri başarısız olursa (`superseded`, `author_erased`, `community_changed`, `forbidden`...) diğerleri etkilenmez ve geri alma partisinde `FAILED` + nedenle kalır.
- Yalnız telafi uygulandıktan SONRA işaret yazılır: süreç araya ölürse işaretsiz kalan karar yeniden denendiğinde `superseded` olur (çift telafi olmaz), geri alınamaz görünür.

**Genel sözleşme (#185/#194):** "yalnız önceden tanımlı reversible aksiyonlar, sürümlü ve denetlenebilir telafi, her undo yeni audit, append-only audit değişmez" ilkeleri bu uçlarla uygulanmıştır; genel audit undo'su aynı çift tablosu, sürüm koşulu ve `author_erased` kuralını kullanabilir.

## 6. Arayüz

Yönetici anket ve yorum listelerinde satır onay kutusu; seçim varken "Seçilenlere toplu işlem…". Pencere: işlem seç → **Önizleme al** → kayıt başına sonuç (kapsam dışı satırlar "Uygulanamaz", içerik gösterilmez) → gerekçe → **Uygula**. Önizleme alınmadan veya uygulanacak kayıt yokken uygulama kapalıdır; 409 `preview_stale` önizlemeyi geçersiz kılar. Sonuç özeti kısmi başarısızlığı nedenleriyle yazar. "Toplu işlem geçmişi" açılır panelinde son partiler; geri alınabilir partide **Geri al…**: pencere açılınca önizleme yüklenir (kayıt başına geri alınacak / geri alınamaz + neden), gerekçe girilir, **Geri al** ile telafi kararları uygulanır ve sonuç özeti nedenleriyle yazılır.

## 7. Kapsam dışı (sonraki dilimler, #183)

- Tekil (toplu olmayan) moderasyon kararlarının geri alınması: bu dilim yalnız toplu partileri hedefler.
- ~~Kullanıcının anket, yorum, rapor, medya ve moderasyon geçmişini tek ekranda birleştirme~~ — yapıldı: KV-33 §13 (tür, topluluk, içerik ve tarih süzgeçleri). IP süzgeci veri politikası gereği eklenmedi.
- Tekrarlı/spam içerik **uyarı puanı**, operatör incelemesi ve yanlış pozitif itiraz yolu (otomatik kalıcı ban yok).
- ~~İkinci onay/MFA (#182) gerektiren eşik~~ — yapıldı: §8. Büyük partilerin geri alınması ve tekil kararlar eşiğe tabi değildir.
- Toplu `LOCK`/`UNLOCK`, trend ve yorum kapatma işlemleri; hesaptan bağımsız arama sonucu seçimi tek sayfa ile sınırlıdır (seçim sayfalar arası korunur, en çok 50).

## 8. Yüksek hacimli toplu işlemde ikinci onay (dilim 4)

Eşiği aşan toplu işlem **uygulanmaz**; başka bir yöneticinin onayını bekleyen bir talep olur. Amaç: tek bir (ele geçirilmiş veya hatalı) hesabın kısa sürede çok sayıda içeriği tek başına gizleyip kaldırabilmesini engellemek. #182'deki iki kişi + MFA ilkesinin toplu moderasyona uygulanmasıdır; rol değişikliği onayından ayrı bir tablodur.

### 8.1 Eşik

Başlatanın **son 60 dakikada ONAYSIZ uygulanan kayıt sayısı + bu işlemin değişecek (WILL_CHANGE) kayıt sayısı ≥ 20** ise ikinci onay gerekir (`BULK_APPROVAL_THRESHOLD`). Pencere toplamı, işlemi 19'luk parçalara bölerek eşiği aşmayı engeller. Geri alma partileri ve ikinci onaydan geçmiş partiler pencereye girmez. Değişecek kayıt yoksa (hepsi zaten o durumda veya uygulanamaz) onay istenmez. Önizleme `approval: { required, threshold, windowMinutes, windowApplied }` döner; arayüz "Uygula" yerine "Onaya gönder" yazar. Eşik **bütün roller için** geçerlidir (SUPER_ADMIN dahil); onaylayacak ikinci bir ADMIN+ yoksa işlem 20'nin altında parçalanmalıdır.

### 8.2 Akış

| Adım | Uç nokta | Kural |
|---|---|---|
| Talep | `admin.moderation.{polls,comments}.bulk` → **202** `BulkApprovalView` | Önizleme özeti (digest) doğrulanır; **içerik değişmez, parti açılmaz**. Başlatan başına aynı anda en çok 3 bekleyen talep (`409 too_many_pending`). Talep 30 dakika geçerli. Audit: `moderation.bulk.approve` / `request` (aktör başlatan). |
| İnceleme | `admin.moderation.bulkApprovals.get` | Kayıt başına sonuç **başlatanın yetkisiyle şimdi** hesaplanır; onaylayan neyi onayladığını görür. `stale`: talepten sonra özet veya değişecek kayıt sayısı değiştiyse. Moderatör yalnız kendi talebini görür. |
| Onay | `admin.moderation.bulkApprovals.approve` `{ reason }` | ADMIN+, **başlatandan farklı**, oturumda **taze tek kullanımlık MFA step-up** (`me.mfa.stepup`). Parti **başlatan adına** uygulanır (`moderation_actions.actor_id` başlatan; onaylayan talepte ve audit'te). |
| Ret | `…bulkApprovals.reject` `{ reason }` | ADMIN+, başlatandan farklı. İçerik değişmez. |
| Geri çekme | `…bulkApprovals.cancel` `{ reason }` | Yalnız başlatan (başkasının talebi 404). İçerik değişmez. |
| Liste | `…bulkApprovals.list` | Moderatör kendi taleplerini, ADMIN+ hepsini görür; `status` süzgeci `EXPIRED`'ı da destekler. |

### 8.3 Güvenlik özellikleri

- **Yetki yükselmez.** Onay, partiyi *başlatanın şimdiki yetkisiyle* yeniden planlar (aynı planlayıcı `bulk-core.ts`, aynı uygulayıcı): moderatör başlatan, atandığı toplulukların dışındaki kaydı, onaylayan ADMIN olsa bile uygulayamaz. Başlatanın hesabı etkin değilse veya rolü kalmadıysa `409 initiator_changed`; kapsamı daraldıysa değişecek kayıt sayısı talepten farklı olur ve `409 preview_stale`.
- **Eski özet uygulanmaz.** Kayıtların durumu/topluluğu talepten sonra değiştiyse `409 preview_stale`, hiçbir şey uygulanmaz; step-up harcanmaz (talep reddedilip yeniden başlatılır).
- **Self-approval imkânsız:** uygulamada (`403 self_approval`) ve veritabanında (`moderation_bulk_approvals_actor_check`: ONAY/RET'te `decided_by_id <> initiator_id`, geri çekmede `= initiator_id`).
- **Step-up en son tüketilir:** talep açık mı, başlatan ≠ onaylayan, onaylayan etkin ADMIN+ mı doğrulandıktan sonra, aynı transaction'da. Başarısız onay step-up'ı harcamaz; yarışta yalnız kazananın kodu tüketilir.
- **Tek sonuç:** talep satırı `FOR UPDATE` kilitlenir; eşzamanlı iki onay veya onay + geri çekme yarışında yalnız biri kazanır (diğeri `409 closed`). Parti kaydı, talep güncellemesi ve audit tek transaction'dadır.
- **Süre:** 30 dakika sonra talep okunurken `EXPIRED` sayılır (arka plan işi yok); onaylanamaz/reddedilemez/geri çekilemez, bekleyen sınırını doldurmaz.
- **Audit:** `moderation.bulk.approve` (`request`, `approve`, `reject`), `moderation.bulk.cancel` (`cancel`); hedef `BULK_APPROVAL`. İçerik başına kararlar normal `moderation.*.apply` kayıtlarıdır.

### 8.4 Arayüz

İçerik listesinde "Toplu işlem onayları" açılır paneli (durum süzgeci). Başlatan olmayan ADMIN+ için "İncele ve onayla…": kayıt tablosu, doğrulayıcı kodu ve gerekçe; kayıtlar değiştiyse onay kapalıdır. Kod doğrulandıktan sonra onay reddedilirse aynı pencerede yeniden kod istenmez. Başlatan için "Geri çek…", ADMIN+ için "Reddet…".

### 8.5 Bilinen sınırlar

- **Bildirim yok:** bekleyen talep için yöneticilere push/e-posta gitmez; onaylayan paneli açıp bakar. İstenirse #185/bildirim işi ile eklenir.
- **Geri alma eşiğe tabi değildir:** büyük bir parti onaylanıp uygulandıktan sonra başlatanın veya yöneticinin onu geri alması ikinci onay istemez (telafi kararıdır, sürüm kontrollü, audit'lidir). Gerekirse aynı eşik geri almaya da uygulanabilir.
- **Pencere toplamı yarışı:** bitmemiş partinin sayısı bitişte yazıldığından, eşzamanlı çok sayıda istek birbirinin sayısını görmez; saatlik parti sınırı (20) bunu sınırlar.
- **Parti çökmesi:** onaydan sonra sunucu öğeler işlenirken kapanırsa parti bitmemiş kalır (doğrudan toplu işlemdeki davranışla aynı); tekrar onay mümkün değildir, kalan kayıtlar yeni bir toplu işlemle uygulanır.
- Eşik ve süreler sabittir (ayar değil); değiştirmek sözleşme sabitlerini ve bu belgeyi birlikte günceller.

## 9. Test

`apps/api/test/bulk-approval.test.ts` (eşik ve pencere bölünmesi; talebin içerik değiştirmemesi; başlatan adına uygulama ve audit; self-approval, step-up eksikliği ve tek kullanımlık step-up; moderatör/kullanıcı reddi; başlatan kapsamının aşılmaması; preview_stale; başlatanın rol/hesap/kapsam kaybı; süre dolumu ve bekleyen sınırı; ret ve geri çekme; görünürlük ve imleç bağlama; yarışlar; DB kısıtları), `apps/web/test/bulk-approval.test.ts` ve `apps/web/test/states/bulk-approval.spec.ts` (onaya gönderme, kayıtları görerek MFA ile onay, kodun korunması, eski talep), `apps/api/test/bulk-undo.test.ts` (telafi çiftleri ve özet; yetki ve başkasının partisi 404; HIDE partisinin geri alınması ve append-only kayıtlar; yorum sayaçları; REMOVE için ADMIN şartı ve RESTORE partisinin geri alınması; tek geri alma, geri almanın geri alınamaması, bitmemiş parti; **superseded / status_changed**; **preview_stale**; **kilit altında sürüm koşulu (apply doğrudan)**; **author_erased**; kapsam (taşınmış içerik); **iki eşzamanlı geri alma** ve **geri alma ile yeni karar yarışı**), `apps/api/test/bulk-moderation.test.ts` (özet işlevi; yetki; gövde doğrulaması; önizlemenin salt okunurluğu ve kayıt başına sonucu; geçiş tablosu ve ADMIN şartı; **moderatör kapsam yalıtımı**; ADMIN çok topluluklu parti; kayıt başına moderation_actions/audit/olay ve parti bağları; yorum sayaçları; kısmi başarısızlık; **önizleme sonrası durum/topluluk değişince `preview_stale`**; idempotency; **iki eşzamanlı onay** ve **toplu ile tekil eşzamanlı işlem**; saatlik sınır; parti geçmişi görünürlüğü ve sayfalama), `apps/web/test/bulk-moderation.test.ts` ve `apps/web/test/states/bulk-moderation.spec.ts` (tarayıcıda önizleme zorunluluğu, digest bağı, kısmi başarısızlık özeti, eskiyen önizleme).
