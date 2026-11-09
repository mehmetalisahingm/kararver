# KararVer V1 — Hesap ve kullanıcı içeriği silme politikası

**İşletmeci kararı:** Mehmet, 8 Kasım 2026. **İstenen ürün davranışı:** Kullanıcı hesabını sildiğinde **hesabı, yazdığı anketler ve yorumları silinsin**. Yalnız **gerçekten kişiye bağlanamayan toplu istatistikler** saklanabilsin. Amaç, içerik yazarını `Silinmiş hesap` diye gösterip orijinal kayıtları sonsuza kadar tutmak değildir.

**Durum: TEKNİK HAZIRLIK / NO-GO.** Bu belge mevcut kodun şartı karşıladığını ileri sürmez. Kişisel veri, yedek, e-posta, dosya ve sistem yetkileri üzerinde gerçek mutasyon yapılmadı. Teknik ve hukuki tamamlanma `#181 / #285 / #53 / #54` yayın kapılarına bağlıdır.

## 1. Kararın uygulanma kapsamı

| Veri | V1 hedefi | Sınır |
| --- | --- | --- |
| Hesap | E-posta, kullanıcı adı, profil, parola özeti, oturum, MFA, token, ilgiler ve ilişkili tercihler erişilemez/silinmiş olmalı. FK'ler için teknik tombstone yalnız zorunluysa ve ayrı kişisel veri taşımıyorsa kısa ve sınırlandırılmış tutulsun. | Süper admin/rol, açık hukuki saklama veya hak talebi varsa gerekçeli insan değerlendirmesi; hak başvurusu engellenmez. |
| Kullanıcının yazdığı anket ve seçenekler | Kamuya açık URL/SEO/OG/feed/search, metin, seçenek, sürüm, ek açıklama ve kişisel medya kaldırılır. DB'de kişiye veya içeriğe yeniden ulaşılabilir kayıt bırakılmaması tasarlanır. | Bağımlı üçüncü kişi oyları/yorumları ve yasal kayıtlar için referential-integrity + hak çatışması çözümü gerekir. Üçüncü kişinin verisi topluca silinmez. |
| Kullanıcının yorumları, cevapları, revizyonları ve tepkileri | Orijinal metin, geçmiş, ek dosya, görünürlük ve arama/cache bağlantıları kaldırılır. | Başkasının bağımsız içeriği ve hukuken sınırlı zorunlu kanıt ile ilişkisi ayrı değerlendirilir. |
| Oylar ve istatistik | Hesaba bağlı tekil oy/hareket dizisi kalmaz. Ancak istatistiksel, geri eşleştirilemeyen **toplulaştırılmış** sonuçlar uygun koşulla kalabilir. | `created_at`, `invalidated_at`, tekil `history`, `fingerprint`, çok küçük gruplar ve çapraz anket korelasyonu yeniden kimliklendirme riski açısından değerlendirilmeli. |
| Medya | Özel/orijinal, işlenmiş, public dosyalar ve CDN/cache etkisi dahil temizleme; reddedilmiş ve karantinadaki kopyalar da kapsamda. | Worker denemesi, başarısızlık alarmı ve `storage_cleaned_at` gibi **gerçek başarım kanıtı** olmadan tamam denmez. |
| Yedek ve geri yükleme | Saklama sınırı ve şifreli yedek kullanım politikası belgelenir; restore **izole** edilir ve silme listesi yeniden uygulanmadan açılmaz. | Yedek otomatik temizlendi varsayılmaz. Süre işletmeci + hukuk/operasyon kararıdır; masraf onayı değildir. |
| Denetim ve kanuni saklama kayıtları | Kanunen gerekliyse gerekçeli, amaçla sınırlı, asgari ve erişimi kısıtlı kayıtlar ayrı envanterde tutulur; reklam/ürün ölçümünde kullanılmaz. | “Yalnız anonim toplu istatistik” ürün hedefiyle istisnai kanuni saklama yükümlülükleri açıkça ayrılır. |

## 2. Mevcut koddaki doğrulanmış teknik farklar (8 Kasım kaynak incelemesi)

