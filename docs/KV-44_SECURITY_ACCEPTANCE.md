# KV-44 / #46 — Kapalı beta güvenlik ve entegrasyon kabulü

**Kayıt tarihi:** 9 Ekim 2026. **Teslim sahibi:** Mehmet (@mehmetalisahingm; Utku görevinden devralındı). **Durum: NO-GO — gerçek staging kanıtı tamamlanmadı.** Bu belge plan veya test listesi ile gerçek PASS'ı ayırır.

## 16 Ekim 2026 akşam — #246 staging dağıtımı, ilave salt-okuma medya sınırı

- PR #246 ve #247 main'de, güncel main SHA `28f23188ee2b6aa75b3e7718d37f8e8e0b35465d`. Railway API deploy `375fe83b-b66f-466c-8472-94dde180bde7` **SUCCESS**; canlı health `release.sha=28f23188ee2b`, worker `ready`. Ayrı public bucket credential referansları ve media proxy base URL staging'e uygulandı.
- Eksik UUID için hem doğrudan API hem Next.js `/api` proxy yolu gerçek HTTP 404 döndü. Staging robots tüm dizini disallow eder; sitemap boştur. **Bu kontroller onaylı medyanın başarıyla işlendiği, okunabildiği veya kaldırılabildiği anlamına gelmez.**
- Yeni `scripts/public-media-readonly.mjs` güvenlik otomasyonu, iki sabit staging origin üzerinde yalnız anonim GET ile eksik/geçersiz medya 404, no-store, noindex, redirect ve imzalı URL sızıntısı ile proxy uyumunu izler. Bu tarama kimlikli E2E kabulüne eşit değildir.
- **Hâlâ BLOCKED:** gerçek izole yükleme/model zaman aşımı, private→public onay, 200→ret→404, tarayıcı PUT/CORS, iki bağımsız yönetici MFA, acil anahtar, SMTP ve gerçek cihazlar. Beta **NO-GO**. Aşağıdaki eski SHA listeleri tarihsel kanıttır.

## A. Sürüm ve kanıt ilkesi

### 16 Ekim 2026 — güncel kanıt, kalanlar

