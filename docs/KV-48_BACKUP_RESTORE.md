# KV-48 — Yedekleme, restore ve migration geri dönüşü

> Sahip: **Faruk** · Issue: #50 · Araçlar: `packages/db/ops/` (`backup.ts`, `restore.ts`, `verify.ts`, `check-migrations.ts`), `apps/worker/scripts/media-consistency.ts` · Testler: `packages/db/test/ops.test.ts`, `apps/worker/test/media-consistency.test.ts`

## Özet

| Kabul koşulu (#50) | Durum | Kanıt |
|---|---|---|
| Temiz ortamda gerçek restore ve uygulama smoke testi | ✅ | **Staging (Railway, PG 18.6):** canlı staging DB'sinin yedeği boş bir veritabanına geri yüklendi, birebir doğrulandı; staging API o veritabanına çevrildi ve smoke geçti ([staging tatbikatı](#staging-tatbikatı-2026-10-05)). Yerelde KV-47 profiliyle de: 50 kullanıcı × 60 sn yük, **%0 hata**, doğruluk 9/9 ([tatbikat](#tatbikat-2026-10-02)). |
| DB/medya tutarlılığı, ölçülen veri kaybı ve kurtarma süreleri | ✅ (medya: bulgu var) | DB: manifest ile birebir karşılaştırma ve sayaç tutarlılığı; yedek eşzamanlı yazım altında da tutarlı (test). **Staging RTO 5,2 dk** (yedek → restore → API geçişi → smoke), RPO = yedeğin anı. Medya: staging'de private bucket okundu (0 nesne, 0 kayıt); **public bucket'a API anahtarıyla erişim 403** (aşağıda, ekip işi). |
| Destructive migration ve deploy rollback yöntemi belgeli/denenmiş | ✅ | Uygulamanın bir önceki sürümü yeni şemada yük altında hatasız çalıştı. Deploy öncesi yedeğe dönüş denendi. Yarım kalan migration'ın kurtarılması denendi. Staging'de veritabanı geçişi ve geri dönüşü (DATABASE_URL değişimi + yeniden deploy) gerçekten yapıldı. Yıkıcı migration denetimi (`db:check-migrations`) eklendi. |

**Production'a (#51) devredilenler:** Zamanlanmış yedek işi ve ayrı yedek bucket'ı; sağlayıcının PITR özelliğinin doğrulanması; staging'de bulunan dört sorun ([staging bulguları](#staging-bulguları)).

## Araçlar

```bash
# Yedek: pg_dump (custom format) + manifest (migration'lar, satır sayıları, şema kataloğu, tutarlılık, sha256)
DATABASE_URL=... pnpm --filter @kararver/db db:backup --out ./backups

# Restore: yalnız BOŞ veya olmayan bir veritabanına; ardından manifestle birebir doğrulama
RESTORE_DATABASE_URL=postgresql://.../kararver_restore pnpm --filter @kararver/db db:restore --file ./backups/<yedek>.dump

# Salt-okur sağlık kontrolü (deploy öncesi/sonrası, restore sonrası; --manifest ile yedekle karşılaştırır)
DATABASE_URL=... pnpm --filter @kararver/db db:verify [--manifest <yedek>.dump.manifest.json]

# Yıkıcı migration denetimi (yeni migration'lar)
pnpm --filter @kararver/db db:check-migrations

# DB ↔ bucket tutarlılığı (worker'ın DATABASE_URL ve S3_* değişkenleriyle)
pnpm --filter @kararver/worker media:check
```

- **İstemci araçları:** `pg_dump`/`pg_restore` 17.x gerekir; eski istemci 17 sunucuyu yedeklemez. PATH'te yoksa `PG_BIN=<klasör>`. Parola komut satırına değil `PGPASSWORD` ortam değişkenine yazılır; manifestte ve loglarda parola `***` görünür.
- **Tutarlı yedek:** Manifest ile döküm aynı anın görüntüsüdür. REPEATABLE READ transaction'ında `pg_export_snapshot()`, ardından `pg_dump --snapshot`. Sayımlar da aynı transaction'da yapılır. Canlı trafik altında alınan yedekte de manifest dökümle birebir uyuşur. Test bunu yedek sırasında oy yazarak doğrular. `--snapshot` kaldırılınca test düşüyor (mutasyon testi).
- **Restore güvenliği:** Hedef `RESTORE_DATABASE_URL`'dir, `DATABASE_URL` ile aynı veritabanı olamaz. Hedef yoksa oluşturulur. Doluysa (public şemada tek bir nesne bile varsa) reddedilir. Var olanın üstüne yazma (`--clean`) bilerek yok. sha256 manifestle uyuşmayan dosya restore edilmez.
- **Doğrulama neye bakar:** `prisma migrate diff` trigger'ları, CHECK kısıtlarını ve fonksiyonları görmez. Manifest bunların hepsini de karşılaştırır: trigger'lar (etkin/pasif), kısıtlar (NOT VALID dahil), index'ler, fonksiyon gövdesi özeti, eklentiler. Ayrıca şu tutarlılık kontrolleri koşar:

  | Kontrol | Neden |
  |---|---|
  | Yarım kalmış migration yok | Başarısız migration'dan sonra deploy edilmesin |
  | `polls.vote_count` = geçerli oy | Sayaç ile oy tablosu aynı transaction'da yazılır |
  | `poll_options.vote_count` = seçeneğin geçerli oyu | — |
  | Oy, anketin kendi seçeneğinde | — |
  | `like_count`/`dislike_count` = tepkiler | — |
  | Bütün trigger'lar etkin | Append-only (vote_events, audit, revizyonlar) ve anket kilidi trigger'ları restore sırasında kapatılıp unutulmasın |

  Kontroller toplu SQL'dir; KV-47 profilinde ~160 ms. İlk sürüm satır başına alt sorguyla 30 sn sürüyordu.

## Yedekleme politikası (öneri — hosting kararıyla kesinleşir)

| Ne | Nasıl | Sıklık / saklama |
|---|---|---|
| PostgreSQL | Sağlayıcının otomatik yedeği ve PITR'ı (varsa, hosting kararında doğrulanacak) | Sağlayıcıya göre |
| PostgreSQL (bağımsız kopya) | `db:backup` → ayrı bir yedek bucket'ına (farklı erişim anahtarı; uygulamanın anahtarı yedekleri silemez) | Günlük; 7 günlük + 4 haftalık + 3 aylık |
| PostgreSQL (deploy öncesi) | Migration içeren her deploy'dan hemen önce `db:backup` | Son 5 deploy |
| Private bucket (orijinal + işlenmiş) | DB yedeğinden **sonra** yedek bucket'ına senkron (ör. rclone sync; R2'de nesne sürümleme yok) | Günlük |
| Public bucket | **Yedeklenmez.** İçerik, private bucket'taki işlenmiş kopyanın birebir aynısıdır (worker ve `admin.media.decide` aynı veriyi yazar). APPROVED kayıtlar için `processed_object_key` → `public_object_key` kopyalanarak yeniden üretilir. | — |