1. `apps/api/src/modules/account-erasure/content.ts` kullanıcının yazdığı `poll` ve `comment` kayıtlarını **`updateMany` ile `REMOVED`/tombstone yapıyor**; her satırı ve bağımlı anahtarlarını fiziksel silmiyor. Metin/revizyonları temizlemek önemli, fakat sahibinin istediği “anket ve yorumları sil” şartının **tam DB-satır silme** uygulaması değildir.
2. Aynı dosya, `anonymous_vote_groups` içine `created_at`, `invalidated_at`, olay `history` ve `fingerprint` taşır; `statistical_votes` ve `statistical_vote_events` görünümü o hassas ayrıntıları tekrar sunar. Kullanıcı ID'sinin düşmesi tek başına anonimlik kanıtı **değildir**.
3. `apps/api/src/modules/account-erasure/prisma-store.ts` kullanıcıyı tombstone'a çevirip oturum, token, tercih ve medya ilişkilerini iptal eder; yasal saklama, rol, aktif yaptırım, devam eden export için blokajlar var. Ancak audit, rapor, yaptırım, puan defteri ve benzeri kayıtlarda saklama hukuki gerekçesi ve süre henüz kapanmış değildir.
4. `apps/worker/src/jobs/account-erasure/cleanup.ts` medya dosyalarını **asenkron** siler; başarısız olunca yeniden dener. API `deleted` cevabı **storage cleanup doğrulaması** değildir.
5. `apps/api/src/modules/account-deletion/routes.ts` silme talebini parola, gerekirse MFA, e-posta bağlantısı ve açık onayla korur. `account.selfDeletionEnabled` varsayılanı **kapalıdır**. Hukuki kabul gelmeden bu bayrağı üretimde açma.
6. Yedek/restore, CDN/OG/arama önbelleği ve olay/audit retention için aynı aday SHA üzerinde kanıt yok. Gösterilen sayılar anonimlik veya silme ispatı değildir.

Bu PR'da **sadece** kullanıcıya/e-postaya doğru aşama bildirimi ve salt-okuma NO-GO analiz/testleri hazırlanır. Kontrolü gevşeten bir silme bypass'ı veya production kullanıcı temizliği yapılmaz.

## 3. Mühendislik uygulama planı / ayrı gerçek backend PR'ı

- **Faruk + Mert (DB/erasure):** Tüm inbound FK'leri (oylar, yorum/cevap, paylaşımlar, revizyon, yönetici işlemi, medya, rapor, audit, community, içerik jobs) Prisma + SQL şemasında dök. Yalnız ilgili kişiye ait ve silinmesi gereken satırları transactional + idempotent temizle. Üçüncü kişi hakları için yalnız minimum ilişkileri bırakıp gerçek kişisel bilgi bağını kaldır; gerekiyorsa tüzel/yasal kısımların ayrı legal hold politikasını kullan. Silinmiş hesap tekrar “canlı” yapılamasın.
- **Faruk + Utku (anonimlik):** Oyun ilk/son tarihini, fingerprint ve olay çizelgesini bire bir taşımayan gerçek aggregate tasarımı; ör. izin verilen anket bazında sadece toplu sayaç (gerekirse yeterli grup büyüklüğü, bastırma, yuvarlama, veri bağlama testi). Küçük/tekil seçenek, kronolojik hareket ve hassas kategorili anketlerde riskli çıktıyı yayımlama. Eski `anonymous_vote_groups` satırları ve raporlar için meşru migrasyon/yeniden üretim prosedürü belirle; bu geçiş otomatik sildirmez.
- **Mert + Ümit (uygulama/medya):** Silinmiş yazarın içerikleri URL, feed, arama, OG, sitemap, CDN ve browser cache'den düşmeli. Yanıt, vote ve topluluk sayaçları, thread reply ilişkileri tutarlı kalmalı. Ekranda saklama istisnaları ve asenkron temizlik dürüstçe açıklanmalı.
- **Faruk (depo, yedek, restore):** Kaynak/işlenmiş/public medya silme retry ve alarm, yanlışlıkla tekrar yayına alma engeli. İzole restore testinde silme kayıtları yeniden uygulanmadan okuma erişimi açılmamalı; yedek süresi ve hukuken gerekli istisnalar kaydedilmeli. #311 özel yedek PR'ının kanıtı gerekir, secret veya ücretli sistem açılmaz.
- **Mert + uygun hukuk incelemesi (mevzuat):** Kişisel veri kategorisi → hukuki şart → saklama / imha matrisi ve veri başvurusu e-postası. Hesaba erişemeyen kişiye de veri hakkı yolu. Kanunî kayıt/başvuru işlem logları için ayrı sınırlı saklama; süresiz audit/rapor korumasını otomatik hukuka uygun sayma.
- **Mehmet (nihai işletmeci kabulü):** Hukuki kaynak/retention/gerçek iletişim ve release kararını kendi adıyla verir. `karariniverdestek@gmail.com` adresinin gerçekten açılıp çalıştığı doğrulanmadı; yasal metne otomatik yayınlanmaz.

