# #287 — Çerez, depolama ve ölçüm envanteri

1 Kasım 2026. Kaynak: main `9f300cfd541e` ve bu PR'ın tercih değişikliği. Bu teknik envanter hukuki sınıflandırma/onay veya staging kabulü değildir. Bağlantılar: #285, #286, #288, #53, #284.

## Tarayıcı kayıtları

| Ad | Yer / kaynak | Amaç ve içerik | Teknik süre / silme | Tercih ilişkisi |
| --- | --- | --- | --- | --- |
| `kv_session` (config ile değişebilir) | HttpOnly cookie; `apps/api/src/http/cookies.ts`, `modules/auth/session.ts`, `config.ts` | Opak oturum token'ı; istemci JS'i okuyamaz. SameSite=Lax; staging/production Secure zorunlu | `SESSION_TTL_DAYS`, varsayılan 30 gün; logout/geçersiz oturum cookie'yi temizler. Cookie süresi DB saklama süresi değildir | Oturum işlevi. Kullanıcı tercih panelindeki kaynak ölçümü bunu kapatmaz; uygulanabilir hukuki şart ve kalıcı oturum politikası #285'te açık |
| `kararver:theme` | localStorage; `components/product-provider.tsx` | Kullanıcının light/dark seçimi | Kodda zaman aşımı yok; site verileri temizlenene kadar | Kullanıcı tarafından istenen görünüm tercihi; hukuki sınıflandırma #285 |
| `kv-welcome-v1` | localStorage; `lib/welcome-draft.ts` | Karşılama ekranının görülmesi, `1` | Kodda zaman aşımı yok | Onboarding işlevi; sınıflandırma ve süre kararı açık |
| `kv-welcome-draft-v1` | localStorage; `lib/welcome-draft.ts` | En fazla 20 ilgi kategori kimliği, demo seçimi, güvenli returnTo ve sürüm | Başarılı ilgi kaydı/akış temizliği; kodda zamana bağlı TTL yok | Kullanıcının devam eden formu. Siyasi/dini/sağlık vb. kategori seçimi ihtimali ayrıca değerlendirilmeli; kaynak ölçümü reddedildiğinde keyfi silinmez |
| `kv-data-export-token` | sessionStorage; `features/data-export/download-model.ts` | Hak sahibine gönderilen veri paketi bağlantısının token'ı, giriş sonrası devam edebilmek için | Sekme oturumu, uygulamanın geçersiz token temizliği; backend token ayrıca süre/indirme hakkı kontrol eder. Bu PR token depolamasını değiştirmez | Veri hakları işlevi; yalnız ölçüm reddedildi diye silinmez. Gerçek token envantere/PR'a konmaz |
| `kv.privacy.preferences` | localStorage; `lib/privacy-preferences.ts` (bu PR) | Yalnız sürüm 1, measurement true/false, karar zamanı. Hesap/oturum/IP/benzersiz ziyaretçi kimliği yok | 30 gün; bozuk, gelecekteki, eski sürümlü veya süresi dolmuş kayıt kabul edilmez | Kabul/reddin hatırlanması. 30 gün teknik ilk öneridir; #285 hukuki kabulü yerine geçmez |
| `kv.share.attribution` | localStorage; `lib/share-attribution.ts` (bu PR), `components/source-attribution.tsx` | Paylaşım UUID'si ve yakalama zamanı. URL'nin tamamı/e-posta/hesap kimliği tutulmaz | En fazla 30 gün ve geçerli tercih süresiyle sınırlı; ret/geri çekme/eski-geçersiz tercihyle temizlenir | İsteğe bağlı kaynak ölçümü. Açık seçim yoksa yazılmaz veya okunarak kullanılamaz; önceki sürümden gelen izinsiz kayıt temizlenir |

Temizleme yalnız ilgili ölçüm anahtarını hedefler; toplu `localStorage.clear()` uygulanmaz. Oturum, tema, form ve veri hakları akışı kaynak ölçümüne bağlanmaz. Tercih hesapla birleştirilmez. Aynı origin'deki sekmeler storage olayı ve odaklanmada yenilenir; tüketici her okumada tercihi yeniden kontrol eder. Süre sonu açık sayfada da kontrol edilir.

