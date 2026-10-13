# KV-32 / #184 — Topluluk yönetim görünümü

> Sahip: **Mert** · Kaynaklar: [DATA_MODEL](./DATA_MODEL.md), [KV-04](./KV-04_ROLES_EVENTS.md), [KV-54](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md) (sahiplik tasarımı), #172 (başvuru ve 7 gün / 10 üye eşiği), #184 (topluluğun tam yönetimi)

Bu belge yöneticinin toplulukları **görmesi ve kararın etkisini önceden öngörmesi** içindir (#184'ün ilk dilimi). Durum değişikliği (açma/kapatma, düzenleme, moderatör atama) mevcut gerekçeli ve auditli endpoint'lerle yapılır (`admin.communities.update`, `admin.communities.moderators.*`); bu dilim yazma davranışını değiştirmez.

## 1. Endpoint'ler (hepsi salt okuma, ADMIN+, `community.admin.read`)

| Endpoint | Yol | Ne verir |
|---|---|---|
| `admin.communities.listAll` | `GET /admin/communities?status&q&cursor&limit` | **Kapalı topluluklar dahil** liste (en yeni önce). `q` ad veya slug içinde arar (≥ 2 karakter, büyük/küçük harf duyarsız). Satırda canlı üye, moderatör ve silinmemiş anket sayısı ile eşik özeti. Cursor süzgece bağlıdır: süzgeç değişince 400 `INVALID_CURSOR`. |
| `admin.communities.overview` | `GET /admin/communities/:id/overview` | Durum, yaratıcı, **etki sayıları**, **eşik durumu** ve **son 10 yönetim izi**. |
| `admin.communities.members` | `GET /admin/communities/:id/members?q&role&cursor&limit` | Yönetici üye listesi: arama (kullanıcı adı/görünen ad), rol süzgeci, katılım zamanına göre yeniden eskiye. |

- **Hassas alan yok:** üye listesi public listeyle aynı `CommunityMember` şemasıdır (kullanıcı adı, görünen ad, avatar, rol, katılım tarihi); e-posta, gerçek kimlik, hesap durumu ve silinmiş hesaplar dönmez. `membersVisibility` ayarı **yöneticiye uygulanmaz** (kapalı topluluk ve "yalnız moderatörler" listesi de görülür); public endpoint'in 404 davranışı değişmedi.
- **Okuma audit yazmaz** (KV-33 `user.read` ile aynı politika).

## 2. Etki sayıları (kapatma/açma kararından önce)

`impact` şu anki durumu sayar; hiçbir şey silinmez, yalnız görünürlük ve katılım değişir (KV-32):

| Alan | Tanım |
|---|---|
| `members`, `moderators` | Canlı üyelik satırları (silinmiş hesaplar hariç) |
| `polls` | `REMOVED` olmayan anketler |
| `activePolls` | `ACTIVE` anketler |
| `openPolls` | `ACTIVE`, tür `POLL`, kapanmamış ve süresi dolmamış (hâlâ oy alan) |
| `comments` | `ACTIVE` anketlerdeki `ACTIVE` yorum toplamı (`comment_count`) |
| `openReports` | Topluluktaki anket veya yorumlara açık (`OPEN`) raporlar |

**Kapatma etkisi (mevcut davranış):** topluluk public listeden/sayfadan, katılımdan ve yeni anket açmaktan çıkar; üyelikler, anketler ve moderatör rolleri silinmez, yeniden açılınca olduğu gibi döner.

## 3. 7 gün / 10 üye eşiği (#172) durumu

Kuralı **uygulayan** günlük worker'dır (`community.requests.expire`, her gün 03:10 UTC: onay tarihinden 7 gün sonra 10'dan az üye varsa topluluk `HIDDEN`, başvuru `CLOSED`). Bu görünüm kuralı yalnız **gösterir**:

| `threshold.state` | Anlamı |
|---|---|
| `NOT_APPLICABLE` | Yönetici açtı (başvuru yok); eşik uygulanmaz |
| `IN_PROGRESS` | Süre sürüyor; `members/10`, `daysLeft` (yukarı yuvarlanmış), `approvalDeadline` |
| `REACHED` | Süre doldu ve 10+ üye var; topluluk açık kalır |
| `OVERDUE` | Süre doldu, eşik altı: **günlük worker kapanışı bekleniyor** (worker gecikmesi burada görünür). Topluluk **elle `HIDDEN`** yapılmışsa worker kapatmaz (yalnız `ACTIVE` topluluğu işler); durum `OVERDUE` olarak kalır |
| `AUTO_CLOSED` | Worker kapattı (`closedAt`); topluluk `HIDDEN`. Yönetim izinde `community.request.expire` (aktörsüz sistem işlemi) görünür |
| `REOPENED` | Otomatik kapanıştan sonra yönetici yeniden açtı. Başvuru `CLOSED` kaldığı için worker **bir daha kapatmaz** |

