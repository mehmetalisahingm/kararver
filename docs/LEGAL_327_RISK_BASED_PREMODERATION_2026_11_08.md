# KararVer V1 — Risk temelli yayın öncesi moderasyon kararı

**İşletmeci kararı:** Mehmet, 8 Kasım 2026. Yalnız riskli/şüpheli anketler **moderatör ön incelemesine** alınsın; düşük riskli normal anketler **doğrudan yayımlansın**. Önceki V1 kararı da değişmez: bir kişinin siyasi görüşü, dini, sağlık bilgisi, vb. özel nitelikli kişisel verisini **istemeyi amaçlayan** anket V1'de kabul edilmez. İnsan incelemesi bu yasak için otomatik bir muafiyet yolu değildir.

**Durum: TASLAK / YAYIN NO-GO.** Teknik PR mevcut, CI ve bağımsız gerçek ortam kabulü bekleniyor. Her kullanıcı içeriğinin güvenli olduğuna dair iddia değildir.

## Karar matrisi — sunucu tarafında

| Durum | Sunucu sonucu | Görünürlük |
| --- | --- | --- |
| Açıkça kişisel hassas bilgi talep eden soru/seçenek (`sensitive-policy.ts`) | **400 VALIDATION_ERROR**; DB'ye anket veya puan defteri kaydı yazılmaz | Hiç yayımlanmaz |
| Görsel, bağlantı veya hassas bağlam/örtük soru nedeniyle risk sinyali (`risk-review.ts`) | **202** + yalnız gönderen için `{id,status:"UNDER_REVIEW"}` makbuzu; anket `UNDER_REVIEW` olarak transactional kaydedilir | Public GET/lookup, feed, SEO, oy, yorum 404/görünmez; yetkili admin/moderatör listesinde statü filtresiyle bulunur |
| Bilinen açık ihlal veya incelemeye gerektiren işaret taşımayan anket | **201** normal `PollDetail`, DB `ACTIVE` | Public erişim ve önceden kararlaştırılmış sonuç mahremiyet kuralları geçerli |
| Moderatör onayı | Mevcut sunucu RBAC ve kaynak kapsamı denetimiyle `RESTORE` (`UNDER_REVIEW → ACTIVE`), reason ve append-only audit; varsa bağlı görseller `APPROVED` olmalı | Ancak bu noktadan sonra public |
| Moderatör ret/kaldırma | Yetkili `REMOVE` (`UNDER_REVIEW → REMOVED`), açıklama, audit/itiraz; public gösterim yok | Kullanıcı içeriği hukuki saklama/başvuru süreçlerinden ayrı değerlendirilir; otomatik kalıcı ban yok |

## Uygulanmış kod hazırlığı

- **Backend triage:** `POST /polls` önce izin verilmeyen kişisel hassas veri sorularını 400 ile reddeder; daha belirsiz sinyal varsa `UNDER_REVIEW` seçer. Görselli bütün yeni anketler, özel bağlamı incelemek için temkinli olarak kuyruğa alınır. Linkler ve hassas bağlamlar da kuyruğa düşer. Sıradan ürün/servis soruları 201 döner. **Sinyaller kullanıcı hakkında puan/profil değildir**; yanıt/trace'e ham içerik eklenmez.
- **Kaydetme/idempotency:** `status`, anket/seçenek/medya/ilişkiler ve idempotency anahtarı aynı DB transaction'ında yazılır. Tekrarlanan anahtar aynı 202/201 durumunu ve aynı ID'yi döndürür; ikinci yayın/puan kaydı oluşmaz. Reddetme işleminden kaynaklı yeni kayıt açılmaz.
- **Sözleşme/UI:** `202` yalnız özel bir makbuzdur; public detay DTO'su değildir. Kullanıcı kamuya kapalı detay sayfasına gönderilmez; incelemeyi bildiren mesaj görür. Mevcut puan sistemi **gönderim sırasında** puan düşürüyor; bu eski varsayımı saklamadan belgeliyoruz. **Reddedilen/yayımlanmayan içerikte iade edip etmeme ayrı işletmeci kararına bağlı, henüz çözülmüş değil**.
- **Moderator:** Mevcut `admin.content.polls` listesi `UNDER_REVIEW` filtresiyle içerikleri bulur; mevcut yetki/scope/rollback/audit kurallı `admin.moderation.polls` `RESTORE` ve `REMOVE` üzerinden işlenir. Moderatör yalnız yetkili olduğu toplulukta işlem yapar; topluluksuz içerik ADMIN+ erişimine tabidir. Yeni SUPER_ADMIN veya geniş izin tanımlanmadı.
- **Süre:** İncelemede bekleyen POLL'un saat sayacı, onay anından itibaren aynı orijinal süre kadar yeniden ayarlanır; DISCUSSION süresiz kalır. Onay sonrası `RESTORE` yeni audit yazar, tekrarlanan işlem sıfır değişikliktir.
- **Medya:** Ankete bağlı görsel `APPROVED` değilse anket `RESTORE` ile kamuya açılamaz. Mevcut medya kaldırma/ban akışı ayrıca işlevsel kalmalı.
- **Testler:** Saf risk sinyali ve güvenli örnekler, gerçek sentetik PostgreSQL 201/202, guest 404, private makbuz, idempotency, 403 yetkisiz onay, ADMIN'le onay ve tam oylama süresi, yok olan public veri ve medya/oy sızıntısı regresyonu.

