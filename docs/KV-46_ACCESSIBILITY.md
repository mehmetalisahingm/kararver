# KV-46 / #48 — Ekran durumları ve erişilebilirlik matrisi

#111 mevcut kullanıcı ekranları ve ortak admin kabuğunu kapsar. #48 açık kalır;
#20 medya/sosyal teslimi #124 ile main'e alındı ve #20 kapandı. #47 beta bağımlılığı,
fiziksel cihaz, ekran okuyucu ve staging kabulü hâlâ final kapanış için beklenir.

## 9 Ekim — Oturum kaybı ve güncel ekranlar

Güncel main (`b1c0c07`) #168 onboarding kabulünü ve #170 açık tema admin
filtre kontrast düzeltmesini içerir. Hesap ekranındaki yeni regresyon, profil
kaydı sırasında API 401 döndürdüğünde özel form ve kaydedilenlerin kaldırılmasını,
sayfa yenilendiğinde misafir ekranının korunmasını ve tekrar girişten sonra
`returnTo=/hesap` hedefine dönülmesini doğrular. Bu test HTTP fixture kullanır;
gerçek cookie TTL veya staging veritabanı kabulü olarak değerlendirilmez.

Gerçek kısa TTL staging senaryosu için `docs/KV-48_STAGING_EXPIRY.md` ve
#143 ile eklenen operator CLI kullanılmalıdır. Yalnız ayrı test oturumu oluşturur;
ortak oturum süresi değiştirilmez. Kabul kaydında süre dolmadan 200, aynı cookie
ile süre dolduktan sonra 401 ve DB expired durumu yer almalıdır. Cookie/token
değerleri rapora yazılmaz. Bu çalıştırma ve kontrollü gerçek staging 500/recovery
kanıtı hâlâ beklenmektedir.

## 4 Ekim — Güncel main ve medya matrisi

#111 main'e alındı; bu devam teslimi #124 ve #111'i içeren main üzerine kuruludur.
Yeni medya arayüzü Chromium'da
integration işinde, Firefox/WebKit'te browser-accessibility işinde çalışır:
her motorda 3 senaryo × 2 viewport = 6 test, toplam 18 medya testi. Dolu yükleme
listesi iki temada axe/taşma denetiminden geçer ve ekran görüntüsü kaydedilir.
Motor sürümü ve emülasyon bilgisi rapora eklenir. Private URL, PUT/complete/publish
retry, sıra, karantina/reddetme ve galeri klavye/loading/retry kapsamı korunur.

