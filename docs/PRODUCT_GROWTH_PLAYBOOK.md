# KararVer — Büyüme ve ilk kullanıcı ölçüm planı

> Eski #1 PR'ından güncel V1'e taşınan zamandan bağımsız ürün ve metrik önerileri. **İş sahipliklerinde tek kaynak [#2 görev haritası](https://github.com/mehmetalisahingm/kararver/issues/2)**; gerçek davetli sayısı veya doğrulanmış KPI olarak okunmamalıdır. Güvenlik #46 ve operasyon #51 kabulü olmadan kapalı beta açılmaz.

## 1.1 Kullanıcı kazanımı ve tekrar katılım

Farklı ilgi alanları ortak anket altyapısında kendine özgü soru şablonlarıyla sunulur: otomobilde fotoğraf/fiyat, eğitimde bölüm tercihi, oyunda ekipman karşılaştırması, üniversitede kampüs gündemi. Her kategori kendi soruları, topluluk önerileri ve kategori filtreli trendleriyle keşfedilebilir.

- **Keşfet → katıl:** Ziyaretçi herkese açık soruları, yorumları ve toplulukları girişsiz gezebilir. Oy/yorum için giriş yaptığında seçtiği ankete geri döner; bekleyen işlem onaysız gönderilmez.
- **İlgi seçimi:** Kayıtta atlanabilir kategori seçimi ve topluluk önerileri sunulur. Seçimler değiştirilebilir; seçim yapmayan kullanıcı çeşitli kategorilerden başlangıç akışı görür.
- **Paylaş → yeni katılımcı:** Anket ve topluluk bağlantıları kolay paylaşılır. Kaynak etiketiyle ziyaret → kayıt → ilk katkı ölçülür. Bağlantıyı açmak otomatik topluluk üyeliği oluşturmaz.
- **Katıl → geri dön:** Kullanıcı ankette “Sonucu takip et” seçebilir. Kapanış ve sahibinin karar güncellemesi uygulama içi bildirim üretir. Bildirim tercihleri, sessize alma ve olay başına tek bildirim bulunur.
- **Sor → ilk yanıt:** Yeni ve az oy alan sorulara sınırlı keşif payı ayrılır; aynı yazar/kategori akışı kaplamaz. Bu pay ve tekrar sınırı admin tarafından yönetilir.

## 1.2 İçerik ve topluluk başlangıcı

İçerik ve topluluk sorumluluğu için güncel yetkili görev dağılımı [#2 issue'sudur](https://github.com/mehmetalisahingm/kararver/issues/2); bu büyüme taslağı geçmiş sahiplik tahsisi yapmaz. Bütün kategoriler açık kalır; ilk davet/içerik çalışmaları ekibin erişebildiği birkaç üniversite ve ilgi topluluğunda yoğunlaştırılır.

- Hedef aşama 2: Her başlangıç kategorisine en az 5 özgün soru taslağı ve pilot topluluk sorumluları hazırlanır.
- Hedef aşama 3: Ekip içi alfa ile paylaşım ve ilk katkı denenir. Demo oyları gerçek kullanıcı verisi gibi sunulmaz ve production analitiğine karışmaz.
- Hedef aşama 4: Güvenlik/moderasyon kabulünden sonra 30–50 davetliyle kapalı beta hedeflenir. Bu bir hedef sayıdır, kazanılmış kullanıcı sayısı değildir.
- Hedef aşama 5: İlk oy, paylaşım ve tekrar ziyaret darboğazları düzeltilir; kategori bazlı içerik takvimiyle yayın hazırlanır.

Davet ve topluluk iletişimi ürün sorumlusunun koordinasyonunda ve güvenlik kabulünden sonra yapılır; her pilot topluluğun içerik ve moderasyon sorumlusu belirlenir.

## 1.3 Başarı ölçümü

Metriklerin gerçek sistem teslim sahipleri güncel #2 görev haritası ve alt issue'lara göre belirlenir. Ekip/test hesapları ayrılır. Aşağıdaki beta hedefleri test edilecek hipotezlerdir; kullanıcı kazanma garantisi veya tek başına yayın engeli değildir.

| Ölçüm | Tanım | Başlangıç hedefi |
| --- | --- | --- |
| İlk katkı | Yeni kayıtların 24 saatte en az bir oy veya yorum vermesi | %50+ |
| Yanıt alan soru | Yeni anketlerin 24 saatte yazar dışında en az 5 farklı katılımcıdan oy alması | %60+ |
| İlk oy süresi | Açılıştan yazar dışındaki ilk geçerli oya kadar medyan/p90 | Medyan 60 dakika altı |
| D7 katkı dönüşü | Kayıt kohortunun 7. gün yeniden oy/yorum vermesi | %15+ |
| Paylaşımdan katkı | Kaynak bazlı ziyaret → kayıt → ilk katkı | İlk beta ölçümü |

DAU/WAU, yorum alan anket oranı, kategori/topluluk dağılımı ve rapor çözüm süresi de izlenir. Oranlar pay/payda ve tarih aralığıyla gösterilir; 7 günü dolmayan kohort D7 olarak sunulmaz.

Güncel yürütme ve gözlem planı: [KV-45 Kapalı beta](KV-45_CLOSED_BETA.md) / [Beta operasyonları](beta/OPERATIONS.md).
