# KV-33 — Admin kullanıcılar, yaptırımlar ve roller

> Issue: **KV-33 / #35** · Sahip: **Utku** · Sözleşme: `@kararver/contracts` 1.15.0 (`packages/contracts/src/domains/admin.ts`)
> Kod: `apps/api/src/modules/admin-users/`, `apps/api/src/modules/rbac/roles-routes.ts` · Testler: `apps/api/test/admin-users.test.ts`, `apps/api/test/admin-roles.test.ts`
> İlgili: [`DATA_MODEL.md`](./DATA_MODEL.md) §9.1 (yaptırım servis kuralları), §9.2 (audit) · [`KV-04_ROLES_EVENTS.md`](./KV-04_ROLES_EVENTS.md) (yetki)

KV-33 üç PR'dır: **PR-A** `audit_logs` ve `writeAudit` (KV-39), **PR-B** bu belgedeki endpoint'ler, **PR-C** süresi dolan yaptırımlar için `users.status` senkron job'ı (§6).

## 1. Endpoint'ler

| Endpoint | Metod ve yol | Yetki (KV-04) | Gerekçe | Audit (`action` / `operation`) |
|---|---|---|---|---|
| `admin.users.list` | `GET /admin/users?q&status` | `user.read` (ADMIN+) | — | yok (okuma) |
| `admin.users.get` | `GET /admin/users/:id` | `user.read` | — | yok |
| `admin.users.sanctions` | `GET /admin/users/:id/sanctions` | `user.read` | — | yok |
| `admin.users.reports` | `GET /admin/users/:id/reports?side=against\|filed` | `user.read` | — | yok |
| `admin.users.activity` | `GET /admin/users/:id/activity` | `user.read` | — | yok |
| `admin.sanctions.create` | `POST /admin/users/:id/sanctions` | `user.sanction` (`sanctionTarget`) | zorunlu | `user.sanction` / `apply` |
| `admin.sanctions.lift` | `POST /admin/users/:id/sanctions/:sanctionId/lift` | `user.sanction.lift` (`sanctionTarget`) | zorunlu | `user.sanction.lift` / `lift` |
| `admin.users.passwordReset.send` | `POST /admin/users/:id/password-reset` | `user.password.reset` (ADMIN+, `sanctionTarget`) | zorunlu | `user.password.reset` / `send` |
| `admin.users.dataExports.create` / `.list` / `.deliver` | `POST`/`GET /admin/users/:id/data-exports`, `POST …/:exportId/deliver` | `privacy.export.manage` (SUPER_ADMIN) | zorunlu (create, deliver) | `privacy.export.manage` / `request` \| `deliver` |
| `dataExports.download` | `POST /me/data-export/download` | `privacy.export.download` (kullanıcı, kendi paketi) | yok | `privacy.export.download` / `download` |
| `admin.users.contentJobs.preview` / `.create` / `.list` / `.undo` / `.cancel` | `GET …/content-jobs/preview`, `POST`/`GET /admin/users/:id/content-jobs`, `POST …/:jobId/undo`, `POST …/:jobId/cancel` | `user.content.bulk` (ADMIN+, `sanctionTarget`) | zorunlu (create, undo, cancel) | `user.content.bulk` / `request` \| `undo` \| `cancel` |
| `admin.roles.put` | `PUT /admin/users/:id/role` | `user.role.assign` (SUPER_ADMIN, `roleAssignment`) | zorunlu | `user.role.assign` / `grant` \| `revoke` \| `change` |

- **Arama (`q`):** en az 3 karakter (daha kısa 400). Kullanıcı adı ve görünen adda içerir araması (`kv_normalize … LIKE '%q%'`, KV-26 trigram GIN index'leri). `q` `@` içeriyorsa yalnız e-postada tam eşleşme (`email_normalized` unique index); e-postada içerir araması yoktur (PII taraması olmasın). Sayfalama `id DESC` (UUIDv7 ≈ kayıt zamanı). Silinmiş hesaplar durumlarıyla listelenir. Migration gerekmedi.
- **`roles`:** kullanıcı başına tek global rol; rol satırı yoksa `["USER"]`.
- **`reportCount` ve rapor geçmişi (`against`):** hesaba yapılan raporlar ve kullanıcının anketine, yorumuna, görseline yapılan raporlar, her durumda. `filed`: kullanıcının yaptığı raporlar. Raporlayanın kimliği dönmez (kuyrukla tutarlı).
- **Aktivite:** anket ve yorumlar, gizli/kaldırılmış dahil, durumlarıyla. Oylar yalnız sayı olarak `stats.voteCount`'ta (geçersiz sayılanlar hariç); oy seçimi hassastır, listelenmez.
- Okuma endpoint'leri audit yazmaz (`user.read` audit'li değil).

## 2. Yaptırım kuralları

