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
- **Kapsam dışı (#184'ün sonraki dilimleri):** sahip atama/devir ve son sahip koruması ([KV-54](./KV-54_COMMUNITY_OWNERSHIP_VERIFICATION.md) S1–S3; kritik teyit #182'ye bağlı), üyelik rolü değiştirme/çıkarma, katılım koşulları, moderatör kapsam ihlallerinde 403 + audit görünürlüğü.
