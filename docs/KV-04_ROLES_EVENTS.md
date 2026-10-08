# KararVer — Rol, Yetki, Olay ve Ayar Sözleşmesi (KV-04)

> Issue: **KV-04 / #6** · Sahip: **Utku** · Paket: `@kararver/contracts` 1.2.0
> Temel: [`FOUNDATION_CONTRACTS.md`](./FOUNDATION_CONTRACTS.md) "Yetki matrisi" ve "Olay ve ayar sözleşmesi" · Endpointler: [`API_CONTRACTS.md`](./API_CONTRACTS.md)

**Bağlayıcı kural koddadır.** Bu belge gerekçeyi, kararları ve açık konuları anlatır; kodla çelişirse kod esastır.

| Dosya | İçerik |
|---|---|
| `packages/contracts/src/permissions.ts` | İşlem kataloğu (`actions`), endpoint → işlem eşlemesi (`endpointPermissions`), saf `authorize(actor, action, resource, now)` |
| `packages/contracts/src/events.ts` | Olay kataloğu (`eventCatalog`), `createEvent`, `parseEvent`, `dedupeKey`, `naturalKey`, `eventDelivery` |
| `packages/contracts/src/settings.ts` | Ayar kayıt defteri (`settingsRegistry`), `parseSettingValue`, `validateSettings`, `defaultSettings`, `buildPublicConfig` |
| `packages/contracts/fixtures/events.ts` | Her olay tipi için bir geçerli örnek (mock tüketiciler için) |

Doğrulama: `pnpm contracts:test` (DB gerekmez), `pnpm typecheck`.

---

## 1. Yetki

### 1.1 Kullanım

```ts
import { authorize, permissionForEndpoint, restrictionsFromSanctions } from "@kararver/contracts";

// actor ve resource sunucu tarafından DB'den kurulur; request body/header/token claim'i kullanılmaz.
const decision = authorize(actor, permissionForEndpoint("admin.moderation.polls"), { communityId: poll.communityId }, new Date());
if (!decision.allowed) throw httpError(decision.code); // UNAUTHENTICATED | ACCOUNT_RESTRICTED | EMAIL_NOT_VERIFIED | FORBIDDEN | CONFLICT | SELF_VOTE_FORBIDDEN
```

- `TrustedActor`: `userId`, `roles` (`user_roles`), `status` (`users.status`), `emailVerified`, `sanctions` (kaldırılmamış `sanctions` satırları: `type`, `endsAt`), `moderatedCommunityIds` (`community_memberships.role = MODERATOR`).
- `now` zorunludur; süresi dolmuş yaptırımı (`endsAt <= now`) `authorize` kendisi eler. `endsAt = null` kalıcıdır.
- Bir kuralın `requires` listesindeki bağlam (ör. `ownerId`, `communityId`) verilmezse `authorize` TypeError fırlatır. Eksik bağlam servis hatasıdır; sessiz izin veya ret üretilmez.
- Her ret kodu ilgili endpoint'in sözleşmedeki hata kodları (`allErrors`) içindedir; test bunu bütün endpointler için doğrular.
- `preauthorize(actor, action, now)`: `authorize`'ın kaynaktan bağımsız kısmı (aynı kod yolu). `requires`'ı ve topluluk kapsamı olmayan kuralda `authorize` ile aynı kararı verir; diğerlerinde kapının reddi tam kararda da ret demektir (test: her endpoint için).

**API'de kullanım (KV-12, `apps/api/src/modules/rbac`).** Router her istekte handler'dan önce endpoint'in işlemiyle `preauthorize` çağırır; aktör (`user_roles`, aktif `sanctions`, gerekirse `community_memberships`) her istekte DB'den kurulur, önbellek yoktur. `ACCOUNT_RESTRICTED`'da `details[0].code` KV-04 işlem kimliğidir (ör. `comment.create`). Kaynağa bağlı kısım handler'dadır:

```ts
route("admin.reports.resolve", async ({ params, authorize }) => {
  const report = await store.get(params.id);           // topluluk DB'den, request'ten değil (§4.2)
  await authorize({ communityId: report.communityId }); // işlem verilmezse endpoint'in işlemi
  …
});
```

