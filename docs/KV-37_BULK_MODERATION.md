# KV-37 §bulk — Toplu moderasyon (#183, dilim 1)

Seçilen anket veya yorumlara **tek gerekçeyle** `HIDE` / `REMOVE` / `RESTORE`. Bu belge #183'ün ilk dilimini anlatır: kapsamlı (scoped) toplu işlem, önizleme, kısmi başarısızlık, parti geçmişi. **Geri alma (undo), kullanıcı bazlı birleşik geçmiş ve spam puanı sonraki dilimlerdir** (aşağıdaki "Kapsam dışı").

Tekil moderasyon kuralları değişmedi: `docs/DATA_MODEL.md` §7.1 (geçiş tablosu), `docs/KV-04_ROLES_EVENTS.md` (`moderation.poll.apply` / `moderation.comment.apply`), `docs/KV-17_COMMENTS.md` (sayaçlar).

## 1. Endpoint'ler

| Endpoint | Yol | Yetki |
|---|---|---|
| `admin.moderation.polls.bulkPreview` / `.comments.bulkPreview` | `GET /admin/moderation/{polls,comments}/bulk/preview?ids=a,b,…&action=HIDE` | `moderation.poll.apply` / `moderation.comment.apply` (MODERATOR kendi topluluğu, ADMIN+ hepsi) |
| `admin.moderation.polls.bulk` / `.comments.bulk` | `POST /admin/moderation/{polls,comments}/bulk` `{ ids, action, reason, digest }` | aynı; gerekçe zorunlu |
| `admin.moderation.batches.list` | `GET /admin/moderation/batches` | `moderation.content.search` (moderatör kendi partilerini, ADMIN+ hepsini görür) |

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

## 5. Kapsam dışı (sonraki dilimler, #183)

- **Güvenli geri alma (undo)** ve karar geri alma geçmişi: `moderation_batch_items.moderation_action_id` ve önceki durum bunun için tutulur; sürüm kontrollü undo (yalnız kararın bıraktığı durum hâlâ geçerliyse) ve silinmiş/anonimleştirilmiş veriyi asla geri getirmeme kuralı bir sonraki dilimde. #185 ve #194 ile ortak sözleşme gerekir.
- Kullanıcının anket, yorum, rapor, medya ve moderasyon geçmişini tek ekranda birleştirme; kullanıcı/içerik/topluluk/IP süzgeçleri (IP yalnız veri politikasının izin verdiği ölçüde).
- Tekrarlı/spam içerik **uyarı puanı**, operatör incelemesi ve yanlış pozitif itiraz yolu (otomatik kalıcı ban yok).
- İkinci onay/MFA (#182) gerektiren eşik: bu dilimde yüksek hacimli toplu işlem için ek onay yoktur; 50 kayıt sınırı ve saatlik parti sınırı vardır.
- Toplu `LOCK`/`UNLOCK`, trend ve yorum kapatma işlemleri; hesaptan bağımsız arama sonucu seçimi tek sayfa ile sınırlıdır (seçim sayfalar arası korunur, en çok 50).

## 6. Arayüz

Yönetici anket ve yorum listelerinde satır onay kutusu; seçim varken "Seçilenlere toplu işlem…". Pencere: işlem seç → **Önizleme al** → kayıt başına sonuç (kapsam dışı satırlar "Uygulanamaz", içerik gösterilmez) → gerekçe → **Uygula**. Önizleme alınmadan veya uygulanacak kayıt yokken uygulama kapalıdır; 409 `preview_stale` önizlemeyi geçersiz kılar. Sonuç özeti kısmi başarısızlığı nedenleriyle yazar. "Toplu işlem geçmişi" açılır panelinde son partiler.

## 7. Test

`apps/api/test/bulk-moderation.test.ts` (özet işlevi; yetki; gövde doğrulaması; önizlemenin salt okunurluğu ve kayıt başına sonucu; geçiş tablosu ve ADMIN şartı; **moderatör kapsam yalıtımı**; ADMIN çok topluluklu parti; kayıt başına moderation_actions/audit/olay ve parti bağları; yorum sayaçları; kısmi başarısızlık; **önizleme sonrası durum/topluluk değişince `preview_stale`**; idempotency; **iki eşzamanlı onay** ve **toplu ile tekil eşzamanlı işlem**; saatlik sınır; parti geçmişi görünürlüğü ve sayfalama), `apps/web/test/bulk-moderation.test.ts` ve `apps/web/test/states/bulk-moderation.spec.ts` (tarayıcıda önizleme zorunluluğu, digest bağı, kısmi başarısızlık özeti, eskiyen önizleme).