## 4. Kabul matrisi — yalnız sentetik kullanıcı, izole Postgres

- [ ] Silen hesabın kişisel e-posta, token, MFA, session, profil, ilgi/tercih, aktif içerik ve geçmişi kalmıyor; anonimliğin bozulabileceği ilişki, PII içeren audit JSON veya düzenlenmiş içerik payload kalmıyor.
- [ ] Yazılan anket, seçenek, yorum, cevap, revizyon, görsel, içerik işleri **karar kapsamına göre DB ve nesne depoda** siliniyor. Başkasına ait içerikler/saklanması gereken ayrı haklar korunup kamuya açıktan gerekirse kaldırılıyor.
- [ ] Çoklu kullanıcı, çok küçük anket, nadir hassas kategori, bir oy, zaman damgası ve iki anketi birleştirme denemelerinde aggregate başka verilerle eşleştirilerek kişiyi işaret edemiyor.
- [ ] Double submit, yarış, son SUPER_ADMIN, sahte link, expired token, yanlış MFA, legal hold, yaptırım, export-in-progress ve yetkisiz silmede işlem fail-closed, veri bütünlüğü bozulmuyor.
- [ ] Test DB'de silme sonrası yeniden kayıt, restore/rollback, cache/OG, yedek yeniden yayına açma negatif testleri ve worker başarısızlık/retry alarmı kanıtlı.
- [ ] Cihaz (mobil, gerçek tarayıcı), klavye ve ekran okuyucu, gerçek staging sha ve bağımsız hukuki onay kanıtlı. Sonrasında sadece #54'te Mehmet tarafından GO verilebilir.

## 5. KVKK kaynaklı hukuki çerçeve

[Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK):

- Madde 7: İşleme şartları ortadan kalkınca kişisel veriler silinir, yok edilir veya anonimleştirilir; **işlemlerin kaydı**, diğer yasal yükümlülükler saklı kalmak üzere **en az 3 yıl** saklanır. Bunun erişimi, içeriği ve dayanağı ayrıca minimizasyon ile kararlaştırılır.
- Madde 10: Anonimlik, başka kayıtlarla eşleştirilse dahi kişiyle ilişkilendirilememe şartını içerir; yalnız kullanıcı ID silmek anonimleşme garantisi değildir.
- Madde 12: İlgili kişinin silme/yok etme başvurusuna, işleme şartları ortadan kalkmışsa, **en geç 30 gün içinde** yanıt verilir. Şartlar ortadan kalkmadıysa reddin gerekçesi aynı sürede bildirilir; ilgili üçüncü kişilere gerekli bilgilendirme ve işlemler sağlanır.
- İşleme şartları ortadan kalkmış veriler için periyodik imha süreleri Madde 11 uyarınca ayrıca uygulanır; bu tarihler bir ürün yedek saklama kararı yerine geçmez.

**Önemli:** “Yalnız anonim istatistik” tercihi hukuken zorunlu asgari imha/işlem kayıtlarını yok etmek anlamına gelemez. Bu istisnalar kullanıcıya dürüstçe açıklanmalı ve yasal metinde kesin kanıt olmadan otomatik “tümü anında yok edilir” vaadi verilmemelidir.

## 6. Değişiklik tetikleyicisi ve izleme

`node scripts/erasure-policy-audit.mjs` güvenli **salt-okuma** kaynak analiziyle tespit edilen mevcut NO-GO başlıklarını raporlar; `--enforce` her zaman hukuki/gerçek staging kanıtı olmadığı için çıkış 2 ile merge/yayını durdurur. Bu test gerçek DB verisini silmez, bütçe/secret değiştirmez. Adı geçen denetimde 0 otomatik blocker çıkması bile *gerçek anonimlik veya mevzuat uygunluğu* belgesi değildir. 

**Karar gerektiren sonraki adım:** Yedeklerin operasyonel tutulma süresi (öneri: 7, 14 veya 30 gün) ve istisna/restore süreci. Bu karar kişisel verilerin yedeklerde sınırsız saklanmasına izin değildir; veri en aza indirme, yasal gereklilik ve maliyet onayı ayrıca değerlendirilir.
