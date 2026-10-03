> 3 Ekim: Güncel teslim ve kabul kapsamı aşağıdadır. "İlk demo teslimi" altındaki notlar tarihsel kayıttır; o tarihteki bekleyen bağımlılıkları anlatır.

## 3 Ekim — Gerçek medya ve sosyal API kabulü

#15, #18 ve #19 kapalıdır. Sosyal HTTP adapter'ı #79, bağımsız UI düzeltmeleri
#110 ile ana daldadır. Kalan yükleme akışı gerçek `media.uploads.create` → signed
PUT → `media.complete` → `media.get` üzerinden çalışır. Aynı dosyanın PUT hatasında
aynı idempotency anahtarı kullanılır; complete hatasında PUT tekrarlanmaz.

Doğrulanmış hesap en fazla 10 JPEG/PNG/WebP ekleyebilir (dosya başına 8 MB).
Sunucu limit ve sahiplik kontrolünün otoritesidir. Seçimler yayın hatasında korunur,
sıralanabilir ve taslaktan çıkarılabilir. Sayfadan ayrılınca dosyaları yeniden seçmek
gerektiği açıklanır. PENDING sınırlı aralıklarla kontrol edilir; ağ hatası ve uzun
incelemede manuel tekrar deneme vardır. QUARANTINED açıkça incelemede gösterilir;
REJECTED öğe kaldırılmadan yayınlanmaz. Yalnız onaylı medya public galeride görünür;
sahibine dönen private preview adresi DOM'a veya storage PUT isteğinin cookie'sine taşınmaz.

Galeri resim yüklenmesini, bozuk resim retry'ını, boş medya ve kaldırılan öğe sonrası
geçerli seçimi ele alır. Fiyat/ek bilgi, gizli/açık/kapalı/kilitli sonuç, yorum/yanıt/
alternatif, like-dislike, sahiplik ve iyimser geri alma önceki teslimlerle korunur.

### Doğrulama kaynakları

- `test/media/upload.spec.ts`: 1440px ve 360px'te üç senaryo (6 test); PUT/complete/
  publish hatası, aynı yükleme anahtarı, sıralı mediaIds, dosya doğrulama, pending/
  karantina/reddetme, status retry, private URL yokluğu, galeri loading/retry/klavye,
  axe ve taşma. API sözleşme fixture'larıyla UI testi; gerçek backend değildir.
- `test/social-backend.test.mjs`: gerçek HTTP ve PostgreSQL; iki hesap, medya
  upload/complete/owner kontrolü, bekleyen medyanın gizlenmesi, onaylı sıralama,
  reddedilenin kaldırılması, yorum/tek seviye cevap/alternatif, iki tür tepki,
  düzenle/sil/sahiplik ve gizli/kapalı/kilitli sonuç. Storage ve moderasyon geçişleri
  bu testte kontrollü test verisidir; worker veya gerçek S3 çalıştırıldığı iddia edilmez.
- `test/browser/social.spec.ts`: başarısız sosyal mutasyonlarda geri alma, taslak
  koruma, hesap ayrımı, galeri, mobil/açık tema ve reduced-motion regresyonu.
- Foundation CI: database işinde gerçek HTTP/PostgreSQL; integration işinde medya
  UI matrisi; web işinde sosyal regresyonlar. S3 ve worker kendi CI testlerinde doğrulanır.

Gerçek deployment S3 CORS/public bucket/worker ayarları #18 deploy notlarına bağlıdır.
Fiziksel cihaz, ekran okuyucu ve staging/beta kabulü #48/#47 altında kalır; #48 bu
teslimle kapatılmaz. Kapanışta son PR/CI bağlantısı #20'ye eklenir.

## İlk demo teslimi (tarihsel)

# KV-18 — Galeri, sonuç ve sosyal etkileşim arayüzü

Sahip: Ümit (@umitefe0) · Görev: #20 · Önkoşul: KV-13 UI, PR #68.

## Teslim ve çalışma sınırı

Anket/tartışma detayında galeri, örnek fiyat/ek bilgi, hareket azaltma tercihine uyan sonuç animasyonu, gönderi ve yorum beğeni/beğenmeme, yorum oluşturma, tek seviyeli cevap, kendi yorumunu düzenleme/silme ve ayrı alternatif öneri listesi bulunur. Silinen ana yorumun yanıtları korunur. Yorumların devamı dört ana kayıt halinde açılır; bu, bellekteki demo listelemedir ve gerçek cursor pagination değildir.

