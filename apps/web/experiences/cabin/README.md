# Ücretsiz 3D kabin

7 Kasım 2026. Ana sayfada önce onaylanan yörünge açılışı, ardından 3D kabin ve keşfet akışı bulunur. Ayrı kabin önizlemesi /deney/kabin adresindedir; ücretli servis açılmadı.

## Açma ve düzenleme

`pnpm --filter @kararver/web dev:demo` sonrası `/deney/kabin` adresi bağımsız `/experiences/cabin/index.html` sayfasını açar. Bu sayfa site oturumu veya API bağlantısı istemez. Kaynaklar bu klasördedir; `pnpm --filter @kararver/web build:cabin` statik çıktıları yeniler. Normal dev, demo ve üretim build komutları da bunu otomatik yapar.

Kabin, basınç kapağı, raflar, kumaş paneller, bağlantılar, astronot, elma, laptop ve kaplar Three.js ile ayrı gerçek geometriler olarak oluşturulur. Astronot özgün, parametrik bir basınç giysisidir; fotoğraf, insan taraması veya rig ile animasyonlanan hazır bir karakter değildir. Pencerenin dışındaki uzak Dünya görünümü, önceki onaylı görselden gelen bir arka plan dokusudur. İç mekânı veya hareketli nesneleri temsil eden görüntü düzlemleri kullanılmaz.

Kask ve cam yansımaları kabinden alınan küp haritasını kullanır. Sabit kamerada, gerçek kabin geometrisinin renk ve derinlik çıktıları önbelleğe alınır. Kamerayı çevirmek bunları yeniden hesaplar. Hareketli nesneler 3D olarak çizilmeye, kırılma ve zemin gölgesi üretmeye devam eder.

Son malzeme pasında, kendi 3D modelimizin render'larından yerleşik imagegen ile üretilen fotoğrafik kaplamalar kullanılır. Bunlar kabinin gerçek yüzeylerine derinlik maskesiyle, giysiye ise modelin yerel koordinatlarında uygulanır. Kamera veya astronot hareket ettiğinde yüzeyler perspektif ve örtüşmelerini korur; referansta görünmeyen yüzeyler asıl PBR kaplamayı kullanır. İnce dikiş, çizik ve kırışıklık detaylarının bir kısmı geometri değil dokudur. Bu, otomatik fotoğraftan 3D model çıkarımı değildir. Fotoğrafik kaplamanın ışığı kısmen sabittir; zemin gölgesi ve kask yansıması gerçek zamanlıdır.

## Etkileşim

- Nesneyi fare veya dokunmayla tutup sürükle; yumuşak kuvvet yayı ve sınırlandırılmış tork çarpışmaları korurken kontrolsüz dönmeyi önler.
- Yer çekimi düğmesi 0 g / 1 g arasında geçer. Elma sekmesi düşme yüksekliğine bağlıdır.
- Su ve süt, parçacık tabanlı ayrı akışkan çözücüleri ve hareketli yüzeylerle çizilir.
- Sıfırla başlangıç konumlarını ve akışkanları geri getirir. Hareketi durdur tüm simülasyonu durdurur.
- Kabini keşfet menüsünden klavyeyle nesne seç; ok tuşlarıyla hareket ettir, Escape ile bırak.
- Kamera yalnız Bakış açısı düğmesiyle küçük ve yumuşak geçişler yapar; boş alanda sürüklemek kabini döndürmez. Yalnız ortam seçeneği nesneleri gizler.
- Azaltılmış hareket tercihi başlangıçta simülasyonu durdurur. Kullanıcının yer çekimi, sürükleme veya tuş etkileşimi hareketi başlatabilir.

Fizik RAPIER, görselleştirme Three.js, paketleme esbuild kullanır. Üretim sırasında veya sayfa çalışırken fal, ücretli AI API'si, uzak model servisi veya abonelik çağrısı yoktur. Bu çalışma için yeni ödeme yapılmadı. Görseller yerleşik imagegen ile üretildi; WebP dönüşümü yalnız kayıpsız format dönüşümüdür.

## Dokular

Proje dosyaları `apps/web/public/experiences/cabin/textures/` altındadır:

- `nomex-quilt.webp`: mekik yalıtım kumaşı.
- `pressure-suit-fabric.webp`: giysi kumaşı.
- `apple-skin.webp`: elma albedo dokusu.
- `orbital-window.webp`: mevcut onaylı `art/space/orbital-earth-v2.webp` dosyasının kopyası.
- `room-photographic-bake.webp`: kendi kabin render'ımızın malzeme ayrıntıları geliştirilmiş sürümü; 3D yüzeylere uygulanır.
- `suit-photographic-bake.webp`: kendi astronot render'ımızdan üretilmiş giysi yüzey ayrıntıları; hareketli 3D modelin kumaş malzemesine uygulanır.

Tam üretim istemleri [texture-prompts.md](./texture-prompts.md) ve [finish-prompts.md](./finish-prompts.md) içinde. Reddedilmiş v5 modelleri ve ücretli fal iş akışı bu sürüme dahil edilmedi.

## Doğrulama ve sınırlar

- `node --test apps/web/test/cabin-physics.test.mjs`: 11/11 geçti; 0 g / düşme / zemin / sıfırlama, farklı yükseklikten sekme, kuvvetle sürükleme ve iki akışkanın sonlu kalıp parçacıklarını koruması.
- Web TypeScript kontrolü ve üretim build'i geçti.
- Paketlenmiş sürümde masaüstü 1440×1000 ve telefon görünümü 390×844 kontrol edildi. Telefon görünümünde yatay taşma yok; bu, fiziksel telefonda cihaz kabulü değildir.
- Gerçek fare hareketi elmayı seçip yer değiştirdi; ok tuşu kontrolü, durdurma, yer çekimi ve sıfırlama tarayıcıda kontrol edildi. Durdurulduğunda konum sabit kaldı. Yer çekimi açıldıktan sonra su ve süt zemine yayıldı.
- Tarayıcı kaynaklarının tamamı yerel sunucudandı. Üçüncü taraf ağ çağrısı ve konsol hatası görülmedi.
- Azaltılmış hareket tercihiyle başlangıçta duraklama doğrulandı. WebGL bağlam kaybı bilerek tetiklendi; yeniden deneme bağlantılı hata görünümü açıldı, sayfa yenilendikten sonra sahne tekrar yüklendi.
- Intel UHD Graphics üzerinde sabit kamera / 0 g sahnesinde kısa masaüstü ölçümleri yaklaşık 31–35 FPS idi. Kamera çevrilirken kabin yeniden çizilir; aynı hız garanti edilmez. FPS, pencere boyutu ve cihaz yüküne bağlıdır.

Bu gerçek zamanlı bir 3D yorumdur; fotogerçekçilik için kullanıcı görsel kabulü henüz alınmadı. Giysi çarpışmaları sadeleştirilmiş şekillerle, su/süt ise küçük bir PBF çözücüsüyle hesaplanır; bunlar bilimsel sıvı veya giysi simülasyonları değildir. Kabin, önceki giriş ekranının altında ayrı bölüm olarak yer alır.
