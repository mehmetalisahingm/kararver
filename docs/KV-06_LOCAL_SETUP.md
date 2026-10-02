# KV-06 — Yerel kurulum: sıfırdan checkout → yeşil test

Bu belge yeni bir makinede repoyu klonlayıp `pnpm test`'i yeşil görene kadar gereken komutları **platforma göre ayrı** verir. Stack ve sürüm kararlarının gerekçesi [`TECH_DECISIONS.md`](./TECH_DECISIONS.md) §2 ve §8'dedir; DB testlerinin ayrıntısı [`DATA_MODEL.md`](./DATA_MODEL.md) §11'dedir.

Takıldığınız her noktada önce şunu çalıştırın:

```
pnpm check:setup
```

> **Not:** `pnpm doctor` pnpm'in kendi komutudur, bizim kontrol `pnpm check:setup`. `pnpm doctor` repo kurulumunu denetlemez; "sorun yok" demesi kurulumun hazır olduğu anlamına gelmez.

pnpm henüz yoksa aynı kontrol `node scripts/check-setup.mjs` ile çalışır. `check:setup` hiçbir şeyi değiştirmez. Her sorunu `[HATA]` ya da `[UYARI]` olarak yazar ve altına tek satırlık çözüm komutunu koyar. Kontrol ettikleri: Node sürümü (`.nvmrc`), pnpm sürümü (`package.json` → `packageManager`), bağımlılıklar, `.env`, Docker, postgres container'ının `healthy` olması, dev DB bağlantısı, bekleyen migration'lar, `TEST_DATABASE_URL` ve kök dizinde kalmış `pnpm`/`prisma` dosyaları.

## 1. Ön koşullar (bir kez)

| Araç | Sürüm | Nereden |
|---|---|---|
| Git | herhangi | git-scm.com |
| Node.js | `.nvmrc` dosyasındaki sürüm (şu an 24.21.0) | nodejs.org/dist/v24.21.0, nvm (macOS/Linux) veya nvm-windows |
| pnpm | `package.json` → `packageManager` alanındaki sürüm | aşağıdaki 2. adım |
| Docker Desktop | Compose v2 dahil | docker.com. Windows'ta WSL 2 backend açık olmalı |

Repo bir sürüm aralığı değil, **tam sürüm** bekler. Node 22 kuruluysa install ve testler farklı sonuç verebilir; `check:setup` bunu `[HATA]` olarak gösterir.

## 2. Adımlar

Komutlar aynı sırayla üç kabukta verilmiştir. Kendi kabuğunuzun bloğunu kopyalayın; bloklar arasında karıştırmayın (bkz. §4, "cmd'de `#` ve `>`").

Docker Desktop'ı başlatın ve "Engine running" yazısını görün. Ardından:

### Windows — cmd

cmd'de `#` yorum değildir. Bu yüzden bu blokta yorum yoktur; açıklamalar blok altındadır.

```bat
git clone https://github.com/mehmetalisahingm/kararver.git
cd kararver
node -v
type .nvmrc
for /f %v in ('node -p "require('./package.json').packageManager"') do npm i -g %v
pnpm -v
pnpm install
copy .env.example .env
docker compose up -d
docker compose ps
pnpm db:migrate
pnpm check:setup
set TEST_DATABASE_URL=postgresql://kararver:kararver_local@localhost:5432/kararver_test
pnpm test
```

### Windows — PowerShell

```powershell
git clone https://github.com/mehmetalisahingm/kararver.git
cd kararver
node -v                      # .nvmrc ile aynı olmalı
Get-Content .nvmrc
npm i -g (node -p "require('./package.json').packageManager")
pnpm -v                      # packageManager alanındaki sürüm
pnpm install
Copy-Item .env.example .env
docker compose up -d
docker compose ps            # postgres: healthy
pnpm db:migrate
pnpm check:setup
$env:TEST_DATABASE_URL = "postgresql://kararver:kararver_local@localhost:5432/kararver_test"
pnpm test
```

### macOS / Linux — bash, zsh

```bash
git clone https://github.com/mehmetalisahingm/kararver.git
cd kararver
nvm install && nvm use       # .nvmrc'deki sürüm (nvm yoksa nodejs.org)
npm i -g "$(node -p "require('./package.json').packageManager")"
pnpm -v                      # packageManager alanındaki sürüm
pnpm install
cp .env.example .env
docker compose up -d
docker compose ps            # postgres: healthy
pnpm db:migrate
pnpm check:setup
export TEST_DATABASE_URL=postgresql://kararver:kararver_local@localhost:5432/kararver_test
pnpm test
```

### Adımların açıklaması