- **Sıralama:** Önce DB, sonra bucket. Orijinaller hiç silinmez, işlenmiş kopyalar da silinmez. DB yedeğinin gösterdiği her private nesne bu yüzden sonraki bucket yedeğinde vardır. DB'den sonra eklenen nesneler restore'da yalnız "sahipsiz nesne" bilgisi olarak görünür.
- **Veri kaybı (RPO):** Restore, yedeğin alındığı anın görüntüsüdür. Sonrasındaki yazımlar kaybolur; test bunu ölçer: yedek sürerken yazılan oylar restore'da yoktur, sayaçlar o ana göre tutarlıdır. Bağımsız günlük yedekte RPO ≤ 24 saattir. Sağlayıcı PITR'ı varsa dakikalar mertebesindedir (hosting kararında doğrulanacak).
- **Medya sızıntısı:** `media:check` public bucket'ta hiçbir kaydın göstermediği nesneyi **hata** sayar. Restore sonrası ya da kaldırma yarıda kaldığında reddedilmiş bir görsel hâlâ herkese açık olabilir. Bu nesneler silinir.

## Restore runbook'u

1. **Karar ve kapsam:** Hangi ana dönülecek (en son yedek / deploy öncesi yedek / PITR)? Bu andan sonraki yazımlar kaybolur.
2. **Yazımı durdur:** API'yi bakım moduna al (`maintenance.enabled`) ve worker'ı durdur. Restore sırasında eski DB'ye yazım olmasın.
3. **Yeni, boş veritabanı:** `RESTORE_DATABASE_URL=... db:restore --file <yedek>`. Var olan veritabanı silinmez; inceleme için kalır.
4. **Sonuç `SONUÇ: yedek eksiksiz ve tutarlı geri yüklendi` değilse dur.** Fark listesi neyin eksik olduğunu söyler.
5. **Şema:** Yedek eski bir sürüme aitse `prisma migrate status` bekleyen migration'ları gösterir. Uygulamanın sürümüne göre `prisma migrate deploy`, ardından `db:verify`.
6. **Medya:** Bucket'ları aynı ana döndür (yedek bucket'ından), sonra `media:check`. Public bucket'ı APPROVED kayıtlardan yeniden üret. Sahipsiz public nesneleri sil.
7. **Yönlendir:** API ve worker'ın `DATABASE_URL`'ini yeni veritabanına çevir, yeniden başlat, bakım modunu kapat.
8. **Smoke:** `pnpm smoke --api … --web …`, ardından giriş, oy ve feed kontrolü. Gerekirse trend ve snapshot işlerini elle tetikle (`trends.refresh`, `snapshots.daily`).

