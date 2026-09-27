# KV-13 — App shell, auth ve oluştur/oy ekranları

Sahip: Ümit (@umitefe0) · Görev: #15 · Temel: ana dala alınan KV-01 ve KV-05.

## Teslim

`apps/web` artık KV-01'de seçilen Next.js App Router + React + TypeScript uygulamasıdır. Tasarım kitinin token/bileşen CSS'i ortak kaynaktan yüklenir; fotoğraflı kartların dört görseli dev/build sırasında kitin kaynaklarından public dizinine kopyalanır. `ui/design-system` silinmedi: mevcut önizleme ve #64'ün testleri bu dizine bağlıdır.

Misafir doğrudan akışı ve yorum örneklerini görür; ilk açılışta login popup'ı yoktur. Oy/yayın giriş gerektirir. İptal aynı sayfada kalır; giriş aynı içeriğe/seçime veya taslağa döner. Giriş hiçbir oyu/yayını otomatik göndermez. Yayın ayrıca maliyet/bakiye onayı ister.

İçerik türleri anket ve fotoğrafsız/seçeneksiz tartışmadır. Anket 2–6 seçenek, kategori, süre, yorum tercihi ve sonuç görünürlüğü alanlarını taşır. Yeni kapsam, #15'te bağlanan [V1 ürün kararı](https://github.com/mehmetalisahingm/kararver/blob/3b6a197/docs/V1_USER_FLOW.md) doğrultusundadır; PR #65'teki dosyalar bu PR'a kopyalanmaz.

## Çalıştırma

KV-01 Node 24 ve pnpm 10.34.5 ile, repo kökünden:

```sh
pnpm install
pnpm --filter @kararver/web dev:demo
```

Adres: `http://127.0.0.1:3000`. `dev:demo` yalnızca kendi alt sürecine `NEXT_PUBLIC_KV_DATA_MODE=demo` verir. Root `.env`, API, DB veya Docker gerekmez. Normal `dev`, `build` ve `start` demo modunu kendiliğinden açmaz. Etkin veri adaptörü verilmemiş ortamda işlemler yerine bağlantı-hazırlanıyor durumu görünür. Demo modu production kimlik doğrulaması değildir; gerçek yayında açılmamalıdır.

```sh
pnpm --filter @kararver/web typecheck
pnpm --filter @kararver/web test
pnpm --filter @kararver/web build
pnpm --filter @kararver/web exec playwright install chromium
pnpm --filter @kararver/web test:e2e
```

E2E komutu demo sunucusunu otomatik başlatır/kapatır; geliştirme sunucusu zaten açıksa yerelde kullanabilir. `KV_BROWSER_PATH` ile kurulu Edge/Chrome executable yolu verilebilir. Görsel tarayıcı testleri Chromium/Edge kapsamındadır; fiziksel cihaz ve Safari/Firefox kabulü değildir.

## Demo sınırı

- Hazır hesaplar: `umit@example.test`, `deniz@example.test`; şifre `Demo12345!`.
- Yeni kayıt yalnızca `.test` e-posta kabul eder. Doğrulama/sıfırlama kodu `123456`. Gerçek e-posta gönderilmez.
- Hesaplar, yalnızca demo parolaları, oturum, seçimler, taslak ve yayınlar tek tarayıcı sayfasının belleğinde tutulur. Yenileme hepsini sıfırlar. Cookie, localStorage, sessionStorage veya sunucuya gönderim yoktur.
- Sahte doğrulama kodu/oturumu/publish bakiyesi yalnızca UI testini sağlar. Güvenli token, parola hash'i, CSRF, DB transaction, ledger, abuse kontrolleri veya gerçek auth uygulaması değildir.
- İlk başarılı demo girişinde bir kez 20 puan, başarılı yayın başına 10 puan simüle edilir. Başarısız yayın bakiyeyi değiştirmez; aynı kimlikli tekrar yayın simülasyonda tek kayıt üretir. Bütün gerçek garantiler API/DB tarafında ayrıca uygulanmalıdır.
- Görsel yükleme, yorum yazma/cevap/like-dislike, kalıcı kaydetme, trend motoru, gerçek profil ve bildirim merkezi bu görevde yapılmadı. Diğer sahiplerin feature klasörlerine dokunulmadı. Navigasyondaki bildirim/profil yerleri açıkça sınırlı ekranlardır.

