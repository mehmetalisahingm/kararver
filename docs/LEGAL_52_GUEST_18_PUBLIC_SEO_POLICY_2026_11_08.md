# KararVer V1 — Misafir anket erişimi, sonuçlar, 18+ katılım ve SEO

**İşletmeci kararı:** Mehmet, 8 Kasım 2026. **Hedef:** Misafirler halka açık anketleri ve yayımlanmasına izin verilen sonuçları okuyabilir; **oy ve yorum yazmak için 18+ hesap** gerekir. Bu belge güncel kod, açık inceleme/dağıtım kapıları ve henüz sorulacak sonuç gizliliği ayrımını kaydeder. **Yayın onayı değildir.**

## Kesin erişim matrisi

| İşlem | Misafir | 18+ hesabı olan ve e-postası doğrulanmış kullanıcı |
| --- | --- | --- |
| `GET /feed`, `GET /polls/:id`, `GET /polls/lookup`, halka açık detay/SEO sayfası | Açık | Açık |
| Halka açık anketlerin `results.visible === true` sonucu, toplam ve yüzde oylar | Açık | Açık |
| `AFTER_VOTE` anketi kapanmadan/oy kullanmadan sonucu | **Şimdilik gizli**: mevcut yaratıcının seçtiği kural korunur; gelecek işletmeci kararı bekleniyor | Mevcut `AFTER_VOTE` projeksiyonu aynen korunur |
| Halka açık yorumları/cevapları okumak | Açık (mevcut kural) | Açık |
| Oy vermek, yorum/cevap yazmak, reaksiyon, anket yayınlamak | **Yasak: backend auth verified** | Uygun yetki, gerçek yaş kriteri ve diğer sistem kuralları sağlanırsa |
| `REMOVED`, `HIDDEN`, `UNDER_REVIEW`, silinmiş hesap sahibinin ankete/yazılara erişim | **Kapalı** | Herkese kapalı; kişisel haklara erişim diğer özel süreç |
| Kullanıcıya ait oy, kayıt, bildirim, veri indirme, yönetim | **Kapalı** | Yalnız kendi yetkili erişimi |