Ölçülen veri adımı (aşağıda) birkaç saniyedir. Toplam süreyi insan adımları belirler: karar, bakım modu, ortam değişkeni değişikliği, yeniden başlatma. Bu adımların süresi staging'de ölçülecek.

## Migration ve deploy geri dönüşü

Prisma'da down migration yoktur. Geri dönüşün üç yolu var; hangisinin seçileceği hatanın türüne bağlı.

| Durum | Yöntem | Veri kaybı |
|---|---|---|
| Yeni kodda hata, migration sorunsuz | **Uygulamayı bir önceki sürüme döndür, DB'ye dokunma.** Bunun çalışması için her migration bir önceki sürümle uyumlu olmalı (aşağıdaki kurallar). | Yok |
| Migration yarıda kaldı (P3018) | Dosya `BEGIN; … COMMIT;` ile sarılıysa hiçbir şey uygulanmamıştır: düzelt, `prisma migrate resolve --rolled-back <ad>`, `prisma migrate deploy`. Sarılı değilse önce uygulanmış kısmı elle geri al. | Yok |
| Migration veriyi bozdu | Deploy öncesi yedekten yeni veritabanına restore ([runbook](#restore-runbooku)). İleri düzeltme (forward fix) mümkünse o tercih edilir. | Deploy'dan sonraki yazımlar |

### Migration kuralları (expand/contract)

- **Önce genişlet, sonra daralt:** Kolon/tablo silme, yeniden adlandırma, tip değiştirme ve `SET NOT NULL` aynı sürümde yapılmaz.
  1. Yeni yapıyı ekle; kod ikisini birden yazsın.
  2. Kod artık eskisini okumasın (bir sürüm yayında kalsın).
  3. Eskisini sil.
- **Varsayılansız `NOT NULL` kolon eklenmez:** Eski sürümün INSERT'ü kırılır. `DEFAULT` ver ya da önce NULL'lı ekle.
- **`db:check-migrations`:** Bu ifadeleri yeni migration'larda (`20261002120000` sonrası) bulur: `DROP TABLE/COLUMN/TYPE/SCHEMA`, `TRUNCATE`, `DELETE FROM`, `ALTER COLUMN … TYPE`, `SET NOT NULL`, `RENAME`, varsayılansız `ADD COLUMN … NOT NULL`. Bilerek yapılan yıkıcı adım dosyada onaylanır, reviewer görür:
  ```sql
  -- kv:destructive legacy_x kolonu PR #130'dan beri okunmuyor; deploy öncesi yedek alınacak
  ```
  Onaysız bulgu varsa komut 1 ile çıkar. CI'a eklenmesi KV-06 sahibinde (@Utkuuzun14).
- **Transaction:** Prisma migration dosyasını transaction'a **sarmaz**. Tatbikatta denendi: `CREATE TABLE; SELECT 1/0;` → tablo oluşmuş, migration başarısız işaretli. Aynı dosya `BEGIN; … COMMIT;` ile sarılınca hiçbir şey uygulanmadı; düzeltme, `resolve --rolled-back` ve tekrar `deploy` ile sorunsuz tamamlandı. Yeni migration'lar `BEGIN;` ile başlayıp `COMMIT;` ile bitmeli. Denetim sarılmamış dosyayı **uyarı** olarak raporlar (şimdilik çıkışı etkilemez). Transaction içinde çalışamayan ifade varsa (`CREATE INDEX CONCURRENTLY`) dosyaya `-- kv:no-transaction <gerekçe>` yazılır.
- **Geçmiş migration'lar** değiştirilemez (Prisma checksum). KV-48'de tek tek incelendi; hepsi canlı veri yokken uygulanmıştı:
  - `mert_kv16_media_assets`, `mert_kv31_community`: varsayılansız `NOT NULL` kolonlar (tablolar boştu).
  - `mert_contract_alignment`: enum `RENAME VALUE` (veriyi korur).
  - `faruk_kv17_comment_reactions`: `DROP TABLE comment_likes` (yerine `comment_reactions`).

## Tatbikat (2026-10-02)

Ortam: Windows 11, yerel PostgreSQL 17.10, `pg_dump`/`pg_restore` 17.10. Veri: KV-47 kabul profili (`kararver_perf`).

| Adım | Sonuç | Süre |
|---|---|---|
| A. Deploy öncesi yedek (16 migration, 34 tablo, 280.753 satır, 25,1 MB) | ✅ | pg_dump 1,9 sn (ilk sürümde kontroller 30 sn sürdü → toplu SQL'e çevrildi) |
| B. `prisma migrate deploy`: dolu DB'ye 2 bekleyen migration (KV-43, KV-38) | ✅, `db:verify` tutarlı | 1,2 sn |
| C. Rollback: uygulamanın önceki sürümü (`872c936`, iki yeni migration'dan habersiz) yeni şemada | ✅ 50 kullanıcı × 60 sn, 2.650 istek, **%0 hata**; KV-47 doğruluk 9/9; `db:verify` tutarlı | — |
| D. Deploy öncesi yedeğe dönüş (yeni boş DB) | ✅ manifestle birebir; `migrate status` 2 bekleyen migration gösterdi (beklenen) | restore 1,5 sn + doğrulama 1,9 sn |
| E1. Deploy sonrası yedek (18 migration, 35 tablo, 25,2 MB) | ✅ | 2,2 sn |
| E2. Boş DB'ye restore, `--jobs=4` | ✅ manifestle birebir, kontroller 6/6 | restore 1,6 sn + doğrulama 0,9 sn = **3,1 sn** |
| E3. Aynısı tek transaction (`--jobs=1`) | ✅ | 3,7 sn + 0,7 sn = 4,3 sn |
| E4. Güncel API restore edilmiş DB'de | ✅ 50 kullanıcı × 60 sn, 2.884 istek, **%0 hata**; feed p95 127 ms, oy p95 133 ms; KV-47 doğruluk 9/9 (sayaçlar, oy olayları, trendler, cache gizliliği) | — |
| F. Yarım kalan migration | Sarılmamış: kısmen uygulandı. `BEGIN/COMMIT`: hiç uygulanmadı; `resolve --rolled-back` + `deploy` ile tamamlandı | — |

- C'deki p95'in yüksek olması beklenen bir durum: o sürümde KV-47'nin "Senin İçin" optimizasyonu yok. Hedefler yine tuttu (feed < 800 ms, oy < 500 ms).
- Ölçek: V1 hedef verisinde (bu profil) veri adımı saniyeler sürüyor. Sürelerin veri boyutuyla büyümesi beklenir; daha büyük veride staging'de yeniden ölçülür. Sıkıştırılmış yedek, satır başına ~90 bayt.

## Staging tatbikatı (2026-10-05)

Ortam: Railway `kararver-staging` (`api`, Postgres 18.6, Mailpit, iki bucket), web Vercel'de. Tatbikat yerel makineden, Postgres'e geçici TCP proxy üzerinden yapıldı (Mehmet açtı; iş bitince kapatılacak). Araç: `scripts/staging-drill.mjs` ve `pg_dump`/`pg_restore` 18.6. Canlı `railway` veritabanına yazılmadı; restore'lar ayrı geçici veritabanlarına yapıldı ve işlem sonunda silindi.

| Adım | Sonuç | Süre |
|---|---|---|
| Smoke (önce) | 4 PASS, 3 WARN (web güvenlik başlıkları), 0 FAIL | 1,7 sn |
| Canlı staging DB yedeği (23 migration, 40 tablo, 46 satır) | ✅ | 46–51 sn |
| Boş DB'ye restore + manifestle doğrulama | ✅ birebir, kontroller 6/6 | 82 + 17 sn |
| Hacimli deneme: KV-47 verisi (280.755 satır, 25 MB) staging sunucusunda geçici DB'lerde | ✅ birebir, kontroller 6/6 | yedek 59 sn, restore + doğrulama 97 sn |
| **Geçiş:** staging API `DATABASE_URL` → restore edilen DB, yeniden deploy | ✅ yeni DB'de API bağlantısı 1, eski DB'de 0 | deploy 144 sn |
| Smoke (restore edilen DB ile) | 4 PASS, 3 WARN, 0 FAIL | — |
| **Geri dönüş:** `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`, yeniden deploy | ✅ değer orijinalle aynı; API eski DB'de, smoke 0 FAIL | 110 sn |

- **RTO (ölçülen):** başlangıçtan smoke geçişine **314,7 sn ≈ 5,2 dk**: yedek ~52 sn + restore ve doğrulama ~100 sn + Railway yeniden deploy ve smoke ~160 sn. Süreler bu makineden internet üzerinden ölçüldü; aynı ağdan (Railway içinden) veri adımı daha kısa sürer. İnsan adımları (karar, bakım modu) dahil değildir.
- **RPO:** Restore, yedeğin alındığı anın görüntüsüdür. Geçiş süresince restore edilen DB'ye yazılanlar geri dönüşte kaybolur (tatbikat için kabul edildi; gerçek geri dönüşte API yeni DB'de kalır).
- **Yazımı durdurmak:** Staging'de bakım modu henüz yok (`/v1/config` 404, KV-40); gerçek bir geri dönüşte yazım API kapatılarak durdurulur.
- **Geri dönüş değeri:** API'nin `DATABASE_URL`'i önceden Postgres servisinin adresine birebir eşitti; geri dönüşte Railway referansı (`${{Postgres.DATABASE_URL}}`) olarak yazıldı. Çözülen değer orijinalle aynı; parola değişirse kendiliğinden güncellenir.

### Staging bulguları

1. **Public bucket'a erişim yok (403).** API'nin `S3_*` anahtarı private bucket'ı okuyabiliyor, public bucket'ta `HeadBucket`/`ListObjects` 403. Railway her bucket'a ayrı anahtar veriyor. Bu hâliyle onaylanan görsel public bucket'a kopyalanamaz (`admin.media.decide`, worker `writePublic`). Medya denetimi bu yüzden staging'de tamamlanamadı. Sahip: Mehmet/Utku (staging yapılandırması), Mert (medya).
2. **Worker servisi yok.** Görsel işleme, `trends.refresh`, `snapshots.daily`, `sanctions.expire` ve bildirim dağıtıcısı staging'de çalışmıyor. Sahip: Utku (#51).
3. **PostgreSQL sürümü farklı.** Staging 18.6; TECH_DECISIONS, yerel ve CI 17. `pg_dump` sunucudan eski olamadığı için yedek araçları da 18 olmalı. Karar: ya staging 17'ye ya da karar ve CI 18'e. Sahip: ekip.
4. **Web güvenlik başlıkları yok.** Smoke'taki 3 WARN. Sahip: Ümit (API tarafı #117 ile tamam).

Tatbikatta bulunan ve düzeltilen araç hatası: PostgreSQL 18, dökümden geri gelen CHECK ifadesini farklı yazıyor (`ANY ((ARRAY[...])::text[])` → `ANY (ARRAY[(...)::text])`). Karşılaştırma artık yazım farkını eşitliyor; ad, değer ve mantık farkı yine yakalanıyor (test).

## Tekrarlamak

```bash
# İstemci araçları (17.x) PATH'te değilse:
export PG_BIN=/path/to/postgresql-17/bin
# Testler: birim + uçtan uca (TEST_DATABASE_URL'in yanında <ad>_opssrc / _opsdst veritabanlarını açıp siler)
TEST_DATABASE_URL=... pnpm --filter @kararver/db test:ops
# Tatbikat: yukarıdaki tablo, adım adım
DATABASE_URL=.../kararver_perf pnpm --filter @kararver/db db:backup --out ./drill
DATABASE_URL=.../kararver_perf pnpm --filter @kararver/db exec prisma migrate deploy
RESTORE_DATABASE_URL=.../kararver_restored_perf pnpm --filter @kararver/db db:restore --file ./drill/<yedek>.dump
# API'yi restore edilmiş DB ile aç, sonra docs/KV-47_PERFORMANCE.md'deki yük + doğrulama
```

Staging:

```bash
# DATABASE_URL (TCP proxy), RESTORE_DATABASE_URL (aynı sunucuda yeni DB), S3_*, STAGING_API_URL, STAGING_WEB_URL, PG_BIN (18.x)
node scripts/staging-drill.mjs prepare   # staging'e yazmaz: smoke, yedek, restore, doğrulama, medya denetimi
# API ve worker DATABASE_URL → RESTORE_DATABASE_URL, yeniden deploy; ardından:
node scripts/staging-drill.mjs switch    # API sağlıklı ve smoke geçene kadar bekler, RTO'yu yazar
```

CI'da `pnpm test`, ops testlerini de koşar. Uçtan uca kısım `pg_dump` 17 yoksa gerekçesiyle atlanır (runner'ın istemcisi eski olabilir). Açmak için database job'ına PostgreSQL 17 istemcisi kurulmalı (@Utkuuzun14).
