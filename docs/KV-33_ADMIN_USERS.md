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
5. Paket 7 gün sonra silinir: worker nesneyi, anahtarı ve token'ı siler, talep `EXPIRED` olur (anahtar silindiğinden nesne artık hiç okunamaz). Nesne silinemezse satır `READY` kalır ve sonraki tur dener.

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
4. **Silinmiş/anonimleştirilmiş hesap:** paket üretilmez (409 `user_deleted`). Anonimleştirme kapsamı DATA_MODEL §11/3'te açık (Faruk + Utku).
5. **Görsel dosyaları** pakete eklensin mi (boyut ve sızıntı yüzeyi büyür).

**Kapsam dışı (sonraki dilimler):** anonimleştirme/silme (geri alınamaz onay, saklama/yasal tutma ayrımı), e-posta değişimi, toplu içerik gizleme; kritik işlemlerde ikinci onay/MFA #182.