1. **pnpm kurulumu:** `npm i -g …` satırı sürümü `package.json` içindeki `packageManager` alanından okur (ör. `pnpm@10.34.5`). Sürümü elle yazmayın; alan değişince komut da kendiliğinden doğru sürümü kurar. `corepack enable` yerine bunu kullanıyoruz, çünkü Windows'ta Node `Program Files` altındayken corepack `EPERM` verir.
2. **`pnpm install`:** "Ignored build scripts" uyarısı beklenir, `pnpm approve-builds` **çalıştırmayın**. Prisma client'ı `packages/db` kendi `postinstall`'ında üretir.
3. **`.env`:** Yalnız local container'lar için değerler içerir; gizli değer yoktur. `pnpm db:migrate`, `pnpm db:test` ve `pnpm dev` `DATABASE_URL`'i buradan okur. `pnpm dev` için ayrıca `AUTH_TOKEN_PEPPER` doldurulmalıdır; testler için gerekmez:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
4. **`docker compose up -d`:** PostgreSQL ve SeaweedFS'i başlatır. `docker compose ps` çıktısında postgres `healthy` olana kadar DB komutları "Can't reach database server" verir.
5. **`pnpm db:migrate`:** Dev veritabanına (`kararver`) migration'ları uygular. Kategori seed'i yok; kategoriler admin endpoint'i ile eklenir (KV-26).
6. **`pnpm check:setup`:** Bu noktada `[HATA]` kalmamalıdır.
7. **Test veritabanı:** `.env`'de `DATABASE_URL` varsa ayrıca bir şey gerekmez; testler `<db>_test`'i kullanır. Farklı bir test veritabanı için §3'e bakın.
8. **`pnpm test`:** contracts → db → api → worker testlerini sırayla koşar. Her paketin özetinde `ℹ fail 0` olmalıdır. API özetinde `ℹ skipped 0` görmelisiniz (bkz. §4.5). Worker'da 1 skip beklenir: gerçek moderasyon modeli testi `MODERATION_PYTHON yok` ile atlanır (Python ortamı: [`MEDIA_MODERATION.md`](./MEDIA_MODERATION.md)). Contracts'ta 1 `todo` test `✖ failing tests:` başlığı altında `⚠` ile listelenir; `fail 0` olduğu sürece bu hata değildir.

## 3. Test veritabanı

| Test | Hangi DB | Nereden okur |
|---|---|---|
| `pnpm db:test` | `TEST_DATABASE_URL`, yoksa `.env`'deki `DATABASE_URL` + `_test` → `kararver_test` | ortam, sonra `.env` |
| `pnpm api:test`, `pnpm worker:test` (PostgreSQL senaryoları) | `TEST_DATABASE_URL`, yoksa `.env`'deki `TEST_DATABASE_URL`, o da yoksa `DATABASE_URL` + `_test` | ortam, sonra `.env` (`db:test` ile aynı kural) |

- API ve worker test harness'i de `.env`'yi okur: `.env`'de `DATABASE_URL` varsa terminalde ayrıca bir şey set etmek gerekmez, testler `<db>_test`'e bağlanır. Başka bir test veritabanı isterseniz `.env`'ye `TEST_DATABASE_URL` yazın veya terminalde set edin (terminaldeki değer önceliklidir).
- Hiçbiri yoksa PostgreSQL senaryoları atlanır, ama sessizce değil: her test dosyası `⚠ Postgres testleri ATLANDI …` uyarısı yazar.
- Veritabanı adı `_test` ile bitmek zorundadır; bitmezse testler hiçbir şeye dokunmadan durur.
- **Sıfırlama:** `pnpm test` içindeki `db:test` adımı `kararver_test`'i her koşuda `prisma migrate reset --force` ile sıfırlar. Bu yüzden tam `pnpm test` her zaman temiz DB'de koşar. `pnpm api:test` veya `pnpm worker:test`'i **tek başına** tekrar tekrar koşarsanız veri birikir ve bazı senaryolar (ör. topluluk listeleri) kırılabilir. Önce şunu çalıştırın:

  ```
  pnpm test:reset
  ```

  `test:reset` hedefi `db:test` ile aynı kuralla seçer ve sıfırlamadan önce `host`, `port` ve `db` değerlerini yazar. Yalnız adı `_test` ile biten ve `localhost`/`127.0.0.1` üzerindeki bir veritabanını sıfırlar; diğer her durumda reddeder. Dev veritabanına (`kararver`) dokunmaz.

## 4. Sorun giderme

### 4.1 `corepack enable` → `EPERM: operation not permitted` (Windows)
Node `C:\Program Files\nodejs` altına kurulduğunda corepack oraya shim yazamaz. Corepack'i kullanmayın; pnpm'i npm ile `packageManager` sürümünde kurun:
- cmd: `for /f %v in ('node -p "require('./package.json').packageManager"') do npm i -g %v`
- PowerShell: `npm i -g (node -p "require('./package.json').packageManager")`

