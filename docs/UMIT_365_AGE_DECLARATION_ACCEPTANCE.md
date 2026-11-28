# #365 — mevcut hesap için erişilebilir 18+ beyanı

İlk teslim 10 Kasım 2026; güncelleme 17 Kasım 2026. Frontend #355 head `cde331391b92f7177873d722a08d164f274cbdcb` ve main `1850c7b` ile birleştirildi. Yeni studio teması, public SSR, WebKit form kontrastı ve hesap silme düzeltmeleri korunur. Backend migration/özellik anahtarı veya canlı hesap değiştirilmez.

## Davranış

- Yeni kayıt ayrı, başlangıçta boş 18+ checkbox kullanır; hukuki kabul veya isteğe bağlı rızayla birleştirilmez.
- Login içindeki mevcut beyan akışı tanıtım/ilgi alanı seçimlerini kaydetmeye devam eder. Eski oturumla katılım düğmesine basınca `/hesap/yas-beyani` açılır. Oluşturma ekranı beyan beklerken medya/form göndermez; kamuya açık okuma ve hesap hakları açık kalır.
- Devam rotası `safeReturnTo` ile iç rota olarak tutulur. Beyan POST'u yalnız açık seçimden sonra gider; devam için sonraki `/me` de beyanın tamamlandığını doğrulamalıdır. 401/null veya hâlâ-required yanıt başarı sayılmaz.
- Hata gerekçeyi/seçimi korur. Eşzamanlı gönderim kilitlidir; sekmeye dönüşte veya “Durumu tekrar kontrol et” ile sunucudan okunur. Yaş durumu localStorage'a yazılmaz.

## Yerel kanıt

`apps/web` içinde:

```text
node --test test/http-client.test.ts
KV_BROWSER=<chromium|firefox|webkit> playwright test -c playwright.adult.config.ts
tsc --noEmit
```

İstemci testleri 7/7; üç motorda 360/390/1440px matrisi motor başına 30/30 (toplam 90/90). Bu tarayıcı matrisi 17 Kasım'da güncel tema ve parent birleşimi üzerinde yeniden geçti; web typecheck geçti. Klavye seçimi, axe, reduced-motion, overflow, 2x CSS zoom, server/network/403 hatası ve retry, POST sonrası session expiry ve iki sekmede tek beyan kontrol edildi. Login sırasında ilgi seçimlerinin tek kez kaydı ve expiry olursa seçimlerin korunması ayrıca doğrulandı. Ekran görüntüleri `adult-results` altında ve motor bazlı CI artifact'ındadır; yerelde aynı output dizini yeniden kullanıldığında önceki motorun çıktısı korunmaz. Gerçek şifre/cookie/token içermez. Son Chromium koşusu kurulu Windows Chrome'u kullanır; WebKit fiziksel Safari değildir. Kesin head SHA ve birleşik CI sonucu PR kontrollerinden doğrulanmalıdır.

Foundation mevcut 360/1440 durum paketine ek olarak üç motorda 390px komutunu çalıştırır.

17 Kasım görsel kontrolde bağımsız beyan sayfasının checkbox etiketi 24.75px yüksek bulundu. Ortak `auth-card` form stili kullanılarak en az44px dokunma alanı ve görünür focus-within çerçevesi sağlandı. Regresyon, etiketin gerçek bounding box'ını ve checkbox dışındaki alt köşesine dokunarak seçim yapılmasını kontrol eder; klavye Space davranışı ayrıca korunur. Düzeltme öncesinde360px Chromium testi44px beklentisinde kırılarak bulguyu doğruladı.

17 Kasım staging ön kontrolü: canonical web bu ortamda hem terminal hem gerçek browser navigasyonunda bağlantı reseti verdi (`ERR_CONNECTION_RESET`); free-preview API health 20 saniyede yanıt vermedi. Bu erişim sonucu bir API 500 veya toparlanma testi değildir. Erişim reddi aşılmadı, hesap/rol/ayar veya TTL değiştirilmedi. Bu makinede mevcut NVDA çalıştırılabilir dosyası bulunmadı; fiziksel ekran okuyucu kabulü yapılmış sayılmaz.

## Açık kabul kapıları

### 19 Kasım inceleme düzeltmeleri

- Genel `requireUser` yalnız oturum ister. Yaş kapısı açıkça anket oluşturma ve oy/yorum gönderimine uygulanır; compose kapısı görsel yüklemeyi de kapsar. Kaydetme, tepki, topluluk üyeliği, raporlama ve hesap hakları yaş beyanına bağlanmaz. API yetki kuralları değiştirilmedi.
- API'nin kendi hesap projeksiyonuna `adultDeclarationEnforced` eklendi. Login, `/me` ve profil güncellemesi bu alanı gerçek session yayın anahtarından üretir; `adultDeclarationRequired` eksik beyanı anahtardan bağımsız bildirmeye devam eder. Yeni kayıt beyan şartı aynı kalır. Anahtar kapalıyken login/compose engellenmez; odak çalmayan hatırlatma ve isteğe bağlı beyan sayfasında “Şimdilik işlemime devam et” bağlantısı vardır.
- Eski API bu yeni alanı vermezse önceki koruyucu davranış sürer; yeni API ve web aynı adayda doğrulanmalıdır. Backend anahtarı bu değişiklikle açılmaz. API response sözleşmesi eki Faruk incelemesine tabidir.
- `/topluluk/<slug>` ve tek seviyeli `/hesap/yas-beyani?returnTo=...` dönüşü korunur. Dış URL, protokol-relative, ters bölü, dot-segment, kodlanmış ayraç, iç içe beyan dönüşü ve tekrarlı/ek query alanları kabul edilmez. Oturumu dolan beyan sayfasından login ve beyan sonrası topluluk dönüşü browser regresyonundadır.
- Yeni senaryolar: yaptırım açıkken kaydetme/rapor/üyelik çalışır ve compose kapanır; anahtar kapalıyken login/compose ve gönüllü beyan; expiry sonrası topluluk dönüşü. Önceki negatif beyan, seçimlerin korunması, hata/retry ve erişilebilirlik testleri kaldırılmadı. Kesin güncel test/CI sonuçları PR'da belirtilir; yukarıdaki 17 Kasım sayıları tarihsel kanıttır.

#355 hâlâ bağımlılıktır. `LEGACY_ADULT_DECLARATION_ENFORCED` aday backend'de varsayılan kapalıdır; gerçek katılım reddi/migration ve bu anahtarın aynı sürümde açılması backend/owner kabulüdür. Bu PR anahtarı açmaz veya API yetkisi yerine istemci kontrolü kullanmaz. Canlı aynı-SHA staging ve fiziksel iPhone/Safari/VoiceOver, Android/TalkBack, NVDA bu yerel çalışmada yapılmadı. #365/#191/#48 bu kanıtlarla otomatik kapanmaz; production GO verilmez.
