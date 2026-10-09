# KV-45 / #47 — Kapalı beta başlangıç paketi (hazırlık)

**Başlangıç:** 8 Ekim 2026 · **Teslim sahibi:** Mehmet · **Güvenlik kapısı:** Utku, #46 · **Teknik/yayın kanıtı:** Mert, #53 · **UI/cihaz:** Ümit, #48.

**Aşama: HAZIRLIK.** Davet gönderildiği, gerçek kullanıcı testi yapıldığı veya beta kapısının açıldığı iddia edilmiyor. #46 açıkken davet, harici katılım, üretim verisine test kaydı veya public rollout **yok**.

## 1. Beta açma kapısı (NO-GO varsayılan)

Güvenli davet için şu kayıtlar gerekir:

- [ ] Utku, #46 üzerinde gerçek staging auth, sonuç gizliliği, oyda 20 paralel işlem, RBAC/admin, topluluk izolasyonu, rate limit, medya moderasyonu ve kritik/yüksek açık hata taramasını kanıtladı.
- [ ] Mehmet/Mert #53 kanıt matrisindeki beta açısından kritik yol için commit + Vercel/Railway deploy sürümlerini aynı sürüme eşledi.
- [ ] Ayrı test ortamında hesap açılışı, doğrulama, session/logout, hata mesajları, yeni kullanıcı 20 puan + yayın 10 puan, medya ve bildirim altyapısı doğrulandı; engelleyici bulgu için sahip atandı.
- [ ] Test kullanıcılarına açıkça beta olduğu, verinin nasıl kullanılacağı ve geri bildirimin nasıl paylaşılacağı belirtildi; erişim yalnız davetlilerle sınırlandı.
- [ ] Test içeriklerinin gerçek analitik/verilerden ayrılma yöntemi belirlendi; onboarding demo oyu ve fixture'lar gerçek oy/puan/funnel olarak sayılmadı.
- [ ] Hata bildirim kanalı ve günün sorumlu operatörü belli; kapatma/geri alma ve katılımcı bilgilendirme planı var.
- [ ] Kayıtların kamuya açılması, gerçek kişisel verinin issue'lara konması ve production'a davetle yönlendirme için ayrıca karar gerekecek.

**Öncelikli engeller:** #46 güvenlik kabulü, #48 cihaz/gerçek 500 kabulü, #44 zamanlanmış içerik/bildirim, #42 ayarlar, #51 worker/public storage ve prod gözlemi; bu liste yeni kanıtla değişir.

## 2. Hedef kitle ve davet hunisi

**Hedef:** 30–50 *davetli*; ölçümde **davet edilen / katılan / ilk aksiyonu yapan** ayrı sayı. İlk taslak kota **40 kişi** (tamamı öneridir, gerçek kullanıcı değil):

| Segment | Davet hedefi | Neden |
| --- | ---: | --- |
| Yeni kullanıcı / ürünle ilk kez tanışan | 16 | İlk açılış, kayıt ve anlaşılabilirlik |
| Sosyal etkileşimi yoğun kullanan | 10 | Oy, yorum, tepki, paylaşım |
| Gönderi üretmeye istekli | 8 | Fotoğrafsız tartışma/anket oluşturma ve puan |
| Pilot topluluk moderatörü/yöneticisi | 6 | Topluluk üyeliği, yetki ve keşif |
| **Toplam** | **40** | Hedef aralık 30–50 içinde |

Segmentler işlevsel test rolleridir; hassas profil bilgisine göre ayrım veya kişisel bilgilerin GitHub'a yazılması gerekmez. Tek bir katılımcı birden fazla senaryoyu deneyebilir; davet sayısında tekil sayılır. Önerilen **en az iki pilot topluluk sorumlusu** segment içinde seçilir; gerçek görevlendirme henüz yapılmadı.

**İletişim/izin:** Davetler kontrollü özel iletişim üzerinden yürütülür. GitHub'a isim, e-posta, telefon, oturum verisi, ses/video veya içeriği kişiyi ifşa eden kayıt koyma. Yalnız BETA-001 benzeri rastgele takma test kimliği, izin durumu ve toplulaştırılmış ölçümler kayıtlı olabilir. Katılımcının ayrılma/iletişimi durdurma isteğini süreçte karşıla; kayıt politikası ekipçe belirlenmeden gereksiz veri toplama.

