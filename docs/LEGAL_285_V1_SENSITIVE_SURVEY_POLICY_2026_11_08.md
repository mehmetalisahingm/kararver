# KararVer V1 — Hassas kişisel veriyi ortaya çıkarabilecek anket politikası

**Kesin ürün kararı:** Mehmet · **8 Kasım 2026** · **Kapsam:** KararVer'in ilk herkese açık sürümü.

KararVer V1'de **kişilerin siyasi görüşünü, dinini, sağlık durumunu, etnik kökenini, sendika/dernek üyeliğini, cinsel hayatını, ceza mahkûmiyetini, biyometrik/genetik bilgilerini ya da benzeri hassas kişisel verisini açıklamaya yönlendiren anketlere izin verilmeyecek.** Kullanıcıya bunu dolaylı olarak seçeneklerden çıkarmayı sağlayan anketler de ürün politikası dışındadır. Bu karar gönüllü rıza kutusuyla otomatik aşılmaz.

**Önemli kapsam ayrımı:** Konuyla ilgili her genel haber, akademik açıklama veya kamu hizmeti tartışması kişinin özel nitelikli verisi sayılmaz. Örnek: “Hastane randevu sistemi nasıl geliştirilmeli?” genel hizmet sorusudur. “Hangi hastalığın var?” kişinin sağlık bilgisini toplar. İlk sürümün **anket** kapsamı hakkında bir ürün kararıdır; siyasete/dine/sağlığa ilişkin her genel tartışmanın mutlak hukuki yasağı şeklinde sunulmaz. Yeni tartışma gönderilerinde de katılımcılardan hassas bilgi istenmesine izin verilmez.

## KVKK ve sınır

6698 sayılı Kanun m.6'da özel nitelikli veriler sınırlı sayılmıştır. Kategoriler: ırk/etnik köken, siyasi düşünce, felsefi inanç, din/mezhep/diğer inanç, kılık ve kıyafet, dernek/vakıf/sendika üyeliği, sağlık, cinsel hayat, ceza mahkûmiyeti/güvenlik tedbirleri, biyometrik ve genetik veri. **Kanun kategorileri genişletilmez**; KararVer'in ürün kapsamı bazı riskli çıkarımları daha sıkı biçimde engelleyebilir. 2024'te m.6 işleme şartları değişmiştir. Bu nedenle “özel nitelikli veriler hiçbir koşulda işlenemez” gibi yanlış genel bir ifade kullanılmaz. **KararVer V1 bunları anketle istememeyi seçmiştir**, olası işleme şartı var diye otomatik açılmaz.

