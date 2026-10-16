# Mehmet — 16 Ekim 2026 gerçek staging kanıtı

Bu kayıt beta/production GO değildir. Test hesapları sentetiktir; HTTP yanıtları gerçek staging API ve PostgreSQL yolundan gelir. Doğrudan DB sorgusu, fiziksel cihaz, gerçek SMTP alıcısı veya gerçek beta katılımcısı yerine geçmez.

## Sürüm ve kapsam

- API: `https://api-staging-45cb.up.railway.app`, `be6ebd23b720c6c35df0253e7cad661ab7f9223d`, health `ok`, worker `ready`.
- Web proxy: `https://kararver-staging.vercel.app/api/v1`. İlk yazma kabulü öncesi Vercel READY `be6ebd23…`, Railway SUCCESS `edf564bf-09d8-4c84-b7e4-c5997c9186b8` ile eşlendi. Sonraki main deploy'ları otomatik ilerleyebilir; aşağıdaki kanıt yalnız kaydedilen API sürümüne aittir. Tekrar güncel yayın kabulünde sürümler yeniden eşlenir.
- #240/#241/#243 birleşti. #243 incelemesinde mevcut çıktı dosyasını silebilen restore hata yolu düzeltildi ve dosya koruma/tahrifat testleri eklendi.
- Kaynak kabul aracı: #244 içindeki `scripts/staging-write-acceptance.mjs`. Güvenlik araçlarının 14 yerel koruma testi geçti; bu sayı canlı test sayısı değildir.

## Gerçek HTTP sonuçları (#46, #48, #52, #194)

| Senaryo | Gerçek sonuç |
| --- | --- |
| Normal USER, admin kullanıcı listesi | 403 |
| Aynı cookie: USER → ADMIN → USER | 403 → 200 → 403; yeniden giriş gerekmedi |
| ADMIN, SUPER_ADMIN operasyon paneli | 403 |
| İki ayrı toplulukta moderatör kapsamı | Kendi topluluğu LOCK 200, diğer topluluk LOCK 403 |
| Kilitli ankete oy | 409 `CONTENT_LOCKED` |
| Sahibin kendi anketine oyu | 403 `SELF_VOTE_FORBIDDEN` |
| Misafir sonuç gizliliği | Oy öncesi/sonrası yalnız `{visible:false}`; sayı alanı yok |
| Aynı kullanıcıdan 20 eşzamanlı oy | 1×201, 13×200, 6×429; görünen toplam ve seçenek toplamı 1. Önceki kilitli oy denemesi de hız sayacına girer |
| Kapanmış ankete yeni USER oyu | Ek kabulde 409 `POLL_CLOSED` |
| BAN sonrası aynı açık cookie ile oy | 401; yaptırımın mevcut oturuma etkisi doğrulandı |
| Yalnız kendi sentetik USER hesabında MFA | Kurulum/onay 200, aynı TOTP tekrarında 403, kurtarma kodunun ilk kullanımında 200/tekrarında 403; MFA etkin kaldı |
| Kaldırılmış içerik | Anonim detay 404, yeni paylaşım bağlantısı oluşturma 404; web metadata `noindex` |

İkinci tam yazma akışı **11:03:06 UTC: 46 PASS, 1 FAIL** kaydetti. FAIL, kapanış ret kontrolünün istemci saatiyle pencere bekleyip erken gönderilerek tekrar 429 almasıydı; başarıya çevrilmedi. Araç sunucunun `Retry-After` başlığını izler ve saat farkı için pay bırakır. Önceki denemedeki ikinci anket 429'u da gerçek 30 dakikalık yeni hesap paylaşım aralığıydı; ikinci topluluk anketi diğer sentetik hesaba açtırılarak sınır korunur.

