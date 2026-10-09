# #47 / KV-45 — Kapalı beta çalıştırma rehberi

**Durum: NO-GO / sadece hazırlık.** #46 güvenlik kabulü açık; #51 güncel Railway/Vercel altyapı ve e-posta doğrulaması bağımlılığı açık. Davet, kullanıcı kabulü, gerçek etkileşim ve içerik yayını **başlatılmadı**. Teknik altyapı yalnızca ölçüm ve yayın öncesi hazırlık.

Ana çalışma planı: [KV-45_CLOSED_BETA.md](../KV-45_CLOSED_BETA.md). Yayın kanıtı: [KV-51_RELEASE_EVIDENCE.md](../KV-51_RELEASE_EVIDENCE.md).

## 1. Yalnız gerçek kabul kanıtı sonrasında beta kapısını aç

**GO yetkisi:** Proje sahibi Mehmet; #46 güvenlik onayı Utku; #51 operasyon/sürüm uyumu Faruk; #53 test/regresyon kanıt koordinasyonu Mert. Bu isimler #47 kapsamında ek görev sahibi değildir, yayın güvenliğinin mevcut dış bağımlılıklarıdır. #46, #51 ve #53'ün gerçek staging SHA'lı kanıtları olmadan "GO" denmez.

1. [ ] #46 üzerinde 20 paralel oy, yetki yükseltme, topluluk ayrışması, sonuç gizliliği, rate limit, moderasyon bypass ve P0/P1 bulgularının sıfırlandığına dair açık linkli kanıt.
2. [ ] #51 üzerinde **aynı commit'e** ait Vercel web + Railway API, gerekli migration, e-posta onayı, storage/worker/cron, HSTS/CORS/CSRF ve rollback kanıtı.
3. [ ] #53'te B01–B13'ün teknik alt akışlarıyla sürüm/CI/gerçek staging kanıtı eşleşmesi; #48'de gerçek cihaz kabulünün gerekli bölümü.
4. [ ] Beta erişimi davetlilerle sınırlı, kayıt ve içerik yetkileri kontrol edilmiş. **Vercel SSO'yu herkese açma; güvenlik kapısını aşma.**
5. [ ] Katılım açıklaması, geri bildirim kanalı, veri saklama ve silme isteği süreci, acil durum sorumlusu, durdurma planı hazır.
6. [ ] Seed/demo/test aktörleri gerçek beta analitiğine dahil değil. Gerçek beta sayıları sadece onaylı katılımcılardan.
7. [ ] Mehmet #47 issue'suna **GO + UTC zaman + deploy SHA + gerekçe/kanıt linkleri** kaydını ekledi.

Şu an hiçbir madde varsayılan olarak tamamlanmış değildir. "Kod testleri yeşil" ≠ "beta GO".

## 2. Dışarıdan davet/iletişim

Hedef 30–50 davetli; çalışma kotası **40**, segmentler: yeni kullanıcı 16, sosyal kullanıcı 10, üretici 8, pilot topluluk 6. Bunlar **hedef**, gerçek sayı değil. Pilot yöneticiler dâhil 2 görevli daha sonra seçilecek.

Önce katılım isteğini özel kanalda al; açık rıza alındıktan sonra, yalnız GO kaydı sonrası özel erişim ilet. Geri bildirimin kullanım amacını, iletişimden çıkış yolunu ve test verilerinin niteliğini belirt. Katılım zorunlu değildir; katılımcı durdurmak istediğinde tekrar iletişim kurma. **Kimseye bu PR nedeniyle otomatik davet gönderilmez.**

GitHub'a isim/e-posta/telefon, davet bağlantısı, oturum cookie'si, IP, ham görüşme notu, kişisel içerik ekran görüntüsü koyma. `BETA-001` gibi **rastgele katılımcı kimliği** sadece yerel kayıtlarında bulunsun; kimlik eşleme tablosunu repoda tutma. Bilgilerin tutulması/silinmesi için ilgili operasyon kararı şarttır.

## 3. Yerel ölçüm dosyaları ve rapor

`.gitignore` ile `beta-private/` ve `beta-reports/` korunur. Bu klasörlerdeki veriyi yalnız yetkili ekipte, korunmuş ortamda tut. Şablonlar *boş dizi* olduğu için yapay sonuç üretmez.

