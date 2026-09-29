# @kararver/contracts — Değişiklik günlüğü

Kurallar: [`docs/API_CONTRACTS.md` §5](../../docs/API_CONTRACTS.md#5-versiyonlama-ve-deprecation).
Kırıcı değişiklikler `contract-breaking` etiketiyle, bütün tüketici sahipleri reviewer olarak eklenerek yapılır.

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
