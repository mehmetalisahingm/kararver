# KararVer V1 — İnceleme sonunda reddedilen anketin 10 puan iadesi

**Kesin işletmeci kararı — 8 Kasım 2026 (Mehmet):** Anket/tartışma başvurusu sırasında yayın puanı **10 puan olarak kesilir**. Şüpheli içerik `UNDER_REVIEW` durumuna girip **moderatör tarafından reddedilirse** başlangıçta kesilen 10 puan otomatik, **yalnız bir kez** geri verilir. Düşük riskli içerik doğrudan `ACTIVE` yayımlanır. V1 özel nitelikli kişisel veri isteme yasağı ve moderasyon itiraz hakları değişmez.

**Bu nakit/para iadesi değil, ücretsiz KararVer uygulama içi yayın puanı muhasebesidir.** Puanı fiat para, cüzdan, ödeme, reklama dönüştüren hiçbir işlem yapılmamıştır.

## Teknik uygulama ve fail-closed kuralları

| Senaryo | Beklenen defter ve durum |
| --- | --- |
| Normal/sorunsuz `ACTIVE` anket oluşturulur | Mevcut 10 puan `PUBLISH` kaydı, `delta=-10` (yayın başvurusu ücreti); başka iade yok |
| Şüpheli başvuru `UNDER_REVIEW` kaydı | Başvuruda bir kez kesilen 10 puan, `PUBLISH` defteri, API `202` özel makbuz, public içerik görünmez |
| Yetkili moderatör `UNDER_REVIEW → REMOVED` kararı verir | **Aynı DB transaction'ında** anket durumu, gerekçeli moderasyon/audit/event kaydı ve `MODERATION_REFUND` defter kredisi: `delta=+10`, `balanceAfter` yeni bakiye, `referenceId` anket, `idempotencyKey="moderation-refund:<pollId>"` |
| Moderatör işlemi paralel/tekrar çalıştırılır | Anket satır kilidi, `userId,idempotencyKey` UNIQUE ve immutable ledger ile **bir kredi**; ikinci işlem ek puan yazmaz |
| İlk `PUBLISH` 0 puandı (test/ücretsiz konfigürasyon) | Olmayan kesintiye karşı **0 iade**, `MODERATION_REFUND` kaydı üretilmez |
| İlk kesinti başka tutar olduysa (ör. dinamik ayar) | **Gerçek** negatif `PUBLISH.delta` kadar kredi; olmayan 10 puan imal edilmez; V1 yayın tutarı ayrıca 10 |
| Kullanıcı anketi siler veya zaten yayımlanmış `ACTIVE` anket sonradan moderasyonla kaldırılır | Bu **özel ön inceleme iade kuralı uygulanmaz**; ayrı hak/şikâyet kararı gerekebilir |
| İade edilmiş `REMOVED` anket için `RESTORE` denemesi | **Şimdilik 409 CONFLICT, public yayına açılmaz**: ücretsiz reinstatement/yeniden ücret alma kararı işletmeciden beklenir |
| Moderatörün RBAC erişimi yok, hata/çakışma var, puan hesabı eksik, audit başarısız | Yetkisiz 403 veya transaction rollback/fail-closed; **ret geçip kredi kaybolamaz**, kullanıcıya PII açıklanmaz |

### Kod ve doğrulama

- `apps/api/src/modules/points/moderation-refund.ts`: sadece gerçek orijinal `PUBLISH` debitini bulur; ikinci kredi mümkün değil. Bağımsız puan hesabı upsert yapmaz; silinmiş hesapları canlandırmaz.
- `apps/api/src/modules/moderation/prisma-store.ts`: yalnız yetkili `UNDER_REVIEW → REMOVED` `REMOVE` için atomik iddia; diğer kaldırma geçişlerinde yok. Refunded poll eski içerik restorasyonu sırasında 409 fail-closed.
- `apps/api/test/points.test.ts`: Postgres, 10 puan debiti, özel makbuz, yanlış yetkili ret 403, ret sonrası iade, aynı ret tekrarında tek kredi, ledger'a kullanıcının bakabilmesi, ödeme sonrası ret geri alma reddi, aktif anket takedown'ında iade olmaması.
- `apps/api/test/polls.test.ts`: ücretsiz/0-cost sentetik senaryoda sahte puan kredisi olmaması; queue halinde özel erişim ve kıymetli süre.
- Hukuk ve ürün kabulü: #285, moderasyon/itiraz #290, insan inceleme operasyonu #327, staging #53 ve son release #54. Gerekçe mesajı kullanıcıya doğru iletilmeli, hesabı silinmiş kullanıcı/uyuşmazlık/manuel bakiye ayarı ve yedek restore ayrı testlerdir.

## KVKK, veri güvenliği ve kullanıcıya şeffaflık

Puan hareketleri, moderatör kararları ve denetim izi hesap/poll ilişkisi taşıdıkları ölçüde kişisel veri olabilir. İşleme amacı, hukuki sebep, saklama/imha, ilgili kişi hakları, veri sorumlusu kimliği, teknik erişim/kayıt politikası gerçek aydınlatma metnine işlenmeli. **İşleme amacı ile hukuki sebep ayrı açıklanmalıdır**, muğlak "her şey için izin" metni kullanılmaz. Kullanıcıya “yayın başvurusunda 10 puan düşer; moderatör reddederse tek sefer otomatik iade olur” açıklaması ve bakiye geçmişinde +10 görünürlüğü sağlanmalı.

Resmî kaynaklar:
- [KVKK — Aydınlatma yükümlülüğü](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-)
- [KVKK — Aydınlatma yükümlülüğü duyurusu](https://www.kvkk.gov.tr/Icerik/6765/AYDINLATMA_YUKUMLULUGUNUN_YERINE_GETIRILMESI_HAKKINDA_KAMUOYU_DUYURUSU)
- [KVKK — Başvuru hakkı](https://www.kvkk.gov.tr/Icerik/2062/Basvuru-Hakki)

## Kalan zorunlu kabul ve sonraki işletmeci kararı

- [ ] **Gerçek moderatör işlemi P0:** kullanıcıya ret/iade ve puan bakiyesi bildirimi (#290, #327). Gerekçeler kötü niyetli kullanıcıya gizli yetkili/audit detaylarını sızdırmasın.
- [ ] **İade sonrası itiraz kabulü:** “Anket yeniden onaylanırsa 10 puan yeniden kesilsin mi, yoksa ücretsiz geri açılmasına izin verilsin mi?” Karar gelmeden restorasyon kapalı; kullanıcı yeni anket başvurusu yapabilir.
- [ ] **Yedek/restore:** tüketilmiş/geri alınmış idempotency kaydının ve silinme kararının eski DB yedeğinden geri yüklenmesiyle ikinci kredi çıkmaması; #311/#322 ile audit ve ledger checksum.
- [ ] **Eşzamanlılık:** iki moderatör eşzamanlı REMOVE; yanlış yetki, kart/puan hesabı yokluğu, reddedilmeyip RESTORE onaylanan anket, toplu moderasyon/geri alma/telafi, sistem ayarı 0/10.
- [ ] **Yayın kabulü:** gerçek PostgreSQL, UI, worker, accessibility, staging ve review son SHA için yeşil olmalı. PR #326 hassas içerik, PR #328 risk kuyruk, bu PR ise refund; merge ve rollout sırası bağımlı. Gerçek kullanıcı veya prod DB değişmedi.

**DURUM: TASLAK / NO-GO.** Bu belge hukuk onayı, CI PASS ya da canlıya alma taahhüdü değildir.
