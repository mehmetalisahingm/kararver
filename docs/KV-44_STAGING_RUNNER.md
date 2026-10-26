# KV-44 / #46 — Rollere bölünmüş staging kabul aracı (R0–R5)

**Araç:** [`scripts/kv44-staging-runner.mjs`](../scripts/kv44-staging-runner.mjs) · **Test:** `pnpm security:test` (ağsız, sahte staging ile) · **Durum:** araç hazır, staging'de **hiç çalıştırılmadı**. Beta kararı [KV-44_SECURITY_ACCEPTANCE.md](KV-44_SECURITY_ACCEPTANCE.md) üzerinden ayrıca verilir.

## 1. İlkeler

- **Başkasının kimlik bilgisi başka makineye gitmez.** Her kişi yalnız kendi rolünü, kendi makinesinde, kendi env'iyle çalıştırır. Roller arası yalnız maskeli değerler (run id, marker, kimliklerin ilk 8 karakteri) ekrandan okunup argümanla verilir.
- **Sentetik hesap yalnız iki tane:** yazar USER (initiator makinesinde) ve medya USER (media-operator makinesinde). Yönetici rolünde sentetik hesap açılmaz, hiçbir hesaba rol atanmaz. Hesaplar her makinede R0'dan hemen sonra, tek seferde açılır. Kayıt limiti (5/IP/saat) aşılırsa sonuç **BLOCKED-ratelimit** olur, NO-GO değil.
- **Pencere 60 dk.** T0 en geç dk 19'da açılır, çünkü T+31 adımı dk 50'den önce bitmeli. Temizlik dışı yazma adımları dk 50'den sonra **BLOCKED-window** olur. Son 10 dakika yalnız R4'e kalır.
- **R4 her zaman koşar.** Açılış fazı FAIL olursa (P0 dahil) temizlik hemen orada çalışır. Temizlik başarısız olursa rapor **TEMİZLİK EKSİK** yazar ve kalan kayıtları maskeli listeler.
- **Kanıt repo dışında:** `%USERPROFILE%\kv44-evidence\<runId>\<rol>.jsonl`. E-posta, şifre, cookie, TOTP ve tam kimlik yazılmaz. Kimliklerin ilk 8 karakteri kalır, TOTP `******` görünür. İmzalı URL'de yalnız host ve path'in ilk 8 karakteri kalır, sorgu kısmı (imza, credential, expires) `?******` olur.
- `.state-<rol>.json` (aynı dizinde) temizlik için tam kimlikleri tutar. Kimlik bilgisi içermez ama **paylaşılmaz**, birleştirmeye girmez.

## 2. Roller ve env