- **Eşzamanlılık:** üye sayısı canlı satırlardan sayılır (önbellek sütunu `member_count` değil); worker kapanış kararını topluluk satırı kilidi altında, kendi sayımıyla verir (`expire-requests.ts`), yani panelde görünen ile worker'ın kararı arasında bir anlık fark olabilir; worker kararı kesindir.
- **Kapatmadan geri açma:** `AUTO_CLOSED` topluluk `admin.communities.update` (`status: ACTIVE`, gerekçeli) ile açılır; panel bunu "yeniden açılan topluluk tekrar otomatik kapanmaz" notuyla gösterir.

## 4. Son yönetim izi

`recentChanges`: topluluk hedefli son 10 audit kaydı (`target_type = COMMUNITY`): zaman, işlem (`community.update`, `community.create`, moderatör atama/kaldırma, başvuru kararı, otomatik kapanış), **gerekçe** ve aktör (sistem işleminde `null`). Önce/sonra özeti dönmez; ayrıntı için `admin.audit.list` (KV-39).

## 5. Panel

Yönetici panelindeki **Topluluklar** sekmesinde "Topluluk durumu ve eşik" bölümü: durum/arama süzgeci, satırda eşik rozeti, "Genel bakış" ile etki sayıları, eşik açıklaması, son yönetim izi, üye arama ve **etkiyi gösteren** kapatma/yeniden açma penceresi (gerekçe zorunlu). Kapalı topluluk artık "Kimlikle işlem" yerine listeden açılabilir.

## 6. Test ve sınırlar