- Kuyruk listeleri `ctx.moderationScope()` ile filtrelenir: ADMIN/SUPER_ADMIN `{ all: true }`, MODERATOR `{ all: false, communityIds }`.
- Kaynak bağlamı gereken (`requires` veya topluluk kapsamı olan) endpoint'in handler'ı `ctx.authorize`'ı çağırmadan başarılı dönerse test/dev ortamında 500, production'da hata logu (unutulan kontrol sessiz izin olmasın). KV-12 öncesi, sahipliği kendisi kontrol eden handler'lar `LEGACY_RESOURCE_CHECKS` listesindedir; yeni endpoint listeye eklenmez.
- **Bilinen açık:** `RESTRICT_POSTING` içerik görseli yüklemeyi şu an engellemiyor. Avatar muafiyeti amaca bağlı olduğu için kapı karar veremez; `media.upload`/`media.complete` handler'larına `ctx.authorize({ mediaPurpose })` eklenmeli (Mert, KV-16).

### 1.2 Kurallar

1. **Public işlem** hesap durumuna bakmaz. BANNED/SUSPENDED oturumlu kullanıcı da public okuma yapabilir (FOUNDATION: "public okuma ve itiraz kanalı yaptırım durumundan ayrıdır").
2. **Oturum gerektiren işlem**: misafire 401. BANNED/SUSPENDED hesap oturum gerektiren hiçbir işlemi yapamaz (403 `ACCOUNT_RESTRICTED`).
3. **verified**: e-posta doğrulanmamışsa 403 `EMAIL_NOT_VERIFIED`. Rol istisnası yoktur.
4. **owner**: `resource.ownerId === actor.userId`. Admin sahip yerine geçmez; başkasının içeriği moderasyon endpointleriyle değiştirilir.
5. **Anket sahibi kendi anketine oy veremez** (403 `SELF_VOTE_FORBIDDEN`, rol istisnası yok).
6. **RESTRICTED işlem bazlıdır** (yaptırım tipinden türetilir, `WARNING` hiçbir yetkiyi etkilemez):

   | Kısıt | Kapanan | Açık kalan |
   |---|---|---|
   | `RESTRICT_COMMENTS` | yorum/cevap/alternatif oluşturma ve düzenleme | geri kalan her şey |
   | `RESTRICT_POSTING` | anket oluşturma ve düzenleme, ek açıklama, "Kararımı verdim", içerik amaçlı görsel (`POLL`, `COMMUNITY`) | avatar yükleme, geri kalan her şey |
   | Her ikisi | — | oy, tepki, kaydetme, takip, rapor, **kendi içeriğini silme**, anketi kapatma, hesap düzenleme |

