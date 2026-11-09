# KararVer — 30 günlük DB yedek politikası ve silme-sonrası geri yükleme kapısı

**İşletmeci kesin kararı:** Mehmet, 8 Kasım 2026. PostgreSQL için **operasyonel yedek saklama üst sınırı 30 gün**. Bu süre kişisel verileri/yedekleri 30 gün boyunca her koşulda tutma izni değildir; amaç ortadan kalkınca yürürlükteki silme/yok etme yükümlülükleri, hukuki istisnalar ve güvenlik tedbirleri ayrıca uygulanır.

**Bu belge yasal görüş/fiilî provider konfigürasyonu/production kabulü değildir. Sonuç: NO-GO.**

## Saklama katmanlarının ayrımı

| Kayıt / kopya | Karar ve kural | Teknik durum |
| --- | --- | --- |
| Günlük şifreli PostgreSQL DB snapshot'ı | **En fazla 30 gün** (GitHub özel yedek reposu artifact `retention-days: 30`). | #311 şablon ve public kod doğrulama 35 → 30 değiştirildi; private repoda gerçek workflow'un güncellendiği ayrıca teyit edilmeli. |
| Deploy öncesi PostgreSQL dump'ı | Son 5 deploy politikası **30 gün üst sınırını aşamaz**. | #311 runbook güncellendi; gerçek lifecycle silme mekanizması ayrıca gerekli. |
| Sağlayıcı Neon PITR/otomatik yedekler | İlgili saklama ayarı ve plan limiti kontrol edilerek **30 günden uzun aktif tutulmaması hedeflenir**; sağlayıcı tarafından zorunlu farklı süre varsa açık istisna kararı gerekir. | Gerçek sağlayıcı hesabı ve tarihli saklama politikası teyit edilmedi, otomatik değişiklik yapılmadı. |
| Önceden alınmış 35 günlük artifact, eski Railway/başka dış snapshot ve yedek bucket | Aynı 30 gün üst sınırına göre envanter, erişim ve güvenli tasfiye planı. | Yeni YAML eski artifact'ın ömrünü kısaltmayabilir. Mevcut dosyalar, restore kanıtı ve kayıp riski değerlendirilmeden **toplu silinmez**. |
| İmha/silme işlemi delili | KVKK Yönetmeliği m.7/3 uyarınca **en az 3 yıl**, başka yükümlülükler saklı. Yalnız işlem, zaman, yöntem ve gerekli asgari ispat, rol-kısıtlı ayrı kayıt. | Genel DB snapshot'larını bu nedenle 3 yıl tutmak gerekmez. İmha kaydının kategorisi/erişim/süre ve güvenli saklama yolu #285/#181'de hukukla kararlaştırılmalı. |
| Audit/rapor/yaptırım/legal hold | Otomatik “anonim” veya “süresiz saklanır” sayılmaz; kayıt kategorisi, hukuki şart, erişim ve ihtiyaç süresi ayrı. | #181/#285/#290/#291 açık. |
| Medya nesnesi, CDN ve e-posta logu | PostgreSQL yedeğiyle aynı veri türü değildir; ayrı envanter, süre ve silme kanıtı gerekli. | #302 ve #321 bağımlılığı. |

## Neden normal restore PASS yetmez?

`packages/db/ops/restore.ts` şu an şema, göç, tablo sayısı, invariants ve dump hash doğrular. Ancak 7 Kasım tarihli bir yedek **8 Kasım'da silinen** kullanıcıyı içerir ve snapshot tutarlı olduğu için restore yine PASS verebilir. Bu nedenle:

1. **Silme işlem kaydı, restore edilmekte olan aynı DB/snapshot'ın içinden değil; ayrı, güvenilir ve append-only operasyondan gelmeli.** Kayıt, bütün silme kararlarını kapsamalı, kesintisiz geçmiş ve watermark kanıtı vermelidir. Private kanaldaki log dosyası kimlikleri kamuya açmayacak; anahtar ayrı görevde tutulacak.
2. Yedek **yalnız izole/quarantined DB'ye** restore edilir. Uygulamanın web/API/worker'ları, e-posta gönderimi, medya yayını ve public ağ erişimi kapalıdır.
3. Snapshot sonrası güncellenmiş **Ed25519 imzalı** bağımsız silme listesinin taze, tekil ve bütünlüğü doğrulanır. `packages/db/ops/restore-erasure-gate.mjs` listede geçen hesaba ait `user`, `poll`, `comment`, `vote`, `session`, `authToken` ve `mediaAsset` satırı bulursa **exit 2 / NO-GO** döndürür. Tek bir tombstone `user` satırı bile “yalnız anonim istatistik” sayılıp geçirilmez. **Silme yapmaz**, eksik ledger'i kendisi yaratmaz.
4. Hatalı/eski/imzasız/başka anahtarla imzalanmış kayıt, fazla yetkili DB hedefi veya üretimle aynı DB **reddedilir**. Geçerli belge olmadan boş `[]` listeye güvenilmez; listeyi üretme, imzalama ve kapsama bakımından ayrı operasyonel kabul zorunlu.
5. Eğer silinen kullanıcı tekrar görünürse **promosyon durdurulur**; veri üzerine silme SQL'i körlemesine çalıştırılmaz. #321 kapsamında doğrulanmış **erase replay** algoritması, FK/third-party hakları ve tüm linked verilerle yeni temiz restore üretir; kontrolü yeniden koşar.
6. Harici kayıt erişilemezse, restore güvenli biçimde devreye alınmaz; kontrollü başka recovery planına geçilir. Yalnız `restore.ts` başarılı sonucu kamuya açma yetkisi **değildir**.
7. Son check ile canlı trafiğe yönlendirme arasında yeni silme talebi olabileceğinden, veri değişim penceresi ve journal yeniden doğrulaması operasyonel bir onay adımıdır. Silme geçmişinin **eksiksiz ve imzalı kaynakça** üretimi henüz uygulanmadı.

