# KararVer — Sıfır ücretli barındırmaya güvenli geçiş (1 Kasım 2026)

**Durum: HAZIRLIK / NO-GO.** Bu belge ve `render.yaml` yalnızca dağıtım hazırlığıdır. Kaynak veritabanı, bucket'lar, DNS ve mevcut çalışan Railway servisleri değiştirilmedi. Yeni sisteme canlı trafik yönlendirilmedi.

## 1 Kasım 2026 — oluşturulan ücretsiz hedef altyapı

**Gerçekleştirildi (kaynak Railway değiştirilmedi):**
- Neon Free organizasyonu: `org-red-recipe-40149581` (doğrulandı: `free_v3`).
- Neon projesi: `kararver-staging-free`, proje ID `broad-rain-56203802`; region `aws-eu-central-1` (Frankfurt), PostgreSQL **18.6**.
- Branch: `main` (`br-weathered-firefly-b9nrb2au`); DB: `kararver_staging`, bağlantı testi SELECT başarılı.
- Boş DB'ye **henüz kaynak veriler restore edilmedi**; kullanıcı tablosu sayısı 0.
- Neon Object Storage (şu anda **boş**): `kararver-staging-uploads-private` ve `kararver-staging-media-public`. İki bucket da `private`; var olan uygulamanın proxy üzerinden erişim düzenini korur.
- Neon S3 endpoint, path-style, region ve bucket adları `render.yaml`'de önceden tanımlandı. Credential'lar hiçbir yerde commit edilmedi.
- Neon Free limitleri: 1 GB Postgres storage/project, 100 CU-saat/project/ay, 5 GB egress ve 5 GB Object Storage; limitlere ulaşılması hizmeti kesebilir. **Ücretli plana yükseltme yok.**
- Neon API / DB doğrudan erişim için connection string kullanılmalı; bağlantı URL'lerini terminal/log/PR üzerinde paylaşmayın. `prisma migrate deploy` ile `pg_restore` **doğrudan (pooler olmayan)** bağlantıyı kullanın. API trafiğinde PgBouncer uyumluluğu test edilirse pooled bağlantı tercih edilebilir.

**Kalan blokajlar:** Railway OAuth bağlantısı `DATABASE_PUBLIC_URL` ve S3 secret'larını redakte ediyor. Güncel kaynak dump ve object copy için güvenli, yetkili aktarım çalıştırılmalı; Render bağlantısı henüz yok; SMTP ve sürekli worker çözülmeden Vercel trafiği çevrilmemeli.

## Hedef ve kesin sınırlar

- Ücretli plan, kart ekleme, otomatik kullanım aşımı veya abonelik **yok**. Vercel Free mevcut haliyle kalır.
- Deneme hedefi: Neon Free (PostgreSQL) + Render Free web service (**yalnız API önizlemesi**).
- Render Free 512 MB RAM / 0,1 CPU, boşta kalınca uyku ve ephemer al filesystem sınırlarına sahip; bu nedenle her dakika iş yapan `pg-boss` worker'ını güvenilir biçimde çalıştırmaz. Mevcut Railway API+worker ortalama RAM'i ~433 MB; iki süreci aynı 512 MB serviste birleştirmek OOM riski taşır.
- **Tam ürün göçü bu PR ile bitmez:** Sürekli worker, gerçek SMTP, özel + genel medya bucket'ları, veri aktarımı/ülke değerlendirmesi ve maliyet limiti doğrulanmalıdır.
- Railway Trial'ın bitmesi ve olası 30 gün sonraki volume silinmesi nedeniyle dışarıda, geri yüklemesi doğrulanmış güncel yedek zorunludur.
- Herhangi bir ortamda secret, token, PG URL, PII, ham dump veya imzalı medya URL'leri GitHub'a, Vercel önizleme günlüklerine veya kamuya açık issue'ya konmaz.

## Bağlantı ve yedekleme engelleri

Railway bağlı hesabı, servis isimleri ve değişken **isimlerini** gösteriyor ama OAuth bağlantısında `DATABASE_PUBLIC_URL`, `PGPASSWORD` ve `S3_*` secret değerleri **gizleniyor**. Bu nedenle buradan doğrudan dump üretildiği ya da yeni DB'ye restore yapıldığı iddia edilemez.

Render ve Neon servisleri hesap sahibinin bağlantısı/kurulumu tamamlandıktan sonra oluşturulmalıdır; **ücretli plan seçmeyin**.

### A. Kaynakta güncel yedek — zorunlu

1. Railway'de `kararver-staging / Postgres` ana DB'nin **güncel** dış dump'ını şifreli, yerel/özel bir konumda oluşturun. 5 Ekim'deki restore tatbikatı yedeği 1 Kasım güncel verisi sayılmaz.
2. `pg_dump` PG18 sürümü ile ve **ana** DB bağlantısına karşı çalıştırın; `Postgres-2_Bi` geçici restore kopyasıdır, ana kaynak değildir.
3. Örnek yerel komutlar (komut satırına secret yapıştırmayın; `SOURCE_DATABASE_URL` ve `TARGET_DATABASE_URL` güvenli geçici ortam değişkenleri olarak sağlanır):

