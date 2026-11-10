# #289 — 18+ ürün politikası: karar ve teknik teslim sınırı

**Karar tarihi:** 8 Kasım 2026. **Kararı veren:** KararVer işletmecisi Mehmet. **Kapsam:** KararVer'de *yeni hesap kaydı* yalnızca 18 yaşını doldurmuş kişiler için tasarlanır. Bu, işletmecinin **ürün tercihi** olup bütün Türkiye'deki dijital platformlar için genel bir yasal yaş eşiği olduğu iddiası değildir.

## Kullanıcıya gösterilecek kısa metin (taslak)

> KararVer, 18 yaşını doldurmuş kişilerin hesap oluşturabileceği bir platformdur. Hesap açarken 18 yaşınızı doldurduğunuzu beyan edersiniz. 18 yaşını doldurmadıysanız lütfen hesap oluşturmayın.

Bu kısa açıklama henüz onaylı/aktif kullanım koşulları, aydınlatma veya ayrı bir açık rıza metni değildir. Onaylı yasal paket #285/#286 ile sürümlü yayımlanır. Hukuki metnin erişim adresi ve gerçek iletişim kanalı kesinleşmeden yayın onayı yoktur. **Önerilen** `karariniverdestek@gmail.com` adresinin açılıp erişilebilir olduğu henüz teyit edilmedi.

## Teknik politika / bu PR'ın sağladıkları

1. Gerçek kayıt formunda 18+ beyanı **boş varsayılan** ve erişilebilir onay kutusu vardır. İşaretlenmedikçe kayıt butonu kapalıdır; kayıt isteği onayı taşır.
2. `POST /v1/auth/register` API'si, uygulamanın bütün gerçek dağıtımlarında `adultConfirmed === true` istemedikçe **400 VALIDATION_ERROR** döner. Bu kontrol hesap araması, parola hashleme ve mail gönderiminden **önce** yapılır; sadece frontend'e güvenilmez.
3. Doğum tarihi, kimlik fotoğrafı, biyometri, yeni çerez veya izleme verisi toplanmaz. Bu aşamada kalıcı yaş kanıtı saklanmaz. Kayıt `adultConfirmed` beyanı gerçek yaş doğrulaması değildir.
4. Eski test fixture'ları, sınır özelliğinden bağımsız eski auth testlerini sürdürebilmek için `createHarness(..., { adultDeclarationRequired: false })` şeklindeki açık seçenekle çalışır. **Production/staging varsayılanı true**; ayrı API testinde gerçek politika açık ve eksik/false/hatalı beyan ile olumlu senaryolar test edilir.
5. Yeni istemci ve eski istemci sözleşmeleri: eski/üçüncü taraf istemci onaysız istek gönderirse kayıt reddedilir; bu beklenen güvenli davranıştır.

## Kalan zorunlu kabul: burada tamamlandı denmiyor

- [ ] #289: 5651/sosyal ağ kapsamı, geçerli yaş doğrulama yöntemi ve yürürlük/geçiş hükümleri **birincil mevzuat** üzerinden hukuken değerlendirilsin. Bir onay kutusu **güçlü yaş doğrulaması sayılmaz**. Gerekliyse yetkili yaş doğrulaması/entegrasyon ayrıca uygulanır. Gerçek hesap e-Devlet şifresi veya kimlik görüntüsü isteme.
- [ ] Mevcut hesapların yaş durumuna ilişkin meşru veri kaynağı ve geçiş stratejisi/itiraz/erişilebilirlik tasarlansın. Mevcut hesaplar otomatik silinmez, banlanmaz veya yaşları varsayılmaz.
- [ ] Politikanın kayıt dışı içerik görüntüleme, paylaşım, davet ve diğer akışlara etkisi hukuken kapsamlandırılsın. Bu PR yalnız **yeni kayıt** için beyan kontrolü içerir.
- [ ] Staging'de aynı SHA'da API, tarayıcı (mobil dahil), klavye/ekran okuyucu, negatif kayıt testleri çalıştırılıp #46/#48/#53'e kanıt bağlansın.
- [ ] Gerçek iletişim kanalı ve işletmeci hukuki metinleri #285/#286'da onaylanıp yayına alınsın; #284/#54 bağımsız GO kapıları açık kalsın.

## Veri minimizasyonu ve kaynak

18+ ürün kararı, otomatik KVKK açık rızası veya işleme şartı anlamına gelmez. Kayıt sözleşmesi için gereken veriler ile seçime bağlı analitik/pazarlama rızaları ayrı değerlendirilir. Doğum tarihi/kimlik görüntüsü gibi ağır veriler gerekli olduğuna ilişkin hukuk/teknik karar olmadan eklenmez.

- KVKK kişisel veri hukuki şartları: https://www.kvkk.gov.tr/Icerik/2050/Kisisel-Veriler
- KVKK veri minimizasyonu ihlal kararı: https://www.kvkk.gov.tr/Icerik/5413/Islenme-Amacinin-Gerektirdiginden-Fazla-Kisisel-Veri-Islenmesi-Aktarilmasi-Veri-Minimizasyonu-Ilkesine-Aykirilik-
- KVKK çocukların kişisel veri korunması ve yaş güvenceleri üzerine duyuruları: https://www.kvkk.gov.tr/Icerik/8289/Dijital-Oyunlar-ve-Kisisel-Verilerin-Korunmasi-Sempozyumu

**Durum:** Uygulama adayı, CI/staging ve hukuk kabulü bekliyor. **NO-GO.**
