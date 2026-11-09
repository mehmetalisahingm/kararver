# #48 / #190 / #191 / #296 — tercih alanı yerleşim regresyonu

2 Kasım 2026. Mehmet'in #296 inceleme talebine devamdır; yayın veya hukuki kabul değildir.

## Değişiklik

CI `41299398302` Chromium onboarding 360px/full-motion ilk ekranda CLS `0.1653826904296875` bildirdi. Aynı adayın yerel başlangıç koşusu 5/5 geçti; bu nedenle aralıklı CI hatasının tek nedeni kesinleşmiş sayılmadı.

Ortak içerik sarmalayıcısı artık kısa route-loading fallback sırasında da en az ilk viewport kadar yer ayırır. Tercih footer'ı ilk boyamada görünürken uzun onboarding gelince aşağı itilmez. Tercih çubuğunun minimum alanı vardır; mobil canlı durum mesajı tetikleyiciden ayrı, önceden ayrılmış satırdadır. Uzun hata mesajları kesilmeden büyüyebilir. Panel kullanıcı işlemiyle açılır, otomatik açılmaz.

Onboarding kabulünün **CLS <= 0.1** eşiği, hareket ve klavye kontrolleri korunur. Ölçüm JSON'una kayma kaynaklarının yalnız element/sınıf/rect bilgisi eklenir; metin, form değeri veya kişisel veri yazılmaz.

Firefox reload koşusunda dinamik native `disabled` durumunun tarayıcı tarafından geri yüklenmesi hydration uyarısı üretti. Tetikleyici kararlı `aria-disabled` + işlem koruması kullanır; hazır olmadan açılmaz. Reload testleri hydration hatalarını ayrıca reddeder. Form alanlarının autocomplete davranışı değiştirilmez.

## Tekrar edilebilir yerel kanıt

- `playwright test test/browser/onboarding-acceptance.spec.ts`: Edge/Chromium, 1440/360px, full/reduced motion, 5/5. Dört yolculuğun altışar sahnesinde CLS 0. Test öncesi başlangıç koşusu da 5/5; CI kök neden iddiası değildir.
- `playwright test -c playwright.states.config.ts privacy-preferences`: Edge, Firefox, WebKit; desktop/360px, **18/18 PASS**. Geciktirilmiş JS ile ilk viewport alanı, hiç seçim olmaması, klavyeyle ret/kabul/özelleştirme/geri çekme, status/focus, 44px hedef, axe, taşma, form/returnTo korunması, reload sonrası ret ve kaynak kaydı temizliği. Son koşuda hydration hatası yok.
- `node --test test/privacy-preferences.test.ts`: 10/10; storage engeli, expiry ve geri çekme negatifleri dahil.
- `next build`: staging/API modu ve güncel Render hedefiyle PASS; TypeScript ve statik üretim geçti. `git diff --check` temiz.

Yeni fixture testinin ilk denemesi yanlış `UNAUTHORIZED` hata koduyla gerçek misafir durumunu temsil etmedi ve form beklerken zaman aşımına uğradı. Sözleşmedeki `UNAUTHENTICATED` ile düzeltildi; ürün auth davranışı veya assertion gevşetilmedi.

Yerel/fixture kanıtları staging, fiziksel Safari/iPhone/VoiceOver, Android/TalkBack veya Windows/NVDA değildir. #48, #191, #285–#287 ve beta/public GO açık kalır. #298 bu değişikliği aldıktan sonra kendi ortak layout'una sarmalayıcıyı taşımalıdır; birleşme sırası #296 ardından #298.

## Davranış notu

Kullanıcı aynı ölçüm onayını tekrar kaydettiğinde tercihin `updatedAt` değeri yenilenir. Bundan eski kaynak kaydı geçersizleşir; URL'de geçerli `src` varsa yeni izin zamanında yeniden yakalanabilir. Bu mevcut gizlilik davranışıdır; bu düzeltme ölçüm/saklama politikasını değiştirmez.