| Durum | Sonuç |
|---|---|
| WARNING'de `endsAt` | 400 `VALIDATION_ERROR` (contracts) |
| SUSPEND'de `endsAt` yok / BAN'da `endsAt` var | 400 (contracts, DB CHECK'leriyle aynı) |
| `endsAt` geçmişte | 400 `VALIDATION_ERROR` (`field: endsAt`, `code: past`) |
| Aynı tipte aktif yaptırım (WARNING hariç) | 409 `already_active` |
| Farklı tipe geçiş (ör. SUSPEND aktifken BAN) | serbest; ikisi birlikte aktif kalır, durum önceliğe göre |
| Silinmiş hesaba yeni yaptırım | 409 `user_deleted` |
| ACTIVE son SUPER_ADMIN'e SUSPEND/BAN | 409 `last_super_admin` (pratikte yalnız yarışta oluşur, bkz. §4) |
| Zaten kaldırılmış yaptırımı kaldırma | 409 `already_lifted`, audit yok |
| Süresi dolmuş yaptırımı kaldırma | 409 `expired`, audit yok |
| Silinmiş hesabın yaptırımını kaldırma | serbest |
| Başka kullanıcının yaptırım id'si | 404 |

- **`users.status` senkronu:** uygulama ve kaldırma aynı transaction'da `users.status`'u kalan aktif yaptırımlardan yeniden hesaplar (`statusFromSanctions`: BAN > SUSPEND > RESTRICT_* → RESTRICTED > ACTIVE; WARNING etkisiz). Örnek: SUSPEND ve BAN birlikte aktifken BAN kaldırılırsa durum `SUSPENDED` olur; SUSPEND de kaldırılırsa kalan kısıta göre `RESTRICTED` veya `ACTIVE` (testli).
- **Kaldırma idempotent değildir** (`idempotency: none`): tekrar deneyen istemci 409 `already_lifted` alırsa işlemi başarılı sayar.
- **Uygulama `Idempotency-Key` kabul eder** (key-optional). Anahtar hedef kullanıcıya bağlıdır; aynı anahtar ve gövde aynı yaptırımı döner (tek satır, tek audit), farklı gövde 409 `IDEMPOTENCY_KEY_REUSED`.
- **Ban oyları silmez:** BAN ve kaldırılması oy satırına, `invalidated_at`'e, sayaçlara, `vote_events`'e ve public sonuca dokunmaz (testli). Oyu geçersiz saymak ayrı ve gerekçeli işlemdir (`admin.votes.invalidate`, KV-43).

## 3. Oturumlar — Faruk'un `sessions` tablosuna yazma

SUSPEND ve BAN, yaptırımla **aynı transaction'da** kullanıcının açık oturumlarını iptal eder (`sessions.revoked_at = now`). Sözleşme notu (`admin.sanctions.create`), DATA_MODEL §7.2 ve TECH_DECISIONS §3.4 bunu ister.

- **Sahiplik:** `sessions` tablosu ve auth modülü Faruk'undur. Auth modülünün dosyalarında değişiklik yoktur; yazma `apps/api/src/modules/admin-users/prisma-store.ts` içinde `tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })` ile yapılır. Faruk PR'a reviewer olarak eklenir.
- **Neden gerekli:** Oturum çözümü her istekte `users.status`'u okuduğu için SUSPENDED/BANNED kullanıcının oturumu iptal olmasa da bir sonraki istekte 403 alırdı. İptalin asıl etkisi şudur: yaptırım kaldırılınca eski oturumlar geri gelmez, kullanıcı yeniden giriş yapar.
- İptal edilen oturum sayısı audit kaydının `after.sessionsRevoked` alanındadır. RESTRICT_* ve WARNING oturumlara dokunmaz.

## 4. Eşzamanlılık

Her değiştiren işlem tek transaction'dadır ve sabit kilit sırası izler:

1. Hedef `users` satırı `FOR NO KEY UPDATE`. Aynı kullanıcıya gelen iki işlem sıraya girer; ikincisi kuralları birincinin sonucuna göre yeniden değerlendirir.
2. ACTIVE SUPER_ADMIN'i etkileyen işlemlerde (`admin.roles.put` her zaman, SUPER_ADMIN hedefe SUSPEND/BAN) `user_roles WHERE role = 'SUPER_ADMIN' ORDER BY user_id FOR UPDATE`.
3. Aktör ve hedef taze okunur, KV-04 `authorize` yeniden çağrılır (router'daki karar istek öncesi veriyle verilmişti); son aktif SUPER_ADMIN sayımı burada yapılır.

İkinci bir kullanıcı satırı hiç kilitlenmez. Hedefte `FOR UPDATE` kullanılmaz: aktör karşı işlemin hedefi olabilir ve bizim yazdığımız FK'ler (`sanctions.created_by_id`, `user_roles.granted_by_id`, `audit_logs.actor_id`) aktör satırında `FOR KEY SHARE` ister; `FOR UPDATE` bununla çakışıp deadlock'a (40P01) yol açıyordu. `FOR NO KEY UPDATE` çakışmaz.

**Son aktif SUPER_ADMIN:** Aktör ACTIVE bir SUPER_ADMIN olduğu için kural tek başına yalnız yarışta tetiklenir: iki SUPER_ADMIN birbirini aynı anda düşürür veya banlarsa ikisi rol satırı kilidinde sıraya girer; ikinci işlem kendi hesabının artık yetkili/ACTIVE olmadığını görür (403) veya sayım 1'dir (409). Testler (`admin-roles.test.ts`) iki eşzamanlı istekle "tam olarak biri başarılı, bir aktif SUPER_ADMIN kalır" der. ACTIVE olmayan veya silinmiş SUPER_ADMIN'i düşürmek aktif sayıyı azaltmaz ve serbesttir (`superAdminCountForRoleRule`).

## 5. Bilinen açıklar ve sonraki işler

- **Süre dolumu gecikmesi:** süresi dolan yaptırım `users.status`'a en geç ~90 sn içinde yansır (§6); o arada kullanıcı giriş yapamaz ve açık oturumu 403 alır. Yönetici süresi dolmuş yaptırımı kaldıramaz (409 `expired`); beklemesi yeterlidir. PR-C, PR-B'den sonra ve onunla birlikte merge edilmelidir.
- **Olaylar (KV-21 PR-2):** `sanction.applied`, `sanction.lifted` ve `role.changed` (yalnız rol değiştiğinde) store'da, audit'in yanında aynı transaction'da outbox'a yazılır; reddedilen işlem olay yazmaz. Olay INSERT'i kilitlerden sonradır ve FK'sizdir, yukarıdaki kilit sırasını değiştirmez. Şu an kayıtlı tüketicileri yoktur (abonesiz dağıtılır). Süre dolumu (§6) olay üretmez: katalogda karşılığı yok, süre dolması kaldırma değildir. Ayrıntı: [`KV-21_NOTIFICATIONS.md`](./KV-21_NOTIFICATIONS.md) §5.
- **İtiraz endpoint'i:** ertelendi, ayrı iş (KV-04 §5/1).
- **`admin.audit.list`:** ayrı PR (KV-39).

## 6. Süre dolumu job'ı — `sanctions.expire` (PR-C)

Kod: `apps/worker/src/jobs/sanctions/` · Test: `apps/worker/test/sanctions.test.ts` · Kayıt: `apps/worker/src/main.ts`.

- **Aralık:** pg-boss cron'u ile her dakika (`* * * * *`), kuyruk `singleton`. pg-boss cron'u dakika çözünürlüklüdür ve cron izleyicisi varsayılan 30 sn'de bir çalışır; bu yüzden süresi dolan yaptırım `users.status`'a **en geç ~90 sn içinde (+ iş süresi)** yansır. Yönetici işlemleri (PR-B) aynı transaction'da senkronladığı için bu gecikme yalnız zamanla dolan yaptırımlar içindir.
- **Ne yapar:** Durumu `SUSPENDED`/`RESTRICTED` olup kaldırılmamış yaptırımlardan hesaplanan değerden farklı olan kullanıcıları bulur (turda en fazla 500; kalanlar sonraki turda) ve `users.status`'u düzeltir. Karar contracts `statusFromSanctions` ile verilir (API ile aynı fonksiyon); SQL yalnız ön filtredir. BAN kalıcıdır, süre dolumuyla değişmez.
- **Yaptırım satırı değişmez:** süre dolması kaldırma değildir; job `sanctions`'a yazmaz (`lifted_*` boş kalır). DB de aktörsüz kaldırmaya izin vermez (`sanctions_lift_check`, `sanctions_guard`).
- **Her kullanıcı ayrı transaction:** `users` satırı `FOR NO KEY UPDATE` (PR-B ile aynı kilit), kilitten sonra taze okuma ve yeniden hesap; değiştiyse durum + aynı transaction'da audit (`source: WORKER`, aktör NULL, `user.status.sync` / `sync`, `before: {status}`, `after: {status, expiredTypes}`). Değişmediyse hiçbir şey yazılmaz. Bir kullanıcıdaki hata turu durdurmaz.
- **İdempotent:** iki worker veya tekrar çalışma aynı kullanıcıda kilitte sıraya girer; ikincisi düzeltilmiş durumu görür ve yazmaz → tek audit (testli).
- **Yönetici işlemiyle yarış (testli, iki sıra):**

  | Sıra | Sonuç |
  |---|---|
  | Yönetici önce yeni SUSPEND uygular, job bekler | Job aktif SUSPEND'i görür; durum zaten `SUSPENDED` → değişiklik ve audit yok |
  | Job önce `ACTIVE` yazar, yönetici bekler | Yönetici kilitten sonra `ACTIVE` görür, yeni SUSPEND ile `SUSPENDED` yazar; job'ın tek audit'i kalır |

- **Index:** aday sorgusu `users_status_idx` ile başlar, her aday için `sanctions_user_id_lifted_at_ends_at_idx`; migration gerekmez. Test `EXPLAIN`'i `SET LOCAL enable_seqscan = off` ile koşar (boş/küçük tabloda planner seq scan seçmesin; index'in kullanılabildiği sınanır).

## 7. Şifre sıfırlama başlatma — `admin.users.passwordReset.send` (#181)

Yönetici, kullanıcının kayıtlı e-postasına tek kullanımlık sıfırlama bağlantısı gönderir. Yönetici şifreyi, token'ı veya bağlantıyı **hiçbir yerde görmez**: yanıt yalnız `{ sent, expiresAt }`'tir, audit `after` yalnız `expiresAt` tutar (token, bağlantı ve e-posta yoktur), kullanıcı yeni şifreyi kendisi belirler. Bağlantı, mevcut `auth.password.reset` akışıyla aynıdır (`/sifre-yenile#token=…`, 1 saat, tek kullanımlık, kullanılınca bütün oturumlar kapanır); token yalnız SHA-256 özetiyle (`auth_tokens`) saklanır.

| Konu | Kural |
|---|---|
| Yetki | `user.password.reset`: ADMIN+; `sanctionTarget` kuralı: admin hedef SUPER_ADMIN ister, kimse kendi hesabına uygulayamaz (403; kendisi için normal "şifremi unuttum" vardır). Rol DB'den okunur; store kararı hedef kilitlendikten sonra taze veriyle yeniden verir. |
| Hesap durumu | SUSPENDED/RESTRICTED hesaba gönderilir (kullanıcı şifresini yenileyip yaptırım bitince girebilir). BANNED → 409 `user_banned`, silinmiş → 409 `user_deleted`; normal "şifremi unuttum" akışıyla aynı kural. Reddedilen istek token, mail veya audit üretmez. |
| Sıklık sınırı | Hesap başına ardışık istekler arası 60 sn ve saatte en çok 5; aşılırsa 429 `RATE_LIMITED` + `Retry-After`. Sınır hedef satırı kilitliyken audit kayıtlarından hesaplanır: aynı anda gelen iki istekten yalnız biri geçer (çift tıklama ve iki yöneticinin yarışı yeni token/mail üretmez). |
| Önceki bağlantılar | Yeni token, hesabın kullanılmamış önceki sıfırlama token'larını geçersiz kılar; yalnız en son bağlantı çalışır. |
| E-posta hatası | Token ve audit transaction'la yazılır, mail commit'ten sonra gönderilir. Servis hata verirse yanıt `sent=false`'tur (token oluşmuştur); panel "tekrar dene" der, 60 sn sonra yeni bağlantı üretilir. |
| Audit | `user.password.reset` / `send`, gerekçe zorunlu, aktör, hedef, `requestId`. |

Test: `apps/api/test/admin-password-reset.test.ts` (yetki matrisi, gerekçe, bağlantının çalışması ve oturumların kapanması, audit'te sır olmaması, ban/silinmiş, çift tıklama, saatlik sınır, eşzamanlı yarış, e-posta hatası). Kapsam dışı (#181'in sonraki dilimleri): e-posta adresi değişimi, hesap dondurma/geri alma akışı, kullanıcı içeriğinin toplu gizlenmesi, KVKK dışa aktarma ve anonimleştirme; kritik işlemlerde ikinci onay/MFA #182 ile gelir.

## 8. KVKK veri dışa aktarma (#181)

Kullanıcının kendi kişisel verisinin paketini hazırlar ve **yalnız kullanıcıya** teslim eder. Yönetici talebi açar ve teslimi onaylar; paket içeriğini, indirme token'ını veya bağlantıyı hiçbir yanıtta, audit kaydında ya da loglarda görmez.

**Akış**

1. `admin.users.dataExports.create` (SUPER_ADMIN, gerekçeli): `data_exports` satırı `PENDING`. Hesap başına en çok bir açık talep (PENDING/PROCESSING/READY) vardır; tekrar çağrı aynı talebi döner ve yeni audit yazmaz. Kısmi unique index (`data_exports_one_open_per_user_key`) ve hedef kullanıcı satırı kilidi yarışta da tek satırı garanti eder.
2. Worker `data-exports.build` (dakikada bir): `FOR UPDATE SKIP LOCKED` ile sahiplenir, paketi toplar (JSON → gzip → **AES-256-GCM**, rastgele anahtar, AAD = talep id'si), private bucket'a `exports/<id>-<rastgele>.bin` olarak yazar, satırı `READY` yapar (anahtar yalnız bu satırda). Takılan `PROCESSING` talep 10 dk sonra yeniden alınır; talebi kaybeden deneme kendi nesnesini siler. Hata → `FAILED` + kısa kod (`build_failed`, `too_large`; 25 MB JSON ve koleksiyon başına 50 bin satır sınırı); ham hata metni DB'ye yazılmaz. FAILED talep açık sayılmaz, yeni talep açılabilir.
3. `admin.users.dataExports.deliver` (SUPER_ADMIN, gerekçeli): talep `READY` iken yönetici kimlik doğrulamasını (destek kanalı vb.) yaptığını gerekçeyle beyan eder. Yeni bir indirme token'ı üretilir (yalnız SHA-256 özeti saklanır, önceki bağlantıyı geçersiz kılar) ve bağlantı (`/veri-indir#token=…`) **yalnız hesabın kayıtlı e-postasına** gider. Bağlantı 24 saat (ve paket süresi) geçerlidir. Hesap başına 60 sn bekleme ve saatte 3 gönderim (429).
4. `dataExports.download` (kullanıcı): **hem** token **hem** paketin sahibi olan oturum gerekir; başkasının oturumu ya da yanlış token aynı `TOKEN_INVALID_OR_EXPIRED` yanıtını alır (hesap/paket varlığı sızmaz). Paket sunucuda çözülür (GCM etiketi doğrulanmazsa veri dönmez) ve JSON olarak döner. Teslim başına en çok 3 indirme; sayaç paket çözüldükten sonra, koşullu `UPDATE` ile düşer (eşzamanlı indirmeler hakkı aşamaz). Her indirme audit'e yazılır.
5. Paket 7 gün sonra `EXPIRED` olur: worker anahtarı ve token'ı önce siler. Depolama erişilemiyorsa şifreli nesnenin silinmesi sonraki tur yeniden denenir; bu sırada anahtar tutulmaz. İndirme tamamlanırken güncel token, iki süre ve aktif hesap tekrar kontrol edilir. Mail/depolama hataları yalnız kısa kodlarla loglanır; ham hata mesajları kişisel veri veya bağlantı taşıyabilir.

**Audit** (hepsi `target = USER`, token/bağlantı/e-posta/içerik yok): `privacy.export.manage` `request` (`after: { exportId }`), `deliver` (`after: { exportId, linkExpiresAt }`); `privacy.export.download` `download` (aktör kullanıcının kendisi, `after: { exportId, downloadNumber }`).

**Pakette olanlar** (`apps/worker/src/jobs/data-exports/collect.ts`; her koleksiyon açık `select` ile okunur, şemaya eklenen sütun bilinçli eklenmedikçe pakete girmez): profil (e-posta, kullanıcı adı, görünen ad, biyografi, durum, tarihler, rol, puan bakiyesi), anketler (seçenekler ve ek açıklamalarla, kaldırılmış/silinmiş dahil), yorumlar, oylar (kullanıcının kendi oyu, anket başlığı ve seçenek etiketiyle) ve oy olayları, anket/yorum tepkileri, kayıtlılar, takipler, ilgi alanları, puan defteri, bildirimler ve bildirim tercihleri/susturmaları, yaptığı raporlar, aldığı yaptırımlar, içeriğine/hesabına uygulanan moderasyon işlemleri, topluluk üyelikleri ve başvuruları, görsel yükleme kayıtları (meta veri), oturumlar (zaman, IP, cihaz).

**Bilerek pakette olmayanlar ve nedenleri**

| Veri | Neden |
|---|---|
| Parola özeti, oturum/token özetleri | Kimlik sırrı; kullanıcıya da verilmez |
| Kullanıcı **hakkındaki** raporlar ve raporlayan kimliği | Raporlayanın güvenliği (kuyruk da raporlayanı göstermez, KV-33 §4). Hakkındaki rapor sonuçları yaptırım/moderasyon işlemi olarak zaten görünür |
| Yaptırımı uygulayan/kaldıran yönetici, moderasyon işlemini yapan yönetici, bildirimi tetikleyen kullanıcı | Üçüncü kişinin kimliği |
| Görsel risk skorları ve etiketleri, hash'ler | Kötüye kullanım tespitinin iç sinyali |
| Yüklenen görsellerin dosyaları | V1 kapsamı meta veri; dosya paketi sonraki iş |
| Başkalarının yorumları/oyları (kullanıcının anketindeki) | Başka kullanıcının verisi; yalnız toplam sayılar anket satırında |
| Audit kayıtları (yöneticinin kullanıcı üzerindeki işlemleri) | Güvenlik ve yasal saklama; açık karar (aşağıda) |

**Test:** `apps/api/test/data-exports.test.ts` (yetki matrisi, gerekçe, kısıtlı/silinmiş hesap, idempotency ve eşzamanlı talep, şifreli saklama, worker tekrar/takılma/yarış/hata, teslim ve sıklık sınırı, token + oturum kimlik doğrulaması, indirme hakkı ve eşzamanlı indirme, bağlantı ve paket süre dolumu, bozuk nesne, şifreleme biçimi, paket içeriği ve sızıntı kontrolü).

**Açık kararlar (Mehmet / ürün ve hukuk)**

1. **Kısıtlı hesap:** BANNED/SUSPENDED hesap giriş yapamadığı için indirme oturumu açamaz; talep bu yüzden 409 `account_restricted` ile reddedilir. KVKK erişim hakkı kısıtlı hesaplar için de geçerliyse ayrı bir kanal (ör. tek seferlik, oturumsuz ama e-posta + kimlik kanıtı) gerekir.
2. **Yetki:** talep ve teslim şimdilik SUPER_ADMIN'e özeldir (kişisel verinin toplu çıkışı). ADMIN'e açılacaksa `privacy.export.manage` kuralı tek satırla değişir.
3. **Audit kayıtlarının pakette yer alması** ve saklama süresi (KV-39 §47: V1'de süresiz, karar Mehmet).
4. **Silinmiş/anonimleştirilmiş hesap:** paket üretilmez (409 `user_deleted`). Anonimleştirme kapsamı [§10](#10-hesap-anonimleştirme-ve-yasal-saklama)'da öneri olarak uygulandı; onay bekliyor (DATA_MODEL §11.4/3).
5. **Görsel dosyaları** pakete eklensin mi (boyut ve sızıntı yüzeyi büyür).

**Kapsam dışı (sonraki dilimler):** anonimleştirme/silme (geri alınamaz onay, saklama/yasal tutma ayrımı), e-posta değişimi, toplu içerik gizleme; kritik işlemlerde ikinci onay/MFA #182.

## 9. Kullanıcı içeriğinin toplu gizlenmesi/kaldırılması (#181)

Bir hesabın anket ve yorumlarını tek seferde gizler veya kaldırır; **önizleme → gerekçe → ayrı onay → kuyruk**, bitince **geri alınabilir**. Genel (hesaptan bağımsız, kapsamlı) toplu moderasyon #183'tür; bu bölüm yalnız tek hesaba ait içerik içindir.

**Akış**

1. `admin.users.contentJobs.preview` (GET, salt okuma): işlem (`HIDE`/`REMOVE`) ve kapsam (`all`/`polls`/`comments`) için etkilenecek anket ve yorum sayısı + `cutoffAt` (önizleme anı). Uygunluk **mevcut moderasyon geçiş tablosundan** gelir (`eligibleSources`): HIDE yalnız `ACTIVE`; REMOVE `ACTIVE`, `UNDER_REVIEW`, `HIDDEN`, `LOCKED`; `REMOVED` olanlar sayılmaz. Yalnız `cutoffAt`'tan önce yazılan içerik sayılır ve işlenir.
2. `admin.users.contentJobs.create` (**ayrı onay**, gerekçe zorunlu): sunucu sayıları `cutoffAt` ile **yeniden hesaplar**; önizlemedekinden farklıysa 409 `preview_stale`, `cutoffAt` 15 dakikadan eskiyse 409 `preview_expired`, uygun içerik yoksa `nothing_to_do`, tek işte 500'ü aşıyorsa `too_many` (kapsamı daralt). Başarılıysa iş `QUEUED` olur; iş düzeyi audit `user.content.bulk` / `request` (gerekçe, request id, iş id ve sayılar).
3. API sürecindeki çalıştırıcı (`modules/content-jobs/runner.ts`, 5 sn'de bir; `FOR UPDATE SKIP LOCKED` ile çok süreçte güvenli) işi 25'lik gruplarla işler. **Her içerik mevcut moderasyon uygulamasından (`ModerationStore.apply`) geçer**: satır kilidi, durum geçişi, yorum sayaçları, `moderation_actions`, içerik başına audit (`moderation.poll|comment.apply`, request id `content-job:<id>`), `moderation.applied` olayı ve açık raporların kapanması aynı öğe transaction'ında yapılır; bu modül yeni bir geçiş kuralı icat etmez. Sonuç `content_job_items`'a (APPLIED/UNCHANGED/FAILED/SKIPPED, önceki ve sonraki durum) yazılır; kısmi başarısızlık işi durdurmaz, sayaçlarda görünür.
4. Her grupta **aktörün yetkisi ve hedefin rolü yeniden doğrulanır** (`authorize`, `sanctionTarget`): aktör yetkisini kaybettiyse veya hedef bu arada admin olduysa (ve aktör yalnız ADMIN ise) iş `FAILED` (`actor_not_authorized`) olur ve kalan içeriğe dokunulmaz.
5. Tur bütçesi (20 sn) dolarsa iş `QUEUED`'a döner ve kaldığı yerden sürer; `PROCESSING`'de 5 dk takılan iş yeniden alınır. İşlenmiş içerik tekrar seçilmez (öğe kaydı + anti-join), yani çift işlem ve kaybolan içerik yoktur.

**Eşzamanlılık ve sınırlar:** hesap başına en çok bir açık iş (kısmi unique index `content_jobs_one_open_per_user_key` + hedef kullanıcı satırı kilidi): yedi paralel onaydan biri başarılı, kalanı 409 `job_open`. Kimse kendi hesabına uygulayamaz; admin hedef SUPER_ADMIN ister. Silinmiş (anonimleştirilmiş) hesaba iş açılamaz (`user_deleted`).

**Durdurma (`cancel`, gerekçeli):** kuyruktaki veya işlenmekte olan iş `CANCELLED` olur; çalıştırıcı her öğeden önce durumu okur ve kalan içeriğe dokunmaz. Koşullu güncelleme: iş aynı anda bittiyse 409 `not_cancellable`. İşlenmiş içerik olduğu gibi kalır.

**Geri alma (`undo`, gerekçeli) — güvenli ve sürüm kontrollü:** `UNDO` işi, asıl işte **uygulanmış ve önceki durumu `ACTIVE`** olan içeriğe `RESTORE` uygular. (1) Önceki durumu `HIDDEN`/`LOCKED`/`UNDER_REVIEW` olan içerik geri alınmaz: `RESTORE` `ACTIVE` yapar, yani daha görünür olurdu. (2) İşten sonra durumu başka biri değiştirdiyse (yeniden kaldırma, geri yükleme vb.) o öğe `SKIPPED` (`changed`) olur, dokunulmaz. (3) Bir işin en çok bir geri alması vardır (`undo_of_id` unique); geri almanın geri alınması yoktur; açık iş varken geri alma açılmaz. (4) Silinmiş/anonimleştirilmiş hesapta geri alma reddedilir (`user_deleted`): silinmiş veri geri üretilmez. Gerekçe, `moderation_actions` ve audit her öğeye yazılır.

**Bilinen sınırlar**
- Öğe kaydı, öğe transaction'ının ardından yazılır; ikisi arasında süreç ölürse içerik uygulanmış ama işte kaydı yoktur: yeniden seçilmez ve yalnız bu iş üzerinden geri alınamaz (`moderation_actions`'ta görünür).
- Her işlenen içerik için sahibine ayrı bir `MODERATION_APPLIED` bildirimi gider (geri alma dahil): 500 içerikte 500 bildirim. Toplulaştırılmış bildirim ayrı iştir (KV-21 tüketicisi).
- Çalıştırıcı API sürecinde koşar; ağır yük için ileride worker'a taşınabilir (aynı tablo ve SKIP LOCKED sözleşmesi).
- İkinci onay/MFA (#182, PR #206) bu işlere henüz bağlanmadı; bağlanınca eşik üstü işler için ikinci yönetici onayı istenmesi önerilir.

**Test:** `apps/api/test/content-jobs.test.ts` (yetki matrisi, önizleme sayımı ve salt okuma, onayda yeniden sayım/eskime/süre/boş/çok fazla, HIDE ve REMOVE'un mevcut moderasyon yoluyla uygulanması — sayaçlar, geçmiş, audit, rapor kapanması, başkasının ve cutoff sonrası içeriğin dokunulmazlığı, yedi paralel onay, tur bütçesi ve kaldığı yerden devam, takılmış iş, aktör yetkisini kaybetme, hedef rol yükselmesi, silinmiş hesap, durdurma, güvenli ve sürüm kontrollü geri alma, çift geri alma).

## 10. Hesap anonimleştirme ve yasal saklama

KVKK silme/unutulma talebinin **yönetici başlatmalı** karşılığıdır (#181). Kullanıcı kendi başına silemez; talep destek kanalından gelir, yönetici kimliği doğrular ve gerekçesiyle uygular. Geri alınamaz. Veri kapsamı kararı DATA_MODEL §11.4/3'ün **önerisidir** ve Mehmet/Faruk/Utku teyidini bekler; kod bu öneriyi uygular.

**Akış:** `GET /admin/users/:id/erasure` önizleme (etki sayıları, engeller; hiçbir şey yazmaz) → `POST /admin/users/:id/erasure` gerekçe + **hesabın kullanıcı adının yazılı teyidi** → tek transaction. Yetki `user.anonymize` (**yalnız SUPER_ADMIN**, `sanctionTarget`: kimse kendi hesabını anonimleştiremez). Eşleşmeyen teyit 409 `confirmation_mismatch` ve hiçbir şey değişmez. İkinci onay/MFA (#182, PR #206) bağlanmadı; gerekçe, teyit ve audit var.

### 10.1 Ne olur, ne korunur

| Veri | İşlem | Neden |
|---|---|---|
| `users` e-posta, kullanıcı adı, görünen ad, biyografi, avatar bağı, parola özeti, e-posta doğrulama ve son giriş zamanı | **Tombstone / boşaltma**: `silinmis_<12 hane>`, `silinmis-<id>@anonim.invalid`, "Silinmiş hesap", parola özeti geçersiz değer; `deleted_at` dolar. `status` ve kimlik (`id`) kalır | Kimlik FK'leri ve içeriğin yazar bağı korunmalı; kişisel alan kalmamalı |
| `sessions`, `auth_tokens`, `idempotency_keys` | **Silinir** | IP/UA ve bekleyen doğrulama/sıfırlama bağlantıları kişisel veri |
| Bildirimler (alıcı olarak), bildirim tercihleri ve sessizleri, ilgi alanları, anket takipleri, kayıt listesi (`bookmarks`, `polls.save_count` aynı transaction'da düşer) | **Silinir** | Davranış/tercih verisi |
| Topluluk üyelikleri (`member_count` düşer) | **Silinir** | Üyelik kişisel ilişkidir |
| Sahip olunan topluluk | **Yönetici yönetimine döner** (audit `community.owner.assign` / `auto_release`, `trigger: anonymize`) | KV-54 §5: sahipsiz kalma hesap sonu kuralı; son sahip koruması bu yolda da korunur |
| Bekleyen topluluk başvurusu | **REJECTED** ("hesap anonimleştirildi") | Karar bekleyen kayıt askıda kalmaz |
| Hazır KVKK veri paketi | **EXPIRED**; anahtar ve bağlantı token'ı hemen silinir, şifreli nesneyi worker siler | Kişisel veri kopyası |
| Avatar görseli | **REJECTED**, public anahtar boş; dosyaları (public + özel) worker siler (`account-erasure.cleanup`, `account_erasures.storage_cleaned_at`) | Yüz fotoğrafı kişisel veridir. Anket görselleri **içeriktir**, silinmez |
| Anketler, yorumlar, sürümleri, tepkiler | **Korunur**; yazar adı anonim görünür | Ürün kararı (DATA_MODEL §7): tartışma bütünlüğü. İçerikte kişisel veri varsa [10.4](#104-içerikteki-kişisel-veri) |
| Oylar ve `vote_events` | **Korunur** (kimliksiz) | Sonuç bütünlüğü; oy sahibi zaten herkese açık değil |
| Raporlar, moderasyon işlemleri, yaptırım geçmişi, puan defteri, `content_jobs` | **Korunur** | Güvenlik ve denetim (meşru menfaat); kullanıcı alanı içermez |
| `audit_logs`, `domain_events` | **Korunur** (append-only) | Denetlenebilirlik; yalnız kimlik ve sayı taşır (ad/e-posta yazılmaz, testli). Aktör adı gösterilirken tombstone adı görünür |
| Veritabanı yedekleri | Yedek saklama süresince kalır | Operasyon politikası; geri yüklemede anonimleştirme yeniden uygulanmalı |

### 10.2 Engeller (409, önizleme aynı listeyi verir)

- `legal_hold`: hesapta açık **yasal saklama** kaydı var ([10.3](#103-yasal-saklama)).
- `active_sanction`: süresi dolmamış, kaldırılmamış WARNING-dışı yaptırım (BAN, SUSPEND, kısıtlama). Aksi halde anonimleştirme ban/askı kaçırma yolu olur (e-posta ve kullanıcı adı serbest kalır). Yaptırım kalkınca veya dolunca anonimleştirilebilir.
- `has_role`: hesabın yönetici/moderatör rolü var; önce rol kaldırılır (son SUPER_ADMIN koruması bu sayede aşılamaz).
- `export_in_progress`: bekleyen/işlenen veri paketi talebi var. Erişim hakkı silme hakkından önce karşılanır; paket hazırlanıp teslim edilir veya başarısız olur.
- `confirmation_mismatch`: yazılı teyit hesabın kullanıcı adıyla eşleşmiyor (küçük/büyük harf ve baştaki `@` önemsiz).

### 10.3 Yasal saklama

`PUT /admin/users/:id/legal-hold` (gerekçeli) açık kayıt koyar, `POST …/legal-hold/release` (gerekçeli) kaldırır; ikisi de SUPER_ADMIN, `user.legalHold.manage`. Açıkken anonimleştirme 409 `legal_hold`. Hesap başına en çok **bir açık kayıt** (kısmi unique index; eşzamanlı koymalar tek kayıt bırakır). Koyma idempotenttir (açık kayıt döner, gerekçe değişmez, audit yazılmaz); açık kayıt yokken bırakma no-op. Kayıtlar silinmez, bırakma alanlarını doldurur. Anonimleştirilmiş hesaba kayıt konmaz (409 `user_deleted`). Gerekçe yöneticiler içindir, kullanıcıya gösterilmez.

### 10.4 İçerikteki kişisel veri

Anonimleştirme yazıları silmez. Kullanıcı kendi yazısında kişisel veri verdiyse (veya talep içerik silmeyi de kapsıyorsa) önce toplu içerik işi (§9, gizle/kaldır, geri alınabilir) çalıştırılır, **sonra** anonimleştirilir; anonimleştirmeden sonra toplu iş 409 `user_deleted` döner. Önizleme `willRetain` ile korunacak yazı/yorum/oy/rapor sayısını gösterir.

### 10.5 Eşzamanlılık, idempotency ve bütünlük

- Hedef kullanıcı satırı `FOR NO KEY UPDATE` ile kilitlenir (yaptırım, rol, şifre sıfırlama, sahip atama aynı kilitten geçer); ardından kullanıcının üye/sahip olduğu topluluk satırları id sırasıyla `FOR UPDATE`, sonra kayıt listesindeki anket satırları id sırasıyla `FOR UPDATE`. Önce kullanıcı, sonra topluluk sırası `communities/owner.ts` ile aynıdır: döngü yok.
- **Yaptırım yarışı:** anonimleştirme önce kilitlerse yaptırım 409 `user_deleted`; yaptırım önce uygulanırsa anonimleştirme 409 `active_sanction`. İkisi birden olmaz (testli).
- **Sahip atama / ayrılma yarışı:** silinmiş hesap sahip olamaz (`user_not_eligible`); sayaç iki kez düşmez, negatife inmez (testli).
- **Idempotency:** hesap başına tek `account_erasures` kaydı (unique). Zaten anonimleştirilmişse 200 `unchanged` ve ilk işlemin zamanı; değişiklik ve audit yok (teyit ne olursa olsun; yetki yine denetlenir). Çift tıklama (5 paralel istek): biri uygular, kalanı `unchanged`.
- **Kalıcı kayıt** (`account_erasures`): yalnız sayılar (`summary`: silinen/korunan adetler), gerekçe, işlemi yapan ve zaman. Kişisel veri içermez.

### 10.6 Audit

`user.anonymize` / `anonymize` (gerekçeli): `before: { anonymized: false }`, `after: { anonymized: true, erasureId, removed: {…}, retained: {…} }`. Sahip olunan her topluluk için ayrıca `community.owner.assign` / `auto_release`. `user.legalHold.manage` / `place`, `release` (gerekçeli). Ad, e-posta, biyografi veya içerik audit'e yazılmaz.

### 10.7 Bilinen sınırlar ve açık kararlar (Mehmet / Faruk / Utku / hukuk)

1. **Veri kapsamı** (§10.1) DATA_MODEL §11.4/3 için öneridir; özellikle "içerik ve oylar kalır" ve "yedekler saklama süresince kalır" teyit bekler.
2. **Kullanıcı adı ve e-posta serbest kalır** (yeni kayıt alabilir). Marka/taklit riski için ayrılmış ad listesi gerekirse ayrı iş.
3. **Kullanıcıya kendi hesabını silme akışı yok**; yalnız yönetici başlatır. Self-servis (e-postayla onay bağlantısı) sonraki dilim.
4. **Kullanıcıya bildirim yok**: anonimleştirme sonrası adres silindiği için e-posta gönderilmez. İşlemden önce onay e-postası istenirse #182 ikinci onay akışıyla birlikte.
5. **İkinci onay/MFA bağlanmadı** (#182/#206): geri alınamaz işlem için önerilir.
6. **Avatar dosyası silme eventual**: DB'de görsel hemen yayından kalkar, dosyaları worker en geç bir tur (~1 dk) sonra siler; depo erişilemezse kayıt işaretlenmez ve yeniden denenir.
7. Anonimleştirmeden hemen önce giriş yapan bir isteğin açtığı oturum satırı (yarış) kalabilir; `deleted_at` doluyken oturum çözümlenmez ve satır süresi dolunca temizlenir.

**Test:** `apps/api/test/account-erasure.test.ts` (yetki matrisi ve kendi hesabı, gövde doğrulaması, yazılı teyit, önizleme salt okunur, tombstone ve giriş/oturum kapanışı, e-posta ve kullanıcı adının yeniden alınabilmesi, içerik ve başkasının verisinin korunması, topluluk/sahiplik/sayaçlar, kayıt listesi ve tercihler, avatar ve paket, audit'te kişisel veri olmaması, idempotency ve çift tıklama, her engel, yasal saklama yaşam döngüsü ve eşzamanlı koyma, yaptırım/sahip atama/ayrılma yarışları) ve `apps/worker/test/account-erasure.test.ts` (avatar nesne silme, idempotency, depo hatasında yeniden deneme).
