# KV-47: Performans, veri tabanı ve yük altında doğruluk (#49)

> Sahip: **Faruk** · Araçlar: `apps/api/perf/` (`seed.ts`, `load.ts`, `verify.ts`, `query-count.ts`) · Test: `apps/api/test/query-count.test.ts`
> Kapsam dışı (kayıtlı): medya kaynak/gecikme ve timeout ölçümü Mert'te (iş tanımı), hız sınırı KV-19 (Utku).

## Özet

| Kabul hedefi (#49) | Sonuç (4 API süreci, gerçekçi profil) | Durum |
|---|---|---|
| 10.000 anket / 100.000 oy / 50 eşzamanlı kullanıcı | 9.000 anket + 1.000 tartışma, 100.000 oy, 20.000 yorum, 4.000 hesap; 50 sanal kullanıcı (40 giriş, 10 misafir) | ✅ |
| Feed p95 < 800 ms | **148 ms** (doyma testinde 623 ms) | ✅ |
| Oy p95 < 500 ms | **127 ms** (doyma testinde 476 ms) | ✅ |
| Hata < %1 | **%0** (bütün koşularda) | ✅ |
| Yük altında oy/trend doğruluğu ve cache gizliliği | 9/9 doğrulama geçti (aşağıda) | ✅ |
| Medya timeout davranışı | Bu makinede S3 yok; Mert'in ölçümü bekleniyor | ⏳ Mert |

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
WEB_CONCURRENCY=4 APP_ENV=local DATABASE_URL=... (diğer .env değerleri) pnpm --filter @kararver/api start:cluster
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
| Medya kaynak/gecikme ve timeout ölçümü | Mert (iş tanımı) |
| CDN/görsel teslim | #99 sonrası public görseller `Cache-Control: no-store`. Reddedilen görselin önbellekte kalmaması için doğru bir karar, ama CDN'in görselleri cache'lememesi demek. Ölçek büyüyünce CDN purge ile kısa ömürlü cache'e geçilmeli (Mert, Utku) |
| Staging'de (ayrı makineler, üretim modu) aynı profil | KV-06 staging ortamı (Utku) hazır olunca |
| Hız sınırı (rate limit) | KV-19 (#21, Utku). Yük testi aynı IP'den geldi; hız sınırı gelince test profili ona göre ayarlanmalı |
| Arama p95'i | Ürün büyürse trigram yerine tam metin indeksi veya ayrı arama servisi |
| İstek başına sorgu sayısı (11–19) | Kart yüklemeyi tek ham SQL'e çevirmek CPU'yu ayrıca düşürür. Şu an gerek yok; hedefler 4 süreçle karşılanıyor |
| **#49'un kapanışı** | Gerçek bağımlılıklar: #38 (KV-36) ve #45 (KV-43, PR #108) |