Kaynaklar:
- [KVKK — Özel Nitelikli Kişisel Veriler](https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler)
- [KVKK — 2024 tarihli özel nitelikli veri işleme rehberi duyurusu](https://www.kvkk.gov.tr/Icerik/8184/Ozel-Nitelikli-Kisisel-Verilerin-Islenmesine-Iliskin-Rehber)
- [KVKK — Aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)

## Aday teknik uygulama

| Yüzey | Yeni hazırlık | Durum |
| --- | --- | --- |
| `POST /v1/polls` | API isteğinde başlık, açıklama, ek bilgi ve cevap seçeneklerine sunucu denetimi; algılanan doğrudan hassas kişisel veri sorusu, puan harcanmadan ve DB'ye eklenmeden `400 VALIDATION_ERROR` + genel mesaj | Bu PR'da hazırlandı; CI/staging ve bağımsız review bekliyor |
| `PATCH /v1/polls/:id` | Yayından sonra başlık/açıklama/seçenekle benzer politika ihlaline dönüşüm engeli | Bu PR'da eklendi; önceden yayımlanmış içerik ayrıca insan incelemesi gerektirir |
| `POST /v1/polls/:id/addenda` | Ek açıklama yoluyla sonradan “hassas kişisel bilgini yaz” çağrısını engelleme | Bu PR'da hazırlandı |
| Yeni `DISCUSSION` gönderisi | Anket yerine tartışma gönderisi açarak doğrudan hassas veri isteme girişimini engelleme | Bu PR'da hazırlandı |
| Web oluşturma ekranı | Politika erken ve erişilebilir biçimde anlatılır; **güvenlik yalnız frontend'e bağlı değildir** | Bu PR'da hazırlandı |
| Mevcut eski gönderiler | Yayınlanmış ve kişisel veri içerebilen anket, oy, açıklama ve seçenekler ayrı **erişim kısıtı / insan inceleme / itiraz** kapsamında | Henüz envanter ve gerçek moderasyon taraması yapılmadı; **NO-GO** |
| Yorumlar, yüklenen görseller, OCR içeriği, medya, arama/OG, profil/DM, topluluk akışı, üçüncü taraf medya | Sırf bu sözcük-temelli API kontrolüyle kapsanmaz; ayrı moderasyon/depolama/veri minimizasyonu testleri gerekir | **Açık zorunlu kabul** #183/#290/#53 |
| Puan/vote ve sonuçlar | Anketin varsayılan herkese açık sonucunda (PR #325) küçük gruplar ve hassas oy çıkarımının yeniden kimliklendirme riski bulunabilir | **#321 anonimlik/suppression + #285 hukuk kabulü açık** |

### Otomatik tespit sınırlaması

`sensitive-policy.ts` **kapalı, belirli dil kalıplarını** engeller. Türkçe aksanları normalize eder; açıkça hassas bilgi soran sorularda ve cevap seçeneklerinden kişisel özellik çıkarıldığında işaretleme yapar. Bu **kapsamlı bir NLP/ML sınıflandırması değildir**; yazım hatası, örtük metafor, ekran görüntüsü/medya yazısı, tüm diller, bağlam ve karmaşık eşleştirmeler kontrol dışına çıkabilir. Tek başına “tüm hassas anketleri kesin engelliyoruz” iddiası kurulamaz. Hatalı reddetmeler için itiraz yolu ve insan incelemesi gerekir; kullanıcıların girdiği ham veri, tespit sonucunda **GitHub loglarına veya hata cevaplarına yazılmaz**.

**Ürün kararı doğrultusunda gerçek yayında güvence:** Bütün yeni anketleri daha güçlü moderasyonla ilk aşamada **yayın öncesi kontrol** kapsamına alma veya eşdeğer insan-onaylı başka tasarım, önceden yayımlanan/işaretlenmemiş potansiyel hassas anketleri ve oyları sessizce teşhir etmemek, görsellerde hassas veri bulunmadığını incelemek. Bu kontrol sadece kelime listesi değil, gerekli insan/operasyon kanıtı olmalıdır.

### Kabul/test matrisi

- [ ] Aynı API head SHA'da yeni anket/create, edit, addendum ve discussion reddi; istek anonim/trusted fark etmeden **server kontrolü**, puan/DB/olay harcaması sıfır.
- [ ] Uygun normal anket ve genel kamu hizmeti tartışmaları yanlışlıkla reddedilmiyor; Türkçe karakterler, büyük/küçük harf, seçenekle kişisel özellik çıkarma, farklı alanlar ve bypass senaryoları testli.
- [ ] Görseller/OCR, yorumlar/cevaplar, kullanıcı profilindeki bireysel açıklamalar, eski anket verisi, public sonuç/farklı rapor akışları, API search/feed/SEO/cache/CDN için **gerçek moderasyon kabul** prosedürü ve riskli içerik saklama/erişim/imha kararı.
- [ ] Haksız moderasyon kararında insan incelemesi ve ilgili kişi/şikâyet kanalı #290 ile erişilebilir; başka kişinin özel bilgileri ifşa edilmez.
- [ ] Yeni politika gereği hesap/oy bağlantılarının çıkarım riski, reklam/sponsor/gelir olmaması, 18+ ve misafir erişimi kararlarıyla (#318/#319/#324/#325) uyumlu şekilde test edilir.
- [ ] Gerçek staging + sentetik/Postgres testleri; aynı SHA + hukuk metin onayı #285, içerik/moderasyon #183/#290, regresyon #53, yayın GO #54.

**Mevcut kullanıcı içeriklerini topluca kaldırmak/silmek veya production moderation/flag açmak için otomatik yetki yoktur.** Potansiyel hassas içeriği kamuya yazan kullanıcılar, üçüncü kişiler ve hukuki saklama yükümlülükleri ayrı değerlendirilmelidir.

**DURUM: DRAFT / NO-GO.**