Final dış kabul kaydı (#48 açık):

| Kabul | Kayıt gereği | Durum |
| --- | --- | --- |
| Fiziksel Android/iOS ve gerçek Safari | Cihaz, OS/tarayıcı sürümü, 360px gezinme/form/galeri bulgusu | Bekliyor |
| NVDA/VoiceOver/TalkBack | Form adı/hata duyurusu, modal odak dönüşü ve galeri okuma | Bekliyor |
| Staging root/server 500 → retry | Ortam adresi, hata ve iyileşme kanıtı | Bekliyor |
| #47 kapalı beta | Gerçek kullanıcı bulguları ve modül sahiplerinin düzeltmeleri | Bekliyor |

Bu satırlar otomatik tarayıcı/axe testiyle tamamlanmış sayılmaz. Son CI bağlantısı
medya matrisi devam PR'ı ve issue #48 üzerinde kayıtlıdır.

## Düzeltmeler

- Sayfa hatasında Next 16.3 `retry` ile yeniden veri istenir; root/provider hatası
  context veya global CSS gerektirmeyen Türkçe global hata belgesiyle karşılanır.
- Ortak route skeleton/status ekranı bulunur. Ham hata/stack kullanıcıya açılmaz.
- Demo formları da hydration tamamlanınca açılır; WebKit'te ilk alanın erken
  yazılıp sıfırlanması engellenir. Geciktirilmiş JavaScript regresyonu bunu doğrular.
- Profil ilk yükleme için tekrar deneme ve ayrı 404 durumu sunar. Gönderi/yorum
  sayfalama hatası mevcut içeriği ve cursor'ı korur; eşzamanlı tıklama engellenir.
- Kaydedilenler yükleme hatasını boş liste gibi göstermez; yeniden yüklenebilir.
  Başarısız profil kaydı taslağı, başarısız kayıt kaldırma liste öğesini korur.
- İlgi alanı kayıt hatası seçimleri gizlemez/sıfırlamaz. Boş kategori, yüklenen
  topluluk ve topluluk hatası ayrı sunulur.
- Admin bağlantı hatası yetki reddinden ayrılır ve tekrar denenebilir. Admin
  menü/modal yüzeyleri açık/koyu tema değişkenlerini kullanır; modal adı erişilebilirdir.

## Tarayıcı ve mobil matrisi

`playwright.states.config.ts` her motor için desktop 1440×1000 ve mobile 360×800
projeleri çalıştırır. Chromium/WebKit mobil viewport + touch + isMobile;
Firefox viewport + touch kullanır (Firefox isMobile desteklemez).

| Motor | Masaüstü | Mobil emülasyon | Kanıt |
| --- | --- | --- | --- |
| Chromium | 1440px | 360px | CI browser-accessibility (chromium), states-chromium |
| Firefox | 1440px | 360px | CI browser-accessibility (firefox), states-firefox |
| WebKit | 1440px | 360px | CI browser-accessibility (webkit), states-webkit |
| Edge (yerel) | 1440px | 360px | Aynı matris, KV_BROWSER_PATH ile |

Her motor: 28 rota × açık/koyu tema × 2 viewport = 112 rota denetimi;
üç motor toplam 336 rota denetimi. Güncel paket her motor için 54 Playwright testi içinde
çalışır. Her denetim taşma, yükleme bitişi, başlık/landmark ve axe WCAG 2 A/AA,
2.1 AA kontrolünü içerir. HTML raporu motor sürümünü, proje/viewport bilgisini
ve emülasyon olduğunu kaydeder. Temsili ekranlar ve her senaryonun son durumu
PNG olarak; hatalar trace/screenshot olarak CI artifact'larına yüklenir.

Mevcut auth/oy/sosyal/galeri/keşfet/admin regresyonları Chromium web işinde,
Firefox/WebKit için browser-accessibility işinde yeniden çalışır. Klavye,
Escape/odak dönüşü, azaltılmış hareket ve grafik/tablo kontrolleri bu paketlerdedir.

## Ekran/state kapsamı

| Ekran ailesi | Denetlenen durumlar | Test kaynağı |
| --- | --- | --- |
| Oturum / auth | oturum loading/offline/500/retry, misafir, giriş/kayıt doğrulama, şifre sıfırlama, form hatası | states/matrix, browser/flows, integration/auth |
| Ana akış / keşfet / arama | loading/skeleton, dolu/boş, 500/retry, cursor/filtre reset, dört arama türü | states/matrix, browser/discovery |
| Kategori / beş trend | loading, dolu/boş, 500/retry, yetersiz geçmiş, gizli sonuç, tarih/örneklem, grafik/tablo | states/matrix, browser/discovery |
| Anket / oluşturma | gizli/açık/kapalı/kilitli, seçenek/form hatası, giriş modalı, yayın/oy hatası ve retry | browser/flows, browser/social |
| Sosyal / galeri | loading/empty/error, iyimser geri alma, taslak koruma, fotoğraf hatası/retry, modal/klavye | browser/social |
| Profil | loading, 404, 500/offline/retry, boş/dolu gönderi/yorum, iki pagination hata/retry akışı | states/matrix |
| Hesap / kaydedilenler | misafir, loading, boş/dolu, ilk yükleme hatası/retry, başarısız profil kaydı ve silme, 401 sonrası özel içerik kaldırma ve yeniden giriş | states/matrix |
| İlgi alanları | misafir, loading, boş/dolu kategori/topluluk, yükleme retry, kayıtta seçim koruma | states/matrix |
| Ortak admin (11 rota) | yetki loading/error/retry/denied, tüm kabuklar, tema/taşma, modal adı/Escape/focus | states/matrix, browser/admin |
| Bildirim merkezi | loading, boş/dolu, retry, sayfalama, okundu işlemi hatası ve toparlanma | states/notifications |
| İlk açılış onboarding | demo sonucu, kayıt/giriş yönlendirmesi, ilgi alanı kaydı retry/401, mobil/klavye/reduced-motion | states/onboarding, browser/onboarding-acceptance |
| 404 | dönüş/skip/focus ve erişilebilirlik | browser/states, states/matrix |
| Route / root 500 sınırı | retry çağrısı, gizli hata bilgisi, bağımsız HTML belge | error-boundaries.test.mjs |

API-mode state testleri gerçek UI/HTTP adapter'ını sözleşme fixture'larıyla sürer;
500/offline ve gecikme tarayıcı request interception ile üretilir. Bunlar backend
veya staging testi değildir. Gerçek PostgreSQL testleri database CI işinde,
gerçek auth HTTP testi integration işinde ayrıca çalışır. Bir ekranın fixture
üzerinde erişilebilir olması, ilgili backend işlevinin staging kabulünün
tamamlandığı anlamına gelmez.

## Çalıştırma ve kalan dış kabul

- `KV_BROWSER=firefox pnpm --filter @kararver/web exec playwright test -c playwright.states.config.ts`
- Aynı komut chromium/webkit için çalışır; önce ilgili Playwright motoru kurulmalıdır.
- API state sunucusu yalnız test script'iyle 3003 portunda açılır; 4012 istekleri
  test tarafından karşılanır. Üretime test endpoint'i eklenmez.
- Fiziksel Android/iOS, gerçek Safari ve ekran okuyucu (VoiceOver/NVDA/TalkBack)
  kabulü emülasyon/axe sonucu olarak iddia edilmez. Cihaz/sürümle ayrıca kayıt gerekir.
- Staging root/server 500 enjeksiyonu → iyileşme ve beta kullanıcı kabulü ayrıca
  yürütülür. Bu sınırlar #48'in açık tutulmasının nedenidir.
