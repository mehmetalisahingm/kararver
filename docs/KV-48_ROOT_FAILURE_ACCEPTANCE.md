# KV-48: bağımsız kök hata ekranı ve kategori odağı

18 Ekim 2026, main `6620a9053bc3` üzerine frontend düzeltmesi.

## Sorun ve davranış

Kök layout/provider çöktüğünde `global-error.tsx` ortak CSS'i kullanamaz. Eski
mor fallback yeni ürün temasından ayrılıyordu; ana sayfa bağlantısının dokunma
hedefi ve belirgin klavye odağı yoktu. Bağımsız belge fildişi/antrasit/şampanya
paletine, sistem koyu moduna, UTF-8/title/viewport bilgilerine ve en az 44px
hedeflere sahip. Stil ve içerik için uygulama provider'ına veya stylesheet'e
ihtiyaç duymaz. Retry callback ve özel hata bilgisini gizleme korunur.

WebKit pointer/touch ile tıklanan kategori düğmesini otomatik odaklamadığı
için native dialog kapandığında odak düğmeye dönemiyordu. Ekle/düzenle/
aktiflik penceresini açmadan önce gerçek açan düğme odaklanır. Escape ve Vazgeç
sonrasında native dialog o düğmeye döner. API, rol, izin ve mutation değişmez.

## Kanıt

- Başlangıç geniş WebKit `matrix + notifications + onboarding`: 54 geçti,
  kategori dialog focus testinin desktop/mobile iki örneği başarısızdı.
- Düzeltme sonrası kategori testi WebKit desktop/mobile 2/2 geçti; test artık
  oluşturmanın yanında düzenle ve pasife alma için Escape ve Vazgeç dönüşünü de
  doğrular. Başarısız testin assertion'ı kaldırılmadı.
- Bağımsız fallback Edge/Chromium, Firefox 155 ve Playwright WebKit'te
  desktop1440/mobile360 toplam 6/6 geçti. Her örnek light/dark, reduced-motion,
  Tab sırası ve görünür focus, 44px hedef, taşma, başlık/lang ve axe WCAG
  2 A/AA/2.1 AA denetimini içerir.
- `node --test test/error-boundaries.test.mjs`: 2/2; gerçek retry callback
  çağrılır ve özel sunucu hatası kullanıcıya yazılmaz. Web TypeScript temiz.
- Yerel eski Firefox binary'si spawn UNKNOWN veriyordu. Resmi Playwright CLI
  ile ayrı çalışma alanına temiz kurulumdan sonra fallback testleri geçti.
  Bu bir uygulama kodu/CI hata düzeltmesi diye sunulmaz.

```powershell
# apps/web içinde; kurulu motoru KV_BROWSER ile seç
$env:KV_BROWSER='webkit'
node node_modules/@playwright/test/cli.js test -c playwright.fallback.config.ts
node node_modules/@playwright/test/cli.js test -c playwright.states.config.ts matrix --grep 'admin: connection'
node --test test/error-boundaries.test.mjs
```

`global-error.spec.ts` gerçek TSX belgeyi React ile render eder ve yerel
interception fixture'ı olarak sunar; uygulama sunucusu, root layout ve stylesheet
olmadan çalıştığını sınar. Aynı dosya normal states CI kapsamına da dahildir.
Bu sentetik tarayıcı testi gerçek staging sunucu 500 enjeksiyonu değildir.

## Açık kabul

#48, #190 ve #194 bu küçük düzeltmeyle kapanmaz. Gerçek staging 500/retry/recovery,
fiziksel iPhone/Safari/VoiceOver, Android/TalkBack ve NVDA, ilgili beta/release
kabulü ayrıca gerekir. SUPER_ADMIN işlevsel staging kabulünü Mehmet yapar;
bu testlerde yalnız sözleşme fixture'ları kullanıldı, gerçek rol yükseltilmedi.