**Önemli 18+ bağımlılığı:** Mevcut backend doğrulanmış **e-posta/oturum** kontrolü yapar; bu kendi başına doğum yaşını kanıtlamaz. [#318](https://github.com/mehmetalisahingm/kararver/pull/318) yeni kayıt için 18+ **öz beyan** sunar ama hâlâ draft; eski hesapların yaşı, yeterli doğrulama gerekip gerekmediği ve yeni + eski oturumlarda V1 eylem engeli [#289](https://github.com/mehmetalisahingm/kararver/issues/289) ile gerçek inceleme/kabul gerektirir. Mevcut kullanıcıların yaşı varsayılmaz. Bu PR `auth: "verified"` sözleşmesini zayıflatmaz, geçici unauthenticated write yolu açmaz.

## Bu PR'daki teknik hazırlık

- SSR `/karar/[id]`: Anket içeriği/başlık/seçenekler/yayımlanabilir sonuçlar, istemci yüklenmeden sunucu HTML'inde; `PollDetail` bunu `initialPoll` olarak alır, ardından kişiye özel katılım/bildirim bilgisini oturumla tekrar çekip günceller. Sunucuya yalnız herkese açık `polls.get/lookup` yanıtı taşınır.
- Sunucu ilk okuma, istemcideki `mapPoll` ile **aynı saf mapping** kullanır; özel token, kullanıcının oy durumu, kimlik veya admin verisi sunucu HTML'ine eklenmez.
- Üretim aşamasında gizli/kaldırılmış/kayıp içerik **gerçek HTTP 404** olur. Üretim API'si 5xx/hatalı projection/bağlantı yokluğu geçici sunucu sorunudur, yanlış 404'a çevrilmez. Preview/demo `APP_ENV !== production` sayfalarında istemci fallback ve `noindex` politikası korunur.
- Canonical URL, OG/X meta, sitemap ve robots zaten mevcut. `APP_ENV=production` ve gerçek `WEB_URL`/sunucu `API_URL` doğrulanmadan Google'da indekslenir denmez. Kaldırılan anketin sitemap'ten düşmesi, CDN/arama cache'in temizlenmesi ve Search Console canlı URL incelemesi **#52/#53** bağımsız kabulüdür.
- Misafir ekranındaki açık ve anlaşılır 18+ kayıt/giriş CTA'sı kullanıcıyı doğru dönüş URL'sine götürür. Bu açıklama **gerçek yaş doğrulaması değildir**.
- API ve web testleri misafirin kamuya açık sonuç erişimini (sadece izin verilen), oy/yorum/anket yazma isteklerinin sunucuda 401 olması, `AFTER_VOTE` sonuç sızıntısı olmaması, ilk render projection, gerçek 404 ve geçici 503 ayrımını testler.

## Google SEO için kabul koşulları

- [ ] Gerçek Vercel üretim ortamında `APP_ENV=production`, **doğru kanonik alan adı**, `WEB_URL`, `API_URL`, HTTPS ve erişilebilir `/robots.txt`, `/sitemap.xml` doğrulansın; yanlış önizleme domain'i canonical olmasın.
- [ ] Yeni misafir/Googlebot benzeri istekte anket detayı HTTP 200, anlamlı sunucu HTML'i, canonical, OG/X meta ve başlık/veri sahada görülsün; 0-JS ağda içerik mevcut, anonim API cevapları kişisel alan sızdırmıyor.
- [ ] Kaldırılan/gizlenen/anket sahibi silinmiş içerik HTTP 404, doğru `noindex` ve feed/sitemap dışı; eski URL'ler, resim önizlemeleri, sosyal önbellek ve CDN için purge/yeniden tarama planı ayrı doğrulansın. **Sırf robots disallow, silmeyi garantilemez**.
- [ ] `AFTER_VOTE` eski sonuç tercihi, kişisel/hassas anket içerikleri ve topluluk moderasyon işlemleri yeni misafir politikası yüzünden ifşa olmasın.
- [ ] Gerçek staging SHA'da masaüstü/mobil, ekran okuyucu/klavye, guest → login/18+ signup → geri dön → oy ve yorum, 401/403/404, kapalı anket, rapor/itiraz, diğer üçüncü kişi yorum gizliliği PR #323 ile birlikte test edilsin.
- [ ] Google Search Console sahibinin **manuel** doğrulama ve sitemap gönderme/URL inceleme izinleri doğrulansın. Indexing garanti edilemez; sponsorlu gösterim/SEO ücreti gerekmez.

## KVKK ve içerik hukuku

Misafirin hesap açmadan okuması **kişisel veri işlenmediği** anlamına gelmez: IP, HTTP/koruma logları, cihaz depolama, güvenlik/operasyon ölçümü ve sayfa içi kullanıcı içerikleri ayrı amaç/hukuki şart/süreye tabi olabilir. KVKK 10. madde aydınlatma, gerçek işletmeci kimliği, amaç ve alıcılar/yurtdışı aktarım, gereksiz izlemeyi reddetme ve #287 ölçüm/çerez kararı korunur. **18+ kayıt şartı misafirin yaşının doğrulandığı anlamına gelmez**; misafir sayfalarında çocuklara ilişkin özel koruma ve veri minimizasyonu ayrıca değerlendirilir. Herkese açık kişisel/siyasi/dini/sağlık içeriğinin hukuka uygun sınıflandırılması ve moderasyonu #285/#289/#290/#183 kapsamında kalır. Anketlerin tümünün zorla Google'a açılması veya silinmiş içeriğin tekrar görünmesi kabul edilmez.

Kaynaklar:
- [Google Search Central — Search technical requirements](https://developers.google.com/search/docs/essentials/technical) (200, ulaşılabilirlik, indekslenebilir içerik; indekslenme garantisi yok)
- [Google — Canonical URL](https://developers.google.com/search/docs/crawling-indexing/canonicalization)
- [Google — noindex kuralı ve robots engeli](https://developers.google.com/search/docs/crawling-indexing/block-indexing?hl=tr)
- [KVKK — Aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)

## Bir sonraki işletmeci kararı — `AFTER_VOTE`

Soru: **Anket sahibi "oy verdikten sonra göster" seçmişse**, misafir sonuçları da anında görebilsin mi?

- **A (önerilen/geçiş için güvenli):** Eski/özel `AFTER_VOTE` seçimi korunur; misafirler yalnız açık sonuçları görür. İleride yeni anketlerde varsayılan `ALWAYS` ayarı değerlendirilebilir.
- **B:** V1'de tüm public anketlerin sonuçlarını (AFTER_VOTE dahil) herkese aç; yazarların eski tercihlerinin değiştirilmesi için sürümlü duyuru/uyum planı ve veri minimizasyonu/mahremiyet incelemesi **önce** yapılır.

**Şimdiki teslim:** Kod adayı + test ve hukuki teknik rehber. #318 yaş, #323 üçüncü kişi gizliliği, #52 SEO, #53 bağımsız regression, #285 hukuk ve #54 yayın GO açık. Üretim, gerçek kullanıcı veya ücretli altyapı değiştirilmedi.
