# KararVer — Olay müdahale runbook'u (#291, #51)

**Sahip:** Faruk (teknik müdahale ve runbook). **Karar, kullanıcı iletişimi ve resmî bildirim:** Mehmet. **Hukuki değerlendirme:** uygun hukuk uzmanı.
**Dayanak:** Mehmet'in 8 Kasım kararları [#41–#46](https://github.com/mehmetalisahingm/kararver/issues/285) ve [#47–#57](https://github.com/mehmetalisahingm/kararver/issues/285#issuecomment-6726634093), özellikle 48A, 49A ve 50A.
Bu belge [KV-49 "Olay müdahalesi"](KV-49_OPERATIONS.md#olay-müdahalesi) bölümünün ayrıntılı hâlidir. Hukuki görüş değildir; bir olayın ihlal olduğuna ya da bildirim gerektiğine **kendisi karar vermez**.

## 0. Değişmez kurallar

1. **Gizli kalan bilgiler:** Olay ayrıntısı, kimlik, hesap sayısı, IP, sır değeri, ham log ve delil **public GitHub'a yazılmaz.** Public issue'da yalnız durum ve özel olay dosyasına maskeli referans bulunur.
2. **Resmî bildirim ve dış mesaj** (KVKK Kurulu, ilgili kişi, kullanıcı duyurusu) **yalnız Mehmet'in açık onayıyla** gönderilir. Bu runbook gönderme yetkisi vermez.
3. **Şüphe karar değildir** (50A). Sırf şüphe otomatik "ihlal" kararı ya da resmî bildirim sayılmaz. Bunun tersi de geçerli: anormal iz bulunmaması "etki yok" demek değildir.
4. **Süre öğrenmeyle başlar.** Bildirim gerekirse KVKK çerçevesi (gecikmeksizin, en geç 72 saat) olayın **öğrenildiği andan** işler. Yayın tarihini ya da hukuki görüşü beklemek süreyi durdurmaz.
5. **Bağımsız onay yoksa kritik devir yok** (42A, 49A). Fail-closed: otomatik korumalar sürer, kritik erişim veya yetki devri yapılmaz.
6. **Pepper'ı körlemesine değiştirme.** `AUTH_TOKEN_PEPPER` oturumları ve (#300 merge olana kadar) MFA şifrelemesini etkiler. Değiştirmeden önce §4.3'teki sıraya uy; aksi hâlde yöneticiler MFA'da kilitlenir.

## 1. Roller

| Rol | Kişi | Görev |
| --- | --- | --- |
| Olay sahibi / ilk müdahale | Faruk | Alarmı karşılar, sınıflandırır, teknik kontrol altına alır, zaman çizelgesini tutar |
| Birincil güvenlik sorumlusu | Ümit | Güvenlik olayında oturum ve erişim kararları, olayın panelden üstlenilmesi (48A) |
| Yedek güvenlik sorumlusu | Mert | Ümit müsait değilse; kritik yetkisi yalnız bağımsız onayla, en fazla 8 saat (#41). Kendi devrini onaylayamaz |
| Bağımsız onay adayları | Mehmet, Utku, Faruk | Mert'in devrini onaylayabilir. Görev kabulü, eğitim, etkin MFA ve RBAC tamamlanmadan hiçbiri onay yetkisi kazanmaz (#41) |
| İşletmeci / veri sorumlusu tarafı | Mehmet | Ürün kararı, bakım modu, kullanıcı iletişimi, resmî bildirim kararı ve onayı |
| Güvenlik incelemesi | Utku | Bağımsız güvenlik incelemesi, secret rotasyonunun gözden geçirilmesi |

Bir kişi aynı olayda hem talep eden hem onaylayan olamaz.

## 2. Sınıflandırma

| Seviye | Örnek | İlk hedef |
| --- | --- | --- |
| **S1: kişisel veri şüphesi** | DB/yedek/medyaya yetkisiz erişim şüphesi, sızan secret, sağlayıcı güvenlik duyurusu, yanlış kişiye giden veri | Hemen §3 ve §4 |
| **S2: güvenlik, veri yok** | Yetki hatası (veri erişimi kanıtlanmadan), şüpheli oturum, kaba kuvvet | Aynı gün; veri erişimi ortaya çıkarsa S1'e yükselt |
| **S3: hizmet** | Kesinti, hatalı deploy, migration sorunu, alarm | KV-49 akışı (rollback/restore) |

Emin değilsen bir üst seviyeyi seç.

## 3. Kişisel veri ihlali şüphesi (50A)

1. **Hemen bilgilendir:** Mehmet'e ve güvenlik sorumlularına (Ümit, yoksa Mert) **özel kanaldan**. Kanal e-posta + güvenli yönetici paneli; ulaşılamazsa §5.
2. **Özel olay dosyasını aç** (repo dışında, erişimi kısıtlı). İçerik:
   - öğrenme anı (UTC) ve kim öğrendi;
   - zaman çizelgesi;
   - etkilenen ortam (gerçek mi sentetik/staging mi);
   - olası veri kategorileri ([#288 envanteri](LEGAL_288_PROVIDER_TRANSFER_INVENTORY.md) K1–K10);
   - olası ilgili kişi grupları;
   - delil erişimi ve sınırları (ör. "bağlantı geçmişi tutulmuyor").
3. **Public kayıt:** #291'e yalnız "S1 olay dosyası açıldı, özel referans: …" düşülür.
4. **Hukuki değerlendirme (Mehmet + hukuk):** Kurul ve ilgili kişi bildirimi gerekiyor mu? Karar gerekçeli ve tarihli yazılır; "gerekmiyor" kararı da gerekçesiyle kaydedilir. Belirsizliklerin sahibi ve tamamlayıcı inceleme tarihi belirlenir.
5. **Bildirim gerekirse:** süre §0.4'e göre işler. Eksik bilgi sonradan tamamlanır; gecikme varsa gerekçesi yazılır. Metin ve gönderim Mehmet'in onayıyla yapılır.

## 4. Teknik kontrol altına alma

Her adımdan önce ve sonra zamanı olay dosyasına yaz. **Önce kanıtı ve kurtarma noktasını koru, sonra değiştir.**

### 4.1 Kurtarma noktası
- Değişiklikten önce şifreli yedek al (KV-48 `db:backup` + zarf şifreleme). Yedek alınamıyorsa nedenini yaz.
- Restore gerekiyorsa yalnız izole hedefe yapılır. Silinmiş hesapların geri gelmemesi için restore kapısı (#322/#338) çalıştırılır; kapı NO-GO verirse açma.

### 4.2 Erişimi kes
| Gerekirse | Araç |
| --- | --- |
| Yeni yazımları durdur | `maintenance.enabled` (KV-40, `admin.emergency.put`). Okuma, giriş/çıkış ve `/admin` açık kalır |
| Tek bir yüzeyi kapat | Acil durum anahtarları: `features.registration`, `features.pollCreation`, `features.comments`, `features.uploads` |
| Şüpheli kullanıcı oturumları | `admin.users.sessions.revoke` (kullanıcı bazında) |
| Şüpheli yönetici | Rolü geri al ya da yaptırım uygula. Tek SUPER_ADMIN kilitlenmesine dikkat: SA180 |
| Geçici erişimler | Açılmış DB proxy'si, geçici token, paylaşılmış panel erişimi kapatılır (KV-49 kuralı) |

### 4.3 Secret rotasyonu (sıra önemli)
1. **Hangi secret'ın etkilendiğini** yaz (ad, değer değil). Staging ve production secret'ları ayrıdır; birinin sızması diğerini değiştirmeyi gerektirmez, ama kontrol edilir.
2. **DB parolası, S3 anahtarları, SMTP/Mailpit kimliği:** sağlayıcı panelinden yenile → servis değişkenini güncelle → redeploy → `/health` doğrula → eski değeri iptal et.
3. **`AUTH_TOKEN_PEPPER`:** değiştirmek **bütün oturumları düşürür**.
   - #300 merge edilmediyse MFA sırları da bu pepper'la şifrelidir; körlemesine değiştirmek MFA'yı kilitler.
   - #300 sonrası sıra: `MFA_ENCRYPTION_KEY` mevcut olmalı → `mfa:rekey` ile v1 sırlar v2'ye taşınmış olmalı → eski pepper `MFA_LEGACY_PEPPERS`'a eklenir → yeni pepper verilir → doğrulanır. Ayrıntı: `docs/SA180_MFA_KEY_ROTATION.md` (#300 dalında).
   - Ayrıcalıklı hesaplar için Mehmet'in 7 Kasım kararı: kontrollü yeniden kayıt (#180).
4. **`BACKUP_PUBLIC_KEY` / yedek özel anahtarı:** özel anahtar sızdıysa yeni anahtar çifti üretilir, yeni yedekler yeni anahtarla alınır. Eski yedekler eski anahtarla açılabilir kalır; saklama ve tasfiye kararı Mehmet'tedir (30 gün tavanı).
5. Rotasyon kanıtı (ne zaman, kim, hangi secret adı, doğrulama) özel dosyaya yazılır.

### 4.4 Doğrula ve kapat
- `/health`, staging smoke, güvenlik read-only kapısı (`security-staging.yml`).
- Açılan bütün geçici erişimler kapatıldı mı?
- Bakım modu ve acil durum anahtarları eski hâline döndü mü (karar Mehmet'te)?

## 5. Acil uyarı ve olayın üstlenilmesi (43A–49A)

| Konu | Kural | Bugünkü teknik durum |
| --- | --- | --- |
| Birincil kanal | Yetkili yöneticinin e-postası + güvenli yönetici paneli; ilk uyarı **anında**, sonra **saatte bir**, aynı olay için birleştirilmiş | Staging'de gerçek e-posta yok (Mailpit). Otomatik uyarı iş akışı #185'te (Utku/Mehmet); **henüz yok** |
| Uyarı içeriği | Hassas kişisel veri, sır, MFA kodu, kurtarma bağlantısı, token ve ifşa edici ayrıntı yok | Kural; uygulama gelince negatif test gerekir |
| Üstlenme (48A) | **Yalnız yetkili kişinin MFA korumalı panelden olayı açıkça üstlenmesi** sayılır. E-posta veya push teslimi üstlenme değildir | Panel akışı **henüz yok** |
| İkinci kanal (45A/46A) | Önceden doğrulanmış yetkili cihaza push. Kayıt için MFA + cihaz sahipliği + bağımsız onay; kayıp cihazda erişim hemen askıya alınır (47A) | **Yok.** Sağlayıcı seçilmedi; 53A gereği kapalı ([#288 §5](LEGAL_288_PROVIDER_TRANSFER_INVENTORY.md)) |
| Push de başarısız (49A) | Kritik erişim/yetki devri **kapalı**; acil inceleme kuyruğu ve anında + saatlik uyarı sürer | Push olmadığı için bugün bu durum geçerli |

Otomatik iş akışı gelene kadar ilk müdahaleci uyarıyı **elle** gönderir ve olay dosyasına yazar: gönderim zamanı, kime, hangi kanaldan, cevap.

## 6. Kapanış

Olay kapatılmadan önce, ayrı ayrı kanıtlı olarak:
- [ ] Teknik kök neden ve kontrol altına alma adımları.
- [ ] Secret rotasyonu (gerekiyorsa) ve doğrulaması.
- [ ] Bildirim değerlendirmesi: karar, gerekçe, tarih. "Gerekmiyor" kararı da yazılı.
- [ ] İlgili kişi iletişimi (gerekiyorsa, Mehmet onaylı).
- [ ] Geçici erişimler kapalı; bakım modu ve anahtarlar eski hâlinde.
- [ ] Ders ve takip işleri issue olarak açıldı (ayrıntısız).
- [ ] #291'de yalnız durum: "kapandı, özel dosya referansı: …".

Zorunlu olmayan bir bildirim "tamam" görünsün diye uydurulmaz.

## 7. Masa başı tatbikat (production öncesi)

Gerçek veri ya da gerçek bildirim kullanılmadan, staging üzerinde:
1. **Senaryo A:** staging S3 anahtarı sızdı → §4.1–4.4, rotasyon ve `/health`.
2. **Senaryo B:** sağlayıcı güvenlik duyurusu (Railway 21 Ekim örneği) → §3 akışı: dosya, öğrenme anı, kategori, değerlendirme sahibi.
3. **Senaryo C:** Ümit'e ulaşılamıyor, Mert devir istiyor, onaycı yok → 49A fail-closed; devir yapılmadığı doğrulanır.

Her tatbikatın tarihi, katılanlar ve süre ölçümleri özel dosyaya yazılır; #291'e yalnız "tatbikat yapıldı, referans" düşülür.

## 8. Açık işler

| İş | Sahip | Bağlı |
| --- | --- | --- |
| Otomatik acil uyarı (anında + saatlik, birleştirme) | Mehmet/Utku | #185 |
| Panelden MFA korumalı olay üstlenme | Mehmet/Utku, UI Ümit | #185, #46 |
| Push yedek kanalı (sağlayıcı, cihaz kaydı, kayıp cihaz) | Faruk (teknik plan), Utku (güvenlik) | #180, #288 (53A) |
| MFA anahtar ayrımı (pepper rotasyonunu güvenli kılar) | Faruk | #300 |
| Production olay sahipleri, log saklama süresi ve tatbikat | Faruk + Mehmet | #51, #291 |

**Durum: NO-GO.** Runbook hazır; otomatik uyarı, üstlenme akışı, push kanalı ve tatbikat kanıtı açık.