Tercihlere her sayfanın altındaki aynı adlı düğmeyle ulaşılır. Başlangıçta panel kapalı ve kaynak ölçümü kapalıdır; paneli açmak, sayfayı ziyaret etmek veya URL'de kaynak etiketi bulunması kabul değildir. Otomatik açılan bir çerez duvarı yoktur; yalnız kullanıcı açınca ayrıntı/karar alanı genişler. Böylece hydration sırasında sayfayı iten otomatik panel de eklenmez. Ürün kabuğundaki "İçeriğe geç" bağlantısı ilk klavye durağı olarak kalır; mobil alt gezinme için tercih alanının sonunda boşluk bırakılır.

Depolama erişimi/yazımı engelliyse kabul başarı sayılmaz. Geri çekme kalıcılaştırılamadığında mevcut belge ölçümü kapalı tutar ve kullanıcıya site verilerini temizleme seçeneği açıklanır; yeniden açılışta veya başka sekmede kalıcı kayıt silinmiş gibi garanti verilmez. Storage erişimi tamamen yasaksa fiziksel kaydın silindiği de iddia edilmez.

## Ağ ve sunucu akışları

- `lib/http-client.ts`: ürün API istekleri credentials=include ile yapılandırılan API'ye gider. Giriş, oy, moderasyon, hak başvurusu gibi ürün istekleri isteğe bağlı analitik değildir. `NEXT_PUBLIC_API_URL=/api` kullanıldığında `next.config.ts` gerçek API'ye proxy eder.
- `lib/media-client.ts`: imzalı upload için farklı origin'e istek; API cookie/authorization gönderilmez. Medya/avatar/görsel URL'leri ayrıca görüntü isteği oluşturur. Gerçek public/private origin, ülke ve sağlayıcı #288 panel kabulüyle belirlenir.
- `modules/shares/routes.ts`: paylaş düğmesi paylaşım kaydı ve `?src=<uuid>` bağlantısı üretir. Bu PR bu kullanıcı işlemini kaldırmaz. `readShareAttribution` için üretim frontend tüketicisi bulunmadı; bu PR kayıt/okuma kapısını düzeltir, yeni analytics veya conversion endpoint'i eklemez. Sunucudaki paylaşım/ürün olaylarının amacı ve hukuki şartı ayrıca açık.
- `SourceAttribution` ve tercih bileşeni fetch, beacon veya üçüncü taraf SDK çağırmaz. Özel bir analytics ağı uç noktası eklenmedi. URL'deki `src` web/proxy erişiminde görülebilir; bunu tarayıcı tercihi sunucu loglarından silemez. Sunucu/proxy log politikası #285/#288 ile ayrıca kabul edilir.
- 1 Kasım'daki **main** kaynak taramasında Google Analytics/Tag Manager, reklam pikseli, iframe veya `next/script` analitik SDK entegrasyonu bulunmadı. **#312 aday sürümü kendi origin'inde ayrı bir 3D kabin iframe'i ekler; aşağıdaki ek envanter buna ilişkindir.** Bu kaynak gözlemidir; Vercel/Cloudflare/Railway dashboard enjeksiyonu, CDN cookie'leri, gerçek DNS/TLS sonlandırma ve log saklama ayarları taramayla kanıtlanmaz. Hesap panelleri ve gerçek production ağ kaydı açık kabul işidir.
- **Tarayıcının bağlandığı origin'ler (Faruk, ağ/sağlayıcı; 9 Kasım, main `2e9db35`):**

  | İstek | Tarayıcının bağlandığı yer | Sağlayıcı / bölge | Taşınan |
  | --- | --- | --- | --- |
  | Sayfa, statik dosyalar, `/api/*`, onaylı görsel (`/api/media-public`) | Aynı origin (Vercel); Vercel `/api`'yi sunucu tarafında Render API'ye aktarır | Vercel (bölge doğrulanmalı) → Render Frankfurt | Çerez, IP, user-agent, istek içeriği |
  | **Görsel yükleme** (presigned PUT) | **Doğrudan depolama uç noktası** (`S3_ENDPOINT`). API URL'yi üretir, dosya Vercel/Render'dan geçmez | Neon Object Storage, `eu-central-1` | Görsel dosyası, IP, user-agent. API çerezi gönderilmez |
  | **Moderasyon önizlemesi** (presigned GET, 5 dk) | **Doğrudan depolama uç noktası.** İncelemedeki (ve admin kapsamında reddedilmiş) görselin işlenmiş kopyası; `media/view.ts` imzalı URL üretir, `admin/media-panel.tsx` `<img>` ile açar | Neon Object Storage, `eu-central-1` | Moderatörün IP'si ve user-agent'ı; Referer gönderilmez (`no-referrer`). API çerezi gönderilmez |
  | Paylaş → WhatsApp / X | `wa.me`, `twitter.com`: **yalnız kullanıcı tıklayınca** yeni sekme; önceden istek yok | Meta, X | Paylaşılan bağlantı |

  API, sahibine de incelemedeki görselinin imzalı önizleme URL'sini döndürür (`media/routes.ts`); web bugün bunu yalnız moderasyon panelinde gösterir. Sahibe gösterilirse aynı satır sahibin IP/user-agent'ı için de geçerli olur.

  `apps/web/src`, `public` ve `next.config.ts` taramasında başka dış origin, harici font, CDN script'i, analitik/telemetri/hata izleme paketi (`@vercel/analytics`, Sentry, PostHog vb.) yok. CSP yalnız `frame-ancestors`/`base-uri`/`form-action`/`object-src` kısıtlıyor. Kaynak gözlemidir; Vercel panelinden enjekte edilebilecek özellikler (Web Analytics, Speed Insights) panelde kapalı olduğu doğrulanmalı. Sağlayıcı ve aktarım ayrıntısı: [LEGAL_288_PROVIDER_TRANSFER_INVENTORY.md](LEGAL_288_PROVIDER_TRANSFER_INVENTORY.md).