Sonra `pnpm -v` aynı sürümü göstermelidir.

### 4.2 Yanlış Node sürümü (ör. 22 kurulu, repo 24 istiyor)
`node -v` ile `.nvmrc` farklıysa `check:setup` `[HATA]` verir. nvm-windows veya nvm ile önce `nvm install 24.21.0`, sonra `nvm use 24.21.0` çalıştırın, ya da nodejs.org/dist/v24.21.0 kurulumunu yapın. Ardından **yeni** bir terminal açın; pnpm'i de yeniden kurun (4.1), çünkü global paketler Node sürümüne bağlıdır.

### 4.3 `Can't reach database server at localhost:5432` (P1001)
Docker Desktop kapalıdır ya da postgres container'ı ayakta değildir. Bilgisayar yeniden başladıktan sonra Docker Desktop otomatik açılmıyorsa bu sık yaşanır.
1. Docker Desktop'ı başlatın, "Engine running" yazısını bekleyin. macOS: `open -a Docker`, Linux: `sudo systemctl start docker`.
2. `docker compose up -d`
3. `pnpm check:setup`: postgres `healthy` ve "Dev DB bağlantısı" `[OK]` olmalı.

5432 başka bir Postgres tarafından kullanılıyorsa: o servisi durdurun ya da compose'ta portu `5433` yapıp `.env` ve `TEST_DATABASE_URL`'i güncelleyin.

### 4.4 `.env` yokken `pnpm db:test` → `TEST_DATABASE_URL veya DATABASE_URL tanımlı olmalı`
`.env` kopyalanmamıştır. cmd: `copy .env.example .env`, PowerShell: `Copy-Item .env.example .env`, macOS/Linux: `cp .env.example .env`.

### 4.5 API/worker PostgreSQL testleri sessizce atlanıyor
`pnpm api:test` özetinde `ℹ skipped` sıfırdan büyükse ve atlanan testlerin (`﹣` işaretli) yanında `TEST_DATABASE_URL yok (CI'da çalışır)` yazıyorsa değer bu terminalde tanımlı değildir. `.env`'de olması yetmez (bkz. §3). Değeri set edin ve `pnpm check:setup` ile `TEST_DATABASE_URL` satırının `[OK]` olduğunu görün.

### 4.6 Testler biriken veriyle kırılıyor (ör. communities)
`kararver_test` yalnız `pnpm test` / `pnpm db:test` sırasında sıfırlanır. `pnpm api:test`'i tek başına tekrar koşmadan önce `pnpm test:reset` çalıştırın.

### 4.7 cmd'de `#` ve `>`; kökte `pnpm` / `prisma` adlı dosyalar
cmd'de `#` yorum başlatmaz, satırın geri kalanı komuta argüman olarak gider. `>` ise çıktıyı dosyaya yönlendirir. Yorumlu ya da `>` / `->` içeren bir satırı (bash bloğu, log çıktısı) cmd'ye yapıştırmak, kök dizinde `pnpm`, `prisma` gibi adlarla anlamsız dosyalar bırakabilir. `check:setup` bunları `[UYARI]` olarak bildirir. Silmek için cmd'de `del pnpm prisma`, PowerShell'de `Remove-Item pnpm, prisma`, macOS/Linux'ta `rm pnpm prisma`. cmd kullanıyorsanız yalnız §2'deki cmd bloğunu kopyalayın.

### 4.8 `seaweedfs-init` bucket oluşturamadı
`docker compose up -d seaweedfs-init` komutunu tekrar çalıştırın. Bucket zaten varsa hata vermez.

### 4.9 İkinci klondan / worktree'den `docker compose up` seaweedfs'i o dizine bağlar
Compose proje adı sabittir (`name: kararver`), bu yüzden hangi dizinden çalıştırılırsa çalıştırılsın aynı container'lar kullanılır. seaweedfs, `./infra/seaweedfs/s3.json` dosyasını komutun çalıştırıldığı dizinden bağlayacak şekilde yeniden oluşturulur; o dizin silinince container bozulur. Asıl repo dizininden `docker compose up -d` çalıştırın.

### 4.10 İkinci klonda dev veritabanı boş değil
Aynı nedenle her klon aynı `postgres-data` volume'ünü, yani aynı `kararver` ve `kararver_test` veritabanlarını kullanır; yeni klon temiz bir DB demek değildir. Testler için `pnpm test` ya da `pnpm test:reset` yeterlidir; dev DB'yi sıfırlamak gerekiyorsa bunu bilerek yapın (`pnpm db:reset`).
