# KV-54 — V1.1: topluluk sahipliği ve üniversite doğrulama (#56)

> Sahip: **Mert** · Aşama: V1.1, yayın sonrası backlog; V1'i bloke etmez · Kapanış bağımlılığı: #54 (public V1 yayın kararı)
> Kaynaklar: PRODUCT_TEAM_PLAN §10 ve §24, [V1_USER_FLOW](./V1_USER_FLOW.md) "Topluluklar ve üyeler", [DATA_MODEL](./DATA_MODEL.md) §7 ve §11, [KV-04](./KV-04_ROLES_EVENTS.md) (yetki kataloğu), [KV-33 §8](./KV-33_ADMIN_USERS.md#8-kvkk-veri-dışa-aktarma-181) (KVKK paketi), [KV-39](./KV-39_AUDIT.md) (audit), [KV-40](./KV-40_SETTINGS.md) (ayarlar)

Bu belge bir **tasarım ve kural kararı önerisidir**; kod ve migration değişikliği yoktur. Amaç: V1.1'de topluluk sahipliği ve isteğe bağlı üniversite e-posta doğrulaması gelirken kuralların (talep, onay, ret, itiraz, devir, görünürlük, saklama) ve V1 topluluk izolasyonunun nasıl korunacağının belli olması. Sayısal eşikler ve politika seçimleri §12'deki **açık kararlarla** Mehmet'e bırakılmıştır; onaylanana kadar "önerilen" sayılır.

## 1. Bugünkü durum (V1)

- **Roller:** topluluk içinde yalnız `MEMBER` ve `MODERATOR` (`community_role`). "Sahip" rolü yoktur. `communities.created_by_id` yaratıcıyı (admin veya onaylanan başvuru) tutar ama yetki vermez.
- **Yönetim:** admin topluluk açar/düzenler/kapatır ve moderatör atar (`community.create`, `community.update`, `community.moderator.assign`). Moderatör yalnız atandığı topluluğun kapsamında çalışır; kapsam dışı işlem 403'tür (KV-04 `scope: community`).
- **Başvuru (#172):** kullanıcı topluluk başvurusu açar; admin gerekçeyle onaylar/reddeder; onayda topluluk ve başvuranın üyeliği aynı transaction'da oluşur. Onay tarihinden itibaren 7 günlük süre içinde 10 benzersiz üyeye ulaşmayan topluluk günlük UTC worker'ıyla `CLOSED` olur (`community_requests`).
- **Üye listesi:** görünürlük topluluk ayarıdır (`PUBLIC` / `MEMBERS` / `MODERATORS`), sunucuda uygulanır; listede yalnız kullanıcı adı, avatar ve topluluk rolü vardır (V1_USER_FLOW).
- **E-posta doğrulaması:** `users.email_verified_at`; V1'de ortam bayrağıyla (`EMAIL_VERIFICATION_REQUIRED`) geçici olarak gevşetilebilir. Üniversite/kurum bilgisi hiçbir yerde tutulmaz.
- **Hesap silme/anonimleştirme:** kapsamı açık konudur (DATA_MODEL §11.4/3); bu belge ona bağımlı kuralları ayrıca işaretler.

## 2. İlkeler

1. **V1 davranışı değişmez.** Yeni özellikler ek sütun/tablo ve ayar bayrağıyla gelir; mevcut kolonların, `community_role` değerlerinin ve V1 endpoint'lerinin anlamı korunur. Bayraklar (`communities.ownership.enabled`, `affiliation.enabled`, KV-40) **varsayılan kapalıdır**; kapalıyken sistem V1 ile birebir aynı davranır.
2. **Yetki yalnız backend'dedir.** Rol/nesne/kapsam kararı `authorize` ile verilir; panel gizlemesi güvenlik değildir.
3. **Her yetki değişikliği gerekçeli, auditli ve idempotenttir.** Sahiplik atama/devir, doğrulama verme/geri alma audit'e önce/sonra özetiyle yazılır (KV-39).
4. **Veri minimizasyonu.** Kurum bilgisi için gerçek e-posta adresi saklanmaz (§8); varsayılan görünürlük "kimseye" dir, rozet kullanıcının açık onayıyla görünür.
5. **Doğrulama yetki vermez.** "Üniversite doğrulandı" bir rozettir; moderasyon, sahiplik veya içerik yetkisi kazandırmaz. Yetki ancak §3–§5'teki ayrı kurallarla verilir.
6. **Sahipsiz topluluk bozuk durum değildir.** V1'de olduğu gibi admin yönetir; sahiplik isteğe bağlıdır.

## 3. Sahiplik modeli

- **Tek sahip:** topluluk başına en çok bir `owner_id` (yeni, boş olabilen sütun; `users` FK, `RESTRICT`). Yeni bir `community_role` değeri **eklenmez**: mevcut rol mantığına dokunmamak V1 izolasyonunun garantisidir. Sahip aynı zamanda üyedir (üyelik satırı zorunlu, rolü MEMBER/MODERATOR olabilir).
- **Sahibin yetkileri (kapsam: yalnız kendi topluluğu):** açıklama/görsel düzenleme, moderatör ekleme/çıkarma, topluluğu kendi isteğiyle kapatma talebi (admin onaylar), sahipliği devretme (§5), üye listesi görünürlüğünü seçme.
- **Sahibin yetkisi olmayanlar:** global rol, kullanıcıya yaptırım uygulama (moderatör kuralları geçerli), başka topluluğa erişim, üyelerin e-posta/özel verisini görme, `owner_id`'yi kendi başına başkasına atama (§5 iki taraflı onay gerekir), son sahibi kaldırma.
- **Sahibin kısıtları:** aynı anda en çok 3 topluluğa sahip olabilir (öneri); sahip olmak için hesap `ACTIVE` ve e-postası **gerçekten** doğrulanmış olmalıdır (`email_verified_at IS NOT NULL`; V1'deki geçici gevşetme bayrağı sahiplik kararında yok sayılır).
- **Başvuru onayı:** `communities.ownership.enabled` açıkken #172 onayı, başvuranı sahip olarak da atar (aynı transaction). Kapalıyken V1 davranışı: yalnız üyelik.

## 4. Sahiplik talebi: talep, onay, ret, itiraz

Sahipsiz veya admin yönetimindeki bir topluluk için üye sahiplik talebinde bulunur.

**Uygunluk (sunucuda, talep anında ve onay anında yeniden):**

| Koşul | Önerilen değer |
|---|---|
| Hesap durumu | `ACTIVE`, aktif yaptırım yok, e-posta doğrulanmış |
| Hesap yaşı | ≥ 30 gün |
| Üyelik süresi | o toplulukta ≥ 14 gün üye (veya moderatör) |
| Sahiplik sınırı | mevcut sahiplik < 3 |
| Açık talep | (topluluk, kullanıcı) için en çok bir açık talep; aynı topluluğa aynı anda başka kullanıcının talebi de olabilir (admin birini seçer) |
| Tekrar talep | reddedilen talepten sonra 30 gün bekleme |

**Durumlar:**

```
PENDING ─► APPROVED                 (sahip atanır, owner_id yazılır, audit)
PENDING ─► REJECTED ─► APPEALED ─► APPEAL_APPROVED | APPEAL_REJECTED  (itiraz sonucu kesindir)
PENDING ─► WITHDRAWN                (talep eden geri çeker)
PENDING ─► EXPIRED                  (30 gün karar yok; talep eden bilgilendirilir)
```

- **Karar:** admin (`community.claim.review`), gerekçe zorunlu (≥ 3 anlamlı karakter, KV-39 ile aynı). Ret gerekçesi talep edene gösterilir; iç not ayrı alandır ve gösterilmez.
- **İtiraz:** reddedilen talep sahibi karar tarihinden itibaren 14 gün içinde **bir kez** itiraz eder (gerekçe zorunlu). İtirazı **ilk kararı veren kişiden farklı** bir yetkili inceler (SUPER_ADMIN). Karar kesindir; ikinci itiraz yoktur. Yanlış pozitif için tek çıkış yolu bu itirazdır.
- **Eşzamanlılık:** talep ve karar topluluk satırı kilidiyle sıralanır; aynı topluluğa iki talep aynı anda onaylanamaz (ikincisi 409 `already_owned`). Onay, uygunluğu transaction içinde yeniden doğrular.
- **Mevcut sahip varsa:** talep alınmaz; sahiplik yalnız §5'teki devirle veya admin atamasıyla değişir.
- **Bildirim:** talep eden her durum değişikliğinde uygulama içi bildirim alır (yeni bildirim türleri; KV-21 deseni). Admin kuyruğu bekleyen talep sayısını gösterir.
- **Audit:** `community.claim` (`request`, `withdraw`), `community.claim.review` (`approve`, `reject`, `appeal_approve`, `appeal_reject`), hedef `COMMUNITY`.

## 5. Yetki devri (sahiplik transferi)

- **İki taraflı:** mevcut sahip bir üyeyi aday gösterir (gerekçe zorunlu) → aday **açıkça kabul eder** (7 gün içinde) → transfer tek transaction'da yapılır. Kabul gelmezse veya aday uygun değilse transfer `EXPIRED` olur ve sahip değişmez.
- **Aday uygunluğu** §4 tablosuyla aynıdır (hesap yaşı hariç: 14 gün); ayrıca aday zaten sahipse veya yaptırımlıysa reddedilir.
- **Transaction:** topluluk satırı `FOR NO KEY UPDATE`, ardından eski/yeni sahip kullanıcıları tutarlı sırayla (id sırası) kilitlenir; uygunluk yeniden doğrulanır; `owner_id` güncellenir, eski sahibin üyeliği korunur (MEMBER/MODERATOR), audit ve olay aynı transaction'da yazılır.
- **Son sahip koruması:** sahip tek başına topluluğu "sahipsiz bırakamaz": hesabını silmeden, topluluktan ayrılmadan veya kendi rolünü düşürmeden önce devretmeli ya da sahipliği bırakmayı seçmelidir (bırakma = `owner_id` boşalır, topluluk admin yönetimine döner, audit). Hesap silme/yasaklama sahiplik sorununu çözmeden bitmez: sahip BANNED olursa veya hesap silinirse topluluk otomatik admin yönetimine döner (`owner_id` boşalır, olay + audit) ve admin bilgilendirilir.
- **Soğuma süresi:** devirden sonra 7 gün içinde yeni devir yapılamaz (devir zinciriyle kimliği gizleme/ticaret önleme).
- **Admin zorunlu atama:** SUPER_ADMIN gerekçeyle sahibi atayabilir/değiştirebilir (sahibin kabulü gerekmez; eski sahibe bildirim gider). Kritik işlemdir: ikinci onay/step-up MFA (#182) gerektirir. Bu güvenlik entegrasyonu tamamlanana kadar kritik sahiplik mutasyonları kapalı kalır; audit ve gerekçe ikinci onayın yerine geçmez.
- **Audit:** `community.owner.transfer` (`propose`, `accept`, `decline`, `expire`), `community.owner.assign` (`assign`, `release`), önce/sonra özetinde yalnız kullanıcı kimlikleri.
- **Örtüşme (#184):** #184 V1'de admin tarafındaki sahip değiştirme/atma ve son sahip korumasını uygular. Bu belge kuralların kaynağıdır; #184'ün ilk diliminde `owner_id` ve `assign/release` gelir, §4 talep/itiraz ve §5 iki taraflı devir V1.1 işidir.

## 6. Üniversite e-posta doğrulaması (isteğe bağlı)

**Amaç:** kullanıcı bir kuruma bağlı olduğunu (öğrenci/personel) kanıtlayabilsin; sonuç rozet ve kurumsal topluluk kabulü için kullanılabilsin. **Zorunlu değildir**, hiçbir V1 işlevi buna bağlanmaz.

**Kurum kaydı (`institutions`, admin yönetir):** kimlik, kurum adı, kısa ad, o kuruma ait olduğu ayrıca doğrulanan e-posta alan adları, durum (ACTIVE/DISABLED). İlk kurum/alan adı listesi §12/3'te karar bekler; örnek bir alan adı gerçek kurum doğrulaması sayılmaz. Alan adı listesini yalnız SUPER_ADMIN yönetir (`institution.manage`, gerekçeli, audit); kamu e-posta sağlayıcıları (gmail, outlook vb.) hiçbir kuruma eklenemez.

**Akış:**
1. Kullanıcı kurumu seçer ve kurumsal e-posta adresini girer (alan adı kurumun listesinde olmalı).
2. Sistem **o adrese** tek kullanımlık, 24 saat geçerli, tek seferlik bir doğrulama bağlantısı gönderir (mevcut `auth_tokens` deseni; yeni amaç `AFFILIATION_VERIFICATION`). Bağlantı URL fragment'ında taşınır.
3. Kullanıcı bağlantıyı **kendi oturumuyla** açar (başkasının oturumu geçersiz sayılır) → `VERIFIED`.
4. Doğrulama 12 ay geçerlidir; süre dolmadan 30 gün önce yenileme hatırlatılır, dolunca `EXPIRED` (rozet kalkar, içerik/üyelik etkilenmez).

**Kötüye kullanım önlemleri:** kullanıcı başına günde 3, alan adı başına saatte 20 doğrulama maili; aynı kurumsal adres tek hesapta olabilir (benzersizlik, §8'deki anahtarlı özetle); bağlantı yalnız ilgili kullanıcıda geçerli; doğrulanmış kurumsal adresin sahibi değişirse (mezuniyet, adres devri) yıllık yenileme bunu yakalar; admin yanlış doğrulamayı gerekçeyle geri alabilir (`REVOKED`, audit) ve alan adı devre dışı bırakılırsa o alan adı üzerinden verilen doğrulamalar toplu `REVOKED` olur.

**Rozet:** "Samsun Üniversitesi doğrulandı". Yalnız kurum adı gösterilir; e-posta, alan adı, öğrenci numarası, bölüm hiçbir yerde yok. Kullanıcı rozeti profilinde göstermeyi ve topluluk üye listelerinde görünmesini **ayrı ayrı** açık onayla seçer (varsayılan kapalı); onay geri alınınca rozet anında gizlenir.

## 7. Kurumsal topluluk doğrulaması

- **Doğrulanmış kurum topluluğu:** bir topluluk bir kuruma bağlanabilir ve "Doğrulanmış kurum topluluğu" etiketi alabilir. Koşullar: (a) sahibi o kurumda `VERIFIED` aidiyete sahip, (b) admin etiketi gerekçeyle verir (`community.institution.verify`), (c) etiketin kaynak kanıtı (ör. resmî başvuru) iç notta kayıtlı. Etiket **resmî temsil anlamına gelmez**; metin "resmî olmayan pilot" ilkesiyle uyumlu olmalıdır (KV-07 §topluluk pilotu).
- **Etiket kalkar:** sahibin aidiyeti `EXPIRED/REVOKED` olursa ve 30 gün içinde yeni doğrulanmış sahip yoksa; kurum devre dışı kalırsa; admin geri alırsa. Topluluk ve içerik etkilenmez.
- **Yalnız doğrulanmış üye modu (isteğe bağlı):** sahip, topluluğa katılımı o kurumda `VERIFIED` aidiyeti olanlarla sınırlayabilir. Mevcut üyeler **çıkarılmaz** (dedupe: yeni katılımlar kısıtlanır, mevcutlar için 30 gün uyum süresi); katılamayan kullanıcı topluluğun var olduğundan başka bir şey öğrenmez (üye listesi/sayısı sızmaz).
- **V1 toplulukları** ve bayrak kapalıyken tüm topluluklar bu özelliklerden etkilenmez.

## 8. Görünürlük ve veri saklama sınırları

| Veri | Kim görür | Saklama |
|---|---|---|
| Kurumsal e-posta adresi (düz metin) | **Hiç kimse; saklanmaz.** Yalnız doğrulama mailinin gönderildiği an işlenir | Veritabanına yazılmaz, loga yazılmaz |
| Kurumsal adresin anahtarlı özeti (HMAC, sunucu sırrıyla) | Hiç kimse (benzersizlik kontrolü içindir) | Doğrulama süresince; `REVOKED/EXPIRED/WITHDRAWN` sonrası 30 gün içinde silinir; hesap silinince/anonimleştirilince hemen |
| Aidiyet durumu (kurum, VERIFIED/EXPIRED/REVOKED, tarihler) | Kullanıcının kendisi; admin (hesap detayı, gerekçeli erişim loglu) | Hesapla birlikte; hesap silinince silinir |
| Rozet (kurum adı) | Kullanıcı onay verdiyse profil/üye listesi; vermediyse yalnız kendisi | Onay geri alınınca görünürlük anında kapanır |
| Sahiplik talebi/itiraz kayıtları ve iç notlar | Talep eden (ret gerekçesi dahil), admin (iç not) | Karar + 12 ay; sonra kullanıcı kimliği anonimleştirilmiş özet |
| Audit kayıtları | `audit.read` yetkisi (ADMIN+) | KV-39 politikası (V1'de süresiz; açık karar) |
| KVKK veri paketi | Yalnız kullanıcı | **Aidiyet durumu ve rozet onayı pakete girer** (kullanıcının kendi verisi); e-posta özeti, iç notlar ve itirazı değerlendiren admin kimliği girmez |

- **Hesap silme/yasaklama:** aidiyet kayıtları ve özetler silinir; sahipse §5 son sahip koruması önce çalışır.
- **Üçüncü taraf paylaşımı yok:** kurumla veri paylaşımı, kuruma rapor veya toplu liste çıkarma bu kapsamda **yasaktır**; ilerideki "topluluk içgörüleri" (V1.2) yalnız anonim toplamlar kullanır ve ayrı onay ister.
- **Hukuki dayanak ve aydınlatma:** rozet gösterimi için açık rıza metni ve aydınlatma güncellemesi gerekir; saklama süreleri hukuk onayına tabidir (§12/6).

## 9. Yetki kataloğu ve sözleşme taslağı

Yeni işlemler (KV-04 kataloğuna implementasyon PR'ında eklenir; ad kuralı `^[a-z]+(\.[a-z][a-zA-Z]*)+$`):

| İşlem | Rol | Kural/kapsam |
|---|---|---|
| `community.claim` | user (doğrulanmış e-posta) | uygunluk §4 |
| `community.claim.review` | admin | itirazı ilk karar vericiden farklı SUPER_ADMIN inceler |
| `community.owner.transfer` | owner (kaynak sahibi) | kapsam: kendi topluluğu |
| `community.owner.assign` | super_admin | kritik; #182 ikinci onay |
| `affiliation.verify` | user | kendi hesabı |
| `affiliation.manage` | admin | gerekçeli geri alma |
| `institution.manage` | super_admin | alan adı listesi |
| `community.institution.verify` | admin | gerekçeli |

Endpoint taslakları (`availability: planned`; sözleşme implementasyon PR'ında yazılır): `communities.claims.create/withdraw/appeal`, `admin.communities.claims.list/decide`, `communities.owner.transfer.propose/respond`, `admin.communities.owner.put`, `affiliations.start/verify/mine/visibility`, `admin.affiliations.revoke`, `admin.institutions.*`, `admin.communities.institution.put`. Yeni tablolar: `community_claims`, `community_owner_transfers`, `institutions`, `institution_domains`, `affiliations` (+ `communities.owner_id`, `communities.institution_id`). Hepsi additive migration; V1 tablolarında kolon silme/yeniden adlandırma yok.

## 10. V1 topluluk izolasyonu: kabul ve test senaryoları

Bu senaryolar **implementasyon PR'larının kabul koşuludur**; her biri gerçek PostgreSQL testi olarak yazılır.

| # | Senaryo | Beklenen |
|---|---|---|
| I1 | Bayraklar kapalıyken mevcut topluluk testleri (KV-31, #172) hiçbir değişiklik olmadan geçer | V1 davranışı birebir |
| I2 | Sahipsiz (V1) topluluk: admin açma/kapatma/moderatör atama ve moderatör kapsamı aynı | değişiklik yok |
| I3 | Moderatör A'nın B topluluğunda işlemi | 403 + audit (mevcut) |
| I4 | Sahip, başka topluluğun içeriğini/üyelerini yönetmeye çalışır | 403 + audit; yetki yükselmesi yok |
| I5 | Sahip, global rol veya yaptırım yetkisi kullanmaya çalışır | 403 |
| I6 | Üye listesinde aidiyet/rozet, kullanıcı onayı yokken | görünmez (liste yanıtı şema testi) |
| I7 | Yalnız doğrulanmış üye modunda doğrulanmamış kullanıcı katılır | reddedilir; liste/sayı sızmaz; mevcut üyeler çıkarılmaz |
| I8 | Aynı topluluğa iki talep aynı anda onaylanır | biri başarılı, diğeri 409; tek `owner_id` |
| I9 | Eşzamanlı iki devir / devir sırasında sahip hesabı yasaklanır | tek sonuç; son sahip koruması bozulmaz |
| I10 | Sahip hesabını silmeye/ayrılmaya çalışır | önce devir/bırakma zorunlu; otomatik admin yönetimine dönüş testi |
| I11 | Başkasının oturumuyla aidiyet doğrulama bağlantısı | geçersiz (hesap varlığı sızmaz) |
| I12 | Kamu e-posta alan adı veya kurum listesinde olmayan alan adı | reddedilir |
| I13 | Aynı kurumsal adres ikinci hesapta | reddedilir; ilk hesap etkilenmez |
| I14 | Alan adı devre dışı bırakılır | o alan adından verilen doğrulamalar `REVOKED`, rozetler kalkar, toplulukların etiketi §7'ye göre |
| I15 | Düz metin kurumsal e-posta veritabanında, audit'te, loglarda | hiçbir yerde yok (tarama testi) |
| I16 | KVKK paketi | aidiyet durumu var; e-posta özeti ve iç not yok |
| I17 | Her yetki değişikliği | gerekçe, requestId, audit, idempotency/çift gönderim testi |
| I18 | Bayrak kapatılınca | yeni talepler reddedilir (FEATURE_DISABLED), mevcut sahiplik/aidiyet verisi korunur ve okunabilir |

## 11. Uygulama dilimleri (yayın sonrası ayrı issue'lar)

| Dilim | İçerik | Bağımlılık |
|---|---|---|
| S1 | `owner_id`, admin atama/bırakma, son sahip koruması, #172 onayında sahip atama (bayrak arkasında); I1–I5, I10 | #184 ile birlikte planlanır |
| S2 | Sahiplik talebi, onay/ret, itiraz, bildirimler; I8 | S1 |
| S3 | İki taraflı devir ve soğuma süresi; I9 | S1, kritik teyit için #182 |
| S4 | `institutions`, aidiyet doğrulama akışı, rozet ve görünürlük onayı; I11–I16 | KVKK kapsamı kararı (§12) |
| S5 | Kurumsal topluluk etiketi, yalnız doğrulanmış üye modu; I7, I14 | S1, S4 |

Her dilim küçük PR, gerçek API/DB testleri ve erişilebilir UI kanıtıyla ilerler; V1 yayınını bloke etmez.

## 12. Açık kararlar (Mehmet)

1. **Eşikler:** hesap yaşı 30 gün, üyelik süresi 14 gün, sahiplik sınırı 3, ret sonrası bekleme 30 gün, itiraz süresi 14 gün, devir kabul süresi 7 gün, soğuma 7 gün: onaylanır mı, ayarlanır mı?
2. **İtiraz kimde:** itirazı yalnız SUPER_ADMIN mi incelesin; tek SUPER_ADMIN varsa nasıl çalışsın (ikinci karar verici yoksa itiraz dış incelemeye mi gider)?
3. **İlk kurum listesi:** hangi kurumlar ve alan adlarıyla başlanır (ör. Samsun Üniversitesi)? Alan adı doğrulamasını (kurumdan yazılı teyit) kim yapar?
4. **Rozet görünürlüğü:** varsayılan "kapalı, kullanıcı açar" yeterli mi, yoksa V1.1'de rozet yalnız kullanıcının kendisine mi görünsün?
5. **Yalnız doğrulanmış üye modu** V1.1'e girsin mi, yoksa V1.2'ye mi ertelensin (hukuki ve ürün riski daha yüksek)?
6. **Hukuk/KVKK:** rozet için açık rıza metni, saklama süreleri ve kurum e-postası işlemenin hukuki dayanağı (DATA_MODEL §11.4/3 ile birlikte Faruk + Utku).
7. **Audit saklaması:** sahiplik ve doğrulama audit kayıtları süresiz mi (KV-39 §47)?
8. **Bayrak adları ve kademeli açılış:** önce yalnız seçili topluluklarda mı açılsın?

## 13. #56 kabul koşulları

- [x] **Talep/onay/ret/itiraz ve yetki devri kuralları belli:** §3–§5 (uygunluk, durum makinesi, itiraz tek sefer ve farklı karar verici, iki taraflı devir, son sahip koruması, admin zorunlu atama, eşzamanlılık, audit).
- [x] **Doğrulama görünürlüğü ve veri saklama sınırları belli:** §6 ve §8 (düz metin e-posta saklanmaz, anahtarlı özet süresi, rozet onayı, KVKK paketi, üçüncü taraf yasağı).
- [x] **V1 topluluk izolasyonunu koruyacak kabul/test senaryoları var:** §2/1 (additive + varsayılan kapalı bayrak, yeni rol değeri yok) ve §10 (I1–I18).
- [ ] **Mehmet onayı** gereken eşik/politika kararları (§12): onaylanana kadar öneridir.
- Kod, migration ve ekran yoktur; uygulama §11'deki dilimlerle yayın sonrası yapılır. Gerçek bağımlılıklarla doğrulama (#54 yayın kararı, #182 ikinci onay, hukuk onayı) bekler; bu belge **tasarım kabulüdür**, özelliğin tamamlandığının kanıtı değildir.
