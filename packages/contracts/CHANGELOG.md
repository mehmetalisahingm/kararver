## KV-23 (#25)

- `decisions.get`: public karar ve izleyici takip/sahiplik durumu; private/no-store.
- `decisions.put`: moderasyon kilidi için CONTENT_LOCKED; aynı değer tekrarı olay üretmez.
- Karar/kapanış bildirimleri açık takipçileri de kapsar; kullanıcı + olay tekilliği korunur.

# @kararver/contracts — Değişiklik günlüğü

Kurallar: [`docs/API_CONTRACTS.md` §5](../../docs/API_CONTRACTS.md#5-versiyonlama-ve-deprecation).
Kırıcı değişiklikler `contract-breaking` etiketiyle, bütün tüketici sahipleri reviewer olarak eklenerek yapılır.

## 1.19.0 — 2026-10-08 (Faruk, KV-19 hız sınırı, #21)

Kırıcı değişiklik yok: yalnız yeni ayar anahtarları. `RATE_LIMITED` (429) zaten her uç noktanın ortak hatasıydı.

- **Eklendi:** `limits.*` (18 anahtar, `settings.ts`): giriş (e-posta/IP başına başarısız deneme), kayıt, şifre sıfırlama/doğrulama tekrarı, oy, yorum (dakika ve gün), şikâyet, görsel yükleme, arama ve diğer yazma işlemleri; yeni hesap için ayrı değerler. Resmî değer yok (`default: null`): plan sınır ister, sayı vermez. Öneriler `missing` alanında; Mehmet teyidi bekliyor (KV-04 açık konu 10). Public değil.
- **Belge:** `docs/KV-19_RATE_LIMIT.md` (kurallar, pencereler, 429 + `Retry-After`).

## 1.18.0 — 2026-10-06 (Mert, KV-37 gelişmiş admin içerik işlemleri, #39)

Kırıcı değişiklik yok: yeni uç noktalar, `ModerationAction` enum'unda yeni değerler (açık enum, API_CONTRACTS §5) ve yanıtlara eklenen alanlar; `admin.sanctions.create` gövdesine isteğe bağlı alan. Reviewer: Faruk (polls/comments, `allowComments` etkin değer), Utku (`admin.sanctions.create` + `reportId`, `sanction.applied`).

- **Eklendi:** `admin.content.polls` (`GET /admin/polls`) ve `admin.content.comments` (`GET /admin/comments`): yönetici arama/liste. Türkçe harf ve büyük-küçük duyarsız metin, durum/topluluk/kategori/yazar/rapor/trend süzgeçleri; gizli ve kaldırılmış içerik dahil; moderatör yalnız kendi toplulukları (`moderation.content.search`, kapsam: queue).
- **Eklendi:** `admin.moderation.history.polls|comments` (`GET /admin/{polls|comments}/:id/moderation-history`): içeriğin raporları ve moderasyon işlemleri (kullanıcı uyarısı/yaptırımı rapor üzerinden dahil) tek zaman çizgisinde; raporlayan kimliği dönmez (`moderation.content.history`).
- **Eklendi:** `admin.moderation.polls.move` (`PATCH /admin/polls/:id/placement`): kategori ve/veya topluluk taşıma, gerekçeli; ilk geçerli oydan sonra da serbest (soru, açıklama, seçenekler değişmez); hedef toplulukta da yetki ister (`moderation.poll.move`).
- **Eklendi:** `admin.reports.warn` (`POST /admin/reports/:id/warn`): kuyruktan içerik sahibine WARNING; hedefin açık raporlarını kapatır; `moderation.user.warn` (sanctionTarget kuralı).
- **Eklendi:** `ModerationAction` += `CLOSE_COMMENTS`, `OPEN_COMMENTS` (yalnız anket): yorumları kapatır, oy ve görünürlük etkilenmez. `moderation.applied` olayının `action` alanı bunları taşıyabilir; bildirim üretmez.
- **Eklendi:** `AdminPollItem`, `AdminCommentItem`, `ContentHistoryItem`, `ModerationRecordAction`; `ReportView` += `excerpt`, `contentStatus`, `targetUser` (kuyrukta içerik özeti ve uyarının hedefi).
- **Değişti:** `admin.moderation.polls|comments` yanıtı += `commentsClosed` (ankette bool, yorumda null). `PollDetail.allowComments` artık etkin değerdir: moderasyon kapattıysa `false`.
- **Değişti:** `admin.sanctions.create` gövdesi += isteğe bağlı `reportId`: yaptırımı rapora bağlar (`moderation_actions.SANCTION_USER`, audit `after.reportId`, hedefin açık raporları ACTIONED); 409 `report_mismatch`, 404 rapor yok.
- **Eklendi:** KV-04 işlemleri `moderation.content.search`, `moderation.content.history`, `moderation.poll.move`, `moderation.user.warn`; audit işlemleri `move`, `warn`, `close_comments`, `open_comments`.
- **DB:** `polls.comments_closed_at`, `moderation_action_type` += `CLOSE_COMMENTS`, `OPEN_COMMENTS`, `MOVE`, `SANCTION_USER`; `comments_body_trgm_idx` (migration `20261006130000_mert_kv37_admin_content_ops`).
- **Kapsam dışı (#39 kararı):** etiket değiştirme.

## 1.17.0 — 2026-10-05 (Utku, KV-21 PR-3 bildirim tüketicisi)

Kırıcı değişiklik yok: `NotificationType` açık enum'dur (API_CONTRACTS §5), yeni değer minor; diğerleri yeni sabit ve şema.

- **Eklendi:** `NotificationType` += `SANCTION_APPLIED` (sona). Katalogda `sanction.applied` artık `notifications` tüketicisini listeler ve `notification: "SANCTION_APPLIED"`; bildirim yalnız `WARNING` ve `RESTRICT_*` için yazılır, `SUSPEND`/`BAN` için yazılmaz (KV-21 §4).
- **Eklendi:** `notificationData`: tipe göre `NotificationView.data` şemaları (strict, düz alanlar; seçim, serbest metin ve kişisel veri yok). `NotificationView.data` değişmedi.
- **Eklendi:** `MANDATORY_NOTIFICATION_TYPES` (`MODERATION_APPLIED`, `SANCTION_APPLIED`: kapatılamaz) ve `POLL_MILESTONES` (10, 50, 100, 500, 1000, 5000, 10000; üretici ve tüketici aynı listeyi kullanır).
- **Değişti:** `notifications.preferences.update` notu: `SANCTION_APPLIED` da kapatılamaz.
- **Eklendi:** paket alt yolu `@kararver/contracts/fixtures/events` (`eventExamples`): worker'daki bildirim adapter sözleşme testi katalog örneklerini kullanır.
- **Belge:** KV-04 katalog tablosunda `sanction.applied` satırı.

## 1.16.0 — 2026-10-04 (Utku, KV-21 PR-2 olay outbox'ı)

Kırıcı değişiklik yok (yeni yardımcı ve DB hata eşlemesi minor; zarf, katalog, `createEvent` ve `parseEvent` değişmedi).

- **Eklendi:** `newEventId(now?)`: producer'ın olay kimliği (UUIDv7, RFC 9562; ilk 48 bit milisaniye zamanı, 74 bit rastgele). Node'da ve PostgreSQL 17'de UUIDv7 üreteci olmadığı için sözleşmede; API ve worker aynı fonksiyonu kullanır. Kimlik mutation transaction'ında bir kez üretilir ve `domain_events.id` olur (docs/DATA_MODEL.md §9.4).
- **Eklendi:** `dbErrorMap`: `KV_DOMAIN_EVENTS_IMMUTABLE` → `INTERNAL_ERROR` (outbox satırının zarfı değiştirilemez).
- **Test:** `events.test.ts`: UUIDv7 biçimi ve `parseEvent` kabulü, zaman bitleri ve sıralama, tekillik, geçersiz zaman.

## 1.15.0 — 2026-10-02 (Utku, KV-33 admin kullanıcılar ve yaptırımlar)

Kırıcı değişiklik yok: değişen endpoint'ler henüz uygulanmamıştı (KV-33 ile ilk kez uygulanıyor); cevaba alan eklemek ve yeni endpoint minor.

- **Eklendi:** `admin.users.sanctions` (`GET /admin/users/:id/sanctions`, bütün yaptırım geçmişi), `admin.users.reports` (`GET /admin/users/:id/reports?side=against|filed`), `admin.users.activity` (`GET /admin/users/:id/activity`); üçü de `user.read` (ADMIN+), cursor'lı. Şemalar `AdminUserReport`, `AdminUserActivity`.
- **Eklendi:** `statusFromSanctions(sanctions, now)`: `users.status`'un yaptırımlardan türetilen değeri (BAN > SUSPEND > RESTRICT_* → RESTRICTED > ACTIVE; WARNING etkisiz). API ve süre dolumu job'ı (KV-33 PR-C) aynı fonksiyonu kullanır.
- **Değişti:** `Sanction`'a `liftedBy` (PublicUser | null) ve `liftReason` (string | null). DB'de alanlar zaten vardı (`lifted_by_id`, `lift_reason`).
- **Değişti:** `admin.users.list` `q` en az 3 karakter (trigram index'i); daha kısa 400 `VALIDATION_ERROR`. Notlar: e-postada yalnız tam eşleşme; `roles` tek elemanlı.
- **Değişti:** `admin.sanctions.create`: `errors: ["CONFLICT"]` (`already_active`, `user_deleted`, `last_super_admin`); WARNING için `endsAt` null olmalı.
- **Değişti:** `admin.sanctions.lift`: `errors: ["CONFLICT"]` (`already_lifted`, `expired`), `idempotency: none` (zaten kaldırılmış yaptırım artık mevcut satırı değil 409 döner; KV-33 kararı).
- **Düzeltildi:** `admin.roles.put` fixture'ı `roles: ["USER", "MODERATOR"]` diyordu; kullanıcı başına tek rol olduğu için `["MODERATOR"]`.
- **Değişti:** KV-04 işlem kataloğu 105 endpoint (belge ve test senkron).

## 1.14.0 — 2026-10-02 (Utku, KV-39 audit kaydı)

Kırıcı değişiklik yok (henüz uygulanmamış `admin.audit.list` cevabına alan ve sorguya isteğe bağlı filtre eklenmesi, yeni yardımcılar ve DB hata eşlemesi minor).

- **Eklendi:** `src/audit.ts`: `assertAuditEntry` (yazmadan önce doğrulama ve normalleştirme; API ve worker aynı kuralı kullanır), `auditOperations` / `allowedAuditOperations` (audit'li her KV-04 işleminin izinli `operation` değerleri açıkça; ör. `user.role.assign` → `grant` | `revoke` | `change`, `vote.invalidate` → `invalidate` | `restore`; tek değerlide verilmezse o değer, çok değerlide zorunlu; haritada olmayan katalog işlemi audit'e yazılamaz, kimliğin son parçası varsayılanı yalnız `systemAuditActions` için), `reasonRequiredActions` (gerekçesi zorunlu KV-04 işlemleri), `systemAuditActions` (`user.status.sync`), `auditTargetTypes`, `AUDIT_SUMMARY_MAX_CHARS`. KV-04 işlem kataloğu ve `authorize` değişmedi.
- **Eklendi:** `AuditSource` (`API` | `CLI` | `WORKER`). `AuditEntry`'ye `source` ve `operation`; `admin.audit.list` sorgusuna isteğe bağlı `operation` ve `source` filtreleri. Endpoint hâlâ uygulanmadı (ayrı KV-39 PR'ı); tüketici etkisi yok.
- **Eklendi:** `dbErrorMap`: `KV_AUDIT_LOGS_APPEND_ONLY` → `INTERNAL_ERROR`.
- **Düzeltildi:** `admin.audit.list` fixture'ı `action` olarak olay adını (`sanction.applied`) kullanıyordu; artık KV-04 işlem kimliği `user.sanction` + `operation: "apply"` + `source: "API"`.
- **Test:** `audit.test.ts`: gerekçesi zorunlu her işlem ve değiştiren her yönetici endpoint'inin işlemi `auditOperations`'ta olmalı (haritada olmayan audit'li işlem testi kırar); gerekçe listesi endpoint gövdeleriyle iki yönlü karşılaştırılır (gerekçesiz DELETE'i olan `featured.manage`, `announcement.manage`, `community.moderator.assign`, `media.ban.manage` bilinçli istisna), tür biçimi, `assertAuditEntry` kuralları.

## 1.12.1 — 2026-10-02 (Mert, KV-32 topluluk yönetimi)

Kırıcı değişiklik yok (şema hatası düzeltmesi, istek biçimi aynı).

- **Düzeltildi:** `admin.communities.update` gövdesinde `membersVisibility` zod 4 `partial()` yüzünden varsayılanı (`MEMBERS`) koruyordu; alan gönderilmese de görünürlük `MEMBERS`'a sıfırlanır ve "en az bir alan" kuralı hep geçerdi. Alan artık gerçekten isteğe bağlı.

## 1.12.0 — 2026-10-02 (Faruk, KV-43 oy geçersiz sayma)

Kırıcı değişiklik yok (yeni endpoint, yeni işlem ve yeni şemalar minor).

- **Eklendi:** `admin.votes.invalidate` (`POST /admin/votes/invalidate`; hedef `VOTES` veya `ACCOUNTS`, isteğe bağlı `pollId`) ve `admin.votes.restore` (`POST /admin/votes/restore`). İkisi de `ready`; gövde `reason` ister.
- **Eklendi:** `InvalidateVotesBody`, `RestoreVotesBody`, `VoteCorrectionResult`; KV-04 işlemi `vote.invalidate` (admin).
- **Değişti:** KV-04 işlem kataloğu 99 endpoint (belge ve test senkron).

## 1.11.0 — 2026-10-01 (Faruk, #66 içerik sürüm geçmişi)

Kırıcı değişiklik yok (planlı endpoint'in hazır olması ve yeni DB hata eşlemesi minor).

- **Değişti:** `admin.revisions.polls` / `admin.revisions.comments` artık `ready` (tablolar `poll_revisions`, `comment_revisions`, migration `20261001150000_faruk_kv66_content_revisions`). Sürüm 1 ilk paylaşımdır; her düzenleme yeni sürüm yazar.
- **Değişti:** `comments.update` notu: her düzenleme yeni sürüm olarak geçmişe yazılır.
- **Eklendi:** `dbErrorMap`: `KV_REVISIONS_APPEND_ONLY` → `INTERNAL_ERROR`.
- **Test:** `api-contracts.test.ts` V1_USER_FLOW kontrolü bilinçli güncellendi: sürüm geçmişi de hazır olmalı; puan endpoint'leri hâlâ planlı.

## 1.10.0 — 2026-10-01 (Faruk, #66 tartışma gönderileri ve gönderi tepkileri)

Kırıcı değişiklik yok (API_CONTRACTS §5: planlı endpoint'in hazır olması ve yeni DB hata eşlemesi minor).

- **Değişti:** `reactions.poll.put` / `reactions.poll.delete` artık `ready` (tablo `poll_reactions`, migration `20261001120000_faruk_kv66_discussions_reactions`).
- **Değişti:** `polls.create` notu: `kind=DISCUSSION` sağlayıcıda açık; yayın puanı #67 gelene kadar iki türde de yok.
- **Eklendi:** `dbErrorMap`: `KV_NOT_A_POLL` → `NOT_A_POLL`, `KV_POLL_KIND_IMMUTABLE` → `INTERNAL_ERROR`.
- **Test:** `api-contracts.test.ts` içindeki "V1_USER_FLOW endpointleri planlı" kontrolü bilinçli güncellendi: gönderi tepkileri artık hazır olmalı; puan ve sürüm geçmişi hâlâ planlı.

## 1.9.0 — 2026-09-30 (Faruk, KV-27 "Senin İçin" feed)

Kırıcı değişiklik yok (API_CONTRACTS §5: yeni ayar anahtarı minor).

- **Eklendi:** Ayar kayıt defterine `feed.explorationPercent` (0–50), `feed.maxSameAuthorPerWindow` (1–10),
  `feed.maxSameCategoryPerWindow` (1–10). Public değil. **Resmî değer yok** (`default: null`): PRODUCT_TEAM_PLAN §7
  ve #29 bunları admin ayarı olarak ister ama değer vermez. Öneri 20 / 2 / 4 (Faruk); API KV-40 gelene kadar bunları
  kullanır. Mehmet teyidi bekliyor (KV-04 açık konu 8).
- **Test:** `settings.test.ts` bilinçli olarak güncellendi: "feed.* kayıtta yok" kontrolü artık üç anahtarın
  kayıtlı, public olmayan ve varsayılansız olduğunu doğruluyor; eksik varsayılanlar listesine eklendiler; eksik
  alanlara verilen test girdisi tipe göre (boolean/tamsayı). `kv04-docs.test.ts` varsayılansız tamsayı ayarını da
  kabul ediyor.

## 1.8.0 — 2026-09-29 (Utku, KV-12 RBAC katmanı)

Kırıcı değişiklik yok (API_CONTRACTS §5: yeni fonksiyon ve DB hata eşlemesi minor; yeni refine DB'nin
zaten reddettiği gövdeyi sözleşmede de reddeder).

- **Eklendi:** `preauthorize(actor, action, now)` — `authorize`'ın kaynaktan bağımsız kısmı, API router'ının
  istek kapısı. `authorize` aynı karar fonksiyonunu kullanır; davranışı değişmedi. Test: her endpoint için
  kapının reddi tam kararda da ret, kaynaksız kuralda karar birebir aynı.
- **Eklendi:** `dbErrorMap`'e `KV_SANCTIONS_IMMUTABLE` → `INTERNAL_ERROR` (yaptırım geçmişi değişmez;
  migration `20260929151330_utku_kv12_admin_roles_sanctions`, DATA_MODEL §9.1).
- **Değişti:** `admin.sanctions.create` gövdesi `BAN` için `endsAt: null` ister (DB `sanctions_ban_permanent_check`
  ile aynı). Endpoint henüz uygulanmadı (KV-33); tüketici etkisi yok.

## 1.7.0 — 2026-09-28 (Faruk, KV-20 yayın limitleri)

Kırıcı değişiklik yok (API_CONTRACTS §5: yeni ayar anahtarı minor).

- **Eklendi:** Ayar kayıt defterine yayın limitleri (kaynak PRODUCT_TEAM_PLAN §13, public değil):
  `polls.newAccountPeriodDays` (7), `polls.newAccountDailyLimit` (3), `polls.newAccountCooldownMinutes` (30),
  `polls.dailyLimit` (10), `polls.cooldownMinutes` (10). KV-04 açık konu 9'un cooldown/günlük limit kısmı kapandı.
- **Test:** `settings.test.ts` "cooldown/günlük limit kayıtta yok" kontrolü bilinçli olarak güncellendi:
  artık bu 5 anahtarın kaynağı ve değerleri doğrulanıyor; `feed.*` ve trend katsayıları hâlâ kayıtta yok.

## 1.6.0 — 2026-09-28 (Faruk, KV-17 yorumlar)

Kırıcı değişiklik yok (API_CONTRACTS §5).

- **Değişti (metadata):** `reactions.comment.put` / `reactions.comment.delete` → `planned` yerine
  `ready`. Tablo `comment_reactions` KV-17 ile açıldı (migration
  `20260928210000_faruk_kv17_comment_reactions`); `comment_likes`'ın yerine geçer.
  Anket tepkileri (`reactions.poll.*`) #66'da planlı kalır.

## 1.5.0 — 2026-09-28 (Faruk, KV-11 oy sistemi)

Kırıcı değişiklik yok (API_CONTRACTS §5).

- **Eklendi:** `dbErrorMap`'e `KV_SELF_VOTE` → `SELF_VOTE_FORBIDDEN`. DB, anket sahibinin kendi
  anketine yazılan oyu trigger ile reddeder (migration `20260928200000_faruk_kv11_self_vote_guard`).

## 1.4.0 — 2026-09-28 (Mert, KV-16 medya API'si)

Kırıcı değişiklik yok (API_CONTRACTS §5: yeni hata kodu minor).

- **Eklendi:** `media.uploads.create` hata listesine `CONFLICT`: aynı `Idempotency-Key` işlenmeye
  başlamış bir yükleme için tekrar gelirse yeni upload URL'i verilmez (orijinalin üzerine yazılmaz).
- **Not:** `media.uploads.create` URL süresi ve imzalı başlıklar; `media.complete` için
  `not_uploaded` doğrulama hatası ve tekrar çağrı davranışı.

## 1.3.0 — 2026-09-28 (KV-06, #8 — Utku: mock sunucu fixture'ları)

Kırıcı değişiklik yok (API_CONTRACTS §5). Şema, endpoint ve hata kodu değişmedi; wire sürümü
`contractVersion = "1.0"` aynı.

- **Eklendi (minor):** `exports`'a `"./fixtures"` girişi. Fixture export'u güncel temel
  örnekleri koruyup mock ekran durumlarını ekleyen `fixtures/index.ts` üzerinden sunulur.
- **Eklendi (fixture):** tarihli trendler, boş liste durumları, içerik kilidi, gizli sonuç/
  geçersiz oy, medya pending/quarantined/rejected ve guest/unverified oy senaryoları.
- **Test:** paket dışı fixture import'u, endpoint içi benzersiz senaryo adları ve tüm
  genişletilmiş örneklerin request/response/error sözleşmelerine uyumu doğrulanır.

## 1.2.0 — 2026-09-28 (KV-04 + KV-03 devamı)

Kırıcı değişiklik yok (API_CONTRACTS §5). Wire sürümü `contractVersion = "1.0"` değişmedi.
KV-04 ayrıntısı: [`docs/KV-04_ROLES_EVENTS.md`](../../docs/KV-04_ROLES_EVENTS.md).

- **Eklendi (Utku, KV-04):**
  - `permissions.ts`: işlem kataloğu (`actions`), 97 endpoint'in her biri için yetki kuralı
    (`endpointPermissions`, `permissionForEndpoint`), saf `authorize(actor, action, resource, now)`,
    `restrictionsFromSanctions`, `highestRole`, `accountMediaPurposes`.
  - `events.ts`: olay kataloğu (`eventCatalog`: üretici, konu, aktör, strict payload, tüketiciler,
    KV-07 eşlemesi, bildirim tipi, hassas alanlar, doğal anahtar), `createEvent`, `parseEvent`,
    `dedupeKey`, `naturalKey`, `eventDelivery`, `isEventType`.
  - `settings.ts`: ayar kayıt defteri (`settingsRegistry`: tip, min/max, kaynaklı varsayılan,
    `PublicConfig` yolu), `parseSettingValue`, `validateSettings`, `defaultSettings`,
    `buildPublicConfig`, `emergencySwitchSettings`.
  - `eventTypes`'a 7 yeni tip: `vote.invalidated`, `report.resolved`, `sanction.applied`,
    `sanction.lifted`, `role.changed`, `settings.changed`, `featured.applied`.
  - `fixtures/events.ts`: her olay tipi için bir geçerli örnek.
- **Eklendi (Faruk, KV-03 devamı):** `PollViewer`'a `canVote` ve `voteBlockedReason`
  (`NOT_A_POLL`, `OWN_POLL`, `POLL_CLOSED`, `CONTENT_LOCKED`, `ACCOUNT_RESTRICTED`,
  `EMAIL_NOT_VERIFIED`, `VOTE_INVALIDATED`, `VOTE_CHANGE_DISABLED`). Kural `voteAvailability`
  yardımcısında ve `PUT /vote` hata sırasıyla aynı.
- **Değişti (ürün kararı, Mehmet 2026-09-28):** Anket sahibi oy veremediği için AFTER_VOTE
  anketinde de sonuçları her zaman görür. `resultsVisibleTo` opsiyonel `viewerIsAuthor` alır;
  verilmezse #64 davranışı aynen korunur.
- **Değişmedi:** `eventEnvelope` ve `canModerate` davranışı aynen korundu (#64 testleri geçiyor).
  `eventEnvelope`'a "yeni kod `createEvent` kullanır" notu eklendi.
- **Not:** KV-07 `featured_content_applied` artık `featured.applied`'a eşlenir; `community.featured`
  yalnız topluluk yüzeyi anlamında kalır.
- **Taslak:** 6 ayarın resmî varsayılanı yok (`polls.voteChangeAllowed`, `features.*`,
  `maintenance.enabled`); ilgili test `todo`. Bkz. KV-04 belgesi §5.

## 1.1.0 — 2026-09-28 (Mert: medya / moderasyon / topluluk)

Kırıcı değişiklik yok (API_CONTRACTS §5).

- **Eklendi (minor):** `MediaPurpose`'a `COMMUNITY` değeri. `admin.communities.create/update`
  içindeki `imageMediaId` için yüklenen görselin amacı; önceden karşılığı yoktu.
- **Değişti (metadata):** `communities.members`, `communities.join`, `communities.leave`,
  `admin.communities.moderators.put/delete` → `planned` yerine `ready`. Tablolar #73 ile açıldı.
- **Not:** `reports.create` — kapanmış raporun sahibi aynı hedefi yeniden raporlarsa aynı
  `reportId` `OPEN`'a döner (DB'de kullanıcı + hedef başına tek satır).
- DB enum'ları sözleşmeye hizalandı (`media_purpose`, `report_reason`, `moderation_action_type`);
  wire adları değişmedi.

## 1.0.0 — 2026-09-28 (KV-03, #5)

İlk tam v1 sözleşmesi.

- **Ürün düzeltmesi:** Anket sahibi kendi anketine oy veremez; `votes.put` için
  403 `SELF_VOTE_FORBIDDEN`, hata fixture'ı ve sözleşme testi eklendi. KV-11
  gerçek serviste bu kontrolü ilk oy, tekrar ve değişim için uygulamalıdır.

- **Geçiş:** Paket bağımlılıksız `.mjs`'ten TypeScript + zod 4.6.5'e taşındı (TECH_DECISIONS §2). #64'teki export adları (`contractVersion`, `errorStatuses`, `errorResponse`, `pageResponse`, `pollResults`, `eventEnvelope`, `roles`, `canModerate`), davranışları ve 5 testi aynen korundu. Giriş dosyası `src/index.mjs` → `src/index.ts`.
- **Eklendi:**
  - 10 domain için 97 endpoint tanımı: request/response şeması, yetki seviyesi, hata kodları, idempotency, cache, sağlayıcı ve tüketici.
  - `errorStatuses`'a 24 yeni kod; mevcut 9 kod ve status'ları değişmedi.
  - `resultsVisibleTo`, `dbErrorMap`, `allErrors`, `getEndpoint`, `endpoints`.
  - Her endpoint için fixture örnekleri (`fixtures/examples.ts`).
  - Domain olay tipleri: `vote.changed`, `comment.replied`, `reaction.changed`, `report.created`, `points.granted`, `points.debited`, `points.adjusted`.
- **Değişti (tüketicisi yoktu):** FOUNDATION_CONTRACTS'taki `PUT/DELETE /comments/:id/like` yerine `PUT/DELETE /comments/:id/reaction` (like/dislike, #66).