Misafir yorumları okuyabilir. Etkileşim giriş ister; modal iptali bulunduğu yerde kalır. Yorum/alternatif/cevap taslağı giriş boyunca korunur, giriş otomatik yayın yapmaz. Taslaklar içerik ve hesap bazında ayrılır; sayfa yenilendiğinde sıfırlanır. Başarısız yorum, düzenleme, silme ve tepkide iyimser görünüm geri alınır; düzenleme/yorum metni korunur. İşlem devam ederken ikinci mutasyon kilitlenir. Yorum/tepki yayın puanını tüketmez ve anket oyu sayılmaz.

Kilitli içerik okunur, etkileşimler kapalıdır. Oylama süresinin bitmesi yorumları kendiliğinden kapatmaz. `commentsEnabled=false` yeni yorum/yanıt/alternatif oluşturmayı engeller. Yeni boş tartışmalar, hata/tekrar deneme ve yüklenme durumları desteklenir.

Galeri klavye ile kullanılabilir. Demo fixture'ında incelemedeki/kaldırılmış görseller URL taşımaz; yüklenemeyen onaylı görsel için tekrar deneme bulunur. Örnek bütçe güncel bir fiyat/teklif değildir. Gerçek public yanıt yalnızca onaylı medya içermelidir; sahibine özel medya durumları ayrı yetkili uçtan alınır.

## Güncel sözleşme ile ilişki

28 Eylül'de ana dala alınan [KV-03 sözleşmeleri](https://github.com/mehmetalisahingm/kararver/blob/f23c836/docs/API_CONTRACTS.md), `packages/contracts/src/domains/comments.ts`, `polls.ts` ve `media.ts` incelendi. Bu dal, açık PR #68 üzerine kuruludur; ortak sözleşme/şema dosyalarını değiştirmez. Aşağıdaki modeller frontend view model'leridir; doğrudan HTTP gövdesi değildir.

