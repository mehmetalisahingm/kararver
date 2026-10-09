# #144 — Premium onboarding görsel kabulü

8 Ekim 2026. Başlangıç: main `cb93669`; #146 görsel teslim ve #149 (#145) entegrasyonu içerir.
Gerçek bileşen konumu `apps/web/src/features/onboarding/` klasörüdür.

## Tekrarlanabilir kanıt

`apps/web` içinde:

```sh
KV_BROWSER=webkit pnpm exec playwright test test/browser/onboarding-acceptance.spec.ts --output onboarding-results
```

Chromium ve Firefox için `KV_BROWSER` değiştirilir. CI üç motoru da çalıştırır.
Foundation checks içindeki `onboarding-chromium`, `onboarding-firefox`,
`onboarding-webkit` artifact'ları geniş ekran durumları testinden önce yüklenir;
başka bir modülün hatası onboarding kanıtını kaybettirmez.

Her 1440×1000 / 360×800 ve normal / reduced-motion birleşiminde:

1. `01-intro.png`: büyük marka, değer sorusu ve ana CTA.
2. `02-value.png`: değer önerisi.
3. `03-poll.png`: iki etkileşimli seçenek, açık demo açıklaması.
4. `04-result.png`: seçime uygun etiket, %68/%32 örnek dağılım ve devam çağrısı.
5. `05-interests.png`: seçili kategori ve görünür klavye odağı.
6. `06-login.png`: auth görsel devamlılığı ve giriş formu.

Her senaryoda başarılı çalışmanın `video*.webm` ve `trace.zip` dosyaları da saklanır.
Axe geçici sayfalar açabildiğinden birden fazla video olabilir; tam akış kaydı trace
ve sahne görüntüleriyle birlikte değerlendirilir. Görseller test verisi içerir;
demo kimlik bilgileri staging hesabına ait değildir.

## Denetlenen davranış

- Baştan sona yalnız Tab, Enter ve Space ile giriş ekranına ulaşılır. Test doğrudan
  `focus()` çağırarak bir erişim eksikliğini atlamaz.
- Her sahnede yatay taşma ve WCAG 2 A/AA + 2.1 AA axe kontrolü yapılır.
- Kontrole ulaşıldığında odak çizgisinin bulunduğu, sahne değişiminde başlığın odaklandığı doğrulanır.
- Reduced-motion altında onboarding ağacında çalışan animasyon kalmaz; seçim ve CTA'lar çalışır.
- İki demo seçeneği de sınanır. Geri dönüş kategori seçimini korur.
- Atlama ve kayıt bağlantıları klavyeyle ulaşılabilir; son adres login/signup olur.
- Destekleyen motorlarda `layout-shift` ölçülür; yakın kullanıcı girdisi dışındaki
  toplam kayma 0.1'i aşarsa test başarısız olur. Her sahnenin `*-layout.json`
  dosyası ölçümü, destek durumunu, viewport'u ve motor sürümünü kaydeder.
  Bu laboratuvar UI kontrolüdür; üretim Core Web Vitals veya fiziksel cihaz hız testi değildir.

## Görsel inceleme ve bulunan düzeltme

WebKit masaüstü ve 360px görüntülerinde tipografi hiyerarşisi, anket kartı,
örnek sonuç grafiği, kategori seçimi ve auth renk devamlılığı incelendi.
Yatay kesilme görülmedi. Uzun mobil içerik dikey kaydırılarak erişilebilir.
Klavye görüntülerindeki başlık/CTA çerçeveleri görünür odak kanıtıdır.

Tam klavye turu Windows WebKit ortamında giriş/kayıt bağlantılarının varsayılan
Tab turunda atlandığını ortaya çıkardı. Onboarding bağlantılarındaki açık
`tabIndex={0}` doğal sırayı koruyarak ulaşılabilirliği sağlar; pozitif tabindex kullanılmaz.

Yerel WebKit 5/5 ve Edge Chromium 5/5 kabul senaryosu geçti. Web typecheck geçti.
Firefox ve Linux motor sonuçları ilgili PR'ın CI artifact/job kanıtından okunmalıdır;
yerel Firefox veya fiziksel Safari testi yapıldığı iddia edilmez.

## Entegrasyon ve sınırlar

#149 içindeki desktop/mobil HTTP-fixture testleri ilk/geri gelen misafir,
oturumlu kullanıcı, deep-link, tek ilgi kaydı ve mevcut tercihlerin korunmasını kapsar.
8 Ekim staging tarayıcı kontrolünde açılış → demo → 13 gerçek kategori → login ve
geri gelen misafir devam ekranı doğrulandı (#144 issue notu).
Bu görsel testler gerçek staging auth/DB kabulünün yerine geçmez; #145'in gerçek
hesaba kayıt kabulü kendi kanıtıyla izlenir.

#48 fiziksel iPhone/Safari/VoiceOver, Android/TalkBack, NVDA, gerçek expiry ve
gerçek sunucu 500/recovery kabulü bu belgeden bağımsızdır ve açık kalır.

9 Ekim: dal güncel main e4446b1 ile birleştirildi; #160 modal odak düzeltmesi ve #163 auth retry düzeltmesi dahildir. Yeni CI sonuçları PR üzerinden izlenir.
