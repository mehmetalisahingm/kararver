# KV-12: İlk SUPER_ADMIN (bootstrap) runbook'u (#14)

> Sahip: **Utku** · Kod: `apps/api/src/modules/rbac/bootstrap.ts` (mantık), `bootstrap-cli.ts` (giriş noktası) · Test: `apps/api/test/admin-bootstrap.test.ts`
> Karar: [`DATA_MODEL.md` §11.4 açık konu 6](./DATA_MODEL.md) · Rol kuralları: [`DATA_MODEL.md` §9.1](./DATA_MODEL.md)

Bir ortamda hiç SUPER_ADMIN yokken ilk SUPER_ADMIN'i tek seferlik olarak atar. Sonraki bütün rol atamaları admin panelinden (`admin.roles.put`, KV-33) yapılır. Ortam değişkeniyle açılışta yükseltme ve seed migration bilerek kullanılmaz (§11.4/6).

## Önkoşullar

- Hedef kişi normal kayıt akışıyla hesap açmış ve e-postasını doğrulamış olmalı.
- Hesap silinmemiş ve `status = ACTIVE` olmalı.
- `DATABASE_URL` hedef ortamı göstermeli. Local'de kökteki `.env` okunur; `APP_ENV` tanımlıysa (staging/production) sadece ortam değişkenleri kullanılır.
- Migration'lar uygulanmış olmalı (`user_roles` tablosu).

## Kullanım

```bash
# 1) Önce dry-run (varsayılan). Hiçbir şey yazmaz; transaction READ ONLY açılır.
pnpm --filter @kararver/api admin:bootstrap --email kisi@example.com

# 2) Çıktıdaki hedef veritabanını ve kullanıcıyı kontrol edin, sonra yazın:
pnpm --filter @kararver/api admin:bootstrap --email kisi@example.com --apply
```

Dry-run çıktısı:

```text
Hedef veritabanı: localhost:5432/kararver
Mod: DRY-RUN (hiçbir şey yazılmaz)
Yapılacak: @kisi (0199…): USER → SUPER_ADMIN (yeni satır), granted_by_id = NULL
Yazmak için aynı komutu --apply ile çalıştırın.
```

- **Hedef veritabanı** yalnız `host:port/veritabanı` olarak yazılır. Kullanıcı adı, parola ve tam `DATABASE_URL` hiçbir çıktıda yer almaz.
- **E-posta** kayıt/giriş ile aynı fonksiyonla (`normalizeEmail`, auth modülü) normalize edilir; büyük harf ve baştaki/sondaki boşluk fark etmez.
- **`--apply` başarılıysa** stdout'a yapılandırılmış tek satır yazılır. Bu satırı değişiklik kaydına (ör. deploy notu) ekleyin:
  ```json
  {"event":"rbac.super_admin_bootstrap","userId":"…","username":"kisi","previousRole":null,"role":"SUPER_ADMIN","database":"localhost:5432/kararver","at":"2026-09-30T12:00:00.000Z"}
  ```
- **Audit (KV-39):** `--apply` rol satırıyla **aynı transaction'da** `audit_logs`'a bir kayıt yazar: `source = CLI`, `actor_id` NULL (sistem/CLI), `action = user.role.assign`, `operation = grant` (rol satırı yoksa) veya `change` (mevcut MODERATOR/ADMIN satırı yükseltiliyorsa), hedef `USER`/kullanıcı id'si, sabit gerekçe (`BOOTSTRAP_AUDIT_REASON`, CLI gerekçe argümanı almaz), `before` = önceki rol (`USER`/`MODERATOR`/`ADMIN`), `after` = `SUPER_ADMIN` ve `grantedBy: null`. Rol yazılırsa kayıt da vardır; kayıt yazılamazsa rol de geri alınır. Dry-run (READ ONLY), "zaten" ve ret audit yazmaz. Stdout satırı operatör çıktısı olarak kalır; kalıcı iz audit kaydıdır (DATA_MODEL §9.2).

## Kurallar ve sonuçlar

Her şey tek transaction'da, sabit anahtarlı bir advisory lock (`pg_advisory_xact_lock`) altında yapılır. Eşzamanlı iki çalıştırmadan yalnız biri yazar; ikincisi kilidi bekler, sonra yazılan satırı görüp reddeder.

