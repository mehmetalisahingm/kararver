# #365 — mevcut hesap için erişilebilir 18+ beyanı

10 Kasım 2026. Bu frontend teslimi #355 head `7f85a53edca6c5066c8d0ab3b53604d2c793f4d9` üstündedir; backend migration/özellik anahtarı veya canlı hesap değiştirmez.

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

İstemci testleri 7/7; üç motorda 360/390/1440px matrisi motor başına 30/30 (toplam 90/90). Klavye seçimi, axe, reduced-motion, overflow, 2x CSS zoom, server/network/403 hatası ve retry, POST sonrası session expiry ve iki sekmede tek beyan kontrol edildi. Login sırasında ilgi seçimlerinin tek kez kaydı ve expiry olursa seçimlerin korunması ayrıca doğrulandı. Ekran görüntüleri `adult-results/<motor>` altında ve CI artifact'ındadır; gerçek şifre/cookie/token içermez. Chromium Windows Edge motorudur; WebKit fiziksel Safari değildir. Yerel kontroller aynı çalışma ağacında yapıldı; kesin head SHA ve birleşik CI sonucu PR kontrollerinden doğrulanmalıdır.

Foundation mevcut 360/1440 durum paketine ek olarak üç motorda 390px komutunu çalıştırır.

## Açık kabul kapıları

#355 hâlâ bağımlılıktır. `LEGACY_ADULT_DECLARATION_ENFORCED` aday backend'de varsayılan kapalıdır; gerçek katılım reddi/migration ve bu anahtarın aynı sürümde açılması backend/owner kabulüdür. Bu PR anahtarı açmaz veya API yetkisi yerine istemci kontrolü kullanmaz. Canlı aynı-SHA staging ve fiziksel iPhone/Safari/VoiceOver, Android/TalkBack, NVDA bu yerel çalışmada yapılmadı. #365/#191/#48 bu kanıtlarla otomatik kapanmaz; production GO verilmez.