Main `2c6bb0ed6360441d0e375d50fe5a925c617f48ce`, kanonik web `https://kararver-staging.vercel.app`, API `https://api-staging-45cb.up.railway.app`. Web/API aynı SHA; [main CI](https://github.com/mehmetalisahingm/kararver/actions/runs/38937887630) başarılı. CI staging-smoke skipped; canlı HTTP ayrı çalıştırıldı. Tam beta kararı **NO-GO** kalır. Önceki tarihli BLOCKED listeleri başlangıç kaydıdır; en yeni kapsam aşağıdadır.

| Kapsam | Kaydedilen gerçek kanıt | Kalan |
| --- | --- | --- |
| S01–S04 | Sabah be6ebd23… sürümünde iki sentetik hesap/topluluk; aynı cookie USER→ADMIN→USER 403/200/403, scope dışı 403, 20 aynı-user isteğinde tek oy, kilitli/kapanmış oy retleri, sonuç gizliliği. Ek kapanış/MFA/kaldırma 27/27. | Sabah tam akışındaki 46 PASS/1 FAIL saklı; düzelen Retry-After beklemesiyle son adayda tam tekrar ve poll bazlı CAST-event eşlemesi gerekir. |
| DB | 2c6bb0e, 17:20 UTC: yarım migration, anket/seçenek oy sayacı, oy-seçenek aidiyeti, tepki sayaçları ve etkin trigger kontrolü **6/6 tutarlı**. | Bu global kontrol poll bazlı CAST-event kanıtının yerine geçmez. |
| S05 | Gerçek medya yolu için özel bucket/proxy ve bucket'a özel anahtar düzeltmesi #246. | #246 CI ve gerçek DB/S3 izole model-timeout → karantina → onay → public ret kabulü bekler. |
| S06 | Sabah gerçek 429/Retry-After ve BAN sonrası aynı-cookie 401. | Kaynak/IP ayrımı ve suspend alt vakaları son adayda tamamlanmalı. |
| S07 | Kod/CI senaryoları mevcut. | Shared staging'de kontrollü bakım/switch geri alma penceresi henüz yok. |
| S08 | 2c6bb0e: anonim güvenlik 25/25; kendi-session 17/17 (17:25 UTC), Secure/HttpOnly/SameSite=Lax/no-store, CSRF 403, session korunumu, logout204/eski-cookie401. | Yeni yayın adayında tekrar. |
| S09 | 2c6bb0e, 17:20:44–17:21:14 UTC: yalnız 20s test session'ı **200 → DB expired=true/revoked=false → aynı-cookie401 + temizleme**. Global TTL/hesap değişmedi; test session'ı sonunda revoke edildi. | Sağlayıcı SMTP kabulü ayrı; kullanıcının doğrulamayı geçici kapalı tutma kararı korunur. Doğal expiry artık eksik değildir. |
| S10 | Main tam CI başarılı; gerçek admin mobil/desktop8/8. | Fiziksel cihaz/ekran okuyucu, iki yönetici zorunlu onayı, yedek aktivasyonu, #51/#53 ve kalan yüksek riskler. |

[Ayrıntılı zaman/SHA ve sınırlamalar](MEHMET_V1_LIVE_EVIDENCE_2026_10_16.md). İç ağdaki kabul sonrası pre-deploy komutu normal migration komutuna döndürüldü ve tekrar okundu. DB dış erişimi veya ek ücretli worker servisi açılmadı. Sentetik güvenlik hesaplarının rol/yaptırım/temizlik sonucu ayrıca doğrulandı. Gerçek beta katılımcısı, fiziksel cihaz veya bağımsız insan onayı uydurulmadı.

Her satır şu alanlara bağlanmalıdır: *staging URL, aynı release'e ait web SHA/API SHA, UTC zaman, kullanılan test tipi, gerçek HTTP durumları (kişisel veri maskeli), GitHub CI job/link, vaka/ticket, PASS/FAIL/BLOCKED, sahibi*. Bir eski PR'ın başarılı testi yeni staging adayının geçtiği anlamına gelmez.

Güvenlik için **göstermelik test hesabı, sahte mock, demo fixture veya yalnız başarılı HTTP 200** yeterli değildir. Kritik kullanıcı durumu, eşzamanlılık, sızıntı ve bypass kontrolleri gerçek PostgreSQL ve canlı API sınırlarıyla ayrıca doğrulanır. Gizli erişim bilgisi, kullanıcı e-postası, oturum çerezi, doğrulama tokenı, ham IP ve özelleştirilmiş sağlık/kimlik bilgileri bu belgede veya halka açık issue yorumunda bulunmaz.

**Mevcut durum:** Kod seviyesinde birçok kapsamlı test var. 9 Ekim Railway ortam incelemesinde staging API deployment'ı `53cebc1fd23d3b0f0d2ce05c81464c12bb3b7a1a` ve `SUCCESS` görünüyor; son merge `b1c0c07a398ce4dbd14a9a5a8f291af1f2c6ff29` olduğundan **kod sürümleri aynı değil**. Bu bilgi daha yeni deployment doğrulaması gelince güncellenecek. Bu çalışma ortamından API'ye doğrudan DNS/HTTP erişimi doğrulanamadığı için canlı güvenlik taraması PASS sayılamaz. Buradaki bütün HTTP kontrolleri yeniden çalıştırılmalı.

**15 Ekim 2026 güncellemesi:** Railway staging API `GET /health` → `status=ok`, `worker=ready`, `release.sha=ae3ff8f38467`; `main` birleşme commit'i `ae3ff8f384673c54fb763f98ba3cadaf27d8416a`, Railway deployment SUCCESS. Salt-okuma gerçek HTTP: `/v1/categories` 200, anonim `/v1/admin/audit` 401, Vercel staging web ana sayfası erişilebilir. GitHub Actions Foundation checks (run `38713249727`) database, integration, storage, web, UI ve Chromium/Firefox/WebKit başarı; `staging-smoke` adımı skipped. **S01–S10 kimlikli/proxy/medya/oy/SMTP kapsamları hâlâ BLOCKED; NO-GO değişmedi.** Aşağıdaki 9 Ekim sürüm uyuşmazlığı paragrafı tarihsel bulgudur, artık geçerli deploy durumu değildir.

## B. Otomatik test ve staging kabul matrisi

Durumlar: **AUTOMATED** = gerçek Postgres destekli CI test kodu mevcut; güncel SHA'lı yeşil iş varsa yalnız kod seviyesi kanıt. **BLOCKED** = aynı staging sürümünde gerçek HTTP kanıtı eksik. **FAIL** = doğrulanmış zafiyet/hata. Hiçbiri tek başına beta GO değildir.

| ID | Güvenlik şartı | Mevcut otomatik kanıt | Gerçek staging kabul | Başlangıç |
|---|---|---|---|---|
| S01 | 20 eşzamanlı aynı kullanıcı oyu → 1 geçerli oy; iki hesap sonucu değiştiremez | `apps/api/test/votes.test.ts` eşzamanlılık/sayaç | Aynı release, iki doğrulanmış kontrollü test hesabı, DB sayaç ve idempotency | BLOCKED |
| S02 | Kapanan ve kilitli içerikte oy, seçenek değişimi reddi | `votes.test.ts`, `polls.test.ts`, `votes-admin.test.ts` | Gerçek kapanış sonrası ret / sonuç gizliliği | BLOCKED |
| S03 | Rol yükseltme yok, güncel roller açık oturumda etkili | `rbac.test.ts`, `admin-roles.test.ts`, `admin-users.test.ts` | Yetkisiz 403; admin/audit/super-admin yalnız izinli | BLOCKED |
| S04 | Topluluk moderatörü başka topluluğa erişemez | `rbac.test.ts`, `admin-communities.test.ts`, `admin-moderation.test.ts` | İki bağımsız topluluk ve moderatör hesabı, scope dışı 403 | BLOCKED |
| S05 | Gizli/karantinadaki medya public olamaz; servis kesintisinde fail-closed | `media.test.ts`, `admin-moderation.test.ts`, worker medya testleri | Gerçek private S3 bucket, public URL kontrolü, model timeout/kesinti | BLOCKED |
| S06 | Rate limit, ban/suspend, hesap ve IP sınırları atlatılamaz | `rate-limit.test.ts`, `rbac.test.ts`, `media-rbac.test.ts` | Kaynak ve hesap ayrımı, açık session üzerinde yaptırım testi | BLOCKED |
| S07 | Acil anahtarlar ve bakım modu mevcut oturumlarda etkili | `admin-settings.test.ts` | Gerçek staging kontrollü bakım/geri alma, ayrı izole pencere | BLOCKED |
| S08 | Cookie Secure/HttpOnly/SameSite, CSRF/CORS/HSTS | `security-headers.test.ts`, `auth.test.ts`; `scripts/security-acceptance.mjs` | TLS gerçek proxy cevabı, cross-origin denemeleri, login sonrası CSRF | BLOCKED |
| S09 | Oturum logout/expiry/replay ve e-posta doğrulaması | `auth.test.ts`, `staging-expiry-cli.test.ts` | Gerçek SMTP/mail teslimi, short-expiry kontrollü test, eski cookie 401 | BLOCKED |
| S10 | P0/P1 sıfır; bulguların yeniden test kanıtı ve staging smoke | GitHub issue/PR incelemesi + `scripts/smoke.mjs` | Kritik/yüksek engel kalmamalı; #51/#48/#53 | BLOCKED |

**Model/karantina kesintisi** S05 için özellikle gerekliyse gerçek model cevabını zorla değiştirmek yerine staging'deki izole medya worker testinde timeout/degraded provider fixture kullan; gerçek kullanıcı görselini bozma. Güvenliği bypass eden gizli test endpoint'i ekleme. **Bakım/acil anahtar** S07 için shared staging üzerinde yazma isteği diğer testçilere etki edebilir; önceden belirlenmiş kontrollü pencere dışında değiştirme.

## C. READ-ONLY güvenlik testi

Aşağıdaki komut yalnız GET atar: test hesabı oluşturmaz, veritabanına yazmaz, oy vermez, medya yüklemez ve davet göndermeye yetki vermez.

```bash
pnpm security:test
node scripts/security-acceptance.mjs --api https://api-staging-45cb.up.railway.app
```

GitHub Actions: **[Staging security read-only gate](../.github/workflows/security-staging.yml)**. `workflow_dispatch` ile elle, **3 saatte bir UTC :17** zamanlanmış olarak ve güvenlik kapısı dosyalarında `main`e push olduğunda çalışır (GitHub schedule gecikebilir). Her çalıştırma, maskeli READ_ONLY sonucu 14 gün artifact olarak saklar; başarısız kontroller Actions işini kırar. Bu otomasyon #46'nın kimlikli staging kabulünü veya beta GO kararını vermez. Bu testlerin kapsamı public health/config, misafir kullanıcı ve admin rotalarında 401, HSTS, sunucu bilgisi sızıntısı, public config'de secret anahtarı ve kötü niyetli origin'in CORS üzerinden yetki alamamasıdır.

- HTTP veya DNS erişilemiyorsa **FAIL** (başarıya çevrilmez).
- Başarılı olsa bile beta statüsü **NO-GO** kalır; oturum, CSRF ve 20 paralel oy gibi yazma senaryoları burada test edilmez.
- Gerçek güvenlik zafiyeti varsa ilgili sorumluya öncelik verilir, bulgu ve regresyon kanıtı #46'ya bağlanır.

## D. Gerçek staging için yönlendirilmiş kabul adımları

1. **Sürüm eşlemesi:** GitHub `main` SHA, Vercel web SHA, Railway API SHA, worker/cron job SHA ve migration versiyonunu yaz; uyumsuzsa FAIL/BLOCKED.
2. **Auth:** yalnız kontrollü e-posta doğrulanmış iki test hesabı kullan. Çerezleri ve session ID'leri rapora koyma. Oturum aç/yenile/çık ve süresi dolan cookie tekrar kullanımı 401, cookie Secure/HttpOnly/SameSite/Lax koşullarını gör.
3. **Oy:** iki ayrı kullanıcı, açık/kapalı anket ve seçenekleriyle 20 paralel istek. Tek aktif oy ve gerçek PostgreSQL sayaç/olay uyumu; sonuç görünürlüğü kapalıyken anonim kullanıcıya sızıntı yok.
4. **RBAC & izolasyon:** normal kullanıcıya admin route 403, misafire 401, SUPER_ADMIN-only update, moderatör B'nin topluluk A'ya erişememesi, rol kaldırıldıktan sonra aynı cookie ile tekrar 403.
5. **Rate limit & yaptırım:** 5 başarısız giriş, oturum açmış kısıtlı kullanıcı, kaldırılana kadar engel; aynı test penceresinde diğer kullanıcı etkilenmez. Rate limit testlerini kontrollü, düşük deneme sayısıyla yap.
6. **Media/model:** PENDING/QUARANTINED görsel public değil; timeout/bilinmeyen verdict otomatik APPROVED üretmez; onay yalnız işlenmiş kopyayı yayınlar. Ayrı test bucket ve temsilî/kişisel olmayan görsel kullan.
7. **Acil anahtar:** bakım/switch kapatma ve geri alma aynı pencere içinde, audit ve açık oturum üzerinde tekrar kontrol; gerçek kullanıcıya zarar vermeyecek izinli hazırlık olmadan değiştirme.
8. **Kanıt/triage:** Her isteğin yalnız durum kodu, maskeli log referansı ve SHA'sı; ciddi bulgular için P0/P1 issue; bağımsız tekrar test. #46'da PASS imzası ve #47 beta davet GO kararı **ayrı**.

## E. Güncel operasyon engelleri

- [#51](https://github.com/mehmetalisahingm/kararver/issues/51): staging API'nin main ile eşlenmesi, e-posta ve worker/cron; bunlar release kapısı.
- [#48](https://github.com/mehmetalisahingm/kararver/issues/48): gerçek cihaz ve erişilebilirlik kabulü.
- [#53](https://github.com/mehmetalisahingm/kararver/issues/53): bütün testlerin sürüm/ortam/kanıt bağlantıları.
- [#47](https://github.com/mehmetalisahingm/kararver/issues/47): sadece #46 güvenlik GO sonrası gerçek beta.
- [#172](https://github.com/mehmetalisahingm/kararver/issues/172): V1'deki topluluk talep/onay katmanının ek yetki ve izolasyon kabulü.

**Sonuç:** Kod testleri hazır/çalışabilir olsa da mevcut kanıtlar #46'yı kapatmaya yetmez. Sürüm eşleşmesi, gerçek staging HTTP ve test kullanıcılarıyla güvenlik kabulü olmadan açılmış tüm beta davetleri **NO-GO** kabul edilir.