## API entegrasyon sınırı — KV-03 hâlâ açık

`src/lib/model.ts` **frontend view model** ve `ProductClient` arayüzüdür; onaylı wire sözleşmesi değildir. `src/lib/demo-client.ts` bunun geçici bellek içi uygulamasıdır. Uydurma endpoint'ler veya sahte HTTP backend'i eklenmedi. #64'teki ortak error/cursor/result başlangıcı incelendi, ancak henüz merge edilmemiş pakete bağımlılık kurulmadı. Gerçek istemci gelince `ProductProvider` adaptör oluşturma noktası değiştirilecek; ekranlar client arayüzünden çalışır.

| İşlem | Gerekli API sözleşmesi / sahibi | UI beklentisi |
| --- | --- | --- |
| Kayıt/giriş/çıkış/oturum | KV-03, KV-09 / Faruk | Güvenli cookie, süre/iptal, alan hataları, doğrulama durumu, bakiye |
| Doğrulama/sıfırlama | KV-09 / Faruk | Gerçek süreli/tek kullanımlı token, genel reset yanıtı, e-posta teslimi |
| Akış/detay | KV-03, KV-10 / Faruk | Public güvenli içerik projeksiyonu, durumlar, sayfalama; gizli sonuç sayaçlarını hiç vermeme |
| Yayın | KV-10 + V1 yayın puanı / Faruk | Seçenek/tartışma alanları, idempotency, maliyet, bakiye, atomik debit |
| Oy | KV-11 / Faruk | Tek aktif oy, tekrar istek, oy değiştirme politikası, kapanış ve sonuç gizliliği |

View model limitleri UI örnekleridir (10–140 başlık, 2.000 açıklama, 120 seçenek, 1 saat–30 gün). Sunucu limitleri kesinleşince sözleşmeden okunacak; frontend validation sunucunun yerine geçmez. Kaynak/ham DB nesnesi ekrana yayılmaz; `Results` discriminated union gizli durumda sadece `{ visible: false }` içerir. Özel sonuç güvenliği gerçek API/cache/HTML katmanında doğrulanmadan tamamlandı sayılmaz.

`returnTo` yalnızca `/`, `/olustur`, `/karar/<id>` yollarını kabul eder. Harici URL, protocol-relative yol, sorgulu hedef veya traversal reddedilir. Seçim/taslak provider'da tutulur; URL'ye parola/token yazılmaz. Şifre alanı başarılı işlemde temizlenir; loglanmaz.

## Ortak dosya ve bağımlılık etkisi

`apps/*` zaten workspace kapsamındadır. Root manifest/CI/env/DB değişmedi. Tek root `pnpm-lock.yaml`, pinlenmiş web bağımlılıklarını eklemek için güncellendi. Yeni root lock değişikliği PR kapsamının açık bir parçasıdır; KV-01 sürümleri korunur. #64 merge olurken lockfile'ın aynı pnpm sürümüyle tekrar üretilmesi gerekebilir.

## Tamamlanma kapısı

Bu PR #15'in **demo UI teslimidir**; issue otomatik kapatılmaz. Gerçek API, staging ve iki gerçek hesapla oluştur → oy ver senaryosu KV-03/06/09/10/11 tamamlanınca uygulanacak. Demo test başarısı gerçek kimlik/oy/puan güvenliği veya ürün kabulü olarak sunulmaz.

## Doğrulama sonuçları

- Node 24 / pnpm 10.34.5 ile üretim derlemesi ve TypeScript kontrolü başarılı.
- 7 adaptör testi başarılı: gizli sonuçlar, tek oy, puan/idempotency, hata sonrası tekrar, doğrulama/sıfırlama, doğrulama sınırları ve iki hesap ayrımı.
- 5 Playwright senaryosu başarılı. İlk çalışmadaki iki test seçicisi Next route announcer ile çakıştığı için main kapsamına alındı; iki başarısız senaryo yeniden çalıştırılarak geçti.
- 360 ve 1440 pikselde 8 rota için 16 axe denetimi; açık tema akışında ek denetim: toplam 17 denetimde ihlal yok. Yatay taşma ve modal klavye/fokus kontrolleri geçti.
- Masaüstü, mobil, açık tema ve giriş ekranı görsel olarak incelendi; görsel kontrol sırasında runtime hatası görülmedi.
- Demo değişkeni verilmeden production sunucusunda demo kapalı ekranı doğrulandı.
