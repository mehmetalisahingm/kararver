# @kararver/contracts — Değişiklik günlüğü

Kurallar: [`docs/API_CONTRACTS.md` §5](../../docs/API_CONTRACTS.md#5-versiyonlama-ve-deprecation).
Kırıcı değişiklikler `contract-breaking` etiketiyle, bütün tüketici sahipleri reviewer olarak eklenerek yapılır.

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