| Rol | Kim | Hesap | Env (her kişinin kendi makinesinde) |
|---|---|---|---|
| `initiator` | Utku | kendi staging **ADMIN** hesabı | `KV44_EXPECTED_SHA`, `KV44_EMAIL`, `KV44_PASSWORD` |
| `owner` | Mehmet | SUPER_ADMIN | aynı üç değişken |
| `media-operator` | Mert | kendi ADMIN hesabı (temizlik için) + yerelde açılan medya USER | aynı üç değişken + `KV44_MEDIA_HOST` (beklenen staging private bucket host'u, yalın ad) |
| `approver` | Mert | kendi ADMIN hesabı, MFA kurulu | aynı üç değişken; TOTP adım anında görünmez sorulur |

Initiator için **MODERATOR yetmez**: toplu onay endpoint'i ADMIN kapısındadır. MOD hesabı `self_approval` yerine kodsuz 403 alır. Topluluksuz yorumlar da `needsAdmin` olur. Rol uymazsa araç `BLOCKED-role` yazar.

Her kişinin makinesinde `gh` kurulu ve repo okuma erişimiyle oturum açık olmalıdır (`gh auth status`). `--check-env` bunu denetlemez (ağsızdır).

## 3. Koşu sırası ve komutlar

**Akış:** Faruk: pencere başında `STAGING_PINNED_SHA` sabitler → R0 … R5 → pencere sonunda kaldırır.

Sabitleme R0'dan önce yapılır ve `KV44_EXPECTED_SHA` sabitlenen SHA'nın kendisidir. R0 her fazın başında (temizlik hariç) staging'e hiç istek atmadan önce `STAGING_PINNED_SHA` repo değişkenini kişinin kendi `gh` oturumuyla okur (`gh api repos/mehmetalisahingm/kararver/actions/variables`; yalnız GitHub, staging değil). Değişken yoksa, 7–40 haneli küçük harf hex değilse ya da `KV44_EXPECTED_SHA`'nın öneki değilse `R0.pinned` **FAIL (P0) → NO-GO** olur ve faz durur. `gh` kurulu değilse, oturum açık değilse ya da repo erişimi yoksa sonuç **BLOCKED-verification** olur. Temizlik fazı (`--phase cleanup`) sabitlemeyi okumaz, çünkü değişken pencere sonunda kaldırılır ve R4 her zaman koşmalıdır. Sabitleme koşu sırasında değişirse ya da deploy olursa sonraki R0 `R0.pinned`/`R0.release` FAIL verir, R5 de rol dosyalarındaki sürüm farkını yakalar.

Önce ortak değerler belirlenir: `--new-run` (ağsız) bir run id üretir; pencerenin başlangıcı (ISO, UTC) herkese aynı verilir.

```bash
node scripts/kv44-staging-runner.mjs --new-run
```

Her kişi koşudan önce kendi env'ini ağsız olarak kontrol eder. Çıktıda yalnız değişken adları ve durumları (`ok`, `missing`, `invalid`) bulunur, değerler hiç basılmaz. `--window-start` verilirse pencerenin başlangıç, T0 en geç (dk 19), yazma sınırı (dk 50) ve bitiş (dk 60) zamanları UTC olarak basılır. `--as` verilmezse dört rolün hepsi listelenir. Eksik ya da geçersiz değişken varsa çıkış kodu 1 olur.

```bash
node scripts/kv44-staging-runner.mjs --check-env --as media-operator --window-start <iso>
```

```bash
node scripts/kv44-staging-runner.mjs --preflight
```

`--preflight` yalnız `GET /health` ve `GET /v1/config` atar, kimlik bilgisi kullanmaz. Ayrı onayla çalıştırılır.

| Sıra | Dakika (tahmini) | Kim | Komut |
|---|---|---|---|
| R0 + hesap + R2 açılışı (T0) | 0–~10 (T0 ≤ 19) | initiator | `--as initiator --phase open --run <id> --window-start <iso>` |
| R1 | T0 sonrası | owner | `--as owner --target <8> --marker <sec_kv44_…> --run <id> --window-start <iso> [--legacy-approval <id>]` |
| R3 | T0 sonrası | media-operator | `--as media-operator --phase run --run <id> --window-start <iso>` |
| R2 kalan adımlar | R1/R3 sonrası | approver | `--as approver --phase approve --approval <8> --run <id> --window-start <iso>` |
| T+31 | T0+31 (≤ 50) | approver | `--as approver --phase expiry --approval <8> --run <id> --window-start <iso>` (sunucunun `createdAt` değerine göre bekler) |
| R4 | T+31 sonrası, ≤ 60 | initiator, media-operator | `--phase cleanup` (aynı run/window) |
| R5 | sonra | initiator | `--merge --run <id>` |

Yazarın 20 yorumu yeni hesap limiti (3/dk) yüzünden yaklaşık 7 dakika sürer. Araç `Retry-After` kadar bekler; limit değiştirilmez. Açılış fazı sonunda HANDOFF bloğu gerekli argümanları basar. Diğer roller JSONL dosyalarını R5 için initiator'ın aynı run dizinine koyar; `.state-*` dosyaları gönderilmez.

R5'ten sonra Faruk pencere sonunda `STAGING_PINNED_SHA`'yı kaldırır; staging-monitor gecikme alarmına döner.

**Kalıcı izler.** Temizlik hiçbir şey silmez: hesaplara BAN, yorum ve ankete REMOVE, medyaya REJECT uygular. Sentetik kullanıcılar (`sec_kv44_…`), kaldırılan içerik, audit kayıtları ve `domain_events` staging'de kalır. Bu yüzden beta ölçümünde bu kayıtlar dışlanmalıdır (#268 QA deseni `@example.test|(e2e|wk_a|wk_b|sec)_` hem e-postayı hem kullanıcı adını yakalar).

## 4. Matris

Kaynak sütunu gerçek kod satırıdır; `kv44-staging-runner.test.mjs` her satırın o kodu içerdiğini doğrular. **K sütunu boş:** `kv44-plan.md` `C:\Users\utkuu` altında (Desktop, Downloads, Documents dahil) bulunamadı; K1–K13 eşlemesi plan dosyası bulununca eklenecek.

| ID | R | Rol | Sev | Beklenen | Kaynak | K |
|---|---|---|---|---|---|---|
| R0.pinned | R0 | hepsi (R4 hariç) | P0 | STAGING_PINNED_SHA dolu (7–40 hex) ve KV44_EXPECTED_SHA ile aynı commit; değilse NO-GO, okunamazsa BLOCKED-verification | `.github/workflows/staging-monitor.yml:135` | |
| R0.release | R0 | hepsi | P0 | 200 status=ok env=staging, sha = KV44_EXPECTED_SHA | `apps/api/src/app.ts:507` | |
| R0.login | R0 | hepsi | P0 | 200 + kv_session | `packages/contracts/src/domains/auth.ts:87` | |
| R0.role | R0 | hepsi | P0 | /me rolü uygun (initiator/approver ADMIN+, owner SUPER_ADMIN) | `packages/contracts/src/domains/auth.ts:240` | |
| ACC.register | R0 | initiator, media-operator | P1 | 202; 429 → BLOCKED-ratelimit (5/IP/saat) | `docs/KV-19_RATE_LIMIT.md:21` | |
| ACC.owned | R0 | initiator, media-operator | P0 | yeni hesap yalnız USER | `packages/contracts/src/domains/admin.ts:566` | |
| ACC.login | R0 | initiator, media-operator | P1 | 200, aynı id | `packages/contracts/src/domains/auth.ts:87` | |
| R2.fixture.poll | R2 | initiator | P1 | 201 | `packages/contracts/src/domains/polls.ts:187` | |
| R2.fixture.comments | R2 | initiator | P1 | 20× 201 (429 → Retry-After kadar bekle) | `packages/contracts/src/domains/comments.ts:74` | |
| R2.preview | R2 | initiator | P1 | willChange=20, approval.required=true | `apps/api/src/modules/moderation/bulk-routes.ts:63` | |
| R2.open.expiring | R2 | initiator | P0 | 202 PENDING (T0) | `apps/api/src/modules/moderation/bulk-routes.ts:123` | |
| R2.open.target | R2 | initiator | P0 | 202 PENDING | `apps/api/src/modules/moderation/bulk-routes.ts:123` | |
| R2.self_approval | R2 | initiator | P0 | **403 FORBIDDEN `self_approval`** | `apps/api/src/modules/moderation/bulk-approval-routes.ts:112` | |
| R1.target | R1 | owner | P1 | marker + 8 karakter → tek USER | `packages/contracts/src/domains/admin.ts:566` | |
| R1.self | R1 | owner | P0 | **409 CONFLICT `self`**; details boş da kabul (bkz. §5) | `apps/api/src/modules/rbac/roles-routes.ts:42` | |
| R1.last_super_admin | R1 | owner | P0 | **409 CONFLICT `last_super_admin`** → UYGULANAMAZ-staging (bkz. §5; birim testi `apps/api/test/admin-roles.test.ts:171`) | `apps/api/src/modules/rbac/roles-routes.ts:44` | |
| R1.super_admin_reserved.role | R1 | owner | P0 | 403 FORBIDDEN `super_admin_reserved` | `apps/api/src/modules/rbac/roles-routes.ts:36` | |
| R1.super_admin_reserved.request | R1 | owner | P0 | 403 FORBIDDEN `super_admin_reserved`, kayıt oluşmaz | `apps/api/src/modules/security/approval-routes.ts:29` | |
| R1.legacy_approval | R1 | owner | P0 | 403 `super_admin_reserved`; bekleyen eski talep yoksa **UYGULANAMAZ-staging (birim testi: apps/api/test/role-approvals.test.ts)** | `apps/api/src/modules/security/approval-routes.ts:45` | |
| R3.config | R3 | media-operator | P0 | KV44_MEDIA_HOST yalın host adı | `packages/contracts/src/domains/media.ts:29` | |
| R3.upload.create | R3 | media-operator | P0 | 201 PUT presign | `packages/contracts/src/domains/media.ts:29` | |
| R3.upload.host | R3 | media-operator | P0 | https ve host === KV44_MEDIA_HOST; değilse FAIL ve dur (PUT atılmaz) | `packages/contracts/src/domains/media.ts:66` | |
| R3.upload.put | R3 | media-operator | P1 | 200 (sentetik 64×64 PNG) | `packages/contracts/src/domains/media.ts:66` | |
| R3.complete | R3 | media-operator | P1 | 202 MediaView | `packages/contracts/src/domains/media.ts:70` | |
| R3.private-url | R3 | media-operator | P0 | APPROVED değilken url=null | `packages/contracts/src/domains/media.ts:12` | |
| R3.not-public | R3 | media-operator | P0 | anonim /media-public 404, imza sızıntısı yok | `apps/api/src/modules/media/public-routes.ts:12` | |
| R2.resolve | R2 | approver | P1 | 8 karakter → tek talep, başlatan ben değilim | `packages/contracts/src/domains/moderation.ts:855` | |
| R2.stepup_required | R2 | approver | P0 | **403 FORBIDDEN `stepup_required`** | `apps/api/src/modules/moderation/bulk-approval-routes.ts:121` | |
| R2.stepup | R2 | approver | P1 | 200 stepUpExpiresAt (kod kanıtta `******`) | `packages/contracts/src/domains/auth.ts:231` | |
| R2.approve | R2 | approver | P0 | 200 APPROVED | `apps/api/src/modules/moderation/bulk-approval-routes.ts:138` | |
| R2.closed.reapprove | R2 | approver | P0 | **409 CONFLICT `closed`** | `apps/api/src/modules/moderation/bulk-approval-routes.ts:111` | |
| R2.expired.view | R2 | approver | P1 | T+31'de status EXPIRED | `apps/api/src/modules/moderation/bulk-approval-routes.ts:22` | |
| R2.closed.expired | R2 | approver | P0 | T+31'de **409 CONFLICT `closed`** (TTL 30 dk: `packages/contracts/src/domains/moderation.ts:237`) | `apps/api/src/modules/moderation/bulk-approval-routes.ts:111` | |
| R4.cancel | R4 | initiator | P1 | açık kalan talepler geri çekilir | `packages/contracts/src/domains/moderation.ts:935` | |
| R4.comment | R4 | initiator | P1 | 200 REMOVE | `packages/contracts/src/domains/moderation.ts:400` | |
| R4.poll | R4 | initiator | P1 | 200 REMOVE | `packages/contracts/src/domains/moderation.ts:400` | |
| R4.ban | R4 | initiator, media-operator | P1 | 201 BAN veya 409 already_active | `packages/contracts/src/domains/admin.ts:849` | |
| R4.media.reject | R4 | media-operator | P1 | 200 REJECT | `packages/contracts/src/domains/moderation.ts:691` | |
| R4.residue | R4 | initiator, media-operator | P1 | kalan kayıt yok; varsa TEMİZLİK EKSİK + maskeli liste | `packages/contracts/src/domains/moderation.ts:400` | |
| R5.merge | R5 | initiator | P1 | tüm rol dosyalarında aynı run id ve release | `docs/KV-44_SECURITY_ACCEPTANCE.md:31` | |

Sonuç değerleri: PASS, FAIL, BLOCKED-role, BLOCKED-window, BLOCKED-ratelimit, BLOCKED-verification, UYGULANAMAZ-staging, INFO, TEMİZLİK EKSİK. R5 kararı şöyle verilir: R4 dışında bir FAIL varsa **NO-GO**. Zorunlu satırların hepsi PASS ise (yalnız `R1.last_super_admin` ve `R1.legacy_approval` UYGULANAMAZ-staging olabilir) **PASS**. Diğer her durum **BLOCKED** olur. Temizlik ayrıca TAMAM ya da TEMİZLİK EKSİK diye raporlanır.

## 5. Koddan çıkan iki not

- **`self` ayrıntısı staging'de görünmez.** `PUT /admin/users/:id/role` önce route kapısından geçer (`roles-routes.ts:21`). Kendi hesabı hedefleyen istek orada `permissions.ts:560` kuralıyla reddedilir ve `access.ts:57-58` hatayı **boş details** ile döndürür. `roles-routes.ts:42` (`details[0].code="self"`) yalnız transaction içi yedek kontroldür. Araç 409 CONFLICT'i şart koşar; details `self` veya boş olabilir, gözlenen değer kanıta yazılır. Owner istekte rolünü yine SUPER_ADMIN olarak gönderir. Böylece kontrol bozulsa bile işlem aynı rolü yeniden atamaktan öteye geçmez ve tek süper admin riske girmez.
- **`last_super_admin` HTTP'den tetiklenemez.** Tek SUPER_ADMIN politikasında son SUPER_ADMIN'i ancak kendisi hedefleyebilir. Rolde önce `self` kuralı (`permissions.ts:560`), yaptırımda `Kendine yaptırım uygulanamaz` (403) cevap verir. İkinci SUPER_ADMIN açmak politikaya aykırı olduğundan satır `UYGULANAMAZ-staging` kalır. Kanıtı birim testidir (`admin-roles.test.ts:171`).

## 6. Sınırlar

- Rol onaylarını listeleyen bir endpoint yok. Eski bekleyen talep ancak owner kimliğini biliyorsa (`--legacy-approval`) test edilir. Staging'de bu amaçla talep **açılmaz**.
- R3 karantina yükleme/tamamlama ve anonim erişim retlerini kanıtlar. Model APPROVED derse `R3.not-public` INFO olur, karar BLOCKED kalır. Model timeout/kesinti, private→public onay ve tarayıcı CORS bu aracın kapsamında değildir.
- Sentetik hesaplar audit için yasaklı kalır, içerik soft-delete edilir (`staging-write-acceptance.mjs` ile aynı ilke).