## Salt-okuma denetim örneği (yalnız yalıtılmış ve özel ortamda)

```bash
# Dışarıdan güvenle imzalanmış, HER silme kararını içeren güncel journal
# backup manifesti restore edilen dump'ın manifestidir
# Değerleri ve özellikle kullanıcı ID'lerini issue/CI loglarına YAZMAYIN.
RESTORE_DATABASE_URL=postgresql://...@127.0.0.1:5432/kararver_restore_check \
ERASURE_JOURNAL_PUBLIC_KEY_PEM="(sahibi doğrulanmış PUBLIC Ed25519 anahtarı)" \
node packages/db/ops/restore-erasure-gate.mjs \
  --manifest /secure/snapshot.dump.manifest.json \
  --ledger /secure/erasure-journal.json \
  --signature /secure/erasure-journal.sig
```

Ledger formatı, **işletmecinin özel/imzalı deposunda**, şu sabit alanları içerir:

```json
{
  "version": 1,
  "kind": "kararver-independent-erasure-journal",
  "sealedThrough": "2026-11-08T10:15:00.000Z",
  "erasedUserIds": []
}
```

Bu **şema örneğidir; gerçek kişisel veri veya kabul kaydı değildir**. İmza, JSON dosyasının **tam byte dizisi** üzerine Ed25519 ile alınır ve ayrı `.sig` ikili dosyasıdır. Silme listesi kişisel veri niteliği taşıyabileceğinden yayınlanan repoda veya CI artifact'ta tutulmaz. Public anahtar güvenli işleyişte bir trust root'tan alınmalı; dosyaya beraberinde kaynağı belirsiz anahtar koyup onu “geçerli” saymak yeterli değildir.

`READ_ONLY_VERIFIED_PENDING_HUMAN_GO` bile yalnız listedeki kimliklerin DB'de yeniden görünmediğini gösterir; **listenin tamlığını, geçmiş diğer silmeleri, gerçekten anonim toplulaşmayı, yedek/media yaşam döngüsünü veya hukuki kabulü kanıtlamaz**. Operasyonel süreç ayrıca doğrulanmadan API/worker'a route değiştirmez.

## Ayrı uygulama/acceptance iş listesi

- [ ] **Faruk (#311/#51):** 30 günlük private artifact YAML'ı private repo workflow'una kontrollü uygulansın; 30 gün dışındaki eski artifact'lar sayısal envanter ve doğrulanmış geri dönüş planıyla temizlensin; sağlayıcı PITR/bucket/deploy snapshot yaşam döngüsü belgelensin. 0 TL bütçe sınırı, yeni ücretli altyapı yok.
- [ ] **Faruk + Mert (#321):** Ana canlı kaynaktan dış, append-only/signed tam silme journal'i (audit/legal record'dan ayrı, private, yedek snapshot'ına geri dönmeyen) tasarlanıp test edilsin. Ledger'da ikili işlem, kaybolan satır, token/medya, silme sonrası eski dump ve negatif/yarış senaryoları kapsansın.
- [ ] **Faruk + Utku:** Silme replay, üçüncü kişi hakları/FK'ler/anonim toplu oy verisi, yedek restore imzası, en son watermark ve promote-öncesi güvenlik kararını sağlayan **gerçek** E2E restore tatbikatı; explicit fail-closed ve 0 kullanıcı verisi sızıntısı.
- [ ] **Mert + hukuk (#285/#181):** İmha işlemi kaydının en az 3 yıl saklanması (m.7/3), başka kanuni saklama istisnaları, başvuru ve gerekiyorsa üçüncü kişilere bildirim/silme; erişim ve süre kararları belgelenmeli.
- [ ] **Mehmet (#54):** Gerçek SUPER_ADMIN/işletmeci kabulü ve son yayın GO; CI green veya kaynak okuyucu testi GO değildir.

## Resmî kaynak

- [KVKK — Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK), özellikle m.5(3), m.7(3), m.8–10, m.12. Bu kararın uygulama hukukuna göre yorumlanması ve şirket/şahıs işletmecisi kapsamı ayrıca değerlendirilmelidir.

**NO-GO:** Harici tam günlük, gerçek geri alma tatbikatı, KVKK ve sağlayıcı konfigürasyonu kanıtı tamamlanmadan silinmiş kişilerin geri gelmeyeceği **garanti edilmez**.