| Durum | Sonuç | Çıkış kodu |
|---|---|---|
| Dry-run, kurallar geçiyor | Yapılacak işlem yazılır, hiçbir şey değişmez | 0 |
| `--apply`, kurallar geçiyor | Satır yazılır. Hedefin rol satırı varsa (ör. MODERATOR) SUPER_ADMIN'e yükseltilir, yoksa eklenir. `granted_by_id = NULL` | 0 |
| Hedef zaten tek SUPER_ADMIN | "Değişiklik yok" | 0 |
| Kullanıcı yok (`USER_NOT_FOUND`), silinmiş (`USER_DELETED`), e-posta doğrulanmamış (`EMAIL_NOT_VERIFIED`), `ACTIVE` değil (`USER_NOT_ACTIVE`) | Ret, yazma yok | 1 |
| Herhangi bir SUPER_ADMIN satırı var (`SUPER_ADMIN_EXISTS`) | Ret, yazma yok. Sahibi silinmiş/banlı olsa da satır sayılır | 1 |
| Beklenmeyen hata (bağlantı vb.) | Mesaj, bağlantı dizesi ve parola gizlenerek yazılır | 1 |
| Eksik/bilinmeyen argüman, `DATABASE_URL` yok | Kullanım metni | 2 |

Uygunluk kontrolü "zaten" kontrolünden önce yapılır: SUPER_ADMIN olup sonradan askıya alınan veya silinen hesaba "zaten" denmez, reddedilir.

**Neden kural DB'de değil:** `user_roles_bootstrap_check` verensiz satırı her SUPER_ADMIN'e izin verir (ilk satırı yazabilmek için). "Hiç SUPER_ADMIN yokken, tek bir kez" kuralını yalnız bu CLI korur. `user_roles`'a elle `granted_by_id = NULL` ile yazmak bu korumayı atlar; yapmayın (aşağıdaki kurtarma dışında).

## Kurtarma

### SUPER_ADMIN parolasını unuttu

CLI gerekmez. Normal şifre sıfırlama akışı kullanılır (`auth.password.forgot` → e-postadaki bağlantı → `auth.password.reset`, KV-09). Rol satırı değişmez.

### Tek SUPER_ADMIN'in hesabı silindi veya banlandı

CLI reddeder (`SUPER_ADMIN_EXISTS`), çünkü satır hâlâ vardır. Panelden de düzeltilemez: rol atamak ve yaptırım kaldırmak başka bir aktif SUPER_ADMIN ister. Tek yol elle DB müdahalesidir:

1. **Önce yedek alın** ve müdahaleyi en az iki kişiyle yapın (biri komutları çalıştırır, biri kontrol eder). Tarih, sebep ve kişileri değişiklik kaydına yazın.
2. `psql` ile, CLI'ın kullandığı kilidi alıp eski satırı silin:
   ```sql
   BEGIN;
   SELECT pg_advisory_xact_lock(hashtextextended('kararver.rbac.super_admin_bootstrap', 0));
   SELECT r.user_id, u.username, u.status, u.deleted_at
     FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.role = 'SUPER_ADMIN';               -- tam olarak beklenen tek satır mı?
   DELETE FROM user_roles WHERE role = 'SUPER_ADMIN' AND user_id = '<eski-süper-admin-id>';
   COMMIT;
   ```
3. Yeni hedef için CLI'ı önce dry-run, sonra `--apply` ile çalıştırın.

**Riskler:**
- Elle silinen rol satırının audit kaydı olmaz (SQL ile yapılan işlem `writeAudit`'ten geçmez); yapılan işlemi değişiklik kaydına yazın. Bootstrap'ın kendi audit kaydı silinmez (append-only). Eski SUPER_ADMIN'in verdiği roller (`granted_by_id`) ve yaptırımlar etkilenmez; FK'ler `users`'a gider.
- DB'ye yazma yetkisi olan herkes aynı yolla herhangi birini SUPER_ADMIN yapabilir. Bu yüzden adım 2'de tek satırı `user_id` ile hedefleyin, `WHERE role = 'SUPER_ADMIN'` ile toplu silmeyin ve SELECT sonucu beklenenden farklıysa `ROLLBACK` yapın.
- Banlı eski SUPER_ADMIN'in yaptırımı ve `users.status`'u bu adımda değişmez; gerekirse yeni SUPER_ADMIN panelden yönetir.

## Testler

`apps/api/test/admin-bootstrap.test.ts`, sadece `TEST_DATABASE_URL` tanımlıyken (PostgreSQL) çalışır: dört ret durumu ve kullanıcı yok, başarılı atama, ikinci çalıştırma (farklı kullanıcı ret / aynı kullanıcı "zaten"), silinmiş/banlı sahipli SUPER_ADMIN satırı, dry-run'ın hiçbir satır yazmaması, MODERATOR yükseltme, eşzamanlı iki bootstrap. Kilit testi ilk çalıştırmayı kontroller bitince bekletir, ikincinin advisory lock'ta beklediğini `pg_locks`'tan görür (sabit bekleme yok), sonra ilkini bırakır; kilit kaldırılırsa test kırılır. Test süresi 20 sn ile sınırlıdır; takılırsa hangi adımda takıldığını söyleyen hatayla biter.