Kalan kapanış/yaptırım ve ek MFA/kaldırma kontrolleri **11:08:51 UTC: 27/27 PASS** ile ayrıca tamamlandı. Bu ek akış yalnız bu çalışmanın kaldırdığı, moderasyon izi doğrulanmış kapalı anket ve sahibi yine bu çalışmanın oluşturduğu gizli topluluk üzerinde yürüdü; sonunda eski kapalı/gizli/kaldırılmış duruma döndü. İnsan hesabında MFA kurulmadı, rol/puan değiştirilmedi. Bağımsız iki yönetici onayının zorunlu tutulduğu akış hâlâ ayrı kabuldür.

Toplam beş sentetik kayıt mevcut 5/IP/saat sınırı içinde yapıldı; sayaç, hesap yaşı, global limit ve doğrulama politikası değiştirilmedi. **11:10:50 UTC** bağımsız read-only kontrol: beş hesabın tamamı `USER` ve `BANNED`, kendi toplulukları gizli ve kendi içerikleri kaldırılmış. Yalnız araçların oluşturduğu operatör oturumları kapatıldı. Gizli veri rapora/issue'ya yazılmadı.

Özel çalışma çıktıları `output/playwright/` altında tutulur: `2026-10-16-staging-write-first-attempt.json`, `2026-10-16-staging-write-acceptance.json`, `2026-10-16-staging-closed-mfa.json`, `2026-10-16-admin-real.json`. Bunlar kaynak kod deposuna alınmaz; tablo yalnız maskeli durum kanıtıdır.

## Gerçek admin UI ve görsel takip

Canlı Chromium'da 360×800 ve 1440×1000 viewport: gerçek dashboard/ops verisi yüklendi, yatay sayfa taşması yok, ops bölgesinde otomatik WCAG 2 A/AA + 2.1 AA ihlali yok; read-only kontrol **8/8 PASS**. Gerçek ekran görüntüleri özel çalışma klasöründe incelendi. 360 px ekranda 16 sayacın tek sütunda gereksiz uzaması bu incelemede görüldü; #244 düzenlemesi 340–900 px aralığında iki sütun yapar, daha dar ekranı tek sütun tutar. Fiziksel mobil ve ekran okuyucu kabulü değildir.

Etkin gerçek ayarlar ayrıca okundu: yeni hesap oyu 15/dakika, normal oy 30/dakika, yeni hesap paylaşım aralığı 30 dakika, günlük paylaşım tavanı 3. İlk giriş 20/yayın 10 puan politikası değiştirilmedi.

## Yedekleme CI kanıtı (#51/#186)

#245 adayı `213bc399b637c1a61f2658febdd8bb138c91fa43`, [database işi](https://github.com/mehmetalisahingm/kararver/actions/runs/38890452551/job/116938384913): `pg_dump`/`pg_restore` **17.11** zorunlu doğrulandı. Gerçek yedek → boş hedefe restore → manifest doğrulaması geçti; gerçek döküm şifreleme/yükleme/çözme ve `ops_backup_runs` kaydı testi de geçti. API testleri 698/698, worker 146 başarılı/1 ilgisiz atlama, web gerçek DB testleri 143/143. Diğer CI kapıları ve son merge/deploy durumu GitHub'dan ayrıca izlenir.

Mevcut worker yedek zamanlayıcısı varsayılan kapalıdır. Ayrı Railway servisi, bucket veya özel anahtar oluşturulmadı. Canlı yedek bucket yetkisi, anahtar saklayıcısı, saklama süresi, staging PG 18 istemcisi ve ilk gerçek şifreli restore kabulü bekler.

## Açık kalan kapılar

#46: doğrudan staging DB invariant/satır/olay eşlemesi, gerçek private medya/model kesintisi, kontrollü emergency pencere, doğal TTL ve bağımsız iki yönetici zorunlu onay kabulü. #48/#191/#194: fiziksel cihaz, ekran okuyucu ve insan görsel kabulü. #47/#52: gerçek izinli beta, olgun D7 ve X/WhatsApp gerçek önizleme/cache kabulü. #51/#54: production altyapısı/alan adı/mail ve yedek kurulumu. #57–59 yayın sonrası ürün kararları/pilot; V1'e yeni ekonomi veya ödeme eklenmez. Üst issue'lar bu kayıt nedeniyle otomatik kapatılmaz.
