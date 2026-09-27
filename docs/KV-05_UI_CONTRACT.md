# KV-05 — KararVer ortak UI sözleşmesi

## Referans görsele uyarlama

Ümit'in 27 Eylül'de paylaştığı görsel doğrultusunda giriş sayfası, fotoğraflı anket akışı, kompakt trend/kategori panelleri, profil ve yönetim paneli görsel örnekleri eklendi. Girişte büyük manzara ve “Herkesin fikri var, karar senin.” başlığı; mobilde koyu yüzeyler ve dairesel mor oluştur eylemi kullanılır.

- İlk açılış `#home`; örnek akış `#feed`; profil `#profile`; yönetim görünümü `#admin`.
- Üstteki güneş/ay düğmesi açık/koyu tema arasında geçer; yenilemede koyu varsayılana döner. Tercih kalıcı saklanmaz.
- `reference.css` görsel uyarlama katmanıdır; ana vurgu `#653CFF`, açık temada arka plan `#F5F6FA`, yüzey `#FFFFFF` olur. Aşağıdaki ilk token sözleşmesinin üstüne bu tema değerleri uygulanır.
- Arama ve kategori seçimi yalnızca üç örnek anketi filtreler. Kaydet düğmesi yalnızca geçici görünümü değiştirir; backend veya yerel depolama kullanmaz.
- Yönetim/profil metrikleri örnek olarak etiketlidir; gerçek yetki, moderasyon, analitik, kullanıcı veya takipçi sistemi uygulanmaz. Ekip sahipliği korunur.
- Fotoğraf kaynakları `ui/design-system/assets/README.md` içinde; bütün dosyalar yerel sunulur. Yeni bir servis veya ücretli API entegrasyonu yoktur.