- Auth oturum tablosu IP/user-agent/son görülme/sona erme/iptal alanları tutar (`core.prisma`, auth routes). Cookie TTL'si bu kayıtların otomatik silindiği anlamına gelmez. API logger cookie/authorization/set-cookie/password/token alanlarını redakte eder (`app.ts`); sağlayıcı loglarının hiç kişisel veri içermediği sonucu çıkarılmaz.

## #312 aday sürümü: birinci taraf kabin iframe envanteri

8 Kasım 2026 kod taraması; **yalnız #312 dalı için hazırlıktır**, henüz public/staging ağ gözlemi veya hukuki sınıflandırma değildir.

- Anasayfadaki `SpaceHero`, `/experiences/cabin/index.html?embed=1` adresini **aynı origin** içindeki iframe olarak kullanır. Üç boyutlu kabin Three.js/WebGL, yerel `/experiences/cabin/textures/*` görselleri ve yerel JS bundle'ından oluşur. Kaynakta ayrıca üçüncü taraf analytics SDK, uzaktan script/iframe URL'si, `fetch`/beacon, localStorage/sessionStorage veya cookie okuma/yazma çağrısı görülmedi. Bu, platform düzeyi ağ ve trafik loglarının boş olduğu iddiası değildir.
- `next.config.ts` genel sayfalarda `frame-ancestors 'none'` / `X-Frame-Options: DENY` kullanırken yalnız bu yerel kabin sayfası için `frame-ancestors 'self'` / `SAMEORIGIN` tanımlar. Aktarımın aynı-origin olması üçüncü taraf veri aktarımı olmadığını tek başına hukuken kanıtlamaz; gerçek sağlayıcı, CDN ve log envanteri #288'e bağlıdır.
- İlgili URL ve bileşen #312 görsel deneyim kapsamındadır. Üretim tarayıcı ağ kaydı, iframe kaynağının gerçekten aynı origin kaldığı, beklenmedik script/haricî URL olmadığı, cookie gönderimi, klavye/erişilebilirlik ve CPU/GPU yükü #48/#53/#195 ile test edilmelidir. İleride dış içerik eklenirse bu envanter ve açık tercih/şart değerlendirmesi yeniden yapılır.

## Regresyon ve kapanış

Yerel model testleri: seçim yok, ret, kabul, geri çekme, eski kayıt, bozuk/future/version/expired tercih, ilk kaynak, storage hatası, SSR ve başka sekmede değişen tercihin sonraki okumada uygulanması. Tarayıcıda temiz profil, klavye, mobil, depolama ve ağ farkı ayrıca kaydedilir. Yerel/fixture tarayıcı çalışması gerçek staging/cihaz veya hukuk onayı değildir.

#287 kapanışı için açık: #285 sınıflandırma ve süre/metin kabulü; gerçek deployment/provider storage-ağ envanteri; onaylı metinlerle bağlantı #286; aynı release staging/cihaz kabulü #48/#53. Bu PR bu koşulları kendiliğinden işaretlemez.

Kaynaklar: [KVKK çerez rehberi](https://www.kvkk.gov.tr/Icerik/7353/Cerez-Uygulamalari-Hakkinda-Rehber), [aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-).
