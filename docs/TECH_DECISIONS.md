# KararVer — Teknik Kararlar (KV-01)

> Issue: **KV-01 / #3** · Sahip: **Faruk** · Review: **Mehmet + Utku**
> Görev sahipliğinde tek kaynak **issue #2**'dir. `PRODUCT_TEAM_PLAN.md` ile çelişki olursa #2 esas alınır.
> Son güncelleme: 2026-09-27

Bu belge; stack, sürümler, dizin yapısı, modül sahipliği, ortamlar ve sıfırdan kurulum için tek referanstır. Bir kararı değiştirmek için bu dosyayı güncelleyen bir PR açılır (bkz. [Karar değiştirme](#9-karar-değiştirme)).

---

## 1. Özet

| Konu | Karar | Durum |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript | ✅ Kabul |
| Backend | Fastify + TypeScript, ayrı `apps/api` servisi | ✅ Kabul |
| Veritabanı + ORM | PostgreSQL 17 + Prisma 7 (stable) | ✅ Kabul |
| Oturum / auth | DB'de tutulan opak session + httpOnly cookie, argon2id | ✅ Kabul |
| Background job | pg-boss (Postgres üzerinde kuyruk), ayrı `apps/worker` | ✅ Kabul |
| Object storage | Cloudflare R2 (prod/staging), SeaweedFS (local) | ✅ Kabul |
| Local geliştirme | Docker Desktop + Docker Compose (PostgreSQL + SeaweedFS) | ✅ Kabul |
| Hosting | Vercel (web) + Railway (api, worker, Postgres), Cloudflare DNS | 🟡 **Öneri**, ekip onayı bekliyor |
| Monorepo | pnpm workspaces | ✅ Kabul |
| Türkçe arama | PostgreSQL `unaccent` + ortak normalizasyon fonksiyonu + testler | ✅ Kabul |

## 2. Pinlenmiş sürümler

Hepsi 2026-09-27'de npm registry, nodejs.org ve Docker Hub'dan kontrol edildi. **rc, beta veya canary sürüm kullanılmaz.** Paketler `package.json`'a `^` veya `~` olmadan, tam sürümle yazılır.

| Bileşen | Sürüm | Not |
|---|---|---|
| Node.js | **24.21.0** (LTS "Krypton") | `.nvmrc` dosyasında. `engines`: `>=24.14.0 <25` |
| pnpm | **10.34.5** | Root `package.json` → `packageManager`; corepack ile gelir |
| Next.js | **16.3.6** | `engines.node >=20.9.0` ✔ |
| React / React DOM | **19.3.0** | Next 16 peer: `^19.0.0` ✔ |
| @types/react | **19.3.0** | |
| TypeScript | **6.0.3** | Aşağıdaki nota bakın |
| @types/node | **24.x** (kurulum anındaki son 24.x) | Node major'ıyla eşleşir |
| Prisma CLI / @prisma/client / @prisma/adapter-pg | **7.10.0** (üçü de aynı sürüm) | Aşağıdaki nota bakın |
| PostgreSQL | **17.11** (`postgres:17.11-alpine`) | `unaccent` ve `pg_trgm` contrib ile gelir |
| SeaweedFS (local S3) | **4.47** (`chrislusf/seaweedfs:4.47`) | Sadece local ortam |
| Fastify | 5.12.5 | |
| pg-boss | 12.35.0 | `engines.node >=22.12.0` ✔ |
| zod | 4.6.5 | Hem API doğrulaması hem `packages/contracts` için |
| @node-rs/argon2 | 2.2.1 | Önceden derlenmiş binary, Windows'ta build aracı gerekmez |
| @aws-sdk/client-s3 | 3.x (kurulum anındaki son stable) | R2 ve SeaweedFS aynı S3 API'sini kullanır |

**Neden bu sürümler?**
- **Prisma:** npm'de `prisma` paketinin `latest` etiketi şu an **`8.0.0-rc.17`** (release candidate) sürümünü gösteriyor. `@prisma/client`'ın `latest` etiketi ise `7.10.0`. Bu yüzden düz `npm i prisma` komutu rc kurar ve client ile uyumsuz kalır; ilk denemede tam olarak bu oldu. Her zaman `prisma@7.10.0` gibi açık sürüm yazılır. Prisma 8 stable çıkınca ayrı bir PR ile değerlendirilir.
- **TypeScript:** `latest` etiketi 7.0.2, yani yeni Go tabanlı derleyici. Ama `@types/react` henüz `ts7.0` etiketi yayınlamadı; Next.js'in build sırasında TypeScript'i programatik kullanımı da 7 ile doğrulanmadı. 6.0.3 son JS tabanlı stable sürüm ve Prisma'nın `typescript >=5.4` şartını karşılıyor.
- **pnpm:** 12.x stable ama 12.0.0 sadece bir ay önce (2026-08-26) çıktı. Vercel ve Railway build imajlarının pnpm 12'yi desteklediği doğrulanmadı. 10.34.5 olgun ve yaygın destekleniyor. Yükseltme ayrı bir PR ile yapılır.
- **PostgreSQL:** 18.6 da stable. 17 seçildi çünkü Prisma 7 ve managed host'larda (Railway) desteği daha uzun süredir doğrulanmış. Yükseltme ileride dump/restore ile yapılır.
- **Local S3:** MinIO community sürümü artık sadece kaynak kod olarak dağıtılıyor (son sürüm `RELEASE.2025-10-15`, güncelleme gelmeyecek). Docker Hub ve Quay imajlarına anonim erişim yok. Bu yüzden aktif bakılan, S3 uyumlu SeaweedFS seçildi. Uygulama S3 API'siyle konuştuğu için kod tarafında fark yok.

Sürüm yükseltme kuralı: tek PR'da tek bileşen yükseltilir, lockfile ile birlikte commit edilir, CI yeşil olmalıdır.

---

## 3. Kararlar ve gerekçeler

### 3.1 Frontend — Next.js (App Router)

| Seçenek | Artı | Eksi |
|---|---|---|
| **Next.js** ✅ | Sunucu tarafı render, dinamik `metadata`, Open Graph görseli, `sitemap`/`robots` hazır | Server/client component ayrımını öğrenmek gerekir |
| React + Vite SPA | Basit | SEO ve WhatsApp/X paylaşım önizlemesi zayıf |
| React Router v7 framework | Sunucu tarafı render var | Ekosistem daha küçük |

**Gerekçe:** Her anket için SEO uyumlu bir URL (`/karar/<slug>-<id>`) ve güncel oy yüzdesini gösteren bir paylaşım kartı gerekiyor. SPA bunu ek bir render katmanı olmadan karşılayamıyor.

Next.js sadece arayüz ve SEO katmanıdır; iş mantığı `apps/api`'de durur. Ümit'in `ui/design-system/` altındaki token ve bileşenleri KV-05 kapsamında `apps/web`'e taşınır.

### 3.2 Backend — Fastify + TypeScript (`apps/api`)

| Seçenek | Artı | Eksi |
|---|---|---|
| **Fastify** ✅ | Hafif ve hızlı, zod ile doğrulama, modül klasörleri sahipliğe birebir oturur | Klasör düzeni kuralını biz koyarız (§5) |
| NestJS | Modül yapısı hazır | Çok boilerplate var, 5 hafta için öğrenme maliyeti yüksek |
| Sadece Next.js route handler'ları | Tek deploy | Uzun çalışan worker ve görsel işleme için uygun değil; backend web uygulamasına bağımlı kalır |

**Gerekçe:** API ve worker aynı domain kodunu (`packages/db`, `packages/contracts`) kullanıyor. Backend'in birden fazla sahibi var; her modül tek klasörde, tek sahipte durur.

### 3.3 Veritabanı + ORM — PostgreSQL 17 + Prisma 7

| Seçenek | Artı | Eksi |
|---|---|---|
| **Prisma** ✅ | Olgun migration akışı, interactive transaction, birden fazla dosyaya bölünebilen schema | CHECK kısıtı ve partial index schema dosyasında yazılamaz, migration SQL'ine elle eklenir |
| Drizzle | SQL'e yakın, partial index ve CHECK kısıtını doğrudan destekler | Migration araçları daha az olgun, ekip için yeni |
| Kysely | Tamamen tip güvenli SQL | Migration ve modelleme işinin çoğu elle yazılır |

**Gerekçeler (plandaki ihtiyaçlar):**
- **Tek aktif oy:** `UNIQUE (poll_id, user_id)` kısıtıyla veritabanında garanti edilir, sadece uygulama kontrolüne bırakılmaz.
- **Transaction-safe ve idempotent oy:** Oy ekleme ve seçenek/anket sayaçlarının güncellenmesi tek transaction'da yapılır. Aynı istek tekrar gelirse unique çakışması (`P2002`) yakalanır ve mevcut oy döner.
- **Oyun seçilen anketin seçeneği olması:** Vote tablosunda `(poll_id, option_id)` üzerinden bileşik foreign key kullanılır.
- **Trend ve snapshot işleri** pencere fonksiyonları ve aggregate sorgular gerektiriyor; bunlar `$queryRaw` / TypedSQL ile yazılır.
- Prisma'nın schema'da ifade edemediği CHECK kısıtları, partial index'ler, extension'lar ve Türkçe arama fonksiyonu **migration SQL'ine elle eklenir**. Bu ekler migration dosyasında yorumla işaretlenir.

**Komutlar** (`packages/db` KV-02'de kurulunca):
```bash
pnpm db:migrate                                              # local: prisma migrate dev
pnpm --filter @kararver/db exec prisma migrate deploy        # staging/prod: sadece uygular
pnpm --filter @kararver/db exec prisma studio                # veriye bakmak için
pnpm db:reset                                                # local DB'yi sıfırla + seed
```

### 3.4 Oturum / auth — DB session + httpOnly cookie

| Seçenek | Artı | Eksi |
|---|---|---|
| **DB'de opak session** ✅ | Oturum anında iptal edilir, ban/suspend açık oturumlara hemen uygulanır | Her istekte index'li tek bir sorgu |
| JWT access + refresh | Stateless | Ban, access token süresi dolana kadar işlemez; token iptali karmaşık |
| Better Auth / Auth.js | E-posta akışları hazır | Kendi schema'sını dayatır; ban/restrict ve rate-limit için özelleştirme gerekir |

**Kurallar:**
- Token 32 byte rastgele üretilir. DB'de sadece `sha256(token + AUTH_TOKEN_PEPPER)` saklanır.
- Cookie ayarları: `HttpOnly`, `SameSite=Lax`, staging ve prod'da `Secure`.
- Şifreler argon2id (`@node-rs/argon2`) ile hash'lenir.
- CSRF koruması: SameSite ve durum değiştiren isteklerde `Origin` başlığı kontrolü.
- Web ve API aynı site altında olur (`kararver.com` + `api.kararver.com`). Cookie domain'i `SESSION_COOKIE_DOMAIN` ile ayarlanır.
- Kullanıcı `BANNED` veya `SUSPENDED` olursa açık oturumları aynı transaction'da iptal edilir.

### 3.5 Background job — pg-boss (`apps/worker`)

| Seçenek | Artı | Eksi |
|---|---|---|
| **pg-boss** ✅ | Ek altyapı yok, cron ve singleton job desteği, iş uygulamanın transaction'ında kuyruğa eklenebilir | Çok yüksek hacimde Redis tabanlı kuyruklardan yavaş (V1 için sorun değil) |
| BullMQ + Redis | Hızlı, izleme paneli var | Her ortamda ayrıca Redis gerekir |
| Platform cron'u + HTTP | En basit | Retry, kilitleme ve job geçmişi yok |

**Kullanım:**

| Job | Zamanlama | Sahip |
|---|---|---|
| `trends.refresh` | `*/5 * * * *`, singleton (üst üste binmez) | Faruk |
| `snapshots.daily` | `5 0 * * *` Europe/Istanbul | Faruk |
| `media.process` (karantina → re-encode → moderasyon) | Upload olayıyla tetiklenir | Mert |
| `notifications.deliver` | Olay tetiklemeli (yorum, cevap, oy eşiği, trend girişi…) | Utku |

Trend yenilemesi her çalışmada `calculation_version` ve `computed_at` değerlerini yazar; hedef aralık 5 dakikadır. Redis şimdilik yok. Rate-limit için ihtiyaç doğarsa Hafta 4'te Utku ile yeniden değerlendirilir.

### 3.6 Object storage — Cloudflare R2 (+ local SeaweedFS)

| Seçenek | Artı | Eksi |
|---|---|---|
| **Cloudflare R2** ✅ | Egress ücreti yok, S3 uyumlu, Cloudflare CDN/DNS ile aynı yerde | S3'ün bazı ileri özellikleri eksik |
| AWS S3 + CloudFront | En olgun | Egress ücretli, kurulumu daha fazla iş |
| Backblaze B2 | Ucuz | CDN için ayrıca entegrasyon gerekir |

**Karantina akışı:**
1. Kullanıcıya presigned upload URL'i verilir. Görsel herkese kapalı `*-uploads-private` bucket'ına yüklenir.
2. Worker MIME türünü ve boyutu doğrular, görseli yeniden encode eder, EXIF'i temizler ve moderasyondan geçirir.
3. Onaylanan kopya `*-media-public` bucket'ına yazılır ve CDN'den sunulur.

DB'de sadece object key ve metadata tutulur, binary tutulmaz. Local'de aynı iki bucket SeaweedFS'te oluşturulur (`docker compose` → `seaweedfs-init`).

#### Local S3: neden MinIO değil, SeaweedFS?

İlk kararda local S3 için MinIO seçilmişti. Sürümleri pinlerken (2026-09-27) şunlar görüldü:

- MinIO'nun kendi README'si: *"The MinIO community edition is now distributed as source code only. We will no longer provide pre-compiled binary releases."* Son community sürümü `RELEASE.2025-10-15T17-29-55Z`; bundan sonra güncelleme ve güvenlik düzeltmesi yayınlanmıyor.
- `minio/minio` ve `minio/mc` imajlarına Docker Hub'da da Quay'de de anonim olarak erişilemiyor. Yani `docker compose up` yeni bir ekip üyesinde imajı çekemez.
- Kalan yol MinIO'yu compose içinde kaynaktan derlemekti. Bu hem ilk kurulumu dakikalarca uzatır hem de donmuş, bakımı olmayan bir sürüme bağlar.

| Seçenek | Artı | Eksi |
|---|---|---|
| MinIO'yu kaynaktan derle | İlk kararı korur | Yavaş ilk kurulum, donmuş sürüm |
| **SeaweedFS** ✅ | Aktif bakılıyor (4.47, 2026-09-14), hazır imaj, tek container, S3 API ve presigned URL desteği | Bucket'ların `weed shell` ile oluşturulması gerekiyor (compose'ta otomatik) |
| Garage | Aktif bakılıyor, S3 uyumlu | İlk kurulumda ekstra layout/key komutları gerekiyor |

**Karar:** SeaweedFS (Faruk onayı, 2026-09-27). Uygulama sadece S3 API'siyle (`@aws-sdk/client-s3`) konuşur ve production'da zaten R2 kullanılır. Bu yüzden değişiklik sadece local ortamı etkiler; kodda veya env değişken adlarında fark yoktur.

### 3.7 Hosting — 🟡 öneri (kesin değil)

| Seçenek | Artı | Eksi |
|---|---|---|
| **Vercel (web) + Railway (api, worker, Postgres)** 🟡 | Hızlı kurulum, her PR için preview, staging/prod ayrı environment, managed backup | Maliyet servis sayısıyla artar; lokal görsel modeli pahalı olabilir |
| Tek VPS (Hetzner) + Coolify | Ucuz, tam kontrol | Yedekleme, güncelleme ve güvenlik operasyonu ekipte kalır |
| Fly.io | İyi bölge seçimi | Managed Postgres ve fiyat modeli daha az öngörülebilir |

Önerilen bölge AB'dir (Frankfurt/Amsterdam). DNS, SSL ve R2 Cloudflare'de olur. **Ekip onayından ve fiyat kontrolünden sonra kesinleşecek.** Mert'in görsel moderasyon modeli Python ile çalışacaksa ayrı bir servis olarak eklenir; ağır çıkarsa sadece o servis bir VPS'e taşınır.

### 3.8 Monorepo — pnpm workspaces

| Seçenek | Artı | Eksi |
|---|---|---|
| **pnpm workspaces** ✅ | Katı bağımlılık yönetimi, hızlı, tek lockfile, corepack ile gelir | Bilmeyen için kısa alışma süresi |
| npm workspaces | Ek araç gerekmez | Yavaş; paketler tanımlanmamış bağımlılıklara erişebilir |
| Ayrı repolar | Sınırlar net | API sözleşmelerini senkron tutmak zor |

Kurallar: Sadece root'ta tek bir `pnpm-lock.yaml` bulunur. `npm install` veya `yarn` kullanılmaz. `ui/design-system/`, Ümit'in bağımsız önizleme kiti olarak workspace dışında kalır; `apps/web`'e taşınınca kaldırılır.

### 3.9 Türkçe arama — `unaccent` + normalizasyon

Hedef: "ş/s, ı/i, ğ/g, ç/c, ö/o, ü/u" ve büyük/küçük harf farkı aramayı bozmamalı.

- İlk migration'da `CREATE EXTENSION IF NOT EXISTS unaccent;` ve `pg_trgm` kurulur.
- `unaccent()` fonksiyonu `STABLE` olduğu için index'te kullanılamaz. Bu yüzden `IMMUTABLE` bir sarmalayıcı yazılır:
  `kv_normalize(text) = lower(public.unaccent('public.unaccent'::regdictionary, text))`.
  Önce `unaccent`, sonra `lower` uygulanır. Böylece `İ` ve `I` harfleri locale'e bağlı kalmadan `i` olur.
- Arama kolonları (başlık, açıklama, kullanıcı adı, kategori adı) `kv_normalize(...)` üzerinde GIN (`gin_trgm_ops`) index ile aranır.
- Aynı kurallar TypeScript'te `packages/contracts` içinde `normalizeTr()` olarak da bulunur. Sorgu bu fonksiyondan geçerek gönderilir.
- **Zorunlu test tablosu** (hem SQL hem TS aynı sonucu vermeli):

| Girdi | Beklenen |
|---|---|
| `Şişe` | `sise` |
| `IŞIK` / `ışık` | `isik` |
| `İstanbul` | `istanbul` |
| `ağaç` | `agac` |
| `Göz` | `goz` |
| `Üzüm` | `uzum` |
| `ÇİÇEK` | `cicek` |

Kabul senaryosu: KV-07'deki "Türkçe karakter içeren arama" senaryosu (Mehmet).

---

## 4. Dizin yapısı

```
kararver/
├─ apps/
│  ├─ web/                 Next.js arayüzü
│  │  └─ src/features/<modül>/  bir özelliğin ekranları; sahibi API modülüyle aynı
│  ├─ api/                 Fastify API
│  │  └─ src/modules/<modül>/   her modül kendi route, servis ve testleriyle
│  └─ worker/              pg-boss worker
│     └─ src/jobs/<job>/
├─ packages/
│  ├─ db/                  Prisma schema, migration, seed, client
│  │  └─ prisma/schema/*.prisma   sahip başına ayrı schema dosyası
│  ├─ contracts/           zod şemaları, API tipleri, hata formatı, normalizeTr()
│  └─ config/              ortak tsconfig / eslint ayarları
├─ ui/design-system/       Ümit'in KV-05 önizleme kiti (geçici, workspace dışında)
├─ infra/seaweedfs/        local S3 ayarı
├─ docs/
├─ docker-compose.yml      sadece local
├─ .env.example            local
├─ .env.staging.example    staging değişken listesi (değersiz)
└─ .github/
   ├─ CODEOWNERS
   └─ workflows/           CI
```

`apps/web` genel olarak Ümit'indir: app shell, tasarım sistemi, feed, anket kartı ve detay, oy ve yorum UI'ı. Başka bir sahibin özelliğine ait ekranlar ise `src/features/<modül>/` altında durur ve o modülün sahibine aittir (ör. `features/notifications` → Utku). Next.js route dosyaları (`src/app/...`) bu klasörlerdeki bileşenleri çağıran ince katmanlardır.

Bir modül başka bir modülün iç koduna doğrudan erişmez. İletişim `packages/contracts` içindeki tipler, servis arayüzleri veya job'lar üzerinden olur.

---

## 5. Modül sahipliği

Her modülün **tek bir sahibi** vardır. Sahip, o modüldeki değişikliği onaylayan ve hatasından sorumlu olan kişidir. Diğer ekip üyeleri de PR açabilir.

Kaynak: issue #2 (görev haritası). Plandaki (`PRODUCT_TEAM_PLAN.md` §20) eski dağılımla çelişen yerlerde #2 esas alınır.

| Sahip | Sorumluluk | Yollar |
|---|---|---|
| **Faruk** `@farukkemree` | auth/users, polls, votes, comments + alternatifler, feed, search, categories (API), trends, snapshots, ortak DB ve sözleşmeler | `api/modules/{auth,users,polls,votes,comments,categories,feed,search,trends}` · `worker/jobs/{trends,snapshots}` · `packages/db` · `packages/contracts` |
| **Ümit** `@umitefe0` | Frontend: tasarım sistemi, app shell, feed, anket kartı/detay, oy ve yorum UI | `apps/web` (aşağıdaki `features/*` hariç) · `ui/` |
| **Mert** `@MertKAYAR` | media, moderation, reports, communities, görsel işleme job'u | `api/modules/{media,moderation,reports,communities}` · `worker/jobs/media` · `web/src/features/{media,moderation,reports,communities}` |
| **Utku** `@Utkuuzun14` | rbac, rate-limit, notifications, admin kullanıcılar ve yaptırımlar, audit, sistem ayarları ve acil durum anahtarları, `packages/config`, CI (KV-06, KV-21, KV-34) | `api/modules/{rbac,rate-limit,notifications,admin-users,audit,settings}` · `worker/jobs/notifications` · `web/src/features/{notifications,admin-users,audit,settings}` · `packages/config` · `.github/workflows` |
| **Mehmet** `@mehmetalisahingm` | bookmarks ve profil, karar güncellemesi, paylaşım/SEO, analytics ve dashboard, öne çıkarma ve duyurular, kategori yönetim ekranı, onboarding ve ilgi seçimi | `api/modules/{bookmarks,profiles,decision-updates,share,analytics,featured,announcements,onboarding}` · `web/src/features/{bookmarks,profiles,decision-updates,share,analytics,featured,announcements,admin-categories,onboarding}` |

**Sınır notları:**
- **Kategoriler:** Kategori verisi ve API'si (`api/modules/categories`) Faruk'ta. Admin'deki kategori yönetim ekranı (`web/src/features/admin-categories`) Mehmet'te. Ekran, Faruk'un sözleşmesini kullanır.
- **Kullanıcı / profil:** Hesap, kimlik ve oturum (`users`, `auth`) Faruk'ta. Herkese açık profil sayfası ve istatistikleri (`profiles`) Mehmet'te.
- **Bildirimler:** Olayları çekirdek modüller üretir (ör. Faruk'un `comments` modülü "yorum geldi" olayını yayınlar). Bildirimin kime ve nasıl teslim edileceği (`notifications`) Utku'da.
- **Öne çıkarma:** Plan bunu Utku'ya veriyordu; #2'ye göre Mehmet'te (`featured`, `announcements`).
Sahiplik `.github/CODEOWNERS` dosyasına birebir yansıtılır.

## 6. Ortak dosyaları değiştirme yöntemi

Amaç: kimse kimseyi kilitlemesin, ama ortak dosyalar kimseye sürpriz olmasın.

1. **CODEOWNERS'ta kilit yok:** Ortak dosyalara en az iki sahip atanır ve **birinin onayı yeterlidir**. Branch protection'da "code owner onayı zorunlu" ayarı ekip kararıyla açılır. Açılsa bile iki sahip olduğu için tek kişi bekleme yaratmaz.
2. **Prisma schema:** Schema, sahip başına ayrı dosyalara bölünür: `prisma/schema/core.prisma` (Faruk), `media.prisma` ve `community.prisma` (Mert), `admin.prisma` (Utku: RBAC, yaptırımlar, audit, ayarlar, bildirimler), `growth.prisma` (Mehmet: bookmarks, featured, duyurular, analytics, onboarding). Herkes kendi dosyasındaki modelleri değiştirir. Başka dosyadaki bir modele alan veya ilişki ekleyen PR'a o dosyanın sahibi reviewer olarak eklenir.
3. **Migration sırası:**
   - Her PR en fazla bir migration ekler.
   - Merge'den önce `main`'e rebase edilir ve `pnpm db:migrate` ile migration yeniden üretilir.
   - Migration çakışırsa, sonra merge eden taraf kendi migration'ını yeniden oluşturur.
   - Merge edilmiş bir migration dosyası asla değiştirilmez.
4. **`packages/contracts`:** Bir endpoint'in sözleşmesini o endpoint'in sahibi değiştirir.
   - Kırıcı değişikliklerde (alan silme, tip değiştirme) frontend tarafı (Ümit) ve o sözleşmeyi kullanan modül sahipleri PR'a reviewer olarak eklenir.
   - PR açıklamasına "Etkilenen ekranlar/modüller" başlığı yazılır.
   - Sadece yeni alan ekleyen değişiklikler serbesttir.
5. **Root dosyalar** (`package.json`, lockfile, `docker-compose.yml`, `.env.*.example`): Bu dosyalardaki değişiklik PR'ın konusunu oluşturur, başka işlerin içine gizlenmez. Yeni bir env değişkeni hem `.env.example`'a hem `.env.staging.example`'a eklenir.
6. **Yüksek riskli değişiklikler** (auth, vote integrity, DB migration, yetki, rate limit, production config): Plandaki kurala göre Mehmet veya Utku'dan hızlı bir review alınır.

---

## 7. Ortamlar ve environment değişkenleri

| | Local | Staging | Production |
|---|---|---|---|
| Amaç | Geliştirme | Entegrasyon + kabul testleri (iki gerçek hesapla) | Kullanıcılar |
| Postgres | Docker `postgres:17.11-alpine` | Railway Postgres (ayrı instance) | Railway Postgres (ayrı instance, PITR/backup) |
| Storage | SeaweedFS (Docker) | R2 `kararver-staging-*` bucket'ları | R2 `kararver-prod-*` bucket'ları |
| E-posta | `console` (API loguna yazılır) | SMTP sağlayıcısı (açık konu) | SMTP sağlayıcısı |
| Env kaynağı | `.env` (`.env.example` kopyası) | Railway/Vercel paneli | Railway/Vercel paneli |
| Migration | `prisma migrate dev` | `prisma migrate deploy` (deploy adımında) | `prisma migrate deploy` |
| Seed | Demo/seed içerik (`actor_type=seed`) | Sadece kategoriler + işaretli seed | Sadece kategoriler |

Kurallar:
- `.env` dosyaları commit edilmez; `.gitignore` sadece `*.example` dosyalarına izin verir.
- `.env.example` içinde sadece local container'lara ait, bilerek herkese açık değerler bulunur. `.env.staging.example` değişkenlerin listesidir ve gizli alanları boştur.
- Staging ve production hiçbir secret'ı paylaşmaz (`AUTH_TOKEN_PEPPER`, R2 anahtarları, DB).

---

## 8. Sıfırdan kurulum (yeni ekip üyesi)

### 8.1 Ön koşullar (bir kez)
- **Git**
- **Node.js 24.21.0 LTS**: [nodejs.org](https://nodejs.org) veya `nvm install` / `nvm use` (repo'da `.nvmrc` var)
- **Docker Desktop** (Windows'ta WSL 2 backend açık olmalı), içinde Docker Compose v2 gelir

Kontrol:
```bash
node -v              # v24.x
docker --version
docker compose version
```

### 8.2 Adımlar
```bash
# 1. Repoyu klonla
git clone https://github.com/mehmetalisahingm/kararver.git
cd kararver

# 2. pnpm'i corepack ile aç (sürüm package.json → packageManager'dan gelir)
corepack enable
pnpm -v                          # 10.34.5 görmelisin
# "corepack enable" izin hatası verirse (Windows, Node "Program Files" altında):
#   a) terminali yönetici olarak açıp tekrar "corepack enable" çalıştırın, ya da
#   b) shim'leri PATH'teki kullanıcı klasörüne kurun:
#        corepack enable --install-directory "$HOME/bin"   # $HOME/bin PATH'te olmalı
# Not: "corepack pnpm install" tek başına çalışır ama root script'leri (db:migrate, dev)
#      içeride "pnpm" çağırdığı için PATH'te pnpm yoksa hata verir. Bu yüzden enable şart.

# 3. Ortam dosyasını oluştur
cp .env.example .env
# AUTH_TOKEN_PEPPER'ı doldur:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 4. Local servisleri başlat (PostgreSQL + SeaweedFS)
docker compose up -d
docker compose ps                # postgres "healthy" olmalı
docker compose logs seaweedfs-init   # iki bucket'ın oluşturulduğunu gösterir

# 5. Bağımlılıkları kur
pnpm install

# 6. Veritabanı: migration + seed
pnpm db:migrate
pnpm db:seed

# 7. Geliştirme sunucuları
pnpm dev
#   web → http://localhost:3000
#   api → http://localhost:4000
#   worker → arka planda (log'da job'lar görünür)
```

> ⚠️ **Mevcut durum (KV-01):** Henüz `apps/*` ve `packages/*` yok. 6. ve 7. adımlar hata vermez ama hiçbir şey yapmaz. `pnpm db:migrate` ve `db:seed` komutları KV-02 ile (`packages/db`), `pnpm dev` ise api/web/worker iskeletleri eklenince çalışır hale gelir. Script'ler root `package.json`'da şimdiden tanımlı, yani bu kurulum adımları değişmeyecek.

### 8.3 Sık kullanılan komutlar
```bash
pnpm dev                    # tüm uygulamalar
pnpm --filter @kararver/api dev     # sadece api
pnpm test | lint | typecheck
pnpm db:reset               # local DB'yi sıfırla + seed
docker compose down         # servisleri durdur (veri korunur)
docker compose down -v      # servisleri ve VERİLERİ sil
```

### 8.4 Sorun giderme
- **5432 portu dolu:** Makinede başka bir Postgres çalışıyordur. Onu durdurun ya da compose'ta portu `5433:5432` yapıp `DATABASE_URL`'i güncelleyin.
- **`seaweedfs-init` bucket oluşturamadı:** `docker compose up -d seaweedfs-init` komutunu tekrar çalıştırın. Bucket zaten varsa hata vermez.
- **Yanlış pnpm sürümü:** `corepack prepare pnpm@10.34.5 --activate`.

---

## 9. Karar değiştirme

Bir kararı değiştirmek için bu dosyayı güncelleyen bir PR açılır. PR'da eski karar, yeni karar ve sebep yazılır. En az bir review Mehmet veya Utku'dan olmalıdır. Sürüm yükseltmeleri için §2'deki kural geçerlidir.

## 10. Açık konular / engeller

| # | Konu | Sahip | Bloke ettiği iş |
|---|---|---|---|
| 1 | Hosting (Vercel + Railway) ekip onayı ve fiyat kontrolü | Ekip | Staging kurulumu |
| 2 | Staging e-posta sağlayıcısı (SMTP) seçimi | Faruk | Staging'de e-posta doğrulama |
| 3 | Branch protection ("code owner onayı zorunlu" açık mı?) | Repo sahibi (Mehmet) | — |
| 4 | `docker-compose.yml` bu PR'ı hazırlayan makinede çalıştırılamadı (Docker kurulu değil) | Docker'ı olan bir reviewer | Local kurulumun doğrulanması |
| 5 | Görsel moderasyon modelinin çalışma ortamı (Node mu, Python servisi mi) | Mert | Hosting'in kesinleşmesi |
