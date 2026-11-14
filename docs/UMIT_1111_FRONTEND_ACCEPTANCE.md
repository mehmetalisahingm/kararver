# Ümit — 11.11 frontend kabul paketi

10 Kasım 2026; #367 #368 #369 #370, ayrıca #48/#52/#189–#194. Aday, #347 head `3b3886082147964ab67aa8f2bd346e81d8855687` ile main `279b2e6bb07fcfc4f33327efcf277d1cb5a0717f` birleşimidir. Envanter çakışması çözülürken hem sağlayıcı akışları hem aynı-origin kabin iframe kaydı korundu. Kesin teslim SHA'sı PR head'i ve CI checkout/artifact adıyla izlenir.

## Düzeltmeler

- Yönetim ActionDialog'u pointer'ın tıklanan butonu focuslamadığı tarayıcıda gerçek tetikleyiciyi yakalar; dialog kapandıktan sonra focus döner. Bekleyen işlem Escape/Vazgeç ile kapatılamaz; API hatasında başarı bildirimi verilmez.
- Ürün kabuğu dışındaki 404/yayımlanmamış yasal ekranın geri dönüş butonu okunabilir kontrast kullanır. Boş keşfet ekranı ilk soruya gerçek yönlendirme sunar.
- Anonim API projeksiyonu taşıyan `/karar/` HTML'i client session yüklemesinin arkasında kalmaz. Özel ekranlar bu istisnaya dahil değildir; oy/yorum yetkisi değişmez.
- Root genel streaming loading sınırı kaldırıldı: kamuya açık içerikte varlık kontrolü tamamlanmadan 200 commit edilmiyor. Ekranların kendi yükleme/error/retry durumları korunur. Metadata da üretim modunda kayıp içerik için notFound kullanır.

## Tekrarlanabilir komutlar

`apps/web` içinde, Playwright motorları kurulu olmalıdır:

```text
KV_BROWSER=<chromium|firefox|webkit> playwright test -c playwright.release.config.ts
playwright test -c playwright.public-read.config.ts
tsc --noEmit
```

Release config 360/390/768/1440px, motor başına 40 case çalıştırır. Ayrı workflow üç motoru aynı checkout üzerinde çalıştırır; root Foundation'daki mevcut 401/403, MFA/çift onay, bütün ekran state'leri, iki sekmede tercih ve onaylı izole yasal metin testleri kaldırılmadı. Yeni testler eski pakette çift koşmamak için ayrı config'tedir.

| İş | Teknik kanıt | Gerçek kapsam sınırı |
| --- | --- | --- |
| #367 | Misafir/kayıt/USER tercih ret→kabul→geri çekme→reload; storage SecurityError ve quota; 2x CSS zoom, klavye/axe; anonim network-origin ve storage-key/cookie-attribute JSON | Varsayılan özel Playwright context'leri; sağlayıcı paneli, gerçek tarayıcı gizli mod politikaları veya hukuki onay değildir. Onaylı paket yokken placeholder yayımlanmaz. |
| #368 | 4 genişlik, reduced-motion, kontrast/axe, 44px temel kontrol hedefleri, modal dönüşü; mevcut loading/empty/401/403/500/retry matrisine ek | Fiziksel iPhone/Safari/VoiceOver, Android/TalkBack, NVDA ve beta GO yapılmadı. |
| #369 | 15 açık sentetik kartta API sırası, uzun başlık, medyasız görünüm ve gizli sonuç; empty/arama/profil/kategori/trend/doğrudan linkte eski içerik yok | Bunlar gerçek 15 anketin yayımlanması veya canlı toplu kaldırma değildir. CDN/OG cache purge, Search Console ve dış paylaşım servislerinin cache'i test edilmedi. |
| #370 | 409/429/500 ve browser timedout abort yetki recheck hatasında sıfır privileged read, açık retry; API reddedilen/bekleyen kritik modalda yanlış başarı yok | Test adapterindeki rol yanıtı gerçek rol verme değildir. Canlı SUPER_ADMIN/MFA ve bağlı güvenlik PR'larının işletim kabulü Mehmet'tedir. |

Yerel ilk release turu üç motorda 32/32 geçti. Ağ/çok ekran removal ekleri ayrıca üç motorda 16/16 doğrulandı; son 44px kontrolü ve root SSR düzeltmesi sonrası kesin birleşik sonuç PR/CI'dan okunmalıdır. Crawler suite gerçek localhost HTTP isteğiyle (JavaScript çalıştırmadan) public body+OG 200, removed 404+noindex/eski başlık yok, upstream 503'te gerçek 5xx kontrol eder; 3/3 geçti. Bu bir production Next build/staging testi değildir: `next dev` altında `APP_ENV=production` routing politikası ve izole HTTP API adapteri kullanır.

## Kanıt ve kapanış

Ekran görüntüleri, trace ve anonim tercih zaman çizelgesi `release-results` / `release-report` içindedir; CI artifact'ı SHA taşır. Crawler HTML'i yalnız sentetik fixture'dır. Gerçek token, signed URL, cookie değeri, hesap e-postası veya özel içerik artifact'a eklenmez. Gerçek veri/rol/moderasyon kararı değiştirilmedi; dosya yükleme izin reddi aşılmadı.

10 Kasım read-only staging kontrolü: canonical web bu ortamdan `Connection reset` / HTTP 000; Render `/health` HTTP 200, staging `aba2e4c2410d`, DB/worker sağlıklı. Bu farklı çalışan sürüm yeni adayın staging kabulü sayılamaz. #285 metin/işletmeci kararı, Faruk sağlayıcı/storage kabulü, aynı web/API SHA ve Mehmet'in SUPER_ADMIN/fiziksel cihaz kabulü olmadan ilgili issue'lar ve #46/#54 GO açık kalır. Merge Mehmet'te.