| Hunide metrik | Tanım | Başlangıç |
| --- | --- | --- |
| invited | Davet gönderilen benzersiz kişi | Henüz kanıt yok |
| accepted | Daveti kabul edip katılım onayı veren | Henüz kanıt yok |
| activated | Gerçek hesapla ilk anlamlı aksiyonu tamamlayan | Henüz kanıt yok |
| first_poll / first_discussion | İlk anket / ilk tartışma yayını | Henüz kanıt yok |
| first_vote / first_comment / first_reaction | İlk gerçek etkileşim | Henüz kanıt yok |
| first_community_join | İlk başarılı topluluk katılımı | Henüz kanıt yok |
| D1 / D7 retention | İlk aktivasyon gününden 1 / 7 gün sonra geri dönen / olgun kohort | Ölçüm olgunlaşmadan sonuç yok |
| assistance_rate | Yardımsız bitirilemeyen görevlerin oranı | Henüz kanıt yok |

**Uyarı:** Demo onboarding seçimi, test fixture'ı, yönetici seed'i veya yapay bot etkinliği retention ve dönüşüm paydasına girmez. D7 sadece en az 7 tam günü tamamlamış gerçek kohortta raporlanır.

## 3. İçerik tohumu ve kategori takvimi

Tohum içerik yayını **henüz yapılmadı**. Başlangıç **taslağı:** seçeneğe dayalı 12 anket + fotoğrafsız 8 tartışma = 20 ayrı içerik; moderasyon, farklı kategoriler ve örnek sonucu gizleme senaryoları da düşünülür. Uygulamada 13 kategori bulunduğu daha önce staging kontrolünde görülmüştü; güncel kategori ID/adları API'den tekrar alınmalı, aşağıdaki tematik öneriler mevcut ID ile eşlenmeden gönderi yayınlanmamalı.

| Tema önerisi | Örnek anket sorusu | Örnek fotoğrafsız tartışma |
| --- | --- | --- |
| Teknoloji | “Günlük notlar için hangi aracı seçersin?” | “Bir uygulamada ilk bakacağın güven işareti nedir?” |
| Eğitim | “Yeni beceri öğrenirken video mu metin mi?” | “Grup projelerinde iş paylaşımı nasıl iyileştirilir?” |
| Spor | “Haftada 3 gün mü 4 gün mü antrenman?” | “Takım sporunda iletişimi nasıl kuruyorsun?” |
| Oyun | “Tek oyunculu mu co-op mu tercih edersin?” | “İyi bir oyun açılışını ne farklı kılar?” |
| Yaşam | “Sabah mı akşam mı verimli çalışırsın?” | “Günlük rutininde değiştirmek istediğin bir şey ne?” |
| Eğlence | “Uzun dizi mi kısa sezon mu?” | “Arkadaşlarla aktivite seçerken neye bakarsınız?” |

**Önerilen yayın akışı (göreli, onay sonrası):**

| Evre | İçerik/iş | Ölçüm |
| --- | --- | --- |
| D-2/D-1 | Kategorilerin ve 2 pilot topluluğun kontrollü setup'ı, moderasyon/erişim provası | Gerçek API ve audit kabulü |
| D0 | İlk 6 anket + 4 tartışma; davetlilere görev yönergesi | Gösterim, ilk etkileşim, hata |
| D1–D2 | 4 anket + 2 tartışma; geri bildirim ve forum kontrolü | İlk katılım dönüşümü |
| D3–D4 | 2 anket + 2 tartışma; kalan kullanıcı yolu testleri | Yorum/topluluk/takip, moderasyon |
| D7+ | Olgunlaşmış ilk kohort raporu | D7 dönüş, kayıp noktaları, karara bağlanan buglar |

Her içerik için yayın sahibi, kategori ID, görünürlük, moderation state, izin verilen yorum/oy, başlangıç/bitiş, link ve kaldırma işlemi kanıt defterine eklenir. Gerçek kullanıcı içerikleri tohum gibi gösterilmez; admin seed sayısı net ayrılır.

## 4. Beta test kartları — yardım almadan kullanım