```bash
mkdir -p beta-private beta-reports
cp docs/beta/participants.example.json beta-private/participants.json
cp docs/beta/tasks.example.json beta-private/tasks.json
cp docs/beta/bugs.example.json beta-private/bugs.json

pnpm beta:test
pnpm beta:report --participants beta-private/participants.json \
  --tasks beta-private/tasks.json --bugs beta-private/bugs.json \
  --as-of 2026-10-20T00:00:00.000Z
```

`--as-of` raporlama kesitidir, **gerçek ölçüm saati** seçilmelidir. Rapor kişisel alan içeren nesneleri reddeder. JSON çıktısı gerektiğinde aynı komuta `--json` ekle. Ham dosyaları issue'ya ekleme; yalnız toplu çıktıyı güvenlik/izin kontrolünden sonra #47'ye gönder. Betanın henüz başlamadığı gün raporda gerçek davet sıfır görünmesi yalnız **boş şablon kullanıldığını**, gerçek dünyadaki davet kaydının olmadığını değil, ifade eder.

### Şema: participants.json (yalnız gerçek katılımcı onayı ve aktivasyonundan sonra doldur)

```json
[
  {
    "participantId": "BETA-001",
    "segment": "new_user",
    "invitedAt": "2026-10-20T09:00:00.000Z",
    "consentedAt": "2026-10-20T10:00:00.000Z",
    "acceptedAt": "2026-10-20T10:01:00.000Z",
    "activatedAt": "2026-10-20T11:00:00.000Z",
    "activityDatesUtc": ["2026-10-20", "2026-10-21"],
    "firstActions": {
      "vote": "2026-10-20T11:04:00.000Z"
    },
    "withdrawnAt": null
  }
]
```

**Örnek tamamen kurgusaldır; repoya eklenmiş gerçek veri değildir.** Davet/katılım alanları henüz yoksa `null`, aktivasyon yoksa `activityDatesUtc: []`, `firstActions: {}` kullan. Segment: `new_user`, `social`, `creator`, `community`. İlk eylemler: `poll`, `discussion`, `vote`, `comment`, `reaction`, `communityJoin`. `consentedAt` izinsiz kabul ve sayımın önüne geçer.

### Şema: tasks.json

```json
[
  {"participantId":"BETA-001","caseId":"B01","result":"PASS","assisted":false,"observedAt":"2026-10-20T11:06:00.000Z"}
]
```

Yalnız B01–B13. Aynı kişinin aynı senaryoda en son doğrulanmış sonucu tutulur (eski sonucu ayrıca özel not defterinde saklayabilirsiniz; bu rapora aynı anahtarla ikinci satır giremezsiniz). `PASS`, `FAIL`, `BLOCKED`. Yardım aldıysa `assisted:true` ile kaydet; yardım verilmiş testi yardımsız sayma.

### Şema: bugs.json

```json
[
  {"id":"BETA-BUG-001","severity":"P1","state":"OPEN","owner":"mehmetalisahingm","issueUrl":"https://github.com/mehmetalisahingm/kararver/issues/47"}
]
```

Örnek kurgusaldır ve yalnız biçimi gösterir; gerçekten tespit edilen P1 vakası değildir. Gerçek bulguda **ayrı issue** aç, doğru URL'yi kullan. `FIXED` hâlâ **açık veya teyitsiz** sayılır; ancak bağımsız `VERIFIED` (aynı sürümde tekrar test) sonrasında engelden düşer. Bu dosyada hata açıklamaları/kişisel kanıt tutulmaz.

## 4. D1/D7 ve rapor tanımı