| UI/adaptör işlemi  | KV-03 gerçek uç / dönüşüm                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getEngagement`    | `GET /polls/:id/comments?kind=COMMENT\|ALTERNATIVE&sort=new`; `GET /comments/:id/replies`. Üst yorumlar ve cevaplar ayrı cursor sayfalarıdır; demo tek snapshot döndürür.                              |
| `addComment`       | `POST /polls/:id/comments`: `text → body`, tür `COMMENT/ALTERNATIVE`, ana yorumda `parentId` atlanır. Tekrar istekte aynı Idempotency-Key kullanılır.                                                  |
| `editComment`      | `PATCH /comments/:id`, `{body}`. Sahiplik `viewer.canEdit` ile gösterilir, sunucu tekrar doğrular.                                                                                                     |
| `deleteComment`    | `DELETE /comments/:id`, 204; gerektiğinde ilgili liste yeniden okunur. Cevabı kalan silinmiş yorumda `body=null`, `author=null`, `deleted=true`.                                                       |
| `react`            | Gönderi/yorum için `PUT .../reaction` veya kaldırmada `DELETE`; UI `like/dislike → LIKE/DISLIKE`. Sayaçlar `reactions`, kişisel seçim `viewer.reaction` alanından gelir. #66 implementasyonu beklenir. |
| Galeri/fiyat/bilgi | `PollDetail.media`, `price.amount` (ondalık string), `extraInfo`, `addenda`; public medya yalnızca onaylıdır. Sahibine özel medya durumları `GET /media/:id` ile gelir.                                |
| Durumlar           | Wire `status=ACTIVE/LOCKED` ve `closed` ayrıdır; demo `CLOSED` view state kullanır. Gizli sonuçta yalnızca `{visible:false}` korunur.                                                                  |

Yorum metni sınırı sözleşmedeki 1–2.000 karakterdir. `COMMENTS_DISABLED`, `COMMENT_DEPTH_EXCEEDED`, `CONTENT_LOCKED` senaryoları demo adaptöründe temsil edilir. Fiyat taşınırken decimal string korunur, yalnızca biçimlendirme için sayıya çevrilir. Gerçek edit/delete doğal idempotency ve 204 yanıtı, görünürlük/moderasyon, yorum/cevap cursor'ları, hız sınırları ve oturum süresi hataları gerçek istemci katmanında uygulanıp ayrıca test edilmelidir.

Demo, `NEXT_PUBLIC_KV_DATA_MODE=demo` ile açıkça etkinleştirilir. Bellek içi hesap/yorum/tepki verisi kalıcı değildir; güvenli auth, DB, audit veya moderasyon uygulaması değildir. KV-13'teki hazır `.test` hesaplar ve çalıştırma komutları geçerlidir. Diğer modüllerin API, DB ve medya pipeline dosyalarına dokunulmadı.

## İnceleme akışı

1. `pnpm --filter @kararver/web dev:demo` ile aç; `/karar/tatil-rotasi` galeri, fiyat, açık sonuç ve sosyal alanı gösterir.
2. `/karar/ilk-bisiklet` üzerinde misafir yorum taslağı yaz; Paylaş → giriş → aynı taslağa dönüş. Paylaş'a tekrar basmadan kayıt oluşmaz.
3. Yorum/alternatif oluştur, tek seviye cevap yaz, beğen/beğenme arasında geç, kendi yorumunu düzenle ve sil. Alt yanıt silinmiş ana yorumun altında kalır.
4. Sağ alttaki Demo test araçları ile tepki, yorum, düzenleme, silme veya yükleme hatasını bir sonraki isteğe uygula; tekrar dene.
5. Diğer demo hesabına geç; önceki hesabın düzenleme/silme düğmeleri ve gönderilmemiş taslağı görünmez. `/karar/kilitli-anket` ve `/karar/kapali-anket` durumlarını karşılaştır.

## Kapanış kapısı

#20 bu demo teslimiyle otomatik kapatılmaz. PR #68, gerçek KV-16/KV-17 ve #66 servisleri, cursor listeleri, yetkili medya yanıtları ve staging üzerinde iki gerçek hesap kabulü beklenir. Canlı API bağlanmadan ürün kabulü veya sunucu güvenliği tamamlanmış sayılmaz.

## Doğrulama kanıtı

- Node 24 / pnpm 10.34.5 ile üretim derlemesi ve derleme içindeki TypeScript kontrolü geçti.
- 12 adaptör testi geçti: önceki KV-13 kontrollerine ek olarak tepkilerin oy/puandan ayrımı, yorum tekrarları, alternatif/cevap ayrımı, sahiplik, hata sonrası veri koruma, kapalı/kilitli durumlar ve medyada URL kısıtı.
- 9 Playwright senaryosu geçti (5 KV-13 regresyonu + 4 KV-18 senaryosu). İlk koşuda yakalanan düzenleme etiketi ve tema geçiş kontrastı düzeltildi. Yükleme iptalinin demo hatasını tüketmesi AbortSignal ile düzeltildi; etkilenen senaryolar yeniden çalıştırıldı.
- 16 temel rota/boyut + 4 galeri tema/boyut + düzenleme/silme modalı kontrolleri: 22 axe denetiminde ihlal yok. Klavye, Escape/fokus dönüşü, hareket azaltma, 360 piksel yatay taşma ve runtime hata kontrolleri geçti.
- İlave tarayıcı kontrolünde altı yorumun dört kayıttan devamı, boş alternatif listesi ve ağ hatasından sonra görseli tekrar yükleme doğrulandı. Mobil yorum alanı ve açık tema galeri çıktıları görsel olarak incelendi.
- Bunlar Chromium/Edge demo kontrolleridir; gerçek cihaz/Safari/Firefox ve gerçek API/staging kabulünün yerini tutmaz.

## 1 Ekim — #18 dışındaki UI/test tamamlaması

Yorumların sırası API sayfa dizisinden bağımsız olarak en yeni tarihten eskiye
kurulur. Public `addenda` açıklamaları İstanbul tarih/saat bilgisiyle gösterilir;
fiyatın decimal değeri korunur. Gerçek içerikte bütçe etiketi örnek veri demez.

`social-backend.test.mjs`, CI PostgreSQL üzerinde iki hesap ve gerçek HTTP ile
tekrar yorumun tekilleşmesi, yanıt/alternatif, tepki değiştirme/kaldırma, sahiplik,
düzenleme/silme, silinen yorumun yanıtı ve gizli/kapalı/kilitli durumları doğrular.
Veritabanı yokken açıkça atlanır; başarı kanıtı PR'ın CI sonucudur.

#18 kapsamındaki upload, karantina, medya pipeline ve sahibine özel medya
inceleme/retry entegrasyonu bu teslimde tamamlanmış sayılmaz. #20 bu bağımlılık
ve ilgili kabul tamamlanmadan kapatılmaz. Sosyal HTTP adapter'ı #79'da yer alır.