```bash
# Shell'iniz pg_dump/pg_restore 18 istemcisini ve bağlantı değişkenlerini sağlıyor olmalı.
pg_dump --dbname="$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file=kararver-staging-YYYYMMDD.dump
pg_restore --list kararver-staging-YYYYMMDD.dump > dump-content-list.private.txt
# Yalnız boş, yeni, erişimi kapalı hedefte. Önce restore planını ve uzantıları gözden geçirin.
pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-acl --exit-on-error --verbose kararver-staging-YYYYMMDD.dump
```

4. `pg_restore` hata vermiyorsa tablo sayısı, temel kayıt sayıları, migration geçmişi, sürüm ve yetki invariants'ını eski/yeni DB'de **salt okunur** karşılaştırın. Mevcut `pnpm --filter @kararver/db run db:verify`, `db:verify-votes` ve `db:check-migrations` komutlarını kaynak ve hedef için ayrı çalıştırın. Salt kod testi restore kanıtı değildir.
5. Bir sonraki yazma işlemiyle iki DB'nin farklılaşacağını unutmayın: kullanıcıya açık kesin geçişte maintenance/freeze ve **son delta dump** veya kabul edilmiş write-freeze planı gerekir. Kaynak ve hedefe aynı anda yazmayın.

### B. Medya ve e-posta

- Railway'de `kararver-staging-private` ve `kararver-staging-public` adında iki ayrı bucket var. DB dump **fotoğrafları içermez**. Object key, boyut, checksum ve ACL kontrolüyle özel bucket'tan özel hedef bucket'a; onaylı kopyaları genel hedef bucket'a aktarın. Secret'ları repo içine koymayın.
- Mevcut mailer, staging'de `mailpit_api` için yalnız `.up.railway.app` adresini kabul eder. Railway kapatılacaksa Render'da kullanılacak doğrulanmış, ücretsiz **SMTP** sağlayıcısı gerek (`MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `SMTP_URL`). Prod'a geçişte e-posta doğrulamasını kapatmak çözüm değildir.
- `AUTH_TOKEN_PEPPER` kaynak DB'deki oturum token hash'leriyle ilişkili; rastgele değiştirmek oturumları geçersizleştirir. Gizli aktarım ve planlı zorunlu yeniden giriş arasında güvenlik kararını kaydedin. Parola/MFA/rol tablolarına manuel müdahale etmeyin.

### C. Render API önizlemesi

- `render.yaml`: **sadece** `kararver-api-free-preview`, `plan: free`, `autoDeployTrigger: off`. GitHub'dan merge edilmesi bile otomatik rollout/DB değişimi yapmaz.
- Secrets `sync: false` ile **yalnız Render panelinden** girilir. `API_URL` gerçek Render adresi, `DATABASE_URL` Neon **doğrudan** PostgreSQL bağlantısı olmalı; eskiden kalan Railway internal host kullanılmamalı.
- Restore/migration kabulü olmadan `prisma migrate deploy` veya seed/reset'i hedefte **otomatik** çalıştırmayın. İlk boot aşamasında yalnız `/health` ve gözlem yapılır.
- Sadece API başladı diye gerçek Vercel `API_URL`'ini değiştirmeyin. Vercel `/api` rewrite'ı build sırasında `API_URL` üzerinden oluşur, değişiklik için Vercel redeploy ve aynı-origin auth smoke gerekir.
- Render Free'de 15 dk trafiksizlikten sonra servis uykuya geçer, yeniden başlama süresi olabilir. Ücretli bandwidth/overage riskini dashboard'dan **sıfır ödeme** hedefiyle ayrıca kilitleyin. API/DB yeterli olsa bile worker offline iken medya/snapshot/bildirim/temizlik işlemleri garanti edilemez.

### D. Tam göç için açık kabul kapıları

- [ ] Neon ve Render ücretsiz hesap/bağlantıları hazır; kartla ödeme veya paid plan **yok**
- [ ] Güncel dış `pg_dump` özel depoda, yeni hedefte restore + tüm invariant testleri PASS
- [ ] Her iki medya bucket'ı özel/genel erişim ve checksum'larla aktarılmış, silme/erişim testleri PASS
- [ ] Güvenli SMTP kurulmuş ve kritik auth e-postaları test edilmiş
- [ ] Worker/pg-boss zamanlayıcıları ve medya moderasyonu ücretsiz ve güvenilir bir tasarımla doğrulanmış (Render Free web service uykuya geçerken **NO-GO**)
- [ ] 512 MB/0,1 CPU testleri, load testi, DB bağlantı havuzu ve uygulama belleği kabul edilmiş
- [ ] Vercel aynı-origin proxy, oturum/MFA, oy, anket, medya, silme, backup/restore gerçek testleri PASS
- [ ] #284 hukuki uyum, #46 güvenlik, #51 operasyon, #53 regresyon, #54 GO/NO-GO kabulü tamam
- [ ] Eski Railway servisleri ancak bağımsız yedek ve yeni ortam tam çalışıyorsa owner onayıyla ayrı adımda durdurulur

**Bugünkü karar:** Yeni yapılandırma sadece hazırlık; mevcut Railway'i silme veya Vercel üretim yönlendirmesi yapma. Deneme bittiğinde mevcut servislerin durması mümkün, ancak kopyalanmamış kaynak volume'ların sonradan silinme riski vardır. Hedef platform bağlantısı ve güncel güvenli yedek olmadan taşıma tamamlanmış sayılamaz.
