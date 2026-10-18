# KV-52 / #54 — Public V1 yayın runbook'u ve karar kaydı

> **Sahip:** Faruk (@farukkemree): kanıt paketini toplama, deploy/smoke ve rollout operasyonu. **Son GO/NO-GO kararı yalnız Mehmet'tedir**; bu belge yayın onayı değildir ve Faruk kendiliğinden public yayın yapmaz.
> **Bağlı belgeler:** regresyon ve kanıt matrisi [KV-51](./KV-51_RELEASE_EVIDENCE.md) (#53, Mert) · operasyon ve izleme [KV-49](./KV-49_OPERATIONS.md) (#51) · yedek/restore [KV-48](./KV-48_BACKUP_RESTORE.md) · kapalı beta [KV-45](./KV-45_BETA_LAUNCH_PLAYBOOK.md) (#47).
> **Güncel durum (18 Ekim):** **NO-GO.** Engeller §1'de. Canlı tablo: `GITHUB_TOKEN=$(gh auth token) node scripts/release-status.mjs` (#264).

## 1. Yayın kapıları ve güncel engeller

Kapılar sırayla değil, **aynı aday SHA** üzerinde birlikte geçmelidir. Bir kapının eski SHA'daki PASS'i yeni SHA için geçerli değildir (KV-45 §1, KV-51 §0).

| Kapı | Sahip | Engel (18 Ekim) | Kanıt nerede |
|---|---|---|---|
| #46 güvenlik ve entegrasyon | Utku | Güvenlik matrisi ve canlı medya/model kesinti kanıtı tamamlanmadı | #46, `security-staging` |
| #47 kapalı beta (40 kişi) | Mert | Davet yok: #46 ve #51 GO bekleniyor | KV-45 |
| #48 / #195 mobil ve erişilebilirlik | Ümit / Mert | Fiziksel iOS/Android ve ekran okuyucu kanıtı yok | #48, #195 |
| #51 production operasyonu | Faruk | Alan adı satın alınmadı → gerçek SMTP yok; yedek açık değil (`BACKUP_ENABLED=false`); harici uptime izleme kararı yok | KV-49 kontrol listeleri |
| #52 paylaşım/SEO | Ümit | X/WhatsApp cache ve funnel kanıtı yok | #258, KV-25 |
| #53 regresyon | Mert | Aynı release SHA'da tam regresyon koşusu yok | KV-51 |
| #180 / #182 kritik yetki | Mehmet / Utku | #182 iki kişi kuralı tek SUPER_ADMIN politikasıyla bloke; güvenli alternatif onaylanmadı | #2 (18 Ekim notu) |

## 2. Karar kaydı (şablon)

Her GO/NO-GO kararı #54'e bu alanlarla yazılır (KV-45 §1). Şifre, token, çerez, kişisel veri ve özel URL yazılmaz.

```
Karar: GO | NO-GO                 Karar veren: Mehmet            Zaman (UTC): …
Aday SHA: API … / web …           Foundation CI run: …           Staging smoke: PASS/FAIL (run)
Kapılar: #46 … · #47 … · #48 … · #51 … · #52 … · #53 … (her biri PASS/FAIL/BLOCKED + kanıt bağlantısı)
Açık P0/P1: yok | #…               Kapsam dışı bırakılan (sahip + yeni tarih): …
Geri alma tetikleyicisi: §5'teki ölçütler · Geri alma sorumlusu: Faruk
```

## 3. Yayın öncesi kontrol (Faruk)

**T−24 saat:**
- [ ] `release-status.mjs` raporunda bütün kapılar PASS; açık staging alarmı ve açık P0/P1 yok.
- [ ] Production ortamı KV-49 "Production'a geçiş listesi"ne göre hazır (alan adı, TLS, ayrı API/worker servisi, gerçek SMTP, bucket anahtarları, PostgreSQL sürümü).
- [ ] `scripts/mail-readiness.mjs` production alan adı için FAIL'siz; Gmail ve Outlook'a gerçek teslim (gelen kutusu) doğrulandı.
- [ ] Zamanlanmış şifreli yedek açık ve son 26 saat içinde başarılı; panelde `backup.status = ok`. Son 7 gün içinde şifreli yedekten boş DB'ye restore tatbikatı yapıldı (KV-48).
- [ ] Harici uptime izleme production `/health` ve web ana sayfasını yokluyor; bildirim sorumluya düşüyor. `/health` DB ve worker kesintisinde 503 döner (#263).
- [ ] Acil durum anahtarları ve bakım modu production'da denendi (aç → yayılma süresi → kapat; panelde "Acil durum anahtarları").
- [ ] Aday SHA donduruldu: yayın bitene kadar main'e yalnız yayını engelleyen düzeltme girer.
- [ ] **Staging'de kuru çalıştırma** (aday SHA ile, §4'ün aynısı): bakım modu aç → smoke → bakım kapat → önceki deployment'a rollback → aday SHA'ya dönüş. Süreler ve sonuç #54'e yazılır. Bu sırada staging `STAGING_PINNED_SHA` ile sabitlenir (#257).

**T−1 saat:**
- [ ] Aday SHA'nın Foundation CI'ı yeşil; staging bu SHA'da (`/health` → `release.sha`) ve staging smoke PASS.
- [ ] Mehmet'in GO kaydı #54'te (§2 şablonu).
- [ ] Production izleme değişkenleri tanımlı (#267): `PROD_API_URL`, `PROD_WEB_URL` ve **`PROD_RELEASE_SHA` = aday SHA**. Boş kalırsa onaysız deploy alarm vermez.

## 4. Yayın adımları

| # | Adım | Komut / yer | Doğrulama |
|---|---|---|---|
| 1 | Bakım modu açık: GET dışındaki istekler 503 `MAINTENANCE` (kayıt, oy, yorum, yayın kapalı). **Okuma, giriş/çıkış ve `/admin` açık kalır** | Panel → Acil durum (SUPER_ADMIN, gerekçe) | `/v1/config` → `maintenance: true`; bir yazma isteği 503 |
| 2 | Yayın öncesi yedek | Worker yedek işi elle ya da `apps/worker/scripts/scheduled-backup.ts` | `ops_backup_runs`'ta yeni satır; bucket'ta iki dosya |
| 3 | Aday SHA'yı production'a deploy | Railway: onaylı SHA (yalnız main'den) | `preDeployCommand` migration'ları uyguladı; `/health` 200 ve `release.sha` = aday |
| 4 | Web'i aynı SHA'dan yayınla | Vercel production | Ana sayfa 200, `"demo":false` |
| 5 | Smoke | `pnpm smoke --api <prod-api> --web <prod-web> --strict` | Hepsi PASS |
| 6 | E-posta uçtan uca | Gerçek kutuyla kayıt → doğrulama → giriş | Mail 2 dk içinde gelen kutusunda |
| 7 | Bakım modu kapalı | Panel → Acil durum | Yayılma süresi sonunda `/v1/config` → `maintenance: false` |
| 8 | Duyuru | Mehmet | — |

Adımlardan biri başarısızsa yayın durur, bakım modu açık kalır, §5 uygulanır.

**Doğrulama sırası (7. adımdan sonra ve her geri dönüşten sonra), sırayla:**
1. `GET /health` → 200, `status: ok`, `database: ok`, `worker: ready`, `release.sha` beklenen SHA.
2. `GET /v1/config` → `maintenance` beklenen değerde; özellik anahtarları beklenen değerde.
3. `GET /v1/categories` ve `GET /v1/feed` → 200 (okuma yolu).
4. Web ana sayfası → 200, `"demo":false`.
5. Gerçek hesapla giriş → bir oy → oyu geri değiştirme (yazma yolu; bakım kapalıyken).
6. Operasyon paneli: 5xx oranı ve P95 olağan, kuyrukta birikme yok, alarm yok.

## 5. Geri dönüş tetikleyicileri ve eylem

| Tetikleyici | Eylem |
|---|---|
| Smoke ya da e-posta uçtan uca FAIL (yayın sırasında) | Bakım modu açık kalır; önceki deployment'a uygulama rollback'i (KV-49 "Deploy ve rollback"); kök neden sonra |
| `/health` 503 ya da harici izleme kesinti (5 dk) | KV-49 "Olay müdahalesi"; DB kaynaklıysa sağlayıcı durumu + bağlantı; uygulama kaynaklıysa rollback |
| 10 dakika boyunca 5xx oranı > %5 (panel `http.errorRate`) | Rollback; gerekirse ilgili özellik anahtarı kapatılır (yorum, görsel, anket) |
| Veri bütünlüğü şüphesi (oy sayaçları, kayıp yazım) | Bakım modu; oy tutarlılık kontrolü (`db:verify-votes`, #261); veri bozulduysa KV-48 restore + anonimleştirmelerin yeniden uygulanması (restore 7. adım) |
| Güvenlik olayı (yetki atlatma, veri sızıntısı) | Bakım modu; Utku ve Mehmet; oturum iptali, secret rotasyonu (KV-49 roller) |

Migration'lar geri alınmaz (expand/contract); uygulama rollback'i yeni şemayla çalışır (KV-48).

## 6. Yayın sonrası izleme

| Zaman | Kim | Ne |
|---|---|---|
| İlk 2 saat | Faruk (aktif) | Operasyon paneli: 5xx oranı, P95, kuyruk birikimi, kilitli girişler, kritik yönetici işlemleri; harici izleme; Railway logları |
| İlk 24 saat | Faruk + ilgili sahip | Panel 4 saatte bir; ilk zamanlanmış yedeğin başarısı; e-posta teslim hataları; açılan bug'lar #54'te toplanır |
| İlk 7 gün | Faruk | Günlük `release-status.mjs` raporu #2'ye; P0/P1 bulguların sahibi ve tarihi #54'te |

**Ölçüm notu:** KV-07 ürün analitiği olayları henüz toplanmıyor (#55, KV-53 B1). Bu yüzden yayın sonrası kullanım ölçümü operasyon metrikleriyle (istek, kayıt, oy sayıları) sınırlıdır; ürün metriği iddiası yapılmaz.