- `apps/api/test/community-admin-read.test.ts`: saf eşik fonksiyonu (tüm durumlar ve sınır anı), yetki matrisi, kapalı topluluklar dahil liste, süzgeç ve sayfalama (cursor süzgece bağlı), sayılar (silinmiş hesap ve kaldırılmış anket sayılmaz), etki sayıları, salt okuma, yönetim izi, **başvuru → onay → süre dolumu → worker kapanışı → yeniden açma** uçtan uca, 10 üyeye ulaşan topluluğun kapanmaması, üye listesi görünürlük ayarına takılmaz ve hassas alan taşımaz.
- **Kapsam dışı (#184'ün sonraki dilimleri):** sahip devri ve sahiplik talebi ([KV-54](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md) S2–S3; kritik teyit #182'ye bağlı), sahibe yetki verme, üyelik rolü değiştirme/çıkarma, katılım koşulları, moderatör kapsam ihlallerinde 403 + audit görünürlüğü.

## 7. Topluluk sahibi — atama ve koruma (KV-54 S1)

Tasarım: [KV-54](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md) §3 ve §5. Bu dilim **yalnız altyapıdır**: sahip kaydı, yönetici atama/bırakma, son sahip koruması. Sahiplik şimdilik **ek yetki vermez** (düzenleme, moderatör atama, devir ve talep KV-54 S2–S3).

**Bayrak:** `communities.ownershipEnabled` (KV-40 ayarı, **varsayılan kapalı**). Kapalıyken sistem V1 ile birebir aynıdır: `admin.communities.owner.put` 503 `FEATURE_DISABLED`, #172 başvuru onayı sahip atamaz. Mevcut sahiplik verisi korunur ve okunur; **bırakma bayrak kapalıyken de çalışır** (güvenli yön).

| Konu | Kural |
|---|---|
| Model | `communities.owner_id` (boş olabilir = yönetici yönetimi). **Yeni `community_role` değeri yok:** mevcut rol mantığı ve V1 endpoint'leri değişmedi |
| Atama | `admin.communities.owner.put` (SUPER_ADMIN, gerekçeli): aday **ACTIVE, silinmemiş, e-postası gerçekten doğrulanmış** olmalı (`user_not_eligible`; geçici doğrulama gevşetmesi yok sayılır) ve en çok **3** topluluğa sahip olabilir (`owner_limit`). Üye değilse MEMBER olarak eklenir (sayaç aynı transaction'da); mevcut moderatör rolü korunur. Aynı kullanıcı zaten sahipse değişiklik ve audit yok (idempotent). Eski sahip değişimde üye kalır |
| Bırakma | `admin.communities.owner.release` (SUPER_ADMIN, gerekçeli) ve `communities.owner.release` (sahibin kendisi; başkası ve sahipsiz topluluk 403). Üyelik ve içerik etkilenmez |
| Son sahip koruması | Sahip topluluktan **ayrılamaz** (`communities.leave` 409 `owner_must_release`): önce sahipliği bırakır. DB tetikleyicileri (migration) aynı kuralı doğrudan SQL'e ve yarışa karşı da uygular: sahip üye olmak zorundadır, sahibin üyeliği silinemez |
| #172 başvuru onayı | Bayrak açıkken başvuran onayla birlikte sahip olur (aynı transaction; ikinci audit `community.owner.assign` / `assign`, `trigger: request_approval`). Uygun değilse (3 sınırı, doğrulanmamış e-posta) topluluk **sahipsiz kalır, onay engellenmez**. Bayrak kapalıyken audit biçimi V1 ile aynıdır |
| BAN | BAN uygulanan hesabın sahip olduğu topluluklar **aynı transaction'da** yönetici yönetimine döner (audit `community.owner.assign` / `auto_release`, aktör yaptırımı uygulayan yönetici, gerekçe yaptırım gerekçesi; yaptırım audit'inde `communitiesReleased`, yalnız > 0 iken). SUSPEND sahipliği düşürmez (süreli, topluluk sahibini bekler) |
| Kilit sırası | Önce aday kullanıcı satırı (`FOR NO KEY UPDATE`: aynı kullanıcıya iki atama ve BAN sıraya girer, 3 sınırı yarışta aşılmaz), sonra topluluk satırı (`FOR UPDATE`: leave, atama, bırakma sıraya girer). BAN yolu da kullanıcıdan topluluğa gider: döngü yok |
| Görünüm | `AdminCommunityRow` ve `AdminCommunityOverview` `owner` taşır (kimlik, kullanıcı adı, görünen ad; e-posta yok). Public şemalar değişmedi. Panelde genel bakışta sahip satırı; SUPER_ADMIN için "Sahip ata/değiştir/kaldır" |

**Audit:** `community.owner.assign` (`assign`, `release`, `auto_release`; gerekçe zorunlu) ve `community.owner.release` (sahibin kendi bırakması; gerekçesiz). Hedef `COMMUNITY`; önce/sonra yalnız kullanıcı kimlikleri.

**KV-54 §10 senaryoları:** I1 (bayrak kapalıyken V1 aynı: mevcut topluluk testleri değişmeden geçer), I2, I3 (mevcut testler), I4/I5 (sahip admin uçlarına, moderatör atamaya, yaptırıma, başka topluluğa erişemez: 403), I10'un ayrılma ve BAN kısmı, I18 (bayrak kapanınca atama 503, sahiplik korunur).

**Bilinen sınırlar**
- **Hesap silme/anonimleştirme** akışı henüz yok (#181 sonraki dilim): geldiğinde `releaseOwnedCommunities` (`communities/owner.ts`) aynı transaction'da çağrılmalı; o zamana kadar yalnız BAN yolu bağlıdır.
- Sahip değişimi/bırakma için **olay (outbox) ve bildirim** yok; yalnız audit. Eski/yeni sahibe bildirim KV-54 S3 ile gelir.
- Zorunlu atama kritik işlemdir; **ikinci onay/MFA (#182, PR #206) bağlanmadı** (gerekçe + audit var). #206 merge olunca `community.owner.assign` için ikinci onay istenmesi önerilir.
- 3 topluluk sınırı ve uygunluk kuralları KV-54 §12'deki öneri değerlerdir (Mehmet teyidi bekliyor).

**Test:** `apps/api/test/community-owner.test.ts` (bayrak varsayılan kapalı ve açılıp kapanması, yetki matrisi, atama/idempotency/değişim/üyelik ekleme, uygunluk, 3 sınırı ve **4 paralel atamada sınırın aşılmaması**, iki kullanıcının aynı anda atanması, bırakma, sahibin kendi bırakması, ayrılma koruması ve DB tetikleyicileri, **ayrılma ile atama yarışı**, #172 onayı (açık/kapalı/sınır), BAN ve SUSPEND, sahibin ek yetkisi olmadığı, liste/genel bakış görünümü).
