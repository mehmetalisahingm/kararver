# KV-39 — Değiştirilemez audit log API'si ve ekranı (#41)

> Sahip: **Faruk** (Utku'nun geçici inaktifliği süresince devralındı). Altyapı Utku'nun (#116). Tablo ve kurallar: [`DATA_MODEL.md` §9.2](./DATA_MODEL.md) · Sözleşme: `packages/contracts/src/audit.ts`, `admin.audit.list` · API: `apps/api/src/modules/audit/` · Ekran: `apps/web/src/features/admin/audit-panel.tsx` · Testler: `apps/api/test/audit.test.ts`, `apps/api/test/audit-list.test.ts`, `apps/web/test/admin-client.test.ts`

## Kabul koşulları (#41)

| Koşul | Durum | Kanıt |
|---|---|---|
| Admin kendi logunu değiştiremiyor/silemiyor | ✅ | `UPDATE`, `DELETE` ve `TRUNCATE` trigger ile reddediliyor (`KV_AUDIT_LOGS_APPEND_ONLY`). API'de yazma/silme endpoint'i yok (`POST`/`PUT /admin/audit` → 404). Test: `audit-list.test.ts`, DB testi. |
| Kritik işlemin kaydı kaybolmadan tamamlanması (transaction/outbox) | ✅ | `writeAudit(tx, …)` işlemle aynı transaction'da çalışıyor. İşlem geri alınırsa kayıt da yok, kayıt yazılamazsa işlem de olmuyor (`audit.test.ts`, Utku #116). Olay outbox'ı (KV-21) ayrı; audit, olay tüketicisi değil. |
| Loglar sır içermiyor; users/content/settings/featured/community işlemleri kapsanıyor | ✅ (settings: KV-40 bekliyor) | Hassas anahtarları (`password`, `token`, `secret`, `email`, `cookie`, `ip`, `userAgent`, `sessionId`, `…optionId`) `assertAuditEntry` yazmadan önce reddediyor. API cevabında e-posta veya sır yok (test). Kapsam tablosu aşağıda. |
| PR, test, kanıt | ✅ | #116 (altyapı), bu PR (liste, ekran, `revision.read`), modül PR'ları (aşağıda). |

## `GET /admin/audit` (`admin.audit.list`)

- **Yetki:** Yalnız ADMIN+. Misafir 401, kullanıcı ve moderatör 403.
- **Sıra ve süzgeçler:** `created_at` ↓, `id` ↓. Süzgeçler: `actorId`, `targetType`, `targetId`, `action`, `operation`, `source` (`API` / `CLI` / `WORKER`), `from` (dahil), `to` (hariç).
- **Cursor:** Süzgeçlere bağlı. Başka süzgeçle verilen cursor `400 INVALID_CURSOR` döner.
- **Aktör:** `PublicUser` olarak döner. Silinmiş hesap da gösterilir, çünkü hesap verebilirlik için işlemi kimin yaptığı bilinmeli. Bu görünüm yalnız ADMIN+'a açık.

## Ekran (`/admin/audit`)

- Süzgeçler: işlem, hedef türü, hedef kimliği, kaynak, gün aralığı.
- Liste: zaman, yapan, işlem ve tür, hedef, gerekçe.
- "Göster" ile önce/sonra özeti, istek kimliği ve kayıt kimliği açılır.
- Yükleniyor, boş ve hata durumlarında tekrar deneme ile "daha fazla göster" var; diğer yönetim panelleriyle aynı kalıp (`useRemoteList`).
- Yazma işlemi yok.
- Erişilebilirlik ve taşma denetimi: durum matrisi (`apps/web/test/states/matrix.spec.ts`) `/admin/audit`'i açık/koyu tema ve üç tarayıcıda denetliyor.

## Kapsam (audit yazan işlemler)

| İşlem | Uç noktalar | Yazan |
|---|---|---|
| `user.sanction`, `user.sanction.lift`, `user.role.assign` | `admin.sanctions.*`, `admin.roles.put`; CLI `admin:bootstrap` | admin-users (Utku #122), rbac/bootstrap (#116) |
| `vote.invalidate` (`invalidate` / `restore`) | `admin.votes.*` | votes (Faruk #120) |
| `moderation.poll.apply`, `moderation.comment.apply`, `moderation.poll.move`, `moderation.user.warn`, `report.resolve` | `admin.moderation.*`, `admin.reports.*` | moderation, reports (Mert #130, #139) |
| `media.review`, `media.ban.manage`, `media.queue.read` | `admin.media.*` | media (Mert) |
| `community.create`, `community.update`, `community.moderator.assign` | `admin.communities.*` | communities (Mert #113) |
| `category.manage` | `admin.categories.*` | categories (Mehmet #132) |
| `featured.manage`, `announcement.manage` | `admin.featured.*`, `admin.announcements.*` | featured (Mehmet #147) |
| `points.adjust` | `admin.points.adjust` | points (Mehmet) |
| `revision.read` | `admin.revisions.polls`, `admin.revisions.comments` | revisions (**bu PR**): geçmişin ilk sayfası açılınca bir kayıt; sonraki sayfalar aynı okumanın devamı |
| `settings.update`, `emergency.update` | `admin.settings.update`, `admin.emergency.put` | **Bekliyor:** Uç noktalar henüz yok (KV-40, #42). İşlemler `auditOperations`'ta hazır; uç noktayı yazan kişi `writeAudit` ekler. Contracts testi, gerekçe zorunlu her işlemin haritada olduğunu zorluyor. |

## Açık konular

- **Saklama süresi:** V1'de audit kayıtları **süresiz** saklanıyor (append-only; silme trigger'la yasak). Kayıtlarda kişisel veri yok: kullanıcı kimliği, işlem ve hassas alandan arındırılmış özet var. Süre sınırı (ör. KVKK gereği) istenirse silme, ayrı ve gerekçeli bir migration ile trigger'ın kapsamı daraltılarak yapılır. Karar: Mehmet (ürün).
- **`…_utku_kv39_audit_logs` migration'ı transaction'a sarılı değil:** Main'e girmiş migration değiştirilemez (Prisma checksum). `db:check-migrations` bunu uyarı olarak raporluyor. Sonraki migration'lar `BEGIN/COMMIT` ile sarılı (KV-48).