## Bilinçli sınırlamalar / zorunlu yayın P0

**Bu uygulama, kapsamlı bir güvenlik moderasyonu değildir.** Riskli fakat işaretlenmeyen Türkçe/diğer dillerde sorular otomatik 201 olabilir. Risk işaretleme örüntülerle sınırlıdır; üçüncü kişinin gizli bilgisi, OCR/medya bağlamı, anonimleştirilmemiş oy/küçük grup, daha önceki içerik, profil ve yorumlar ayrı risk taşıyabilir. Sırf CI başarıyla geçiyor diye açıkça yasaklı içeriğin hiç kaçmadığı iddia edilemez.

1. **Mert (#327/#183):** İnsan inceleme operasyonunu yayın öncesinde erişilebilir kıl; admin/moderatörün **başlık, seçenek, açıklama, görseller, ilgili bağlam** ve geçmişi gerçekten görebildiği özel ekran/iş akışı, ret gerekçesi, kullanıcıya bildirim ve itiraz mekanizması; backlog ölçümleri, operatör yedekliliği ve içerik SLA; uygun statünün izinsiz manuel onaylanmasına karşı kontrol. Topluluksuz içerik için ADMIN+ gerçek nöbet planı.
2. **Faruk:** Risk motorunun çekirdeğini bağımsız güvenlikle review, statü transaction ve moderation RESTORE/REMOVE ile medya kilidi testleri, bildirim ve cache invalidation, sıralama ve trend görünürlük izolasyonu. İnceleme sürerken hesap silme, paylaşımları kapatma ve yok olan creator hesabı geri açılmasın.
3. **Utku:** Yetkisiz yönetici, geçmiş ya da iptal edilmiş anahtar, concurrent RESTORE/REMOVE, scope değişimi, şüpheli içerik üzerinden PII sızması, log ve politika manipülasyonu, düşük riskli gibi görünen kötü niyetli yayınlar ve otomatik içerik sınıflandırmasına itirazı denetle. **Mevcut gölge spam puanı #183 hukuki bayrağı açılmayacak.**
4. **Ümit:** `202` makbuzunu kalıcı takip/hesap içerikleri ekranında “incelemede” olarak göster; yanlışlıkla public URL/kopyalama yapma. Ret bildirimi, içerik açıklaması, erişilebilirlik, klavye ve mobil senaryoları.
5. **#321/#285/#290/#53/#54:** Önceden yayımlanmış içeriklerin özel veri riski; anonim toplu sonuçlar, kullanıcı 18+, misafir indekslemesi, silme ve başvuru süreçleri. İlgili kişilere şeffaflık, gerekçeli insan incelemesi, karar veren personelin erişim yetkisi, veri minimizasyonu, saklama süreleri ve gerektiğinde KVKK itiraz süreci. Prod, yedek ve eski kullanıcı verisine izinsiz mutasyon YOK.

### Hukuki çerçeve

- 6698 sayılı KVKK m.5–6 ve m.10 kapsamında anket/metin/hesap bilgilerinin işleme sebebi, veri sorumlusu kimliği, erişim ve yurt dışı sağlayıcı durumu ayrı değerlendirilir. **Özel nitelikli veri kategorileri m.6'da sınırlı sayılmıştır**, V1 bunları anketle toplamamayı seçmiştir; bir kullanıcının açık rızası olduğu gerekçesiyle bu ürün kararı geçersiz kılınmaz.
- Moderatörün inceleme sırasında gördüğü içerik de **kişisel veri işleme** olabilir; yetki ve rol sınırı, minimum görünürlük ve gerekçeli işlem/audit gerektirir. Karar, sınırsız gözetim/profil çıkarımı ya da güvenilmeyen ML sağlayıcısına içerik gönderme izni değildir.
- İlk sürümde **ücretsiz/reklamsız**, **18+**, **misafir public okuma**, **30 gün operasyonel DB backup**, **eski AFTER_VOTE gizliliği**, **silinmiş içerik ve üçüncü kişi hakları** önceki kararlarla birlikte geçerlidir.
- [KVKK — Özel Nitelikli Kişisel Veriler](https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler)
- [KVKK — Aydınlatma Yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
- [KVKK — İlgili Kişi Başvuru Hakkı](https://www.kvkk.gov.tr/Icerik/2062/Basvuru-Hakki)

**Sonuç:** Risk bazlı ön moderasyon kararı teknik PR olarak hazırlandı, **gerçek üretim sisteminde uygulanmadı**. Mevcut döngüde iade ve moderatör operasyonu kabulü açık. Final GO/NO-GO yalnız Mehmet tarafından #54'te verilir.
