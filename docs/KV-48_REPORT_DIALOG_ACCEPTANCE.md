# Rapor penceresi erişilebilirlik kabulü — 21 Ekim 2026

İlgili işler: #48, #192, #193. Başlangıç main: `c0aa932`.

## Düzeltilen davranış

WebKit'te “Bu içeriği raporla” düğmesine pointer ile tıklayıp Escape/Vazgeç
ile kapatınca odak düğmeye dönmüyordu. Başlangıç regresyon testi bunu
`toBeFocused` assertion'ıyla yeniden üretti. Açan düğme modal veya giriş kapısı
açılmadan odaklanır; rapor kapanışında odak, native dialog kapandıktan sonra
geri verilir. Arka planın inert olduğu sırada focus çağrılmaz.

Neden ve Not etiketleri inputlardan ayrılıp benzersiz id/htmlFor ile bağlandı.
Seçenek metinleri veya yazılan not alanın erişilebilir adına eklenmez; aynı
etiketle hata sonrası taslağa erişilebilir. API ve moderasyon davranışı değişmez.

## Testler

`test/states/report-dialog.spec.ts`, desktop1440 ve mobile360:

- Light/dark, modal adı, axe WCAG 2 A/AA/2.1 AA ve taşma; pointer ile açtıktan
  sonra Escape ve Vazgeç ile gerçek düğmeye focus dönüşü.
- İlk rapor isteğinde fixture HTTP 500: neden/not korunur; tekrar gönderme 202
  ile kapanır, odak döner, toplam iki istek vardır.
- Misafir: rapor gönderilmez; giriş kapısının returnTo değeri aynı içeriği
  gösterir; Escape sonrası rapor düğmesi tekrar odaklanır.

Komut: `KV_BROWSER=webkit playwright test -c playwright.states.config.ts report-dialog`
(Firefox/Chromium için KV_BROWSER değişir; Chromium yerelde sistem Edge ile koştu.)
Community/report client unit paketi 6/6, web TypeScript temiz.
WebKit, Firefox ve Edge/Chromium desktop/mobile toplam **18/18 geçti**.
İlk Edge koşusunda bir Next geliştirme JS dosyası `net::ERR_NO_BUFFER_SPACE`
ile yüklenmedi ve guest sayfa oturum kontrolünde kaldı. Kaynak değişmeden ayrı
koşuda altı test geçti; bu ortam hatası uygulama assertion'ı düzeltilerek gizlenmedi.

Bu testler yerel sözleşme fixture'larıdır. Staging'e rapor gönderilmedi; fiziksel
Safari/VoiceOver, TalkBack veya NVDA kabulü ve gerçek sunucu 500 toparlanması
değildir. #48 ve diğer ana issue'lar bu PR ile kapanmaz. #270 ayrı inceleme
bekler; bu değişiklik onunla aynı dosyaları değiştirmez.
