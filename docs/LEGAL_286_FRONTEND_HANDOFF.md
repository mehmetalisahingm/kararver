# #286 — onaylı metin yüzeyleri: ilk teknik dilim

1 Kasım 2026. Bu belge hukuki metin, hukuk görüşü, onay veya yayın GO'su değildir.
Bağımlı temel: Mehmet'in #296 / #287 tercih çalışması. Aynı layout'ta paralel
değişiklik yapılmaması için bu dal #296 dalının üzerine hazırlanmıştır.

## Uygulanan

- Onaylı kaynağa göre başlık/slug/sürüm/tarih/bölüm render eden salt okunur
  yasal bilgi dizini, güncel metin ve geçmiş sürüm yüzeyleri.
- `/yasal`, `/yasal/[slug]`, `/yasal/[slug]/[version]` teknik öneridir; kesin
  URL/başlıklar #285 paketinde onaylanmalıdır. Bilinen metinler/sürümler statik
  üretim listesine girer; bilinmeyen sürüm güncel sürüme sessizce düşmez.
- Bu namespace herkes içindir; ProductProvider/oturum geri yükleme kontrolünden
  bağımsız render edilir. Yönetim veya özel veri rotası bu namespace'e eklenmez.
- Ortak footer ve kayıt öncesi bilgilendirme bağlantıları yalnız tam, onaylı
  paket olduğunda çıkar. Yeni sekme/noopener/noreferrer ile kayıt taslağı ve
  returnTo bulunan ilk sekme korunur. Bunlar kabul kutusu veya rıza işlemi değildir.
- Açık/koyu sistem teması, semantik başlık/landmark, sürüm geçmişi, görünür skip
  ve focus, 44px bağlantılar, uzun metin ve 2x CSS yerleşim desteği.
- Metin React tarafından düz yazı olarak escape edilir; HTML çalıştırılmaz.
  Eksik işletmeci/iletişim/metin/onay, geçersiz veya gelecekteki tarih, yinelenen
  slug/sürüm ve aktif sürümü olmayan paket aktivasyonda reddedilir. Aydınlatma ve
  gizlilik gibi aynı kategorideki metinlerin ayrı belgeler olması desteklenir;
  bunların birleştirilmesine yazılım karar vermez.

## Bilerek etkin olmayan paket

`src/features/legal/published.ts` içindeki paket **null**. #285 üst kaydı ve
#296 belgesine göre başvuru adresi ve metin/saklama/sınıflandırma kararları hâlâ
açıktır. Gerçek işletmeci verisi, hukuki sebep, süre ve onay uydurulmadı;
kişisel Gmail kendiliğinden iletişim adresi yapılmadı. Bu durumda link/notice
gösterilmez, yasal route'lar not-found verir; taslak veya sentetik metin hukuki
kabul olarak görünmez. Next streamed not-found bazı yanıtlarda HTTP 200 taşır;
bu durumda not-found UI ve noindex ayrıca kontrol edilir.

Sentetik paket sadece `test/fixtures/legal.ts` içindedir. Uygulama bu dosyayı
import etmez. Onaylı paket, deployment ve gerçek staging aynı adayda ayrıca
doğrulanmadan bu hazırlık #286'nın tamamlanması sayılmaz.

## Backend sözleşmesi / ikinci dilim — Faruk ile gerekli

Mevcut kayıt sözleşmesine rastgele yeni alan eklenmedi; hiçbir istemci kutusu
kabul kanıtı diye saklanmadı. Aşağıdakiler sözleşme önerisidir, çalışan API değildir:

1. Sunucu aktif doküman kimliği/sürümü/içerik özeti ve **hangi işlem için hangi
   kabulün gerektiğini** yayımlar. Bildirim, sözleşme kabulü, ayrı açık rıza ve
   pazarlama tercihi farklı işlemlerdir. Gerekliliği #285 kararı belirler.
2. Gerekli sözleşme varsa UI ayrı, seçilmemiş ve sürüme bağlı kontrol sunar.
   Kayıt sunucusu checkbox=true veya istemci sürümüne güvenmez; aktif sürüm/özet
   ile gerekli işlemleri atomik olarak doğrular. Eksik veya eski sürüm kayıt
   oluşturmaz. Güncel metin döndürülür; taslak korunarak kullanıcı tekrar okur ve
   kendisi onaylar. Otomatik yeniden kabul/blanket rıza yapılmaz.
3. Gerekli delil minimaldir: hesap referansı, doküman/sürüm/özet, işlem türü ve
   sunucu zamanı; ham IP, oturum token'ı, parola veya gereksiz kimlik alanı yok.
   Gerçek veri modeli ve saklama kararı Faruk/#285 sözleşmesinde netleşir.
4. Metin değişince yalnız onaylanmış yeniden bilgilendirme/kabul politikası
   uygulanır. Geçmiş sürüm değiştirilmez; yeni sürüm ve onay referansı eklenir.
5. Frontend katalog ile sunucu aktif sürümü eşleşmeden zorunlu kabul UI'sı
   etkinleştirilmez. Bu PR backend receipt veya yeniden kabul akışı uygulamaz.

## Kabul sınırları ve kalanlar

- Yerel legal renderer/paket-yok erişim: üç motor × desktop/mobile **24/24**;
  ayrıca WebKit auth-recovery ve ortak shell **8/8**. Model paketi **18/18**.
  Render fixture'ı onaylı paketle gerçek staging veya hukuki kabul değildir.
- Staging değişkenleriyle production build ve TypeScript geçti. Son tipografi/
  paragraf aralığı düzenlemesi WebKit desktop/mobile 2/2 ile yeniden denetlendi.
- Model negatif testleri, bağımsız gerçek React renderer/HTML fixture testleri
  ve uygulamada paket yokken oturum API'sinden bağımsız erişim ayrı kanıtlardır.
- Script kapalı metin okuma/sürüm gezme bağımsız renderer fixture'ında test edilir.
  Onaylı paketli gerçek Next production/staging adayında JS kapalı erişim tekrar
  gereklidir; global loading boundary dev'de streaming kullanabilir.
- 2x CSS zoom fiziksel tarayıcı %200 zoom veya iPhone/Safari kabulü değildir.
- Onaylı metin ve iletişim paketi, gerçek backend eski/eksik kabul negatifleri,
  gerçek staging kayıt/geri dönüş ve cihaz/ekran okuyucu kanıtı beklenir.
- #284/#285/#286 ve #48 açık kalır. #270/#275 zaten main'dedir; tekrar yazılmadı.
- #296 önce merge edilir; sonra bu PR main'e alınır ve aynı aday sürümde kabul
  tekrarlanır. Ücretli servis/hesap, resmî başvuru, rol veya production ayarı yok.
