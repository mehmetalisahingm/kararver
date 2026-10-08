# KV-47: Performans, veri tabanı ve yük altında doğruluk (#49)

> Sahip: **Faruk** · Araçlar: `apps/api/perf/` (`seed.ts`, `load.ts`, `verify.ts`, `query-count.ts`) · Test: `apps/api/test/query-count.test.ts`
> Medya kaynak/gecikme ve timeout ölçümü (Mert): bu belgenin [Medya](#medya-gecikme-ve-timeout-ölçümü-mert) bölümü. Kapsam dışı (kayıtlı): hız sınırı KV-19 (Utku).

## Özet

| Kabul hedefi (#49) | Sonuç (4 API süreci, gerçekçi profil) | Durum |
|---|---|---|
| 10.000 anket / 100.000 oy / 50 eşzamanlı kullanıcı | 9.000 anket + 1.000 tartışma, 100.000 oy, 20.000 yorum, 4.000 hesap; 50 sanal kullanıcı (40 giriş, 10 misafir) | ✅ |
| Feed p95 < 800 ms | **148 ms** (doyma testinde 623 ms) | ✅ |
| Oy p95 < 500 ms | **127 ms** (doyma testinde 476 ms) | ✅ |
| Hata < %1 | **%0** (bütün koşularda) | ✅ |
| Yük altında oy/trend doğruluğu ve cache gizliliği | 9/9 doğrulama geçti (aşağıda) | ✅ |
| Medya timeout davranışı | Gerçek NudeNet + sharp hattı ölçüldü: görsel başına p95 ≤ 0,5 sn, timeout/hata/takılma her zaman karantina, APPROVED hiç yok (aşağıda: Medya). Gerçek S3/R2 gecikmesi staging'de | ✅ Mert (S3 gecikmesi: staging) |

**Bulunan ve düzeltilen iki performans sorunu:**
1. "Senin İçin" yerleşim döngüsü karesel çalışıyordu. Yük altında CPU'nun üçte birini yiyordu; artımlı sayaçlarla yeniden yazıldı, davranışı birebir aynı.
2. API tek süreçte tek çekirdeği doyuruyordu. Cluster girişi (`WEB_CONCURRENCY`) eklendi.

## Ortam

- **Donanım:** Intel Core i7-14650HX (24 mantıksal çekirdek), 16 GB RAM, Windows 11 (10.0.26200).
- **Yazılım:** Node 24.14.0, PostgreSQL 17 (yerel, embedded).
- **Aynı makinede:** API, veritabanı ve yük üreticisi aynı makinede. Ağ gecikmesi yok, ama kaynakları paylaşıyorlar; staging ölçümü ayrıca yapılmalı.
- **API modu:** `APP_ENV=local`. Bu modda her cevap ayrıca sözleşme şemasıyla doğrulanır (üretimde kapalı). Üretim modu SMTP ve S3 istediği için kullanılamadı; ölçümler bu yüzden üretimden kötümserdir.
- **Bağlantı havuzu:** Her süreçte 10 (`DATABASE_POOL_MAX`, varsayılan).
- **Yük profili** (`load.ts`):
  - Ağırlıklar: "Senin İçin" feed 20, yeni feed 10, top feed 5, anket detayı 25, oy 20, arama 8, trend 7, yorumlar 5.
  - Misafirin oy payı detaya gider.
  - Oylar açık anketlere: yeni oy veya değiştirme.
  - Trend job'u (`trends.refresh`) yük sırasında 20–30 sn'de bir çalışır.
- **Gerçekçi profil:** İstekler arası 0,5–1,5 sn düşünme süresi, 120 sn.
- **Doyma testi:** Düşünme süresi 0, 60 sn. Her kullanıcı cevap gelir gelmez yeni istek atar.

## Sonuçlar

| Koşu | İstek/sn | Feed p95 | Oy p95 | Hata |
|---|---|---|---|---|
| 1 süreç, doyma, **düzeltmeden önce** | 33 | 3.069 ms | 2.254 ms | %0 |
| 1 süreç, doyma, sıralama düzeltmesinden sonra | 56 | 1.522 ms | 1.229 ms | %0 |
| 1 süreç, havuz 30, doyma | 56 | 1.579 ms | 1.564 ms | %0 |
| 1 süreç, gerçekçi | 39 | 716 ms | 945 ms | %0 |
| **4 süreç, gerçekçi** | 46 | **148 ms** | **127 ms** | %0 |
| **4 süreç, doyma** | **201** | **623 ms** | **476 ms** | %0 |

**4 süreç, gerçekçi profil, eylem bazında (p50 / p95 / p99, ms):**

| Eylem | Adet | p50 | p95 | p99 |
|---|---|---|---|---|
| feed for_you | 1.182 | 66 | 168 | 252 |
| feed new | 566 | 29 | 81 | 129 |
| feed top | 306 | 70 | 148 | 173 |
| anket detayı | 1.580 | 21 | 77 | 389 |
| oy | 868 | 44 | 127 | 279 |
| arama | 459 | 234 | 406 | 1.215 |
| trend | 373 | 58 | 142 | 199 |
| yorumlar | 286 | 23 | 92 | 1.168 |

- **Sıçramalar:** En kötü değerler (~1,4 sn) bütün eylemlerde aynı anda görülüyor. Bu an, yük sırasındaki ilk trend çalıştırmasına denk geliyor (soğuk başlangıçta 2,1 sn; sonrakiler 130–330 ms). Ayrı bir worker sürecinde/makinede bu etki küçülür.
- **Trend job'u yük altında:** Bütün çalıştırmalar başarılı, ısınınca 130–330 ms.
- **Arama en yavaş uç nokta** (p95 406 ms; doymada 845 ms). Tam metin trigram taraması; KV-26 planları geçerli. Ürün büyürse ilk bakılacak yer.

## Bulgular ve düzeltmeler

### 1. "Senin İçin" yerleşimi karesel çalışıyordu (düzeltildi)

- **Bulgu:** CPU profili, yük altında CPU'nun dolu olduğu sürenin ~%34'ünün `rankForYou`'da geçtiğini gösterdi. Her kart için yerleşmemiş adaylar baştan süzülüp kopyalanıyor, son 10 kart her adayda yeniden sayılıyordu: 500 adayda yüz binlerce işlem.
- **Düzeltme:** Pencere sayaçları artımlı tutuluyor; sıralar kopyalanmadan, her sıranın ilk yerleşmemiş elemanından taranıyor.
- **Davranış aynı:** Yeni test, eski algoritmayı referans alıp 50 rastgele (tekrarlanabilir) aday setinde aynı sırayı ve aynı keşif yuvalarını doğruluyor.
- **Etki:** Doymada verim 33 → 56 istek/sn.

### 2. Tek süreç bir çekirdeği doyuruyor (cluster girişi eklendi)

- **Bulgu:** Sıralama düzeltmesinden sonra API süreci bir çekirdeği %100 kullanıyor; Postgres rahat.
  - Feed'in ana sorgusu veritabanında 0,36 ms, Prisma tarafında ~34 ms görünüyor.
  - İstek başına 11–19 SQL sorgusu var; Prisma `include`'daki her ilişki için ayrı sorgu atıyor.
  - Havuzu 10'dan 30'a çıkarmak hiçbir şey değiştirmedi; darboğaz havuz değil, CPU.
- **Düzeltme:** `src/cluster.ts` (`pnpm --filter @kararver/api start:cluster`) `WEB_CONCURRENCY` kadar süreç açar.
  - API durumsuz (oturum ve idempotency DB'de), bu yüzden süreç sayısıyla doğrusal ölçeklenir.
  - Ölen süreç yeniden başlatılır.
  - **Etki:** 4 süreçle doymada 201 istek/sn.
- **Barındırma notu (Utku, KV-06):** Railway'de aynı etki replika sayısı veya `WEB_CONCURRENCY` ile alınır. Toplam bağlantı `süreç × DATABASE_POOL_MAX + worker`, PostgreSQL `max_connections`'ı aşmamalı.
- **Reddedilen alternatif:** Prisma'nın ilişkileri tek sorguda birleştiren `relationJoins` özelliği hâlâ "preview". Sadece kararlı sürüm kuralı gereği kullanılmadı.

### 3. N+1 yok (regresyon testi eklendi)

`query-count.ts` ve `test/query-count.test.ts`: Liste uç noktalarının sorgu sayısı sayfa boyutundan bağımsız. Feed (yeni, "Senin İçin"), arama ve yorumlar 2, 10 ve 25 kartta aynı sayıda sorgu atıyor; sayfa boyutuyla artarsa test kırılır.

| İstek (perf verisinde) | Misafir | Giriş yapmış |
|---|---|---|
| feed for_you | 12 | 18 |
| feed new | 11 | 16 |
| arama | 12 | 17 |
| trend | 14 | 19 |
| yorumlar | 4 | 8 |
| anket detayı | 11 | 16 |
| oy | — | 12 |

## Medya gecikme ve timeout ölçümü (Mert)

Araç: `apps/worker/scripts/media-latency.ts` (`pnpm --filter @kararver/worker media:latency`, hızlı deneme için `-- --quick`), ham sonuç `apps/worker/scripts/media-latency.results.json`.

**Ne gerçek, ne sahte:** Gerçek: `processMedia` akışı (sha256, imza kontrolü, sharp re-encode, dHash, risk politikası), gerçek NudeNet (Python alt-süreci), gerçek zaman aşımı kodu. Sahte: veritabanı ve object storage (bellek içi). Bu makinede S3 yok; **depolama gecikmesi parametriktir** (çağrı başına 0/200/1000/3000 ms enjekte edildi) ve gerçek S3/R2 gecikmesi staging'de ayrıca ölçülmelidir.

**Ortam:** Intel Core i5-13500H (16 mantıksal çekirdek), 16 GB RAM, Windows 11 (10.0.26300), Node 24.11.0, sharp 0.35.5, NudeNet 3.4.2 (320n). KV-47'nin yük testindeki makineden farklıdır; sayılar kıyaslanmamalıdır. Her hücrede 40 örnek (eşzamanlılıkta 48 iş, depolamada 10).

### Görsel başına süre (tek iş, depolama gecikmesi 0, ms)

| Girdi | Dosya | Toplam p50 | p95 | p99 | NudeNet p50 | NudeNet p95 | Sonuç |
|---|---|---|---|---|---|---|---|
| 800×600 | 163 KB | 116 | 132 | 149 | 24 | 28 | 40/40 APPROVED |
| 1920×1080 | 698 KB | 344 | 367 | 393 | 61 | 67 | 40/40 APPROVED |
| 4000×3000 | 3,5 MB | 438 | 489 | 505 | 53 | 68 | 40/40 APPROVED |

- Sürenin çoğu görsel işleme (decode + re-encode + dHash), model değil: NudeNet 320n görseli 320 px'e indirdiği için süresi çözünürlükten neredeyse bağımsız (~25–70 ms).
- **Soğuk başlangıç:** ilk iş (süreç başlatma + model yükleme dahil) 500 ms, sonraki 124 ms. Worker yeniden başlayınca ilk görsel yarım saniye gecikir.
- 8 MB üst sınırdaki görsel (sınır `media.maxBytes`) bu ölçümün büyük satırından (3,5 MB) uzun sürebilir; sürenin görsel çözme payı çözünürlükle büyür.

### Worker eşzamanlılığı (`MEDIA_WORKER_CONCURRENCY`, 48 iş, 1920×1080)

| Eşzamanlılık | İş/sn | Toplam p50 | p95 | En yavaş | Sonuç |
|---|---|---|---|---|---|
| 1 | 1,6 | 472 | 1.059 | 1.087 | 48/48 APPROVED |
| 2 | 5,2 | 377 | 430 | 440 | 48/48 APPROVED |
| 4 | 9,5 | 414 | 473 | 540 | 48/48 APPROVED |

- Eşzamanlılık 1'in p95'i (1,06 sn) p50'nin iki katından fazla: ölçüm başındaki birkaç iş yavaş; nedeni ayrıca incelenmedi (ısınma işlemi yapıldı, bu yüzden yalnız ısınmaya bağlanamaz). Verim farkı ise sharp'ın libuv iş parçacıklarında paralel çalışmasından geliyor. Varsayılan 1'dir; yük artarsa 2–4'e çıkarmak verimi katlar.
- Tek Python süreci istekleri **seri** işler (`moderate.py` satır satır okur), bu yüzden eşzamanlılık NudeNet'i hızlandırmaz, yalnız görsel işlemeyi paralelleştirir.

### Depolama gecikmesi (çağrı başına, 1920×1080, p50 toplam ms)

| Çağrı gecikmesi | 0 ms | 200 ms | 1.000 ms | 3.000 ms |
|---|---|---|---|---|
| İş süresi | 316 | 876 | 3.288 | 9.287 |

Bir iş 3 depolama çağrısı yapar (özgün okuma, işlenmiş yazma, public yazma). İş süresi ≈ 316 ms + 3 × gecikme; doğrusaldır. Yavaş depolama işi uzatır ama hiçbir zaman yanlış karar üretmez; sorun yalnız bekleme süresidir.

### Timeout ve hata davranışı (hepsi fail-closed)

| Senaryo | Sonuç | Süre |
|---|---|---|
| Takılan model (timeout 1,5 sn) | QUARANTINED / `MODERATION_TIMEOUT` | 1,64 sn |
| Model süreci hemen kapanıyor | QUARANTINED / `MODEL_ERROR` | 0,14 sn |
| Model hazır olmuyor (başlangıç timeout 1,5 sn) | QUARANTINED / `MODERATION_TIMEOUT` | 1,58 sn |
| 12 eşzamanlı iş, model 400 ms/görsel, timeout 2 sn | 4 APPROVED, 8 QUARANTINED / `MODERATION_TIMEOUT` | ≤ 2,2 sn |
| Yukarıdakinden sonraki ilk iş | APPROVED (süreç yeniden başladı) | 0,54 sn |

- **Hiçbir senaryoda hatalı görsel APPROVED olmadı**; timeout, çökme ve başlatma hatası karantinaya düşer ve moderatör kuyruğunda görünür.
- **Bulgu (sıra beklemesi):** Timeout (8 sn) isteğin yazıldığı andan başlar, yani Python sürecinin önündeki sırayı da kapsar. Model yavaşlarsa (CPU çekişmesi, soğuk başlangıç) veya eşzamanlılık yüksekse, sırada bekleyen **sağlıklı** görseller de `MODERATION_TIMEOUT` ile karantinaya düşer ve süreç öldürüldüğü için yeniden başlar (~0,5 sn). Gerçek ölçümde model ~25–70 ms olduğundan 8 sn'lik sınıra yetişmek için sırada ~100 iş gerekir; `MEDIA_WORKER_CONCURRENCY` ≤ 8 sınırıyla bu olası değildir. Etkisi güvenlik değil, moderatörün kuyruğunun şişmesidir. İzlenecek ölçüt: `MODERATION_TIMEOUT` oranı; %1'in üstüne çıkarsa eşzamanlılık düşürülmeli veya model süreci çoğaltılmalı.

### Düzeltme: S3 istemcilerine zaman aşımı eklendi

- **Bulgu:** API ve worker'ın `S3Client`'ları bağlantı ve istek zaman aşımı tanımlamıyordu (AWS SDK varsayılanı sınırsız). Takılan bir S3 bağlantısı worker işini pg-boss'un iş süresi dolana kadar (varsayılan 15 dk) bekletirdi; moderasyon timeout'u yalnız model aşamasını kapsıyor.
- **Düzeltme:** `requestHandler: { connectionTimeout: 5 sn, requestTimeout: 30 sn }` (`S3_CONNECTION_TIMEOUT_MS`, `S3_REQUEST_TIMEOUT_MS`; 8 MB'lık yükleme/indirme için cömert). Zaman aşımı hatası "geçici hata" sayılır: pg-boss yeniden dener, son denemede görsel `PROCESSING_FAILED` ile karantinaya alınır (mevcut davranış, `job.test.ts`).
- Gerçek S3/R2 üzerinde zaman aşımının tetiklendiği staging'de doğrulanmadı.

### Sınırlar

- Görseller sentetik (şekil + gürültü); gerçek fotoğraflarda decode süresi farklı olabilir. NudeNet süresi içerikten bağımsızdır (sabit boyuta indirir).
- Depolama ve DB gecikmesi gerçek değil (yukarıda). Staging'de (R2) yeniden koşturulmalı: `media:latency` depolamayı enjekte eder; gerçek depolamayla ölçmek için `harness`'a S3 adaptörü verilmelidir.
- Tek makinede ölçüldü; ısınma ve arka plan yükü p95'i etkiler.

## Yük altında doğruluk (`verify.ts`, yük koşularından sonra)

1. Sayaçlar: 10.000 anketin hepsinde anket ve seçenek sayacı geçerli oy sayısına eşit (yük sırasında ~4.600 yeni oy ve değiştirme).
2. 104.605 oyun her birinin tek CAST olayı var.
3. Her geçerli oyun seçeneği, oy geçmişindeki son olayın seçeneğiyle aynı.
4. Tek aktif oy: (anket, kullanıcı) başına bir oy.
5. `WEEKLY_MOST_VOTED`'ın güncel çalıştırmasında ilk 20 sıranın oy veren sayısı SQL'le yeniden sayınca aynı.
6. `DAILY_RISING` için aynı kontrol tutuyor.
7. Hazırlık: test kullanıcısı AFTER_VOTE bir ankete oy verdi.
8. Cache: 5 uç noktanın misafir ve giriş cevaplarının hepsi `Cache-Control: private, no-store`. Kişiye özel cevap paylaşılan cache'e girmez.
9. Aynı anket detayına aynı anda 200 istek (oy vermiş kullanıcı, oy vermemiş kullanıcı, misafir karışık): herkes kendi `viewer` alanını ve kendi AFTER_VOTE görünümünü aldı, karışma 0.

## Nasıl tekrarlanır

```bash
# 1) Boş bir *_perf veritabanı + migration'lar
DATABASE_URL=postgresql://.../kararver_perf pnpm --filter @kararver/db exec prisma migrate deploy
PERF_DATABASE_URL=postgresql://.../kararver_perf pnpm --filter @kararver/api perf:seed     # ~80 sn
# 2) API (4 süreç)
# KV-19 hız sınırı tek IP'den gelen 50 sanal kullanıcıyı keser; yük testinde kapatılır (yalnız local/test'te mümkün)
WEB_CONCURRENCY=4 APP_ENV=local RATE_LIMIT_ENABLED=false DATABASE_URL=... (diğer .env değerleri) pnpm --filter @kararver/api start:cluster
# 3) Yük (gerçekçi), sonra doğrulama
PERF_DATABASE_URL=... PERF_API=http://127.0.0.1:4100/v1 PERF_THINK_MS=1000 PERF_DURATION_S=120 pnpm --filter @kararver/api perf:load
PERF_DATABASE_URL=... PERF_API=http://127.0.0.1:4100/v1 pnpm --filter @kararver/api exec node perf/verify.ts
PERF_DATABASE_URL=... pnpm --filter @kararver/api perf:queries   # uç nokta başına SQL sayısı
```

- `perf/results/` altına JSON rapor yazılır; repoya girmez.
- **Seed verisi yaşlanır:** Anketler seed'den ~1 gün sonra kapanır. Uzun aradan sonra yeniden seed edin.

## Kalan işler

| Konu | İş |
|---|---|
| Medya kaynak/gecikme ve timeout ölçümü | ✅ Mert: yukarıdaki Medya bölümü. Kalan: gerçek S3/R2 gecikmesi staging'de |
| CDN/görsel teslim | #99 sonrası public görseller `Cache-Control: no-store`. Reddedilen görselin önbellekte kalmaması için doğru bir karar, ama CDN'in görselleri cache'lememesi demek. Ölçek büyüyünce CDN purge ile kısa ömürlü cache'e geçilmeli (Mert, Utku) |
| Staging'de (ayrı makineler, üretim modu) aynı profil | KV-06 staging ortamı (Utku) hazır olunca |
| Hız sınırı (rate limit) | KV-19 (#21, Utku). Yük testi aynı IP'den geldi; hız sınırı gelince test profili ona göre ayarlanmalı |
| Arama p95'i | Ürün büyürse trigram yerine tam metin indeksi veya ayrı arama servisi |
| İstek başına sorgu sayısı (11–19) | Kart yüklemeyi tek ham SQL'e çevirmek CPU'yu ayrıca düşürür. Şu an gerek yok; hedefler 4 süreçle karşılanıyor |
| **#49'un kapanışı** | Gerçek bağımlılıklar: #38 (KV-36) ve #45 (KV-43, PR #108) |
