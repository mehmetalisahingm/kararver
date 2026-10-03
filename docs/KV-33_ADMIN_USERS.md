# KV-33 — Admin kullanıcılar, yaptırımlar ve roller

> Issue: **KV-33 / #35** · Sahip: **Utku** · Sözleşme: `@kararver/contracts` 1.15.0 (`packages/contracts/src/domains/admin.ts`)
> Kod: `apps/api/src/modules/admin-users/`, `apps/api/src/modules/rbac/roles-routes.ts` · Testler: `apps/api/test/admin-users.test.ts`, `apps/api/test/admin-roles.test.ts`
> İlgili: [`DATA_MODEL.md`](./DATA_MODEL.md) §9.1 (yaptırım servis kuralları), §9.2 (audit) · [`KV-04_ROLES_EVENTS.md`](./KV-04_ROLES_EVENTS.md) (yetki)

KV-33 üç PR'dır: **PR-A** `audit_logs` ve `writeAudit` (KV-39), **PR-B** bu belgedeki endpoint'ler, **PR-C** süresi dolan yaptırımlar için `users.status` senkron job'ı.

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

- **PR-C merge olana kadar:** süresi dolan SUSPEND, `users.status`'ta `SUSPENDED` kalır; kullanıcı giriş yapamaz ve yönetici kaldıramaz (409 `expired`). PR-C (süre dolumu job'ı) PR-B'nin hemen ardından merge edilmelidir.
- **Olaylar:** `sanction.applied`, `sanction.lifted`, `role.changed` üretilmez (olay outbox'ı henüz yok, KV-04).
- **İtiraz endpoint'i:** ertelendi, ayrı iş (KV-04 §5/1).
- **`admin.audit.list`:** ayrı PR (KV-39).
