# KararVer V1 — Ön moderasyon ret bildiriminden sonra 30 günlük itiraz süresi

**İşletmeci kesin kararı (Mehmet, 8 Kasım 2026):** Kullanıcı, reddedilen anket için **ret bildirimi kullanıcıya ulaştığı tarihten itibaren 30 gün** içinde ürün içi moderasyon itirazı yapabilir. Ret kararı tarihi, olayın outbox'a yazıldığı tarih, içerik gönderimi, bildirim satırının `createdAt` alanı veya API tekrarı tek başına 30 günlük süreyi başlatamaz. Süre **ilk doğrulanmış özel bildirim tesliminden itibaren** 30 x 24 saattir; tam son anda gönderilen başvuru kabul edilir, sonra reddedilir. Kullanıcı 30 gün içinde başvurduysa **moderatörün daha sonra cevaplaması** için bu dosya otomatik zaman aşımına uğramaz.

**Kapsam:** KararVer V1'in `UNDER_REVIEW → REMOVED` ile reddedilen anketleri. Telif/resmî talepler, KVKK m.11/13 kişisel veri başvuruları, genel yaptırım itirazları ve yargısal haklar **bu 30 günlük ürün kuralıyla sınırlanmaz**. Önceki #290 belgesindeki ürün itirazı için örnek 14 gün burada **V1 ön moderasyon retlerine ilişkin yeni kararla değiştirilmiştir**.

## Teslimin nasıl kanıtlandığı

Bugün uygulamada zorunlu `MODERATION_APPLIED` bildirimleri var. Worker bir olaydan bildirim oluşturduğunda `notifications.created_at` alanına **olayın gerçekleştiği tarihi** kopyalıyor. Bu zaman **bildirimin ulaştığı tarih değildir**. Yeni taslak:

1. Moderasyon ret kararı audit ve `moderation_actions` içinde `REMOVE`, `from_status=UNDER_REVIEW`, `to_status=REMOVED` olarak tamamlanır. Bu an **başvuru süresini başlatmaz**.
2. Outbox/worker, ret bildiriminin **doğru anket sahibinin kişisel gelen kutusuna** `MODERATION_APPLIED` olarak **başarıyla eklendiğini** aynı transaction'da doğrular. Bu hesap içi teslimin timestamp'i DB `now()` ile kaydedilir; farklı kullanıcıya giden bildirim, başarısız worker, hiç bildirim yazmama veya silinmiş hesap bu süreyi başlatmaz.
3. `moderation_appeal_windows` özel tablosu: özgül ret `rejection_action_id` PRIMARY KEY, yalnız doğru `recipient_id`, özgül `notification_id` kanıtı, `delivered_at`, `deadline_at = delivered_at + interval '30 days'`. Retry/ikinci bildirim eski başlangıcı veya son tarihi değiştiremez; trigger bu iki sütunu değiştirilemez yapar. Bildirim satırı daha sonra rutin 90 günlük temizlikten kaldırılırsa **teslim kanıtı** kaybolmaz.
4. **Sınır/kanıt:** Hesabın gelen kutusuna başarıyla yazılması, bildirimin cihaza push olarak geldiği veya kullanıcının açıp okuduğu anlamına **gelmez**. Bugünkü teknik model yalnız **hesaba teslim** kanıtlar. Gerçek kişiye bildirim usulünün geçerliliği, e-posta teslim delilleri, bounce, hesap erişimi olmayan/suspended/banned kullanıcılar, destek kanalı ve erişilebilir bildirim ekrani **#290 hukuk+operasyon P0**'dır. Bu kabul yapılmadan “bütün kullanıcılara hukuken tebliğ edildi” denmez.
5. Yedek restorasyonunda eski `notifications` ya da outbox yeniden çalışırsa immutable ret kanıtı sayesinde **30 gün sıfırlanmaz**. Veriler eski yedekle geri alınırsa ayrı bağımsız işlem günlüğü/restore-replay P0 (#311/#322); başvuru hakkı sonradan haksız biçimde daraltılmaz.

## Kullanıcı başvurusu

Yeni oturumlu/özel API (açık public poll URL'sinden bağımsız):

- `GET /v1/me/moderation-appeals/:rejectionActionId` yalnız doğru alıcıya teslim günü, UTC/ISO son gün, `OPEN/FILED/EXPIRED`, ilk dosyalama tarihini döndürür. Başka kullanıcıya 404; kullanıcı metni veya moderatör gerekçesi döndürülmez.
- `POST /v1/me/moderation-appeals/:rejectionActionId` (gerekçe 10–1000 karakter): yalnız kayıt sahibi kendi güncel `UNDER_REVIEW→REMOVED` ret kararına itiraz edebilir. Teslim kanıtı YOKSA **404**, süresi dolmuşsa **409 appeal_window_closed**, ret kararı artık geçerli değilse **409 appeal_not_reviewable**. 30 günün son anında ilk başvuru kabul; sonraki milisaniye reddedilir.
- Dosya işlemi PostgreSQL `FOR UPDATE` ve ilk `filed_at` kayıt koruması altında gerçekleşir. Aynı başvuru yeniden gönderilirse ilk tarih ve gerekçe **değiştirilmez**; başka hesap veya client timestamp değerleri kullanılmaz. Özgül bildirim başka ret için tekrar kullanılamaz.
- Ücretsiz itiraz kabulü PR #336: yalnız doğru ret kararı üzerinden ADMIN+ gerekçeli/denetimli **tekil undo** ile aynı anket ücretsiz açılır; önceki `PUBLISH -10` ve `MODERATION_REFUND +10` kayıtları aynen kalır. **Bu PR** restore öncesinde özgül ret için kendi sahibince **zamanında yapılmış** itiraz kaydını şart koşar. Yetkili kişilerin gerçek değerlendirme/karar verme süresi, başvuru tarihinin 30 gün sonrasına taşsa da başvuru geçerlidir.
- Ürün içi 30 günlük normal itiraz bitmiş olsa bile KVKK, diğer mevzuat başvurusu ve desteğe ulaşma hakkı **otomatik sona ermez**. Hesabı kapalı kullanıcı için güvenli alternatif kimlik/teslim yolu bu uygulamada henüz açılmadı; hukuk ve operasyon P0.

## Saklama, gizlilik ve bildirim kabulü

| Veri | İçerik ve koruma | Süre kararı |
| --- | --- | --- |
| Gelen kutusundaki zorunlu ret bildirimi | Yalnız alıcı, eylem/anket ID; moderatör kimliği ve serbest not yok | Mevcut okunan bildirim 90 gün sonra, silinmiş hesap bildirimi 30 gün sonra temizlenir; bu **itiraz süresi başlangıcı değildir** |
| Teslim ve son başvuru kanıtı | Yalnız ret ID, alıcı ID, bildirim ID, iki zaman damgası; idempotent ve değişmez | Ürün 30 günlük dosyalama penceresi belirlendi, **kanıtın hukuken gerekli saklama süresi henüz belirlenmedi**. Otomatik silme/yok etme koyulmadı |
| Başvuru gerekçesi ve ilk dosyalama tarihi | Kısıtlı, özel işlem kaydı, ilk dosyalama değiştirilemez; üçüncü kişilerin bilgileri dışarı çıkmaz | Başvuru çözümlenmesi, haklar, uyuşmazlık ve ispat ihtiyacı ayrı saklama/imha kararı bekler; süresiz tutma da otomatik onay değildir |
| Moderasyon kararları, audit ve puan defteri | Değişmez iş/itiraz bağlantısı; +10 geri ödeme korunur | Kendi hukuki saklama/inceleme süreçlerine göre ayrı |
| Operasyonel DB yedeği | İşletmeci 30 gün saklama tercihi; restore sonrası silme/itiraz zamanları dış kayıtlara göre yeniden doğrulanır | **Yedek 30 gün ≠ itiraz 30 gün ≠ kişisel veri saklama 30 gün** |

## Kabul testleri ve hâlâ açık P0

- [ ] Sentetik Postgres/worker: bildirim yazılmadığında **hiç saat başlamıyor**; başka kullanıcıya yazıldığında sayılmıyor; gerçek alıcıya transaction commit edilince teslim kanıtı yazılıyor. Ret kararından gecikmiş teslimde outbox `createdAt` değil worker `now()` esas. Aynı olayı yeniden işleme, duplicate bildirim ve cleanup süreyi değiştirmiyor.
- [ ] API: yalnız doğru kullanıcı 200 GET/POST, başka kullanıcı 404, bildirimi olmayan 404, 30 gün tam anda 200, **30 gün +1ms** 409, eski/yanlış ret 409, tekrar aynı tarihte idempotent, gerekçe/recipient/son tarih tamper denemeleri engelleniyor.
- [ ] Tekil ADMIN+ itiraz düzeltme: kişinin **zamanında dosyaladığı** kayıt yoksa 409; kabul günü 30 günden sonra olsa da zamanında başvuru varsa işlem geçerli; iade edilmiş +10 korunuyor; farklı anket/hesap, geriye dönük değiştirilen tarih, banned/silinmiş hesap, hassas anket, onaysız medya fail closed.
- [ ] Gerçek kullanıcı ekranı: zorunlu ret bildirimi ile güvenli “İtiraz et” bağlantısı ve ISO/Türkiye saat dilimiyle açık son tarih; bildirim canlıya düşmüyorsa sayaç başlamasın; dublikeler kullanıcıya iki son tarih göstermesin; ekran okuyucu/mobil/ekran yenileme. **Bu PR yalnız API ve worker hazırlığıdır; UI/gerçek e-posta tebliği açık P0.**
- [ ] Mert/Faruk: insan inceleme, karar yetkisi ve başvurunun takip ekranı, reddedilme gerekçesi, yanıt bildirimi, ret sonrası 0 yeni puan ve eski +10; destek taleplerini çözümleme.
- [ ] Utku: veri sahibinin silinmesi/erişim dışı kalması, farklı rol, account takeovers, backdate/fake delivery, clock drift, replay/bulk undo, backup restore, PII erişimlerini incele.
- [ ] KVKK avukatı/uyum (#285): kişisel veri ve moderator başvuru kayıtları için işleme amacı/hukuki sebep, veri sorumlusu, yurt dışı aktarım, saklama/imha, ilgili kişi haklarına erişim, yanlış teslim/başvuru usulü.
- [ ] #53 gerçek staging ve son SHA + bütün CI/çoklu tarayıcı testleri, #54 Mehmet GO/NO-GO. Üretim değişmedi.

## Hukuki ayrım ve resmî kaynaklar

**Bu 30 gün, KararVer'in kendi ürün moderasyon itirazını DOSYALAMA süresidir.** KVKK m.13 uyarınca ayrı bir kişisel veri talebine veri sorumlusunun **en geç 30 gün içinde cevap verme yükümlülüğü**, kullanıcının 30 günde mutlaka ürün içi moderasyon itirazı yapması gerektiği anlamına gelmez. Bu ürün kuralı KVKK/diğer hukukî talepleri daraltmaz.

- [KVKK — İlgili kişilerin başvurularını cevaplama yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2046/Ilgili-Kisiler-Tarafindan-Yapilan-Basvurularin-Cevaplanmasi-Yukumlulugu)
- [KVKK — Aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
- [KVKK — Bildirim usulü kamuoyu duyurusu](https://www.kvkk.gov.tr/Icerik/9024/ilgili-kisilerin-basvurularina-verilecek-cevabin-bildirim-usulune-iliskin-kamuoyu-duyurusu)

**DURUM: STACKED DRAFT / NO-GO**: #326 hassas konu, #328 risk kuyruğu, #333 ret puan iadesi, #336 ücretsiz yeniden yayın, bu PR teslim+itiraz süresi; tam CI/review/staging ve gerçek bildirim/itiraz UX kabulü olmadan yayın yapılmaz.
