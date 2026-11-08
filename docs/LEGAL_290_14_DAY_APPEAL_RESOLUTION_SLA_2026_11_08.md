# KararVer V1 — Moderasyon itirazı 14 TAKVİM GÜNÜ sonuçlandırma hedefi

**Kesin işletmeci kararı:** Mehmet · **8 Kasım 2026**. İtiraz başvurusunun **sisteme sunucu tarafından kaydedildiği andan itibaren 14 takvim günü** içinde moderatör tarafından sonuçlandırılması **ürün/operasyon hedefidir**. Başvuru hakkı ayrı: ret bildiriminin uygulama içi kutuya **gerçek tesliminden itibaren 30 gün** (#339). Kullanıcının 10 puanı yayın gönderiminde kesilir, moderatör reddinde bir kez iade edilir, itiraz kabulü halinde anket ücretsiz geri açılır ve iade geri alınmaz (#333/#336).

**14 takvim günü = UTC kayıt anından itibaren 336 saat** (gün sonu/hafta içi mesai saati değil). Örneğin 8 Kasım 2026 18:00 TSİ kaydedilen başvuru için hedef 22 Kasım 2026 18:00 TSİ. Tekrar gönderme, moderatöre atama veya “incelemede” statüsü süreyi sıfırlamaz. Son andaki çözüm hedef içinde sayılır; 1 milisaniye sonrası gecikmedir.

**Bu hedef yasal KVKK yanıt süresi değildir.** 6698 sayılı Kanun m.13 kapsamında kişisel veri hakkı başvurusunun niteliğine göre en kısa sürede ve en geç 30 günde cevaplanması yükümlülüğü ayrıca geçerlidir. Bu 14 gün, moderasyon içeriği/puan kararına ürün içi itiraz yanıtı için Mehmet'in seçtiği hizmet hedefidir; ayrı mevzuat zorunluluklarını uzatmaz, daraltmaz.

## Veri/model ve güvenlik hazırlığı

- **`moderation_appeal_cases`** aday tablosu: `rejection_action_id`, başvuran `appellant_id`, sunucu `submitted_at`, değiştirilemez `resolution_due_at=submitted_at+336h`, `status=OPEN|IN_REVIEW|RESOLVED`, yetkili `resolved_by_id`, `outcome=ACCEPTED|REJECTED`, `resolved_at`. Ham itiraz gerekçesi veya anketin hassas metni bu tabloda tutulmaz.
- `rejection_action_id` **teslim kanıtına FK**: yalnız ön moderasyon ret kararı için gerçekten kullanıcı inbox'ına ulaşmış zorunlu bildirim ve ona bağlı hak sahibi. DB trigger'ı **başka hesap adına** başvuru kaydı, teslimden **önce/30 gün sonrasında** başvuru ve sonradan `submitted_at` veya `due_at` oynanmasını reddeder. Başvuru başına kullanıcı+ret işlemi UNIQUE (yenilemeyle 14 günü sıfırlama yok).
- Kayıtlı `OPEN/IN_REVIEW` dosya **14 gün sonunda otomatik reddedilmez/onaylanmaz, yeniden yayımlanmaz ve otomatik puan hareketi oluşturulmaz**. Gecikme yalnız yetkili insanın müdahale etmesi gereken SLA ihlalidir. Gerçek kullanıcı haklarını, refundu ve V1 hassas içerik yasağını değiştirmez.
- `appeal-resolution-sla.ts`: saf `OPEN/DUE_SOON/OVERDUE/RESOLVED` iş yükü hesaplama; `appeal-workload.ts` sayım bazında, **başvuru anlatısı, e-posta, gizli içerik ve kullanıcı kimliği döndürmeyen** veritabanı sorgusu. Diğer kişilerin başvurularını kullanıcıya veya kamuya gösteren API eklenmez.
- **Uyarı/iletişim adayları:** kullanıcıya `APPEAL_RECEIVED` ile 14 gün hedefi ve takip; yetkili moderatör için son **48 saatte** `APPEAL_DUE_SOON_STAFF` ve süresi geçtiğinde `APPEAL_OVERDUE_STAFF`; sonuçta `APPEAL_RESOLVED_ACCEPTED|REJECTED` ve ayrı gerekçeli hesap görünümü. Sabit `appeal:<caseId>:<kind>` anahtarıyla tekrarlı uyarı engeli ve PII-minimal metinler. `appeal-notice-intents.ts` **yalnız saf bildirim niyeti** oluşturur; hiçbir canlı kişiye mesaj/e-posta göndermez. Doğru rol/yetki, dedupe, audit, kullanım tercihleri ve bir hatırlatma cron'u ayrıca bağlanmalı.
- **İş yükü/nöbet:** yetkili mod ekibi dosyaları eskiden yeniye + hedefe yaklaşma puanı ile yönetir. Öneri: kalan 48 saatte sorumlu personele iç uyarı; süre dolunca erişim rolünü genişletmeden ADMIN/SUPER_ADMIN'a operasyon eskalasyonu. Bu **otomatik yetki devri değildir**; 0 TL ekip/servis hedefi, on-call yedek personel ve günlük kuyruk kontrolü gerekiyor. Kullanıcıya gecikme durumu şeffafça iletilecek, ancak “otomatik kabul” sözü verilmeyecek.

## Güvenlik/test kabul

- [x] Sunucu zamanından 14×24 saat hedef hesaplayıcı ve inclusive boundary; 48 saat uyarı, +1ms gecikme, RESOLVED öğesinde yanlış alarm yok; saf unit test.
- [x] Sentetik DB test adayı: doğru `receipt/action/user` ile 14 günlük dosya, başka hesaba ait sahte case oluşturma **DB trigger'ında ret**, teslimden önce/30 günden sonra filing engeli, unique ve son tarih değiştirme engeli, geç çözümün otomatik ret olmaması.
- [x] Güvenli mesaj niyetleri ve PII sızmama, staff-only escalation testleri, sabit dedupe keys.
- [ ] **Gerçek kullanıcı itiraz başvurusu API ve ekranı** (mevcut #339 sürümünde yok) yapılacak: kimlik doğrulama, ilgili anket/ret/receipt sahipliği, server `submitted_at`, idempotent POST, rate limit ve 404 cross-account. Yeni tablo **tek başına başvuru sistemi değildir**.
- [ ] Yetkili moderatörün **gizli queue ekranı**, gerektiğinde ikinci göz, atama ve rol kapsamı, gerekçeli cevap, durum/karar bildirimini gerçekten gönderen worker; actor/PII sızdırmadan kaydetme, delivery retry ve case görüntüsü; `RESOLVED` için yetkili audit/undoOfId ve kullanıcının +10 puan iadesinin korunması.
- [ ] Cron/günlük kontrol, backlog ve tüm açık 14-gün hedeflerini takip eden dashboard; gecikme olursa karar vermeyi sürdürme, tekrar sayım/hatırlatma selinden korunma. Ek pahalı sağlayıcı yok.
- [ ] DB migration ve schema drift, trigger envanteri, gerçek Postgres concurrency, kötü aktör/başkasının itirazı, zaman manipülasyonu, silinen hesap, geç teslim, saklama/imha, 30 günlük operasyonel backup restore replay; tam CI, sentetik staging, Mert/Ümit/Faruk/Utku review.
- [ ] **Hukuk ve saklama:** itirazın veri kaydı (ret kararı, teslim, dosya sahibi, zamanlar, sonuç) kişisel veri olabilir. İlgili işleme amacı, veri sorumlusu, hukuki şart, erişim/denetim, veri minimizasyonu ve saklama-imha, legal hold ve hesap silme #181/#285/#311/#322 içinde ayrı gerekçelendirilir. 14 gün hedefi kayıtları 14 gün sonra silme emri, 30 gün yedek kuralı 30 günlük itiraz evrakı saklama kuralı **değildir**.
- [ ] **Dava/şikâyet hakkı:** Ürün içi itiraz red/cevap durumu, KVKK m.11–13 ilgili kişi başvurusu ve yargısal başvuru süreleri birbirinden ayrı açıklanacak. Moderasyon hedefi hakları sınırlayan bir “resmî yasal süre” gibi sunulamaz.

## Uygulama ve görev sahipleri

- **Mert:** P0 #290 kullanıcı itiraz başvuru / karar gerekçesi / moderator queue ve insan inceleme, günlük geri bildirim.
- **Faruk:** PostgreSQL modeli, immutable filing/14g target ve 30g notice doğruluğu; backup, restore/erasure, gerçek API işleri ve CI.
- **Utku:** yetki sınırı, double filing, kasıtlı clock/reset, PII logları, SLA üzerinden yasaklı anketin açılmaması, concurrency/DB check review.
- **Ümit:** başvuru yapıldı/alındı/sonuca 14 gün hedef, kalan süre, gecikme ve gerekçeli bildirim için ekran/mobil/a11y hazırlığı.
- **Mehmet:** yayın/kabul kararı ve bir sonraki açık işletmeci kararı: 14 gün hedefi aşılınca **kime ve hangi kademede eskalasyon** yapılacağı; tasarım önerisi ADMIN ve ardından SUPER_ADMIN. Bu belge tek başına otomatik bildirim/yetki açmaz.

### Resmî kaynaklar

- [KVKK — kişisel veri başvurularına yanıt yöntem ve 30 günlük yükümlülük](https://www.kvkk.gov.tr/Icerik/9024/ilgili-kisilerin-basvurularina-verilecek-cevabin-bildirim-usulune-iliskin-kamuoyu-duyurusu)
- [KVKK — İlgili kişi başvurusunun cevaplanması](https://www.kvkk.gov.tr/Icerik/2046/Ilgili-Kisiler-Tarafindan-Yapilan-Basvurularin-Cevaplanmasi-Yukumlulugu)
- [KVKK — kişisel verileri silme/yok etme/anonimleştirme yönetmeliği](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK)

**PR adayı / NO-GO:** Kamuya çıkmadı, hesap bakiyeleri ve gerçek appeal verileri değişmedi. Bu dosya tamamlanmış hukuk onayı veya ürünün itirazları gerçekten 14 günde yanıtladığı kanıtı değildir.