Sahip: Ümit (@umitefe0). İlgili görev: [#7](https://github.com/mehmetalisahingm/kararver/issues/7).

## Teslim ve sınır

`ui/design-system/` altındaki bağımsız HTML/CSS/JS önizleme, ürün planının koyu/mor tasarım yönünü çalışan bileşen örneklerine dönüştürür. Mert ve Mehmet kendi ekranlarında aynı token ve bileşen kurallarını kullanabilir. Uygulama framework'ü veya backend seçimi yapmaz; KV-01 teknoloji kararı açık olduğundan framework wrapper'ları daha sonra eklenir.

Bu bir uygulama veya API mock'u değildir. Hesap açmaz, oturum tutmaz, oy göndermez, veri saklamaz. Form yalnızca yerel doğrulama davranışını gösterir. `preview.js` ürün koduna taşınmaz. Gerçek ürün ekranları KV-13/KV-18/KV-30 kapsamında sözleşmelerle bağlanır.

## Çalıştırma

Repo kökünden:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory ui/design-system
```

`http://127.0.0.1:4173` adresini açın. Derleme veya runtime paket kurulumu gerekmez. `index.html` doğrudan dosya olarak da açılabilir. İnternet fontu, CDN, analitik veya üçüncü taraf görsel isteği yoktur.

## Katmanlar ve bileşen API'si

1. `tokens.css`: herkese açık CSS custom property'leri.
2. `components.css`: temel eleman kuralları ve `kv-` önekli bileşenler. Token dosyasını kendisi içeri alır. Global reset uygulama girişinde bir kez yüklenir; mevcut uygulamaya eklerken mevcut reset ile birleştirilir.
3. `preview.css`, `index.html`, `preview.js`: yerleşim ve etkileşim örnekleri. Hash navigasyonu yalnızca önizleme içindir.

| Bileşen | API / varyant | Tüketici sorumluluğu |
| --- | --- | --- |
| Button | `.kv-button`, `--secondary`, `--ghost`, `--danger`, `--icon` | İşlem için `button`, gezinme için `a`; ikon düğmesinde erişilebilir ad. Form dışı düğmede `type="button"`. |
| Pending button | `disabled`, `aria-busy="true"`, görünür `Kaydediliyor…` | Tekrar gönderimi önlemek, sonuç bildirimini canlı bölgede vermek. |
| Card | `.kv-card` | İçeriğe göre `article` veya `section`, başlık ilişkisi. |
| Form field | `.kv-field`, `.kv-input`, `.kv-help`, `.kv-field-error` | Benzersiz `id`, bağlı `label`, `aria-describedby`, `aria-invalid`; hata yalnızca renk değildir. |
| Checkbox | `.kv-checkbox` içinde native `input[type=checkbox]` | Etiketi tıklanabilir yapmak; Space davranışını korumak. |
| Badge | `.kv-badge`, `--neutral`, `--success`, `--danger`, `--warning` | Etiket metni zorunlu; pasif etiketi buton gibi sunmamak. |
| Table | `.kv-table-wrap`, `.kv-table` | `caption`, `scope`, gerçek satır başlıkları; overflow alanı adlandırılmış ve odaklanabilir. |
| Modal | `dialog.kv-dialog`, `.kv-dialog__actions` | `showModal()`, başlık/açıklama ID'leri, Escape, iptal, odağı açan düğmeye geri verme. |
| State | `.kv-state`, `.kv-skeleton` | Yüklemede `aria-busy`, kısa status; hatada neden ve yeniden deneme; boşta uygun sonraki adım. |
| Poll option | `.kv-option`, `.kv-option__letter` | Bu statik görünüm seçim davranışı taşımaz. Gerçek tekli seçim native radio grubuyla kurulacak. |
| Result | `.kv-result`, `--winner`, `--kv-result-width` | Sadece yetkili API yanıtı; genişlik sayısal 0–100 arasında normalize edilir. Yüzde ve oy sayısı metin olarak da verilir. |

Örnek:

```html
<link rel="stylesheet" href="/ui/design-system/components.css">
<div class="kv-field">
  <label for="poll-title">Soru</label>
  <input id="poll-title" class="kv-input" aria-invalid="true"
    aria-describedby="poll-title-error">
  <span id="poll-title-error" class="kv-field-error">Bir soru yazmalısın.</span>
</div>
<button class="kv-button" type="submit">Kaydet</button>
```

Framework uyarlamasında aynı semantik korunur. Modal işleyicileri ve API durumları uygulama katmanından sağlanır. Public token adları değişirse tüm tüketen ekranlarla birlikte değişiklik yapılır.

## Görsel kurallar

- Arka plan `#090B10`; yüzeyler `#11151D` / `#171C26`; ana vurgu `#7C3AED`; dekoratif vurgu `#A855F7`.
- Ana metin `#F8FAFC`, yardımcı metin `#94A3B8`. Açık mor, küçük metinde daha açık tonla (`#C4B5FD`) kullanılır. Beyaz metinli düğmeler ana mor üzerinde kalır; daha açık dekoratif mor düğme dolgusu değildir.
- Form sınırları `#69768B`, odak halkası `#C4B5FD`. Kart ayraçları daha sakin `#303949` rengindedir; gerekli kontrol sınırı olarak kullanılmaz.
- Tipografi: yerel sistem fontu; gövde 15 px / 1.6, yardımcı 13 px, H2 21 px, H1 28–38 px. Font indirme zorunluluğu yoktur.
- Boşluk ölçeği: 4, 8, 12, 16, 24, 32, 48 px. Köşeler: 8, 14, 20 px; badge için kapsül.
- Başarı yeşili yalnızca başarı/olumlu durum; tehlike rengi silme/kritik işlem; her durum metinle de anlatılır.
- Dekoratif SVG ikonları `aria-hidden`; bağımsız ikon düğmelerinde `aria-label` bulunur.

## Responsive ve klavye sözleşmesi

| Genişlik | Düzen |
| --- | --- |
| 1200 px ve üstü | Sol navigasyon / esnek ana akış / sağ keşif paneli; toplam en çok 1440 px. |
| 768–1199 px | Sol navigasyon + ana akış; sağ panel ana akışın altına iner. |
| 767 px ve altı | Tek kolon; sabit beş öğeli alt navigasyon; safe-area ve altta en az 104 px pay. |

- Ana Sayfa / Keşfet / Oluştur / Bildirimler / Profil sırası sabittir. Aktif öğe `aria-current="page"` alır.
- Minimum etkileşim hedefi 44×44 px. 360 px genişlikte belge yatay taşmaz; yalnızca tablo kapsayıcısında yerel kaydırma olabilir.
- DOM sırası görsel okumayla uyumludur. Gizlenen sayfa/navigasyon odak sırasından çıkar. İçeriğe geç bağlantısı ve görünür 3 px odak halkası bulunur.
- Önizleme rota değişiminde ana içerik odaklanır; ürün router'ı eşdeğer başlık/odak yönetimi sağlar.
- Modal native `dialog.showModal()` ile arka planı inert yapar, Tab döngüsünü tutar, Escape ile kapanır. İlk odak güvenli iptal eyleminde; kapanınca tetikleyiciye döner. Riskli işlem arka plana tıklayarak onaylanmaz.
- Form hatasında ilk geçersiz alan odaklanır; hata alanla programatik bağlıdır. Yazılmış değerler korunur; düzeltme sonrası hata temizlenir.
- `prefers-reduced-motion: reduce` animasyonları kaldırır. Forced-colors modunda kontrol sınırları korunur.
- Hedef: WCAG AA normal metin için 4.5:1; anlamlı kontrol/focus sınırı için 3:1. Otomatik kontrol, gerçek ekran okuyucu ve cihaz testinin yerine geçmez.

## Veri ve ekran durumları

- Loading: iskeletler dekoratiftir; kısa durum metni okunur. Hata: yeniden deneme odağı kaybolmaz. Empty: nedeni açıklayan metin ve kullanılabilir aksiyon bulunur.
- 404 ve 500 ayrı örnek yüzeylerdir. Sunucu hatasının iç ayrıntıları kullanıcı metnine taşınmaz.
- Gizli sonuçta oran/oy sayısı DOM'a konmaz; CSS ile gizlemek güvenlik değildir. Sonuç verisini vermeme kararı backend'e aittir.
- Kapalı/kilitli/yayından kaldırılmış anket için oy kontrolü gösterme sözleşmesi KV-03 API durumu ile eşleştirilecek; UI yetkilendirme katmanı değildir.
- Trend kartlarının gerçek hesaplama/sıralaması yoktur; örnekler açıkça etiketlidir. Yetersiz veri durumunda uydurma yüzde veya değişim gösterilmez.
- Formdaki 10–140 karakter ve iki alan, doğrulama örneğidir. Ürün limitleri, 2–6 seçenek, upload, süre ve auth KV-03/KV-13 kapsamındadır.

## Sonraki görev sırası

| Görev | Sonraki somut adım | Gereken |
| --- | --- | --- |
| KV-05 / #7 | Bu kitin ekip incelemesi ve seçilen framework'e uyarlanması | KV-01 teknoloji kararı uyarlama için gerekli; kit bağımsız kullanılabilir. |
| KV-13 / #15 | App shell, auth, oluştur/detay/oy ekranlarını uygulamaya taşı | KV-03 API sözleşmesi; gerçek kabul için KV-06/09/10/11. |
| KV-18 / #20 | Galeri, yorum/cevap/alternatif, sonuç etkileşimleri | KV-03; entegrasyonda KV-13/16/17. |
| KV-30 / #32 | Keşfet/kategori ve beş trend formatı | KV-03; entegrasyonda KV-26/27/28/29. |
| KV-46 / #48 | Gerçek ekran ve cihaz regresyonu | Entegre ekranlar ve beta bulguları. |

Bu teslim diğer görevlerin tamamlandığı anlamına gelmez; gerçek hesaplar, API, staging ve cihaz kabulü ayrıca yapılır.

## Doğrulama kanıtı — 27 Eylül 2026

Windows üzerinde headless Edge 154.0.4258.37 ile `tests/verify.cjs` çalıştırıldı:

- Sekiz yüzey × beş genişlik (360/390/768/1024/1440): belge yatay taşması yok; mobil/masaüstü navigasyon eşikleri geçti.
- 360 ve 1440 px ekranlar, akışın loading/empty/error durumları, form hataları ve açık modal: toplam 21 axe-core WCAG A/AA taramasında sıfır ihlal.
- Zorunlu alan/tekrarlanan seçenek, ilk hataya odak, düzeltme, modal ilk odağı/Tab/Escape/odak dönüşü, yeniden deneme, skip-link, bilinmeyen rota ve reduced-motion kontrolleri geçti.
- Masaüstü ve mobil ekran görüntüleri görsel olarak incelendi; tarayıcı JavaScript hatası yok.

Bu sonuçlar tarayıcı viewport testidir; fiziksel telefon, Safari/Firefox, ekran okuyucu ve gerçek backend kabulü henüz yapılmadı. KV-46'nın yerine geçmez.

Testleri tekrar çalıştırmak için statik sunucu açıkken başka terminalde:

```sh
cd ui/design-system
npm ci
npx playwright install chromium
npm test
```

Sistem tarayıcısı kullanılacaksa `KV_BROWSER_PATH` tam executable yolunu alır (bu durumda browser indirmek gerekmez). `KV_PREVIEW_URL` varsayılan olarak `http://127.0.0.1:4173`; `KV_TEST_OUTPUT` isteğe bağlı rapor dizinidir. JSON rapor ve ekran görüntüleri varsayılan `test-results/` altında oluşur ve Git'e alınmaz. Test paketleri yalnızca geliştirme içindir; önizleme bunları kullanmaz.

### Referans uyarlaması doğrulaması

11 yüzey × 5 genişlik taşma/navigasyon kontrolü geçti. Açık ve koyu temalarda toplam 43 axe-core taraması ihlalsiz tamamlandı. Arama/kategori/sonuçsuz durum/sıfırlama ve geçici kaydetme etkileşimleri geçti. Giriş, açık masaüstü akış ve koyu mobil akış ekran görüntüleri incelendi. Gerçek cihaz ve backend testleri kapsam dışıdır.