7. **Yönetici işlemleri** (moderator/admin/super_admin) yalnızca `ACTIVE` hesapla yapılır; en yüksek rol geçerlidir, bilinmeyen rol değeri yok sayılır.
8. **Moderatör** yalnız atandığı topluluktaki kayıtta işlem yapar (`canModerate`, #64'teki davranış değişmedi). Kuyruk listeleri en az bir topluluğa atanmış moderatöre açılır.
9. **Yaptırım**: ADMIN yalnız USER/MODERATOR hesaplara; ADMIN/SUPER_ADMIN hedef SUPER_ADMIN ister. Kimse kendine yaptırım uygulayamaz veya kendi yaptırımını kaldıramaz (403).
10. **Rol atama** yalnız SUPER_ADMIN. Kendi rolünü değiştirme (yükseltme dahil) ve son aktif SUPER_ADMIN'i düşürme 409 `CONFLICT`.
11. **Audit** yalnız okunur; yazma/silme işlemi katalogda yoktur.

### 1.3 İşlem kataloğu

105 endpoint'in her biri tam olarak bir işleme bağlıdır. Eşlemesi olmayan endpoint, registry'de olmayan eşleme, kullanılmayan işlem veya endpoint `auth` seviyesiyle uyuşmayan kural testte kırılır.

| Seviye | İşlemler |
|---|---|
| public | `account.register` · `account.login` · `account.verifyEmail` · `account.recoverPassword` · `content.read` · `poll.share` |
| user | `session.logout` · `account.resendVerification` · `account.read` · `account.update` · `reaction.set` · `bookmark.set` · `bookmark.read` · `follow.set` · `interests.read` · `interests.set` · `points.read` · `report.create` · `community.join` · `community.leave` · `notification.read` · `notification.update` |
| verified | `poll.create` (kısıt: POSTING) · `vote.cast` (kural: selfVote) · `comment.create` (kısıt: COMMENTS) · `media.upload` (kısıt: POSTING, avatar hariç) |
| owner | `poll.update` (kısıt: POSTING) · `poll.close` · `poll.delete` · `poll.addendum.create` (kısıt: POSTING) · `comment.update` (kısıt: COMMENTS) · `comment.delete` · `decision.set` (kısıt: POSTING) · `media.complete` (kısıt: POSTING, avatar hariç) · `media.read` |
| moderator | `report.queue.read` (kapsam: queue) · `report.resolve` (kapsam: community) · `moderation.poll.apply` (kapsam: community) · `moderation.comment.apply` (kapsam: community) · `moderation.content.search` (kapsam: queue) · `moderation.content.history` (kapsam: community) · `moderation.poll.move` (kapsam: community) · `moderation.user.warn` (kapsam: community, kural: sanctionTarget) · `media.queue.read` (kapsam: queue) · `media.review` (kapsam: community) |
| admin | `revision.read` · `vote.invalidate` · `media.ban.manage` · `community.create` · `community.update` · `community.moderator.assign` · `user.read` · `user.sanction` (kural: sanctionTarget) · `user.sanction.lift` (kural: sanctionTarget) · `settings.read` · `audit.read` · `points.adjust` · `metrics.read` · `featured.manage` · `announcement.manage` · `category.manage` |
| super_admin | `user.role.assign` (kural: roleAssignment) · `settings.update` · `emergency.update` |

---

## 2. Olaylar

### 2.1 Zarf, kimlik ve teslim

- Zarf #64'ten gelir: `{version:1, id, type, occurredAt, actorId, subject:{type,id}, payload}`.
- **Kimlik**: UUIDv7, producer üretir, mutation ile aynı transaction'da outbox'a yazılır ve retry boyunca değişmez.
- **Kaynak**: `producer` (sahip + modül) katalogdadır; `actorId` işlemi yapan kullanıcı, sistem olaylarında (`poll.milestone`, `poll.trending`, süre dolumu) `null`.
- **Hedef**: `subject` tipi katalogla sınırlıdır; ID UUID, `SETTING` için ayar anahtarı.
- **Zaman**: `occurredAt` UTC ISO-8601 `Z`.
- **Teslim**: en az bir kez (outbox); exactly-once iddiası yok; sıralama garantisi yok.
- **Tekrar işleme**: tüketici `dedupeKey(event, handler)` ile işlenmiş kaydı tutar (`handler:event.id`); bildirim handler'ı alıcı başına `handler:event.id:recipientId`. Aynı iş farklı ID ile yeniden üretilebiliyorsa (job tekrar çalıştı) `naturalKey(event)` ikinci korumadır; yalnız gerçekten bir kez olabilen olaylarda tanımlıdır.
- **Doğrulama**: producer `createEvent`, tüketici `parseEvent` kullanır (§4.5).
- **Gizlilik**: payload'a serbest metin (yorum, gerekçe, not), e-posta veya IP yazılmaz. `sensitive` alanlar (oy seçimi, seçmen) bildirim verisine kopyalanmaz; bildirim üreten olayda hassas alan yoktur. Bildirim alıcısı payload'a yazılmaz, DB'den çözülür.
- **Analytics**: domain adı (`vote.submitted`) KV-07 adına (`vote_submitted`) adapterla çevrilir; eşleme katalogdadır ve testte KV-07 belgesiyle karşılaştırılır.

### 2.2 Katalog

| Tip | Üretici | Konu | Aktör | Tüketiciler | KV-07 | Bildirim | Doğal anahtar |
|---|---|---|---|---|---|---|---|
| `user.registered` | Faruk `auth` | USER | user | analytics, metrics | `user_registered`, `share_conversion_registered` | — | var |
| `poll.created` | Faruk `polls` | POLL | user | analytics, search, metrics | `poll_created` | — | var |
| `poll.closed` | Faruk `polls` | POLL | any | notifications, analytics, trends, snapshots | `poll_closed` | POLL_CLOSED | var |
| `vote.submitted` | Faruk `votes` | POLL | user | analytics, trends, metrics | `vote_submitted`, `share_conversion_contributed` | — | var |
| `vote.changed` | Faruk `votes` | POLL | user | analytics, trends | `vote_changed` | — | — |
| `vote.invalidated` | Faruk `votes` #45 | POLL | user | trends, snapshots, metrics | — | — | — |
| `comment.created` | Faruk `comments` | COMMENT | user | notifications, analytics, trends | `comment_created` | COMMENT_ON_POLL | — |
| `comment.replied` | Faruk `comments` | COMMENT | user | notifications, analytics, trends | `comment_created` | REPLY_TO_COMMENT | — |
| `alternative.created` | Faruk `comments` | COMMENT | user | notifications, analytics, trends | `alternative_created` | ALTERNATIVE_ON_POLL | — |
| `reaction.changed` | Faruk `reactions` | POLL, COMMENT | user | analytics, trends | `comment_liked`, `alternative_liked` | — | — |
| `decision.updated` | Mehmet `decision-updates` | POLL | user | notifications, analytics | `decision_update_created` | DECISION_UPDATED | — |
| `poll.milestone` | Faruk `votes` | POLL | system | notifications | — | POLL_MILESTONE | var |
| `poll.trending` | Faruk `trends` | POLL | system | notifications | — | POLL_TRENDING | var |
| `featured.applied` | Mehmet `featured` | POLL | user | analytics | `featured_content_applied` | — | var |
| `community.featured` | Mehmet `featured` | POLL | user | notifications | — | COMMUNITY_FEATURED | var |
| `moderation.applied` | Mert `moderation` | POLL, COMMENT | user | notifications, analytics, trends, search | `moderation_action_applied` | MODERATION_APPLIED | — |
| `announcement.published` | Mehmet `announcements` | ANNOUNCEMENT | user | cache | — | — | — |
| `report.created` | Mert `reports` | REPORT | user | analytics, metrics | `report_created` | — | — |
| `report.resolved` | Mert `reports` | REPORT | user | metrics | — | — | — |
| `points.granted` | Mehmet `points` | USER | any | metrics | — | — | var |
| `points.debited` | Mehmet `points` | USER | user | metrics | — | — | var |
| `points.adjusted` | Mehmet `points` | USER | user | metrics | — | — | var |
| `sanction.applied` | Utku `admin-users` | USER | user | notifications, search, metrics | — | SANCTION_APPLIED (yalnız WARNING, RESTRICT_*) | var |
| `sanction.lifted` | Utku `admin-users` | USER | user | search, metrics | — | — | var |
| `role.changed` | Utku `rbac` | USER | user | — | — | — | — |
| `settings.changed` | Utku `settings` | SETTING | user | cache | — | — | var |

Payload şemaları `events.ts` içindedir (strict zod). Kabul koşulundaki alanlar: oy (`vote.submitted`, `vote.changed`, `vote.invalidated`), kapanış (`poll.closed`), karar (`decision.updated`), yorum (`comment.created`, `comment.replied`), alternatif (`alternative.created`), trend (`poll.trending`), moderasyon (`moderation.applied`; gizle/geri yükle dahil). Payload'ları kendi üreticileri PR'da doğrular.

---

## 3. Ayarlar

- Anahtarlar `Setting.key` biçimindedir (`^[a-z]+(\.[a-zA-Z]+)+$`). Bilinmeyen anahtar `NOT_FOUND` (404), tip/aralık dışı değer `VALIDATION_ERROR` (400).
- Alanlar arası kurallar: `polls.minOptions ≤ polls.maxOptions`, `polls.minDurationHours ≤ polls.maxDurationHours`.
- Public anahtarlar `PublicConfig` alanlarına birebir karşılık gelir (test: eksik/fazla alan yok). `buildPublicConfig` eksik public değerde TypeError fırlatır; varsayılan uydurulmaz.
- Acil durum anahtarları (`PUT /admin/emergency`): `registration → features.registration`, `pollCreation → features.pollCreation`, `comments → features.comments`, `uploads → features.uploads`, `maintenance → maintenance.enabled`.
- **Varsayılan kuralı**: yalnız belgede veya contracts kaynağında (yorum/zod sınırı) geçen değer resmîdir ve kaynağıyla yazılır. Fixture değeri resmî değildir.

| Anahtar | Tip | Aralık | Varsayılan | Public | Kaynak |
|---|---|---|---|---|---|
| `polls.minOptions` | integer | 2 – 6 | 2 | `polls.minOptions` | `polls.ts` CreatePollBody.options `.min(2)`; `admin.ts` PublicConfig; PRODUCT_TEAM_PLAN §4 "2–6 seçenek" |
| `polls.maxOptions` | integer | 2 – 6 | 6 | `polls.maxOptions` | `polls.ts` CreatePollBody.options `.max(6)`; `admin.ts` PublicConfig; PRODUCT_TEAM_PLAN §4 |
| `polls.minDurationHours` | integer | 1 – 720 | 1 | `polls.minDurationHours` | `polls.ts` durationHours yorumu "varsayılan 1–720" |
| `polls.maxDurationHours` | integer | 1 – 720 | 720 | `polls.maxDurationHours` | `polls.ts` durationHours yorumu "varsayılan 1–720" |
| `polls.titleMaxLength` | integer | 10 – 200 | 200 | `polls.titleMaxLength` | `polls.ts` Title `.min(10).max(200)` |
| `polls.descriptionMaxLength` | integer | 0 – 5000 | 5000 | `polls.descriptionMaxLength` | `polls.ts` Description `.max(5000)` |
| `polls.newAccountPeriodDays` | integer | 0 – 90 | 7 | hayır | PRODUCT_TEAM_PLAN §13 "ilk 7 gün" (KV-20) |
| `polls.newAccountDailyLimit` | integer | 1 – 100 | 3 | hayır | PRODUCT_TEAM_PLAN §13 "maksimum 3 anket / 24 saat" (KV-20) |
| `polls.newAccountCooldownMinutes` | integer | 0 – 1440 | 30 | hayır | PRODUCT_TEAM_PLAN §13 "minimum 30 dakika" (KV-20) |
| `polls.dailyLimit` | integer | 1 – 1000 | 10 | hayır | PRODUCT_TEAM_PLAN §13 "maksimum 10 anket / 24 saat" (KV-20) |
| `polls.cooldownMinutes` | integer | 0 – 1440 | 10 | hayır | PRODUCT_TEAM_PLAN §13 "minimum 10 dakika" (KV-20) |
| `polls.voteChangeAllowed` | boolean | — | **yok** | `polls.voteChangeAllowed` | PRODUCT_TEAM_PLAN §5, DATA_MODEL §5.1 ayar olduğunu söyler, değer vermez |
| `comments.bodyMaxLength` | integer | 1 – 2000 | 2000 | `comments.bodyMaxLength` | `comments.ts` Body `.min(1).max(2000)` |
| `media.maxBytes` | integer | 1 B – 50 MB | 8 MB | `media.maxBytes` | MEDIA_MODERATION §5 madde 2; `media.ts` sizeBytes yorumu, `.max(50 MB)` |
| `media.maxPerPoll` | integer | 0 – 10 | 10 | `media.maxPerPoll` | `polls.ts` mediaIds `.max(10)` (varsayılan şu an tavana eşit) |
| `media.allowedTypes` | mimeTypes | 1 – 3 | jpeg, png, webp | `media.allowedTypes` | `media.ts` AllowedMimeType; MEDIA_MODERATION §5 madde 1 |
| `points.initialGrant` | integer | 0 – sınırsız | 20 | `points.initialGrant` | V1_USER_FLOW "Başlangıç puanı ve yayın maliyeti — V1" |
| `points.publishCost` | integer | 0 – sınırsız | 10 | `points.publishCost` | V1_USER_FLOW "Başlangıç puanı ve yayın maliyeti — V1" |
| `features.registration` | boolean | — | **yok** | `features.registration` | PRODUCT_TEAM_PLAN §16 anahtarı tanımlar, değer vermez |
| `features.pollCreation` | boolean | — | **yok** | `features.pollCreation` | aynı |
| `features.comments` | boolean | — | **yok** | `features.comments` | aynı |
| `features.uploads` | boolean | — | **yok** | `features.uploads` | aynı |
| `maintenance.enabled` | boolean | — | **yok** | `maintenance` | aynı |
| `trends.moversMinVotes` | integer | 0 – sınırsız | 30 | hayır | DATA_MODEL §8.3 "Eşikler" |
| `trends.moversMinActiveAccounts` | integer | 0 – sınırsız | 10 | hayır | DATA_MODEL §8.3 "Eşikler" |
| `feed.explorationPercent` | integer | 0 – 50 | **yok** | hayır | PRODUCT_TEAM_PLAN §7 ve #29 ayar olarak ister, değer vermez. Öneri 20 (Faruk, KV-27) |
| `feed.maxSameAuthorPerWindow` | integer | 1 – 10 | **yok** | hayır | aynı. Öneri 2 |
| `feed.maxSameCategoryPerWindow` | integer | 1 – 10 | **yok** | hayır | aynı. Öneri 4 |
| `limits.loginFailuresPerEmail` | integer | 1 – 100 | 5 | hayır | Giriş: aynı e-posta için 15 dakikada en fazla başarısız deneme. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.loginFailuresPerIp` | integer | 1 – 1000 | 20 | hayır | Giriş: aynı IP'den 15 dakikada en fazla başarısız deneme. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.registerPerIpHour` | integer | 1 – 1000 | 5 | hayır | Kayıt: aynı IP'den saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.recoveryPerEmailHour` | integer | 1 – 100 | 3 | hayır | Şifre sıfırlama / doğrulama tekrarı: aynı e-posta veya hesap için saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.recoveryPerIpHour` | integer | 1 – 1000 | 10 | hayır | Şifre sıfırlama / doğrulama tekrarı: aynı IP'den saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.votesPerMinute` | integer | 1 – 1000 | 30 | hayır | Oy: normal hesap dakikada en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountVotesPerMinute` | integer | 1 – 1000 | 15 | hayır | Oy: yeni hesap dakikada en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.commentsPerMinute` | integer | 1 – 1000 | 6 | hayır | Yorum: normal hesap dakikada en fazla (burst). KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountCommentsPerMinute` | integer | 1 – 1000 | 3 | hayır | Yorum: yeni hesap dakikada en fazla (burst). KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.commentsPerDay` | integer | 1 – 100000 | 200 | hayır | Yorum: normal hesap günde en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountCommentsPerDay` | integer | 1 – 100000 | 30 | hayır | Yorum: yeni hesap günde en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.reportsPerHour` | integer | 1 – 1000 | 10 | hayır | Şikâyet: normal hesap saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountReportsPerHour` | integer | 1 – 1000 | 5 | hayır | Şikâyet: yeni hesap saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.uploadsPerHour` | integer | 1 – 1000 | 20 | hayır | Görsel yükleme: normal hesap saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountUploadsPerHour` | integer | 1 – 1000 | 5 | hayır | Görsel yükleme: yeni hesap saatte en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.searchesPerMinute` | integer | 1 – 10000 | 60 | hayır | Arama: kullanıcı veya IP dakikada en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.writesPerMinute` | integer | 1 – 10000 | 60 | hayır | Diğer yazma işlemleri: normal hesap dakikada en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |
| `limits.newAccountWritesPerMinute` | integer | 1 – 10000 | 30 | hayır | Diğer yazma işlemleri: yeni hesap dakikada en fazla. KV-19 (#21); Mehmet onayı (2026-10-08, PR #152 tablosu) |

Kaynaklardaki dosyalar `packages/contracts/src/domains/` altındadır. Kayıtta **olmayanlar**: trend katsayıları ve feed sıralama ağırlıkları (§5). Cooldown ve günlük anket limiti KV-20 (#22), `feed.*` keşif payı ve tekrar sınırları KV-27 (#29) ile eklendi.

---

## 4. Kararlar

### 4.1 Kimse kendine yaptırım uygulayamaz
`user.sanction` ve `user.sanction.lift` hedefi aktörün kendisiyse 403 `FORBIDDEN`. **Gerekçe:** Kendi yaptırımını kaldırmak kontrolü boşa çıkarır; kendine yaptırım ise hesabı kilitleyip denetimi atlatmak veya "son SUPER_ADMIN" korumasını dolaylı delmek için kullanılabilir. Gerçek ihtiyaç başka bir yetkiliye yönlendirilir.

### 4.2 Tekil kayıtta her moderasyon işlemi authorize'dan geçer
Kuyruk/liste filtrelemesi serviste (moderatörün toplulukları) yapılabilir. Ancak tekil kayıt üzerindeki **her** moderasyon işleminde (`admin.moderation.*`, `admin.reports.resolve`, `admin.media.decide`) `authorize` o kaydın DB'den okunan `communityId`'si ile ayrıca çağrılır. **Gerekçe:** Liste filtresi yalnız görünürlüktür; ID tahmini veya bayat liste ile başka topluluğun kaydına istek gönderilebilir. Kaynağın topluluğu request'ten alınmaz.

### 4.3 RESTRICTED (ve SUSPENDED/BANNED) yönetici moderasyon yapamaz
Yönetici seviyesi işlemler yalnız `ACTIVE` hesapla yapılır; aksi 403. **Gerekçe:** #64'teki `canModerate` zaten `ACTIVE` ister; hakkında kısıt bulunan hesabın başkalarını yaptırıma bağlaması veya içerik kaldırması tutarsızdır. Kısıtı olan yönetici önce yaptırımını başka bir yetkiliye kaldırtır.

### 4.4 Audit kaydı mutation ile aynı transaction'da yazılır
Audit bir olay tüketicisi değildir. **Gerekçe:** Olay teslimi en az bir kezdir ve gecikebilir; audit kaydı işlemle atomik olmalıdır (işlem varsa kayıt var, işlem geri alındıysa kayıt yok). Olay kataloğunda `audit` tüketicisi bu yüzden yoktur (KV-39).

**Uygulama (KV-39):** `writeAudit(tx, entry)` (`apps/api/src/modules/audit/write.ts`) çağıranın transaction'ında yazar; kayıt önce contracts `assertAuditEntry` ile doğrulanır (`packages/contracts/src/audit.ts`). `action` bu belgedeki işlem kimliğidir (§1.3) veya aktörsüz sistem işlemidir (`systemAuditActions`: `user.status.sync`); işlem kataloğu ve `authorize` audit için değişmez. Aynı işlemin türleri (ör. `vote.invalidate` → `invalidate` | `restore`) ayrı `operation` sütununda tutulur (`auditOperations`). Gerekçesi zorunlu işlemler `reasonRequiredActions`'tadır; gerekçesiz çağrı TypeError'dur ve işlemi de geri alır. Tablo ve kurallar: DATA_MODEL §9.2.

### 4.5 `createEvent` / `eventEnvelope` ayrımı
`eventEnvelope` (#64) geriye uyumluluk için değişmeden kalır: yalnız zarfı doğrular (payload serbest, `id`/`subject` biçimi gevşek). **Yeni kod `createEvent` kullanır**: outbox'a yazma anında payload şeması, UUIDv7, konu tipi ve aktör kuralı katı doğrulanır. Tüketici girişinde aynı katılıkta `parseEvent` çalışır. **Gerekçe:** Zehirli mesaj (tüketicide sürekli hata veren olay) kuyruğa hiç girmemeli; `eventEnvelope`'u sıkılaştırmak mevcut çağıranlar için kırıcı olurdu. Test: katalogdaki her örnek olay hem `eventEnvelope`'tan hem `parseEvent`/`createEvent`'ten geçer; `eventEnvelope`'un kabul ettiği gevşek olaylar `createEvent`'te reddedilir.

### 4.6 `admin.communities.moderators.put` global rol vermez
Topluluk moderatörü atamak `community_memberships.role = MODERATOR` yazar; global `MODERATOR` rolünü değiştirmez. `canModerate` her ikisini de ister (değişmedi). **Gerekçe:** ADMIN'in topluluk ataması üzerinden dolaylı rol ataması yetki yükseltmesidir; global rol atama yalnız SUPER_ADMIN'dedir (`user.role.assign`). Sonuç: global rolü alınmış ama üyeliği MODERATOR kalan kullanıcı moderasyon yapamaz (testli). Ön koşul kontrolü açık konudur (§5, KV-32 [#34](https://github.com/mehmetalisahingm/kararver/issues/34)).

### 4.7 Avatar yüklemesi `RESTRICT_POSTING`'ten muaftır
`media.upload`/`media.complete` yalnız içerik amaçlı görselde (`POLL`, `COMMUNITY`, bilinmeyen amaç) kısıtlanır; `AVATAR` açıktır. **Gerekçe:** `RESTRICT_POSTING` içerik yayımlamayı durdurur; hesap bakımı (profil görseli) yayım değildir. Muafiyet `accountMediaPurposes` listesindedir; yeni amaç eklenirse varsayılan olarak kısıtlanır (fail-closed). Avatarın kendisi yine görsel moderasyonundan geçer (KV-08).

---

## 5. Açık konular

Issue numaraları mevcut eşlemeye göredir (KV-N → #N+2).

| # | Konu | Sahip | Issue |
|---|---|---|---|
| 1 | **İtiraz endpoint'i**: yaptırımlı kullanıcının itiraz kanalı yok. Public okuma gibi yaptırım durumundan ayrı olmalı (FOUNDATION); SUSPENDED/BANNED kullanıcı oturum açamadığı için oturumsuz bir akış gerekir. | Utku | KV-33 (#35)'ten ertelendi; ayrı iş olarak açılacak |
| 2 | **`moderators.put` ön koşulu**: hedefte global `MODERATOR` rolünü aramalı, yoksa hata dönmeli (ör. 409 `CONFLICT`); aksi hâlde atama sessizce etkisiz kalır (§4.6). | Mert | KV-32 ([#34](https://github.com/mehmetalisahingm/kararver/issues/34)) |
| 3 | **`community.featured` gerekli mi?** Genel öne çıkarma `featured.applied` ile taşınıyor; `community.featured` yalnız topluluk yüzeyi + `COMMUNITY_FEATURED` bildirimi için kaldı. Anlam daraltmak sonradan kırıcı olacağı için dar tutuldu. | Mehmet | KV-42 (#44) |
| 4 | **Milestone eşikleri**: `poll.milestone` hangi oy sayılarında üretilir? Hiçbir belgede değer yok. | Faruk (üretici), Utku (bildirim) | KV-21 (#23) |
| 5 | **Yaptırım bildirimi**: `NotificationType`'ta yaptırım tipi yok; kullanıcıya uyarı/kısıt bildirimi gidecek mi? Tip eklemek minor. | Utku | KV-21 (#23) |
| 6 | **`media.maxPerPoll` ürün varsayılanı**: varsayılan şu an tavana eşit (10); ürün varsayılanı Mehmet'e sorulacak. Tavan `polls.ts` mediaIds şemasıyla sabit; config ile API çelişmesin diye kayıtta `max = 10`. | Mehmet | KV-40 (#42) |
| 7 | **Puan tavanı**: `points.initialGrant` ve `points.publishCost` için üst sınır kaynakta yok (kayıtta sınırsız). | Mehmet | #67 |
| 8 | **Eksik 9 varsayılan**: `polls.voteChangeAllowed`, `features.registration`, `features.pollCreation`, `features.comments`, `features.uploads`, `maintenance.enabled`; KV-27 ile `feed.explorationPercent`, `feed.maxSameAuthorPerWindow`, `feed.maxSameCategoryPerWindow` (öneri 20 / 2 / 4, API geçici olarak bunları kullanır; Mehmet teyidi). Değer belgeye yazılınca `settings.test.ts`'teki `todo` kaldırılır. **PR bu yüzden taslaktır.** | Utku (kayıt), Mehmet (ürün), Faruk (`voteChangeAllowed`, KV-11 #13; `feed.*`, KV-27 #29) | KV-40 (#42) |
| 9 | **Kayıtta olmayan ayarlar**: ~~anket cooldown ve günlük anket limiti~~ (KV-20 ile eklendi: `polls.newAccount*`, `polls.dailyLimit`, `polls.cooldownMinutes`), trend katsayıları, feed sıralama ağırlıkları (~~`feed.*`~~ keşif payı/tekrar sınırı KV-27 ile eklendi, değerleri açık konu 8). Değerleri belirlenince kaynağıyla kayda eklenir (minor). | Faruk (polls, trends, feed), Utku (rate-limit) | KV-10 (#12), KV-28 (#30), #22 |
| 10 | ~~**Hız sınırı değerleri (KV-19)**~~ **Kapandı:** Mehmet önerilen değerleri onayladı (#21, 2026-10-08; PR #152 tablosu referans). Değerler `settings.ts`'te kaynağıyla. | — | KV-19 (#21) |