Sorumlu testçi için “yapılacak” değil, **hedef verilir**; nerede tıklandığı, nerede yardıma ihtiyaç duyulduğu ve gerçek hata kaydı tutulur. Test senaryoları gerçek staging üstünde çalışır; tehlikeli admin işlemleri izole yetkili hesapla.

| ID | Testçi görevi | Başarı ölçüsü | Takip |
| --- | --- | --- | --- |
| B01 | İlk ziyaretinde bir içerik bul | İçeriği açıp açıklamasını anlar; zorunlu popup çelişkisi not edilir | #144/#145 |
| B02 | Oy vermek isterken giriş yap, geri dön | Tek gerçek oy; login iptalinde taslak/konum korunur | #46/#48 |
| B03 | Yorum yaz, reply ve like/dislike değiştir | Gerçek veriye tek doğru kayıt, şeffaf UI feedback | #66 |
| B04 | Fotoğrafsız, seçeneksiz tartışma yayınla | 10 puan düşer; yayımlanan içerik görülür | #66/#67 |
| B05 | İki başarılı yayın sonrası bir üçüncü yayın dene | 20→10→0; üçüncü açık ret ve taslak kaybı yok | #67 |
| B06 | Anket oluştur, oy ver / sonucu incele | Oy ve sonuç gizliliği doğru | #46 |
| B07 | Kategori/trend/arama ile içerik keşfet | 5 trend çeşidi, filtre/etiket anlaşılır | #32/#52 |
| B08 | Kaydet, takip et ve bildirimi bul | Tek bildirim, unsubscribe/mute davranışı | #44/#48 |
| B09 | Topluluğa katıl/ayrıl, üye listesini gör | Üye görünürlüğü/rol doğru, özel bilgi yok | #33/#46 |
| B10 | Paylaşım bağlantısını aç | Yanlış sonuç, gizli/kaldırılan verinin OG sızıntısı yok | #52 |
| B11 | Yavaş internet veya API hata anında tekrar dene | Hata gerçek durumdan ayrılır, tekrar deneme güvenli | #48 |
| B12 | Klavye/ekran okuyucu ve 360px üzerinden dolaş | Taşma/odak/form etiketi/hareket azaltma kontrolü | #48 |
| B13 | Admin/moderatör olarak sınırlı iş yap | Yetki dışı başka topluluğa erişemez, audit mevcut | #46 |

Süre ve tamamlanma ölçümü kullanıcı oturumuna göre tutulur. Tavsiye edilen gözlem notu: **hedefe ulaştı mı / kaç tıklama / yardım istedi mi / beklenmedik durum / kanıt linki**. Kullanıcı ekran görüntüsü gerekiyorsa kişisel bilgi maskelenir, herkese açık issue'ya otomatik eklenmez.

## 5. Bulgu triage ve durdurma kriterleri

| Seviye | Örnek | İşlem |
| --- | --- | --- |
| P0 Kritik | Veri sızıntısı, izin yükseltme, topluluklar arası erişim, tekrar puan/oy suistimali | Beta derhal durdurulur; Utku + ilgili sahibi; gerekirse erişim kapatılır |
| P1 Yüksek | Giriş/oy/yayın çalışmıyor, sürekli hata, gerçek veri kaybı, medya karantina bypass | Yeni davetler durur; düzeltme/regresyon gelmeden devam yok |
| P2 Orta | Etkileşimi engellemeyen UI veya net kullanım darboğazı | Sahip ve test senaryosu ile issue; sonraki döngüde doğrula |
| P3 Düşük | Metin/düzen/kozmetik | Kayıt altına al; birleştirilebilir |

Her bulgu için **sahip**, **öncelik**, **ortam SHA**, **tekrarlama adımları**, **beklenen/gerçek**, **kanıt**, **düzeltme PR'ı**, **tekrar test sonucu** gerekir. Hassas bilgi içeren kanıt özel kayıt sistemine alınır; GitHub issue'suna yalnız maskeli özet/link girilir.

## 6. Günlük izleme / final beta raporu şablonu

| Tarih (UTC) | Web/API SHA | Davet / katılım / aktivasyon (tekil) | Yardımsız tamamlanan görev | P0/P1 açık | Yeni P2/P3 | Gözlem / owner |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — / — / — | — | — | — | — |

Final raporunda yalnız gerçekleşen sayıları ve hesaplama tanımlarını belirt; **davet hedefini gerçekleşmiş gibi sunma**. En çok bırakılan ilk üç adımı, tutulan metrikleri, negatif kullanıcı geri bildirimini, erişilebilirlik bulgularını ve ürün kararlarını #47'ye ve #53 kanıt matrisine bağla.

**Bitiş kapısı:** Hedef ve gerçekleşen davet ayrı raporlu, B01–B13'ten ilgili gerçek kullanıcı senaryoları kanıtlı, P0/P1=0, sahipli P2/P3 listesi güncel, en az bir tekrar test döngüsü tamam ve ürün/teknik kabul ayrımı kayıtlı. Bu şartlar sağlanmadan #47 tamamlandı işaretlenmez.

## 7. Davet metni taslağı (henüz gönderilmeyecek)

> Merhaba! KararVer'in sınırlı katılımlı testine davet etmek istiyoruz. Anketleri ve tartışma gönderilerini keşfedip oy, yorum ve topluluk gibi özellikleri denemeni; zorlandığın noktaları bize bildirmeni rica edeceğiz. Test sürümünde hatalar olabilir. Katılım isteğe bağlıdır; geri bildirimin ürün geliştirme için kullanılacaktır. Test erişimi ve veri/geri bildirim koşulları doğrulandıktan sonra ayrıntılı bilgiyi ileteceğiz. Katılmak ister misin?

Gerçek davet, güvenlik kapısı ve iletişim/kişisel veri çerçevesi kesinleşmeden kullanılmaz; **kimseye gönderilmedi**.

## 8. Sahipler ve ilk teslimler

1. **Mehmet (#47):** segment/davet kotalarını onayla, içeriği güncel kategori kimlikleriyle eşleştir, pilot topluluk sorumlularını belirle, takip şablonunu hazır tut.
2. **Utku (#46):** kapalı beta güvenlik kapısı için gerçek staging kanıtı ver; P0/P1 kriterlerini uygula.
3. **Mert (#53):** release kanıt ve SHA eşleştirmesini [KV-51](KV-51_RELEASE_EVIDENCE.md) belgesinde toparla.
4. **Ümit (#48):** fiziksel cihaz ve ekran okuyucu kabulünü yürüt, ilk ziyaret/login sürtünmesini ölç.
5. **Faruk (#51/#42):** worker, görsel public bucket, log ve ortam ayarlarını kapanış kanıtlarıyla kontrol et.

**İlgili işler:** [#47](https://github.com/mehmetalisahingm/kararver/issues/47) · [#46](https://github.com/mehmetalisahingm/kararver/issues/46) · [#48](https://github.com/mehmetalisahingm/kararver/issues/48) · [#53](https://github.com/mehmetalisahingm/kararver/issues/53) · [#54](https://github.com/mehmetalisahingm/kararver/issues/54).

## 9. Operasyonel ölçüm ve 20 içerik taslağı (9 Ekim 2026)

Hazırlık paketinin uygulanabilir sürümü: **[docs/beta/OPERATIONS.md](beta/OPERATIONS.md)**. 12 anket + 8 fotoğrafsız tartışmadan oluşan **henüz yayınlanmamış** içerik bankası: **[docs/beta/seed-content.example.json](beta/seed-content.example.json)**.

Yerel katılımcı ölçüm aracı `scripts/beta-report.mjs`; Node testleri `scripts/beta-report.test.mjs`; komutlar `pnpm beta:test`, `pnpm beta:report --participants beta-private/participants.json --tasks beta-private/tasks.json --bugs beta-private/bugs.json --as-of <UTC timestamp>`. Ham dosyalar yalnız gitignore'lu özel klasörde tutulur. D1 ve D7 sadece olgun kohorttan hesaplanır. Davet/senaryo/hata kayıtları için kişisel bilgi alanları kabul edilmez.

**Gerçek beta kabulü değişmedi:** #46 ve #51 ile yazılı GO olmadan davet veya gerçek içerik yayını yok; #47 açık kalır. Bu değişiklik yalnız G0 hazırlığıdır, gerçek davet/katılım/e-posta doğrulama/CI staging kabulü değildir.
