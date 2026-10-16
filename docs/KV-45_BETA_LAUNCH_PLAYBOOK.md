# KV-45 / #47 — Kapalı beta uygulama ve ölçüm planı

**Hazırlık:** 16 Ekim 2026 · **Sorumlu:** Mehmet · **Durum:** READY_TO_PREPARE / **INVITES_BLOCKED (NO-GO)**. Bu belge yalnızca güvenlik kapısı geçildikten sonra uygulamaya alınacak pilot planıdır. Gerçek davet, onay, katılımcı veya sonuç iddiası içermez.

## 1. GO/NO-GO ve davet kilidi

Davet bağlantısı **yalnızca** #46 güvenlik sorumlusunun aynı `main` SHA + gerçek staging HTTP kanıtıyla GO vermesi, #48 erişilebilirlik ve medya P0/P1 engellerinin kapatılması, #51 yedek/olay müdahale/SMTP kararı ve #53 release matrisiyle birlikte onaylanır. Son karar #54'ten ayrıdır: beta GO production/public V1 GO değildir.

Özellikle açık: #246 gerçek özel-bucket medya kabulü; iki farklı SUPER_ADMIN onayı ve MFA; izole emergency-switch testi; gerçek SMTP sağlayıcı ve teslim; gerçek Android/Windows ekran okuyucu kanıtı. P0/P1 açıkken **davet atılmaz ve gerçek kullanıcı ölçümü başlamaz**. Sürüm değişirse ilgili regresyonlar yeni SHA'ya bağlanmadan eski PASS kullanılamaz.

Karar kaydı alanları: UTC, staging API SHA, web SHA, CI run, #46/#48/#51/#53 bağlantıları, kapatılan P0/P1, GO/NO-GO, karar veren ve geri alma tetikleyicisi. Şifre, token, çerez, kişisel kimlik ve özel URL yazılmaz.

## 2. Katılımcı hedefi (40 kişi; 30–50 aralığında)

Mevcut `scripts/beta-report.mjs` şemasındaki hedeflerle birebir:

| Segment anahtarı | Hedef | Ölçülmek istenen |
|---|---:|---|
| `new_user` | 16 | Yardımsız gezinme → etkileşim → kayıt |
| `social` | 10 | Anket, yorum, reaction ve geri dönüş |
| `creator` | 8 | İki içerik türü, 20/10 puan, taslak ve hata |
| `community` | 6 | Topluluk üyeliği, görünürlük, moderatör sınırı |
| **Toplam** | **40** | Davet / kabul / aktivasyon ayrı sayılır |

Üniversite/yaş/il veya iletişim bilgileri **GitHub issue'larına kaydedilmez**. Katılımcı gönüllü rıza verir; iptal/çekilme ve destek kanalı duyurulur. 40 kişilik hedefe ulaşılana kadar sırf metrik için sahte veya demo kullanıcıyla sayı doldurulmaz. Daha fazla katılımcı için ayrı onay gerekir.

## 3. Pilot içerik ve 13 yardım almadan kullanım vakası

İlk hafta moderasyon ekip sorumlularınca, fotoğraf zorunlu olmadan ve kişisel veriye ihtiyaç duymayan üç örnek gerçek kategori taslağı hazırlanır: teknoloji tercihi, alışveriş kararı, üniversite yaşamı. Sahte topluluk sayısı/oy/grafik yayımlanmaz. Davetlilere yayın öncesi bu içeriklerin kaynağı açıklanır.