- Davetli = `invitedAt` dolu benzersiz kullanıcı.
- Kabul = `consentedAt` + `acceptedAt` dolu kullanıcı (yalnız izinli).
- Aktivasyon = gerçek `activatedAt` ile ilk anlamlı eylemi yapan kullanıcı; yapay seed/demo hariç.
- D1 = aktivasyondan **en az 24 saat** geçmiş hesaplar payda; aktivasyon gününden sonraki ilk UTC takvim gününde `activityDatesUtc` varsa dönüş.
- D7 = aktivasyondan **en az 7×24 saat** geçmiş hesaplar payda; aktivasyondan sonraki 7. UTC gününde aktivite varsa dönüş. Olgunlaşmamış kullanıcı **paydadan çıkarılır**.
- Tamamlanma = B01–B13 görevinin gerçek `PASS` sonucu. Yardım oranı = `assisted=true` görev / gerçekten denenmiş (`PASS` veya `FAIL`) görev.
- P0/P1 = `OPEN` **veya** `FIXED` (bağımsız tekrar test eksik) bulgular; güvenlik kapısı yokken rapor otomatik GO vermez.
- Mevcut rapor bir **lokal yardımcıdır**, analitik servisinin kurulu veya eventlerin prod ortamından aktığı anlamına gelmez.

## 5. İçerik — yayınlamadan hazır

[12 anket + 8 fotoğrafsız tartışma](seed-content.example.json) taslağı:
- D0: 6 anket / 4 tartışma.
- D1–D2: 4 anket / 2 tartışma.
- D3–D4: 2 anket / 2 tartışma.

Taslakların `actorType:"seed"`, `publishStatus:"DRAFT"` olması bilinçlidir. Kategori temaları canlı `GET /v1/categories` içindeki aktif kategori kimlikleriyle eşleştirilmeden yayınlanmaz; editöryel kontrol, görünürlük/gizli sonuç, raporlama/yorum tercihleri ve yönetim yetkileri test edilmeden otomatik seed yok. İnsan gönderileriyle karışmasın.

## 6. Uygulama sırası ve kabul kanıtı

| Aşama | Kimin kararı / kanıt | Çıktı |
| --- | --- | --- |
| G0 hazırlık | Mehmet | Beta repo kiti, 20 içerik taslağı, test senaryoları, anonim raporlama |
| G1 güvenlik/operasyon kapısı | Utku #46 + Faruk #51 + Mehmet | Staging gerçek testleri; yazılı **GO** kararı |
| G2 kontrollü davet | Mehmet | 30–50 gerçek davet, gönüllü katılım ve izin |
| G3 kullanım ölçümü | Mehmet | B01–B13 gözlemleri, ilk katkı, 20/10/0 puan akışı, tekrar test |
| G4 kapanış | Mehmet + #53 release koordinasyonu | Aggregates, P0/P1=0, D1/D7 (olgun kohort), #47 kabul kanıtı |

**Durdur:** Gerçek data/özel içerik sızıntısı, yetki atlatma, oturum/kayıt blokajı, tekrarlanan oy/puan hatası veya açık P0/P1 saptanırsa yeni davetleri durdur; operatör/issue kaydı oluştur; gerekli acil anahtar/rollback yetkisini kullan. İzin ve güvenlik kapısını **test kolaylığı adına atlama**.

## 7. Kanıt kaydı biçimi

`BETA-CASE | durum: PASS/FAIL/BLOCKED | web SHA / API SHA | zaman UTC | cihaz | maskeli kanıt linki | bug issue | owner | son tekrar test`

Bug #47'de rapor etiketleri: **hedef davet**, **gerçek davet**, **gönüllü kabul**, **aktivasyon**, **ilk oy/yorum/yayın/topluluk**, **D1/D7 olgun kohort**, **yardım oranı**, **açık P0/P1**, **GO/NO-GO gerekçesi**.

## 8. Devam eden engeller

- [#46](https://github.com/mehmetalisahingm/kararver/issues/46): gerçek staging güvenlik kabulü.
- [#51](https://github.com/mehmetalisahingm/kararver/issues/51): sürüm eşlemesi, gerçek posta, worker/cron, prod hazırlığı.
- [#48](https://github.com/mehmetalisahingm/kararver/issues/48): fiziksel cihaz ve erişilebilirlik kabulü.
- [#53](https://github.com/mehmetalisahingm/kararver/issues/53): kanıt/release matrisi.
- [#172](https://github.com/mehmetalisahingm/kararver/issues/172): yeni topluluk başvuru akışı, V1 kapsamındaysa beta öncesi sürüm eşlemesi gerekir.

**#47 bu belgeler yazıldığı için kapatılmayacak. Gerçek kullanıcı testleri ve kanıt olmadan tam kabul imkânsız.**
