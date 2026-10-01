# KararVer — API Sözleşmeleri v1 (KV-03)

> Issue: **KV-03 / #5** · Sahip: **Faruk** · Review: **Mehmet**
> Temel: [`FOUNDATION_CONTRACTS.md`](./FOUNDATION_CONTRACTS.md) (#64) · Veri: [`DATA_MODEL.md`](./DATA_MODEL.md) · Kararlar: [`TECH_DECISIONS.md`](./TECH_DECISIONS.md)
> Kaynak kod: `packages/contracts` (`@kararver/contracts` 1.2.0) · Son güncelleme: 2026-09-28

Bu belge ekibin bağlanacağı **sözleşmedir, endpoint implementasyonu değildir**. Her endpoint'in request/response şeması, validation kuralları, yetki seviyesi, başarı/hata kodları, idempotency davranışı, sağlayıcısı ve tüketicisi `packages/contracts/src/domains/*.ts` dosyalarında zod şeması olarak tanımlıdır. Bu belgedeki envanter tabloları o tanımlardan **otomatik üretilir** (§2–3); elle düzenlenmez.

---

## 1. Nasıl kullanılır

```ts
import { getEndpoint, PollDetail, CreatePollBody, errorStatuses } from "@kararver/contracts";

// Sağlayıcı (API): isteği doğrula, cevabı şemaya göre kur
const body = CreatePollBody.parse(req.body);          // 400 VALIDATION_ERROR'a çevrilir
const response = { data: PollDetail.parse(view) };    // fazladan alan varsa hata: sızıntı olmaz

// Tüketici (web): tipleri şemadan türet
type Poll = z.infer<typeof PollDetail>;
```

- **Şemalar strict'tir.** Tanımlanmamış bir alan hem istekte hem cevapta şema ihlalidir. Bu, DB nesnesinin cevaba yanlışlıkla yayılmasını (gizli sonuç, e-posta, iç durum) test seviyesinde yakalar.
- **Fixture'lar:** `packages/contracts/fixtures/examples.ts` her endpoint için en az bir başarılı örnek ve önemli hata senaryolarını içerir. Mock sunucu (KV-06) ve frontend demo adaptörü bunları kullanabilir. #64'teki `fixtures/polls.json` korunur.
- **Komutlar:**
  ```bash
  pnpm contracts:test                                # sözleşme testleri (DB gerekmez)
  pnpm --filter @kararver/contracts typecheck
  pnpm --filter @kararver/contracts docs             # §2–3 tablolarını registry'den yeniden üretir
  ```

**Yetki kısaltmaları:** **G** misafir (oturum varsa izleyiciye göre projeksiyon) · **U** giriş yapmış, BANNED/SUSPENDED değil · **V** U + e-posta doğrulanmış · **O** kaynağın sahibi · **M** moderatör (atandığı topluluk) · **A** admin · **SA** super admin. Rol ve topluluk kapsamı her zaman DB'den okunur (KV-04, FOUNDATION_CONTRACTS "Yetki matrisi").

**Durum sütunu:** *hazır*: sözleşme sabit, tablo mevcut veya sahibinin işinde. *planlı*: V1_USER_FLOW ile gelen ve **DB tablosu henüz olmayan** endpoint. Sözleşme bugünden sabittir; tablo belirtilen issue'nun migration'ı ile gelir (§6).

---

## 2. Endpoint envanteri

Bütün yollar `/v1` önekiyle yayınlanır (ör. `GET /v1/polls/:id`). "Başarı" sütunu olası başarı status'larıdır; hata kodları §4.6'da.

<!-- BEGIN:inventory -->
### Auth ve hesap

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `POST /auth/register`<br>Kayıt; doğrulama e-postası gönderilir · `auth.register` | G | 202 | — | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `POST /auth/login`<br>Giriş; httpOnly session cookie ayarlar · `auth.login` | G | 200 | — | Faruk `auth` | Ümit (web, KV-13) | #11 #15 #67 | hazır |
| `POST /auth/logout`<br>Mevcut oturumu iptal eder, cookie'yi siler · `auth.logout` | U | 204 | doğal | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `POST /auth/email/verify`<br>E-posta doğrulama bağlantısındaki token'ı kullanır · `auth.email.verify` | G | 200 | doğal | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `POST /auth/email/resend`<br>Doğrulama e-postasını yeniden gönderir · `auth.email.resend` | U | 202 | — | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `POST /auth/password/forgot`<br>Şifre sıfırlama e-postası · `auth.password.forgot` | G | 202 | — | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `POST /auth/password/reset`<br>Token ile yeni şifre; bütün oturumlar iptal edilir · `auth.password.reset` | G | 204 | — | Faruk `auth` | Ümit (web, KV-13) | #11 #15 | hazır |
| `GET /me`<br>Oturum sahibinin hesabı · `me.get` | U | 200 | — | Faruk `users` | Ümit (web, KV-13), Mehmet (profil, KV-22) | #11 #15 #24 | hazır |
| `PATCH /me`<br>Görünen ad, biyografi, avatar · `me.update` | U | 200 | doğal | Faruk `users` | Ümit (web, KV-13), Mehmet (profil, KV-22) | #11 #24 | hazır |

### Anket / tartışma, oy, tepki

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `POST /polls`<br>Anket veya tartışma gönderisi yayımlar (10 puan) · `polls.create` | V | 201 | **key zorunlu** | Faruk `polls` | Ümit (web) | #12 #66 #67 #15 #22 | hazır |
| `GET /polls/:id`<br>Anket detayı (izleyiciye göre sonuç projeksiyonu) · `polls.get` | G | 200 | — | Faruk `polls` | Ümit (web), Mehmet (paylaşım/SEO, KV-25) | #12 #15 #20 #27 | hazır |
| `GET /polls/lookup`<br>SEO URL'indeki publicId'den detay (/karar/<slug>-<publicId>) · `polls.lookup` | G | 200 | — | Faruk `polls` | Ümit (web), Mehmet (paylaşım/SEO, KV-25) | #12 #27 | hazır |
| `PATCH /polls/:id`<br>Sahibinin düzenlemesi · `polls.update` | O | 200 | doğal | Faruk `polls` | Ümit (web) | #12 | hazır |
| `POST /polls/:id/close`<br>Sahibin erken kapatması · `polls.close` | O | 200 | doğal | Faruk `polls` | Ümit (web) | #12 | hazır |
| `DELETE /polls/:id`<br>Sahibin kaldırması (soft delete) · `polls.delete` | O | 204 | doğal | Faruk `polls` | Ümit (web) | #12 | hazır |
| `POST /polls/:id/addenda`<br>Tarihli ek açıklama (kilitli ankete bilgi eklemenin tek yolu) · `polls.addenda.create` | O | 201 | key (ops.) | Faruk `polls` | Ümit (web) | #12 #20 | hazır |
| `PUT /polls/:id/vote`<br>Oy ver / değiştir (tek aktif oy) · `votes.put` | V | 200/201 | doğal | Faruk `votes` | Ümit (web) | #13 #15 #20 | hazır |
| `PUT /polls/:id/reaction`<br>Gönderiye beğeni/dislike (oydan ayrı) · `reactions.poll.put` | U | 200 | doğal | Faruk `reactions` | Ümit (web) | #66 #20 | hazır |
| `DELETE /polls/:id/reaction`<br>Gönderi tepkisini kaldırır · `reactions.poll.delete` | U | 200 | doğal | Faruk `reactions` | Ümit (web) | #66 #20 | hazır |
| `GET /polls/:id/history`<br>Günlük dağılım (grafik verisi, İstanbul günleri) · `polls.history` | G | 200 | — | Faruk `trends` | Ümit (trend/grafik, KV-30) | #31 #32 | hazır |

### Yorum ve alternatif öneri

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /polls/:id/comments`<br>Üst seviye yorumlar veya alternatifler · `comments.list` | G | 200 | — | Faruk `comments` | Ümit (web, KV-18) | #19 #20 | hazır |
| `GET /comments/:id/replies`<br>Bir yorumun cevapları (tek seviye) · `comments.replies` | G | 200 | — | Faruk `comments` | Ümit (web, KV-18) | #19 #20 | hazır |
| `POST /polls/:id/comments`<br>Yorum, cevap veya alternatif öneri · `comments.create` | V | 201 | key (ops.) | Faruk `comments` | Ümit (web, KV-18) | #19 #20 | hazır |
| `PATCH /comments/:id`<br>Kendi yorumunu düzenler · `comments.update` | O | 200 | doğal | Faruk `comments` | Ümit (web, KV-18) | #19 #20 | hazır |
| `DELETE /comments/:id`<br>Kendi yorumunu kaldırır (soft delete) · `comments.delete` | O | 204 | doğal | Faruk `comments` | Ümit (web, KV-18) | #19 #20 | hazır |
| `PUT /comments/:id/reaction`<br>Yoruma beğeni/dislike (#64'teki /comments/:id/like'ın yerine) · `reactions.comment.put` | U | 200 | doğal | Faruk `reactions` | Ümit (web, KV-18) | #66 #19 #20 | hazır |
| `DELETE /comments/:id/reaction`<br>Yorum tepkisini kaldırır · `reactions.comment.delete` | U | 200 | doğal | Faruk `reactions` | Ümit (web, KV-18) | #66 #19 #20 | hazır |

### Keşif: feed, arama, kategori, trend

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /feed`<br>Ana akış sekmeleri; kategori/topluluk filtresi · `feed.list` | G | 200 | — | Faruk `feed` | Ümit (web), Mert (topluluk akışı, KV-31) | #22 #29 #15 #32 #33 | hazır |
| `GET /search`<br>Anket, kullanıcı, kategori, topluluk araması (Türkçe normalizasyon) · `search.query` | G | 200 | — | Faruk `search` | Ümit (keşfet, KV-30) | #28 #32 | hazır |
| `GET /categories`<br>Aktif kategoriler (sıralı) · `categories.list` | G | 200 | — | Faruk `categories` | Ümit (web), Mehmet (onboarding, KV-15) | #28 #15 #17 | hazır |
| `GET /trends/:format`<br>Trend listesi (son başarılı çalıştırma) · `trends.list` | G | 200 | — | Faruk `trends` | Ümit (trend ekranları, KV-30) | #30 #31 #32 | hazır |

### Profil, kaydetme, takip, karar, paylaşım, puan

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /profiles/:username`<br>Herkese açık profil · `profiles.get` | G | 200 | — | Mehmet `profiles` | Ümit (web) | #24 | hazır |
| `GET /profiles/:username/polls`<br>Kullanıcının gönderileri · `profiles.polls` | G | 200 | — | Mehmet `profiles` | Ümit (web) | #24 | hazır |
| `GET /profiles/:username/comments`<br>Kullanıcının yorumları · `profiles.comments` | G | 200 | — | Mehmet `profiles` | Ümit (web) | #24 | hazır |
| `PUT /polls/:id/bookmark`<br>Kaydet · `bookmarks.put` | U | 200 | doğal | Mehmet `bookmarks` | Ümit (web) | #24 | hazır |
| `DELETE /polls/:id/bookmark`<br>Kaydı kaldır · `bookmarks.delete` | U | 200 | doğal | Mehmet `bookmarks` | Ümit (web) | #24 | hazır |
| `GET /me/bookmarks`<br>Kaydedilenler (sadece sahibi) · `bookmarks.list` | U | 200 | — | Mehmet `bookmarks` | Ümit (web) | #24 | hazır |
| `PUT /polls/:id/follow`<br>Sonucu takip et · `follows.put` | U | 200 | doğal | Mehmet `decision-updates` | Ümit (web) | #25 | hazır |
| `DELETE /polls/:id/follow`<br>Takibi bırak · `follows.delete` | U | 200 | doğal | Mehmet `decision-updates` | Ümit (web) | #25 | hazır |
| `PUT /polls/:id/decision`<br>Kararımı verdim (sahibin seçimi ve gerekçesi) · `decisions.put` | O | 200 | doğal | Mehmet `decision-updates` | Ümit (web) | #25 | hazır |
| `GET /me/interests`<br>Seçili ilgi kategorileri · `interests.get` | U | 200 | — | Mehmet `onboarding` | Ümit (web) | #17 | hazır |
| `PUT /me/interests`<br>İlgi kategorilerini ayarla (tam liste) · `interests.put` | U | 200 | doğal | Mehmet `onboarding` | Ümit (web) | #17 #29 | hazır |
| `POST /polls/:id/shares`<br>Kaynak ölçümlü paylaşım bağlantısı · `shares.create` | G | 201 | — | Mehmet `share` | Ümit (web) | #27 | hazır |
| `GET /announcements/active`<br>Şu an gösterilecek duyurular · `announcements.active` | G | 200 | — | Mehmet `announcements` | Ümit (web) | #44 | hazır |
| `GET /me/points`<br>Yayın puanı bakiyesi ve yayın maliyeti · `points.get` | U | 200 | — | Mehmet `points` | Ümit (web) | #67 #15 | planlı — tablo #67 migration'ı ile gelecek |
| `GET /me/points/ledger`<br>Puan hareketleri (append-only) · `points.ledger` | U | 200 | — | Mehmet `points` | Ümit (web) | #67 | planlı — tablo #67 migration'ı ile gelecek |

### Medya

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `POST /media/uploads`<br>Presigned upload URL'i (private karantina bucket'ı) · `media.uploads.create` | V | 201 | key (ops.) | Mert `media` | Ümit (web, KV-18) | #18 #20 | hazır |
| `POST /media/:id/complete`<br>Yükleme bitti; doğrulama ve moderasyon kuyruğa alınır · `media.complete` | O | 202 | doğal | Mert `media` | Ümit (web, KV-18) | #18 | hazır |
| `GET /media/:id`<br>Kendi görselinin durumu (istemci PENDING bitene kadar yoklar) · `media.get` | O | 200 | — | Mert `media` | Ümit (web, KV-18) | #18 #20 | hazır |

### Rapor ve moderasyon

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `POST /reports`<br>İçerik veya kullanıcı raporu · `reports.create` | U | 202 | doğal | Mert `reports` | Ümit (rapor modalı) | #26 | hazır |
| `GET /admin/reports`<br>Moderasyon kuyruğu · `admin.reports.list` | M | 200 | — | Mert `reports` | Mert (admin moderasyon UI, KV-37) | #26 #39 | hazır |
| `POST /admin/reports/:id/resolve`<br>Raporu sonuçlandır · `admin.reports.resolve` | M | 200 | doğal | Mert `reports` | Mert (admin moderasyon UI, KV-37) | #26 | hazır |
| `POST /admin/polls/:id/moderation`<br>Anket üzerinde gerekçeli moderasyon işlemi · `admin.moderation.polls` | M | 200 | doğal | Mert `moderation` | Mert (admin moderasyon UI, KV-37) | #39 #26 | hazır |
| `POST /admin/comments/:id/moderation`<br>Yorum üzerinde gerekçeli moderasyon işlemi · `admin.moderation.comments` | M | 200 | doğal | Mert `moderation` | Mert (admin moderasyon UI, KV-37) | #39 #26 | hazır |
| `GET /admin/media`<br>Görsel inceleme kuyruğu · `admin.media.list` | M | 200 | — | Mert `media` | Mert (admin moderasyon UI, KV-37) | #18 #40 | hazır |
| `POST /admin/media/:id/decision`<br>Görseli onayla / reddet · `admin.media.decide` | M | 200 | doğal | Mert `media` | Mert (admin moderasyon UI, KV-37) | #18 #40 | hazır |
| `GET /admin/polls/:id/revisions`<br>İçerik sürüm geçmişi · `admin.revisions.polls` | A | 200 | — | Faruk `polls` | Mert (moderasyon, KV-37), Utku (audit, KV-39) | #39 #41 | planlı — tablo #66 migration'ı ile gelecek |
| `GET /admin/comments/:id/revisions`<br>İçerik sürüm geçmişi · `admin.revisions.comments` | A | 200 | — | Faruk `comments` | Mert (moderasyon, KV-37), Utku (audit, KV-39) | #39 #41 | planlı — tablo #66 migration'ı ile gelecek |

### Topluluklar

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /communities`<br>Açık topluluklar · `communities.list` | G | 200 | — | Mert `communities` | Ümit (web), Mert (topluluk UI, KV-31) | #33 | hazır |
| `GET /communities/:slug`<br>Topluluk sayfası (akışı: GET /feed?communityId=) · `communities.get` | G | 200 | — | Mert `communities` | Ümit (web), Mert (topluluk UI, KV-31) | #33 | hazır |
| `GET /communities/:id/members`<br>Sayfalı üye listesi · `communities.members` | G | 200 | — | Mert `communities` | Ümit (web), Mert (topluluk UI, KV-31) | #33 | hazır |
| `PUT /communities/:id/membership`<br>Topluluğa katıl · `communities.join` | U | 200 | doğal | Mert `communities` | Ümit (web), Mert (topluluk UI, KV-31) | #33 | hazır |
| `DELETE /communities/:id/membership`<br>Topluluktan ayrıl · `communities.leave` | U | 204 | doğal | Mert `communities` | Ümit (web), Mert (topluluk UI, KV-31) | #33 | hazır |
| `POST /admin/communities`<br>Topluluk aç · `admin.communities.create` | A | 201 | key (ops.) | Mert `communities` | Mert (admin UI, KV-32) | #34 | hazır |
| `PATCH /admin/communities/:id`<br>Topluluğu düzenle / kapat · `admin.communities.update` | A | 200 | doğal | Mert `communities` | Mert (admin UI, KV-32) | #34 | hazır |
| `PUT /admin/communities/:id/moderators/:userId`<br>Topluluk moderatörü ata · `admin.communities.moderators.put` | A | 200 | doğal | Mert `communities` | Mert (admin UI, KV-32) | #34 | hazır |
| `DELETE /admin/communities/:id/moderators/:userId`<br>Topluluk moderatörlüğünü kaldır · `admin.communities.moderators.delete` | A | 204 | doğal | Mert `communities` | Mert (admin UI, KV-32) | #34 | hazır |

### Bildirimler

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /notifications`<br>Bildirimler (yeniden eskiye) · `notifications.list` | U | 200 | — | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #23 #37 | hazır |
| `GET /notifications/unread-count`<br>Okunmamış sayısı (rozet) · `notifications.unreadCount` | U | 200 | — | Utku `notifications` | Mehmet (bildirim merkezi, KV-35), Ümit (app shell) | #23 #37 | hazır |
| `POST /notifications/read`<br>Okundu işaretle (seçili veya hepsi) · `notifications.markRead` | U | 200 | doğal | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #23 #37 | hazır |
| `GET /notifications/preferences`<br>Bildirim tercihleri · `notifications.preferences.get` | U | 200 | — | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #36 #37 | hazır |
| `PATCH /notifications/preferences`<br>Tip bazında aç/kapat · `notifications.preferences.update` | U | 200 | doğal | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #36 #37 | hazır |
| `PUT /notifications/mutes/:pollId`<br>Bir anketin bildirimlerini sessize al · `notifications.mutes.put` | U | 200 | doğal | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #36 | hazır |
| `DELETE /notifications/mutes/:pollId`<br>Sessizi kaldır · `notifications.mutes.delete` | U | 200 | doğal | Utku `notifications` | Mehmet (bildirim merkezi, KV-35) | #36 | hazır |

### Platform ve admin

| Endpoint | Yetki | Başarı | Idempotency | Sağlayıcı | Tüketici | Açtığı iş | Durum |
|---|---|---|---|---|---|---|---|
| `GET /config`<br>Public limitler, puan maliyeti, özellik anahtarları · `config.get` | G | 200 | — | Utku `settings` | Ümit (web), herkes | #42 #15 #18 | hazır |
| `GET /admin/users`<br>Kullanıcı arama · `admin.users.list` | A | 200 | — | Utku `admin-users` | Utku (admin UI) | #35 | hazır |
| `GET /admin/users/:id`<br>Kullanıcı detayı, aktivite ve yaptırımlar · `admin.users.get` | A | 200 | — | Utku `admin-users` | Utku (admin UI) | #35 | hazır |
| `POST /admin/users/:id/sanctions`<br>Uyarı / kısıt / suspend / ban · `admin.sanctions.create` | A | 201 | key (ops.) | Utku `admin-users` | Utku (admin UI) | #35 | hazır |
| `POST /admin/users/:id/sanctions/:sanctionId/lift`<br>Yaptırımı kaldır · `admin.sanctions.lift` | A | 200 | doğal | Utku `admin-users` | Utku (admin UI) | #35 | hazır |
| `PUT /admin/users/:id/role`<br>Rol ata · `admin.roles.put` | SA | 200 | doğal | Utku `rbac` | Utku (admin UI) | #14 #35 | hazır |
| `GET /admin/settings`<br>Bütün sistem ayarları (sürümlü) · `admin.settings.list` | A | 200 | — | Utku `settings` | Utku (admin UI) | #42 | hazır |
| `PATCH /admin/settings/:key`<br>Tek ayarı değiştir (iyimser kilit) · `admin.settings.update` | SA | 200 | doğal | Utku `settings` | Utku (admin UI) | #42 | hazır |
| `PUT /admin/emergency`<br>Acil durum anahtarları (tek işlemle kapat/aç) · `admin.emergency.put` | SA | 200 | doğal | Utku `settings` | Utku (admin UI) | #42 | hazır |
| `GET /admin/audit`<br>Değiştirilemez audit kayıtları · `admin.audit.list` | A | 200 | — | Utku `audit` | Utku (admin UI) | #41 | hazır |
| `POST /admin/users/:id/point-adjustments`<br>Gerekçeli puan düzeltmesi · `admin.points.adjust` | A | 201 | **key zorunlu** | Mehmet `points` | Utku (admin UI) | #67 | planlı — tablo #67 migration'ı ile gelecek |
| `GET /admin/metrics`<br>Dashboard metrikleri · `admin.metrics.get` | A | 200 | — | Mehmet `analytics` | Mehmet (admin UI) | #38 | hazır |
| `GET /admin/featured`<br>Öne çıkarma listesi · `admin.featured.list` | A | 200 | — | Mehmet `featured` | Mehmet (admin UI) | #44 | hazır |
| `POST /admin/featured`<br>Öne çıkarma oluştur · `admin.featured.create` | A | 201 | key (ops.) | Mehmet `featured` | Mehmet (admin UI) | #44 | hazır |
| `PATCH /admin/featured/:id`<br>Öne çıkarma düzenle · `admin.featured.update` | A | 200 | doğal | Mehmet `featured` | Mehmet (admin UI) | #44 | hazır |
| `DELETE /admin/featured/:id`<br>Öne çıkarma kaldır · `admin.featured.delete` | A | 204 | doğal | Mehmet `featured` | Mehmet (admin UI) | #44 | hazır |
| `GET /admin/announcements`<br>Duyuru listesi · `admin.announcements.list` | A | 200 | — | Mehmet `announcements` | Mehmet (admin UI) | #44 | hazır |
| `POST /admin/announcements`<br>Duyuru oluştur · `admin.announcements.create` | A | 201 | key (ops.) | Mehmet `announcements` | Mehmet (admin UI) | #44 | hazır |
| `PATCH /admin/announcements/:id`<br>Duyuru düzenle · `admin.announcements.update` | A | 200 | doğal | Mehmet `announcements` | Mehmet (admin UI) | #44 | hazır |
| `DELETE /admin/announcements/:id`<br>Duyuru kaldır · `admin.announcements.delete` | A | 204 | doğal | Mehmet `announcements` | Mehmet (admin UI) | #44 | hazır |
| `GET /admin/categories`<br>Kategori listesi · `admin.categories.list` | A | 200 | — | Faruk `categories` | Mehmet (kategori yönetim ekranı, KV-41) | #28 #43 | hazır |
| `POST /admin/categories`<br>Kategori oluştur · `admin.categories.create` | A | 201 | key (ops.) | Faruk `categories` | Mehmet (kategori yönetim ekranı, KV-41) | #28 #43 | hazır |
| `PATCH /admin/categories/:id`<br>Kategori düzenle · `admin.categories.update` | A | 200 | doğal | Faruk `categories` | Mehmet (kategori yönetim ekranı, KV-41) | #28 #43 | hazır |
<!-- END:inventory -->

---

## 3. Açtığı işler (unblock haritası)

Sözleşme tamamlandığında aşağıdaki issue'lar mock/adapter ile geliştirmeye başlayabilir; gerçek entegrasyon sağlayıcı endpoint yayına alınınca yapılır.

<!-- BEGIN:unblocks -->
| Issue | Sözleşmesi hazır endpointler |
|---|---|
| #11 | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/email/verify`, `POST /auth/email/resend`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /me`, `PATCH /me` |
| #12 | `POST /polls`, `GET /polls/:id`, `GET /polls/lookup`, `PATCH /polls/:id`, `POST /polls/:id/close`, `DELETE /polls/:id`, `POST /polls/:id/addenda` |
| #13 | `PUT /polls/:id/vote` |
| #14 | `PUT /admin/users/:id/role` |
| #15 | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/email/verify`, `POST /auth/email/resend`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /me`, `POST /polls`, `GET /polls/:id`, `PUT /polls/:id/vote`, `GET /feed`, `GET /categories`, `GET /me/points`, `GET /config` |
| #17 | `GET /categories`, `GET /me/interests`, `PUT /me/interests` |
| #18 | `POST /media/uploads`, `POST /media/:id/complete`, `GET /media/:id`, `GET /admin/media`, `POST /admin/media/:id/decision`, `GET /config` |
| #19 | `GET /polls/:id/comments`, `GET /comments/:id/replies`, `POST /polls/:id/comments`, `PATCH /comments/:id`, `DELETE /comments/:id`, `PUT /comments/:id/reaction`, `DELETE /comments/:id/reaction` |
| #20 | `GET /polls/:id`, `POST /polls/:id/addenda`, `PUT /polls/:id/vote`, `PUT /polls/:id/reaction`, `DELETE /polls/:id/reaction`, `GET /polls/:id/comments`, `GET /comments/:id/replies`, `POST /polls/:id/comments`, `PATCH /comments/:id`, `DELETE /comments/:id`, `PUT /comments/:id/reaction`, `DELETE /comments/:id/reaction`, `POST /media/uploads`, `GET /media/:id` |
| #22 | `POST /polls`, `GET /feed` |
| #23 | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read` |
| #24 | `GET /me`, `PATCH /me`, `GET /profiles/:username`, `GET /profiles/:username/polls`, `GET /profiles/:username/comments`, `PUT /polls/:id/bookmark`, `DELETE /polls/:id/bookmark`, `GET /me/bookmarks` |
| #25 | `PUT /polls/:id/follow`, `DELETE /polls/:id/follow`, `PUT /polls/:id/decision` |
| #26 | `POST /reports`, `GET /admin/reports`, `POST /admin/reports/:id/resolve`, `POST /admin/polls/:id/moderation`, `POST /admin/comments/:id/moderation` |
| #27 | `GET /polls/:id`, `GET /polls/lookup`, `POST /polls/:id/shares` |
| #28 | `GET /search`, `GET /categories`, `GET /admin/categories`, `POST /admin/categories`, `PATCH /admin/categories/:id` |
| #29 | `GET /feed`, `PUT /me/interests` |
| #30 | `GET /trends/:format` |
| #31 | `GET /polls/:id/history`, `GET /trends/:format` |
| #32 | `GET /polls/:id/history`, `GET /feed`, `GET /search`, `GET /trends/:format` |
| #33 | `GET /feed`, `GET /communities`, `GET /communities/:slug`, `GET /communities/:id/members`, `PUT /communities/:id/membership`, `DELETE /communities/:id/membership` |
| #34 | `POST /admin/communities`, `PATCH /admin/communities/:id`, `PUT /admin/communities/:id/moderators/:userId`, `DELETE /admin/communities/:id/moderators/:userId` |
| #35 | `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/sanctions`, `POST /admin/users/:id/sanctions/:sanctionId/lift`, `PUT /admin/users/:id/role` |
| #36 | `GET /notifications/preferences`, `PATCH /notifications/preferences`, `PUT /notifications/mutes/:pollId`, `DELETE /notifications/mutes/:pollId` |
| #37 | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read`, `GET /notifications/preferences`, `PATCH /notifications/preferences` |
| #38 | `GET /admin/metrics` |
| #39 | `GET /admin/reports`, `POST /admin/polls/:id/moderation`, `POST /admin/comments/:id/moderation`, `GET /admin/polls/:id/revisions`, `GET /admin/comments/:id/revisions` |
| #40 | `GET /admin/media`, `POST /admin/media/:id/decision` |
| #41 | `GET /admin/polls/:id/revisions`, `GET /admin/comments/:id/revisions`, `GET /admin/audit` |
| #42 | `GET /config`, `GET /admin/settings`, `PATCH /admin/settings/:key`, `PUT /admin/emergency` |
| #43 | `GET /admin/categories`, `POST /admin/categories`, `PATCH /admin/categories/:id` |
| #44 | `GET /announcements/active`, `GET /admin/featured`, `POST /admin/featured`, `PATCH /admin/featured/:id`, `DELETE /admin/featured/:id`, `GET /admin/announcements`, `POST /admin/announcements`, `PATCH /admin/announcements/:id`, `DELETE /admin/announcements/:id` |
| #66 | `POST /polls`, `PUT /polls/:id/reaction`, `DELETE /polls/:id/reaction`, `PUT /comments/:id/reaction`, `DELETE /comments/:id/reaction` |
| #67 | `POST /auth/login`, `POST /polls`, `GET /me/points`, `GET /me/points/ledger`, `POST /admin/users/:id/point-adjustments` |
<!-- END:unblocks -->

Bağımlılığı olmayan KV-03 tüketicileri: #8 (KV-06, mock fixture ve CI) bu paketin `examples` ve şemalarını mock sunucu için kullanır; #6 (KV-04) olay ve yetki sözleşmesini bu envanterdeki `auth` seviyeleriyle eşler.

---

## 4. Ortak kurallar

### 4.1 Wire formatı
FOUNDATION_CONTRACTS'taki kurallar aynen geçerlidir:
- `/v1` öneki; JSON ve camelCase. DB'deki snake_case alanlar doğrudan yayınlanmaz.
- ID'ler UUIDv7 (`id`). Anket URL'i için ayrıca `publicId` ve `slug` döner.
- Zamanlar UTC ISO-8601 formatında ve `Z` ile biter. Takvim günleri (`localDate`) Europe/Istanbul'a göredir.
- Tekil cevap `{data}`, liste `{data, page:{nextCursor, hasMore}}`, hata `{error:{code, message, details}, requestId}`.
- `message` Türkçe ve kullanıcıya gösterilebilir. `details` alan hatalarıdır (`{field, code, message?}`); SQL, stack trace, token veya parola içermez.
- Para: `price.amount` ondalık **string**'tir (`"1250000.00"`), `currency` V1'de sadece `TRY`.

### 4.2 Anket kimliği
- API her yerde UUID `id` kullanır.
- SEO sayfası `/karar/<slug>-<publicId>` URL'ini `GET /v1/polls/lookup?publicId=` ile çözer. Cevap `polls.get` ile aynıdır ve `canonicalPath` içerir. Slug yanlışsa sayfa canonical adrese yönlendirir.
- Slug yetki veya kimlik kanıtı değildir.

### 4.3 Pagination
- Sadece cursor pagination var; `offset` ve `page` parametresi yok. Toplam sayı (count) dönülmez.
- `limit` varsayılan 20, en az 1, en fazla 100.
- `cursor` opak bir base64url değeridir. İstemci içeriğini yorumlamaz, sadece `page.nextCursor`'u geri gönderir. Liste bitince `nextCursor: null` ve `hasMore: false` gelir.
- Sağlayıcı cursor'a sürüm, sıralama anahtarı, `id` (eşitlik kırıcı) ve filtre hash'ini koyar. Filtre veya sekme değişip eski cursor gelirse **400 `INVALID_CURSOR`** döner; istemci listeyi baştan yükler.
- Sıralı ama değişen listeler:
  - **Trendler:** Cursor çalıştırma (`runId`) bilgisini taşır; kullanıcı aşağı kaydırırken sıralama değişmez. Yeni çalıştırma yayınlanınca eski cursor `INVALID_CURSOR` alır.
  - **`for_you` akışı:** Cursor üretim anını taşır; sayfalar arasında tekrar eden içerik olmaz.

### 4.4 Gizli sonuç (`AFTER_VOTE`)
Sonuç projeksiyonu `Results` iki biçimden biridir:

```json
{ "visible": false }
{ "visible": true, "total": 10, "options": [{ "id": "…", "votes": 6, "percent": 60 }] }
```

- **Görünürlük kuralı** (`resultsVisibleTo`): `ALWAYS`, **veya** anketin etkin kapanış zamanı geçmiş, **veya** izleyici anketin **sahibi**, **veya** izleyicinin *geçerli* bir oyu var. Oyu geçersiz sayılmış kullanıcı (`viewer.voteInvalidated`) oy vermemiş kabul edilir.
- **Anket sahibi sonuçları her zaman görür.** Sahip kendi anketine oy veremediği için (`SELF_VOTE_FORBIDDEN`), AFTER_VOTE kuralı ona da uygulansaydı sonucu kapanışa kadar hiç göremezdi. "Sahip" sunucuda oturum kullanıcısı ile DB'deki `author_id` karşılaştırılarak belirlenir; istemcinin gönderdiği bir değere güvenilmez. Sahibe giden cevap zaten `private, no-store`'dur.
- **Oy butonu durumu:** Oturumlu izleyicide `viewer.canVote` ve `viewer.voteBlockedReason` döner. Sebepler öncelik sırasıyla: `NOT_A_POLL`, `OWN_POLL`, `POLL_CLOSED`, `CONTENT_LOCKED`, `ACCOUNT_RESTRICTED`, `EMAIL_NOT_VERIFIED`, `VOTE_INVALIDATED`, `VOTE_CHANGE_DISABLED` (`voteAvailability`). `canVote: true` ancak sebep `null` iken olabilir; sahip için `canVote` hiçbir zaman `true` olamaz (şema reddeder). `PUT /vote` aynı sırayla aynı hataları döner (`OWN_POLL` → 403 `SELF_VOTE_FORBIDDEN`). Misafirde `viewer: null`; UI oy için giriş ister.
- **Gizliyken hiçbir yerde sayı yok:** Feed kartı, detay, arama, profil listeleri, trend listeleri, `polls.history` grafiği ve paylaşım kartı toplam oy dahil hiçbir sayı içermez. Kartta ayrıca bir `voteCount` alanı yoktur; şema bunu reddeder.
- **`WEEKLY_MOVERS`** yüzde değişimi gösterdiği için sadece sonucu herkese açık anketleri (ALWAYS veya kapanmış) içerir.
- **Cache:** `cache: viewer` endpointlerinde misafire giden cevap izleyiciden bağımsız bir projeksiyondur ve paylaşılan cache'e konabilir. Oturumlu kullanıcıya giden cevap `Cache-Control: private, no-store` taşır. Gizli sonuçlu içeriğin SSR HTML'i de aynı kurala uyar (KV-11 kabul koşulu).
- Admin ve moderatör sonucu public endpointlerden değil, admin endpointlerinden görür.
- Tartışma gönderisinde (`kind: DISCUSSION`) `results: null` ve `options: []` döner.

### 4.5 Idempotency

| Tür | Anlamı | Nerede |
|---|---|---|
| **doğal** | PUT/DELETE ve durum komutları (close, resolve): aynı istek aynı sonucu verir | oy, tepki, kaydet, takip, üyelik, moderasyon |
| **key (ops.)** | `Idempotency-Key` gönderilirse tekrar aynı cevabı döner; gönderilmezse normal create | yorum, ek açıklama, medya, admin create |
| **key zorunlu** | Başlık yoksa 400 `IDEMPOTENCY_KEY_REQUIRED` | puan harcayan: `polls.create`, `admin.points.adjust` |

- **Anahtar:** İstemci her *mantıksal* işlem için bir UUID üretir ve ağ tekrarlarında aynı anahtarı kullanır. Biçim: `[A-Za-z0-9_-]{8,128}`.
- **Kapsam** aktör + route + anahtar; saklama süresi 24 saat. Aynı anahtar ve aynı gövde ilk cevabın aynısını (status dahil) döner. Aynı anahtar ve farklı gövde **409 `IDEMPOTENCY_KEY_REUSED`**.
- Anahtar, DB unique kısıtlarının ve transaction'ın yerine geçmez.
- **Oy** için anahtar gerekmez:
  - İlk oy 201.
  - Aynı seçeneğe tekrar oy 200 ve yeni olay üretilmez.
  - Farklı seçenek: ayar izin veriyorsa 200 ve `CHANGE` olayı, vermiyorsa 409 `VOTE_CHANGE_DISABLED`.
  - Eşzamanlı istekler `UNIQUE(poll_id,user_id)` çakışmasıyla yakalanır; satır tekrar okunur ve aynı kurallar uygulanır (DATA_MODEL §5).
- **Yayın ve puan:** Gönderi oluşturma ile 10 puanlık harcama aynı transaction'dadır. Başarısız yayın puan harcamaz. Aynı anahtarla gelen tekrar ikinci bir harcama üretmez (#67).

### 4.6 Hata kodları

Liste `packages/contracts/src/errors.ts` → `errorStatuses` içinde. #64'teki 9 kod ve status'ları aynen korundu.

| HTTP | Kodlar |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_CURSOR`, `IDEMPOTENCY_KEY_REQUIRED`, `TOKEN_INVALID_OR_EXPIRED`, `COMMENT_DEPTH_EXCEEDED` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `SELF_VOTE_FORBIDDEN` (sahip kendi anketine oy veremez), `ACCOUNT_RESTRICTED` (`details[0].code` = kısıtlanan işlem) |
| 404 | `NOT_FOUND` (yetkisiz izleyici için gizli veya kaldırılmış içerik de 404; varlık sızmaz) |
| 409 | `CONFLICT`, `POLL_CLOSED`, `CONTENT_LOCKED`, `POLL_CONTENT_LOCKED`, `NOT_A_POLL`, `VOTE_CHANGE_DISABLED`, `VOTE_INVALIDATED`, `COMMENTS_DISABLED`, `USERNAME_TAKEN`, `DUPLICATE_TITLE`, `INSUFFICIENT_POINTS`, `IDEMPOTENCY_KEY_REUSED`, `VERSION_CONFLICT`, `MEDIA_NOT_USABLE` |
| 413 / 415 | `MEDIA_TOO_LARGE` / `MEDIA_TYPE_NOT_ALLOWED` |
| 429 | `RATE_LIMITED`, `PUBLISH_COOLDOWN`, `DAILY_PUBLISH_LIMIT`: hepsi `Retry-After` (saniye) ile |
| 500 | `INTERNAL_ERROR` |
| 503 | `FEATURE_DISABLED` (acil durum anahtarı), `MAINTENANCE` (`Retry-After` ile) |

**Her endpoint'e otomatik eklenenler** (`allErrors()`):
- Hepsine: `VALIDATION_ERROR`, `RATE_LIMITED`, `MAINTENANCE`, `INTERNAL_ERROR`.
- Yetki seviyesine göre: `UNAUTHENTICATED`, `ACCOUNT_RESTRICTED`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN`.
- Idempotency türüne göre ilgili kodlar; path'inde `:id` olanlara `NOT_FOUND`.

Endpoint tanımındaki `errors` sadece o endpoint'e özgü kodlardır.

**İki kilit farklıdır:**
- `POLL_CONTENT_LOCKED`: İlk geçerli oydan sonraki içerik kilidi (`first_valid_vote_at`). Sadece düzenlemeyi engeller.
- `CONTENT_LOCKED`: Moderasyonun uyguladığı `LOCKED` durumu. Yeni oy ve yorumu da engeller.

**DB hatası → API kodu** (`dbErrorMap`):

| DB | API | Not |
|---|---|---|
| `KV_POLL_CONTENT_LOCKED` (P0001) | 409 `POLL_CONTENT_LOCKED` | İlk oy kilidi trigger'ı |
| `KV_COMMENT_DEPTH` (P0001) | 400 `COMMENT_DEPTH_EXCEEDED` | `details[0].field = "parentId"` |
| `KV_VOTE_EVENTS_APPEND_ONLY`, `KV_VOTE_IDENTITY_IMMUTABLE` | 500 `INTERNAL_ERROR` | Kod hatası; loglanır, istemciye ayrıntı verilmez |
| `23505` `votes (poll_id,user_id)` | — (hata değil) | Doğal idempotency: mevcut oy okunur (§4.5) |
| `23505` `users.username_normalized` | 409 `USERNAME_TAKEN` | |
| `23505` `users.email_normalized` | — | Kayıt yine 202 döner, hesap varlığı sızmaz |
| `23503` `votes (poll_id, option_id)` | 400 `VALIDATION_ERROR` (`field: optionId`) | Başka anketin seçeneği |
| `23514` CHECK ihlalleri | 500 `INTERNAL_ERROR` | API bunları önceden doğrular; DB'ye ulaşması kod hatasıdır |

### 4.7 Başlıklar ve cache
| Başlık | Yön | Kural |
|---|---|---|
| `X-Request-Id` | cevap (her zaman), istek (ops.) | Hata gövdesindeki `requestId` ile aynıdır. KV-07 olaylarındaki `request_id` ve audit kayıtları bununla eşlenir |
| `Idempotency-Key` | istek | §4.5 |
| `Retry-After` | cevap | 429 ve 503 `MAINTENANCE` |
| `Cache-Control` | cevap | `public`: paylaşılan cache'e konabilir (kısa TTL). `viewer`: misafire public, oturumluya `private, no-store`. `private`: her zaman `private, no-store` |
| `Deprecation`, `Sunset` | cevap | §5 |

Cookie session ve CSRF kuralları FOUNDATION_CONTRACTS ve TECH_DECISIONS §3.4'tedir: `credentials: include`, mutation'larda `Origin` kontrolü, CORS allowlist.

### 4.8 Ölçüm kaynağı (KV-07)
`feed.list` isteğe bağlı `source` (`discovery_source`) parametresi alır. Paylaşım bağlantıları `?s=<shareId>` taşır. Analytics olayları sadece sunucu işlemi onayladıktan sonra üretilir; domain olay adları (`vote.submitted`) ile analytics adları (`vote_submitted`) adapter ile ayrılır (#64). KV-03'te eklenen domain olayları: `vote.changed`, `comment.replied`, `reaction.changed`, `report.created`, `points.granted`, `points.debited`, `points.adjusted`. Olay listesinin nihai sahibi KV-04'tür (Utku).

---

## 5. Versiyonlama ve deprecation

**Sürümler:**
- Wire sözleşmesinin major'ı URL'dedir (`/v1`).
- `@kararver/contracts` paketi semver kullanır; ilk sürüm `1.0.0` (bu PR).
- `contractVersion` sabiti `"1.0"` olarak kalır.

| Değişiklik | Tür | Paket sürümü |
|---|---|---|
| Yeni endpoint, yeni **opsiyonel** istek alanı, cevaba yeni alan, yeni hata kodu, *açık* enum'a yeni değer | Kırıcı değil | minor |
| Doküman, not veya fixture düzeltmesi | Kırıcı değil | patch |
| Alan silme veya yeniden adlandırma, tip değişikliği, yeni **zorunlu** istek alanı, daha sıkı validation, status veya hata kodu değişikliği, *kapalı* enum'a yeni değer, auth seviyesinin yükselmesi | **Kırıcı** | major (V1 sonrası `/v2`) |

**Açık ve kapalı enum'lar:**
- *Açık* (istemci bilinmeyen değeri tolere eder, genel gösterim yapar): `NotificationType`, `ModerationAction`, `FeaturedSurface`, `ReportReason`, `LedgerReason`, hata kodları.
- *Kapalı* (istemci her değeri özel işler): `PollKind`, `ResultsVisibility`, `ContentStatus`, `UserStatus`, `Role`, `MediaStatus`, `TrendFormat`, `ReactionValue`.

**Public V1'den önce** (production tüketicisi yok):
- Kırıcı değişiklik tek bir koordineli PR ile yapılır.
- PR'a `contract-breaking` etiketi konur.
- Etkilenen bütün tüketici sahipleri reviewer olarak eklenir; envanterdeki "Tüketici" sütunu kimin ekleneceğini gösterir.
- `packages/contracts/CHANGELOG.md` güncellenir ve #5'e değişikliği özetleyen bir yorum yazılır.

**Public V1'den sonra:**
- Kırıcı değişiklik yeni bir endpoint veya `/v2` olarak eklenir.
- Eski sürüm en az **2 hafta** paralel çalışır; bu sürede cevaplara `Deprecation: true` ve `Sunset: <HTTP-date>` başlıkları eklenir.
- Deprecation, envanterdeki `notes` alanına ve CHANGELOG'a yazılır.
- Sunset tarihinden sonra endpoint `410 Gone` döner. Bu kod V1'de kullanılmıyor; eklenmesi minor bir değişikliktir.

**Duyuru kanalları:**
- `CHANGELOG.md`, PR etiketi ve #5 yorumu.
- CODEOWNERS: `packages/contracts` ve bu belge için Faruk, Mehmet ve Ümit'ten biri onaylar.
- Değişiklik başka bir modülü etkiliyorsa o modülün sahibi de PR'a eklenir (TECH_DECISIONS §6).

**Contract testi kapısı:**
- `pnpm contracts:test`, `main` CI'ında her push'ta çalışır.
- Şema değişip fixture'lar güncellenmezse, bir endpoint'in başarılı örneği eksikse veya bu belgedeki envanter registry'den farklıysa test kırılır.

---

## 6. Gerekli migration'lar (bu PR migration eklemez)

| Değişiklik | Neden | Ekleneceği iş |
|---|---|---|
| `idempotency_keys` (aktör, route, anahtar, istek hash'i, cevap, `expires_at`) | §4.5 `key-required` / `key-optional` | **KV-10 (#12)**; ilk kullanan `polls.create` |
| "İlk giriş" tekilliği (`users.first_login_at` veya ledger'da kullanıcı başına tek `INITIAL_GRANT` kısıtı) | İlk girişte tek 20 puan, paralel girişte de | **KV-09 (#11)** ve #67 |
| `polls.kind` (`POLL`/`DISCUSSION`), tartışmada `closes_at` ve `results_visibility` nullable | Anketsiz gönderi | ✅ #66 (`20261001120000_faruk_kv66_discussions_reactions`) |
| Yorum tepkileri: ✅ `comment_reactions` (KV-17, #19); `comment_likes`'ın yerine geçti. Anket tepkileri (`poll_reactions`, aynı `reaction_value` enum'u) | Like/dislike | Yorum: ✅ KV-17 · Gönderi: ✅ #66 |
| İçerik sürüm geçmişi (`poll_revisions`, `comment_revisions`) | `admin.revisions.*` | #66 |
| `point_ledger` (append-only, bakiye ≥ 0) | Yayın puanı | #67 (Mehmet) |
| `polls.trend_excluded_at` | `EXCLUDE_FROM_TRENDS` moderasyon işlemi | ✅ Sütun **KV-28 (#30)** ile açıldı, trend job'u uyar; yazan işlem KV-37 (#39) |
| `community_memberships`, `communities` alanları | Üyelik ve üye listesi | KV-31 (#33) |
| `media_assets` alanları, `reports`, admin/growth tabloları | İlgili modüller | Sahiplerinin işleri (DATA_MODEL §9) |

**Migration dışında gereken işler:**

| İş | Ayrıntı | Ekleneceği iş |
|---|---|---|
| **Sahip oy yasağı** | `PUT /vote`'ta sunucu, oturum kullanıcısını anketin DB'deki `author_id`'siyle karşılaştırır ve eşitse 403 `SELF_VOTE_FORBIDDEN` döner. Bu kontrol ilk oy, tekrar ve değişimde uygulanır; hiçbir oy, olay veya sayaç yazılmaz. `viewer.canVote` / `voteBlockedReason` aynı `voteAvailability` kuralından üretilir. **DB seviyesinde de** korunuyor: `votes` üzerinde BEFORE INSERT/UPDATE trigger'ı (`user_id = polls.author_id` ise `KV_SELF_VOTE`), API'de 403'e eşlenir (migration `20260928200000_faruk_kv11_self_vote_guard`). | ✅ **KV-11 (#13)** |
| Sahibin sonuçları görmesi | Sonuç projeksiyonu `resultsVisibleTo({ …, viewerIsAuthor })` ile kurulur; sahip bilgisi DB'den gelir | KV-10 (#12), KV-11 (#13) |

---

## 7. Ürün kararları

1. **Karara bağlandı (Mehmet, 2026-09-28): Anket sahibi kendi anketine oy veremez.** Sunucu 403 `SELF_VOTE_FORBIDDEN` döner; tekrar ve oy değişimi dahil hiçbir oy, olay veya sayaç yazılmaz. Rol istisnası yoktur. KV-11 servis implementasyonunda bu kontrol zorunludur (§6).
2. **Karara bağlandı (Mehmet, 2026-09-28): Yayın, yorum ve oy için e-posta doğrulaması şart; tepki (like/dislike) için giriş yeterli.** Gerekçe: Oylar trendlere giriyor ve doğrulanmamış hesaplar manipülasyon yolu olur.
   Akış: Misafir oy verince giriş ekranına gider. Doğrulanmamış hesap `viewer.voteBlockedReason = EMAIL_NOT_VERIFIED` alır (oy denerse 403) ve "e-postanı doğrula" ekranına yönlenir. Bu, V1_USER_FLOW'daki "etkileşimden login'e ve aynı içeriğe dönüş" akışına bir doğrulama adımı ekler.
3. **Karara bağlandı (Mehmet, 2026-09-28): `@kararver/contracts` TypeScript + zod'a taşındı.** #64'teki export adları ve testleri korundu.
4. **Yeni karar, Mehmet'in teyidi bekleniyor (Faruk, 2026-09-28): Anket sahibi sonuçları her zaman görür.** 1. kararın yan etkisi: Sahip oy veremiyorsa ve AFTER_VOTE kuralı ona da uygulanırsa, kendi anketinin sonucunu kapanana kadar hiç göremez. Bu yüzden görünürlük kuralına "izleyici sahipse görünür" eklendi (§4.4).
5. **Teyit bekliyor:** Tartışma gönderisinin süresi yok; tartışma kapanmaz (`closesAt: null`).
6. **Teyit bekliyor:** Kayıtta e-posta çakışması hesap varlığı sızmasın diye her zaman 202 dönüyor; mevcut hesaba "zaten hesabın var" e-postası gidiyor.

## 8. Açık konular

| # | Konu | Kim |
|---|---|---|
| 1 | `LOCKED` anket sonucu gösterir mi? Sözleşme görünürlük kuralını uygular; `LOCKED` sadece yeni oy ve yorumu engeller (FOUNDATION) | KV-11 |
| 2 | İçerik sürüm geçmişi tablosunun kesin issue'su (şimdilik #66) | Faruk + Mehmet |
| 3 | `for_you` sıralama sinyallerinin ayrıntısı; sözleşme sadece cursor davranışını sabitler | KV-27 |
| 4 | Olay adlarının nihai listesi ve payload'ları | KV-04 (Utku) |
| 5 | Mock sunucu: `examples` üzerinden MSW veya küçük bir Fastify mock'u | KV-06 (Utku) |