| Kod | Yardımsız test senaryosu | PASS ölçüsü |
|---|---|---|
| B01 | Misafir ana akışı gezinme | Kayıt duvarı olmadan gerçek içerik |
| B02 | Kategori ve keşfet | Filtre/arama doğru içerik gösterir |
| B03 | Anket detayını açma | Oy vermeden görülebilen alanlar açık |
| B04 | Oy tıklayınca giriş | Girişte aynı ankete/taslağa dönüş; otomatik oy yok |
| B05 | Kayıt ve e-posta durumu | Geçerli doğrulama politikası, anlaşılır hata/kurtarma |
| B06 | Oy verme ve değiştirme | Tek aktif oy ve gizli sonuç kuralı |
| B07 | Yorum ve yanıt | Kaydetme/hata durumunda taslak korunur |
| B08 | Like / dislike | Yalnız gerçek API geri bildirimi |
| B09 | Seçenekli anket oluşturma | 10 puan ve taslak onayı görünür |
| B10 | Seçeneksiz tartışma | Fotoğraf zorunlu değil, puan doğru |
| B11 | Yetersiz puan ve retry | 3. yayın engeli; başarısız işlem çift harcama yok |
| B12 | Topluluk katıl/ayrıl | Yetki ve sayfalı üye görünürlüğü doğru |
| B13 | Bildirim, profil ve çıkış | Session/logout ve erişilebilir geri dönüş |

Bu senaryolar pilot gözlem planıdır; otomatik betikte `B01`–`B13` geçerli IDs olarak var, ancak raporun ayrıntılı kullanıcı eylem anlamını bu tablo tanımlar. Kritik/yüksek yeni hata oluşursa yeni davet durur; etki sahibine aktarılır ve aynı SHA üzerinde tekrar test yapılır.

## 4. Ölçüm ve mahremiyet

Yalnızca özel alanda, `BETA-...` takma ID ve onaylı anonim şema kullanılır: `beta-private/participants.json`, `tasks.json`, `bugs.json`. Bu dosyalar git'e commit'lenmez; e-posta, isim, ham IP, erişim tokenı, oturum çerezi, mesaj içeriği ve serbest metin içermez. QA/demo hesapları katılımcı ölçümüne eklenmez.

```bash
node scripts/beta-report.mjs \
  --participants beta-private/participants.json \
  --tasks beta-private/tasks.json \
  --bugs beta-private/bugs.json \
  --as-of 2026-10-23T00:00:00.000Z
```

Bu tarih yalnız **örnek parametredir**; gerçek rapor için gözlem anının UTC zamanını kullan. İlk davet, kabul, aktivasyon ve ilk oy/yorum/yayın oranı ayrı paydalarda ölçülür. D1 yalnız 1 günü dolan; D7 yalnız **7 günü dolan** aktivasyon kohortlarından hesaplanır. Henüz olgun kohort yoksa `N/A`, hiçbir zaman `0% geri dönüş` değil. D7 iddiası üretmek için pilot en az yedi gün gözlenmelidir.

## 5. Uygulama sırası ve roller

1. **Mehmet:** #46 GO kaydı, pilot kapsamı ve davet metninin onayı; güvenlik kapısından önce davet **yok**.
2. **Mert:** #53 regresyon matrisi, #195 cihaz/erişilebilirlik ve bug triage; içerik/medya hatalarının sahipleriyle kabulü.
3. **Utku:** #182 iki yönetici MFA/yetki testi; audit ve rol güvenlik kontrolü.
4. **Faruk:** #51 gerçek SMTP, yedekleme/restore, alarm ve geri dönüş sorumlusu.
5. **Ümit:** #190/#192/#193 UI düzeltmeleri; yükleme/hata/360px ve ekran okuyucu destek testleri.

Her gün: yeni davet sayısı, kabul/aktivasyon, B01–B13 en az bir gerçek PASS, yardım alma oranı, P0/P1 bulgular ve kesinti/geri dönüş. İlk değerlendirme gerçek ilk davetten **sonra**, P0/P1 varsa genişleme durdurulur. Sorun çözüldüğünde #46 / #53 kanıtları güncellenir.

## 6. Tamamlanmış sayılmayacaklar

Bu plan **40 gerçek davet**, gerçek SMTP teslimi, gerçek cihaz testi, beta metrikleri, üretim yayını veya güvenlik GO değildir. #47, #54 ve üst issue'lar gerçek kanıt gelmeden kapatılmaz.
