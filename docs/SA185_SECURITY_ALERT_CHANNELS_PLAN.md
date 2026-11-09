# Acil güvenlik uyarı kanalları: teknik plan ve negatif testler (#180, #185)

**Sahip:** Faruk (teknik plan). **Alarm dilimleri:** Utku ([#282](https://github.com/mehmetalisahingm/kararver/pull/282), [#283](https://github.com/mehmetalisahingm/kararver/pull/283)). **Güvenlik incelemesi:** Utku. **UI:** Ümit. **Karar:** Mehmet.
**Dayanak:** Mehmet'in 8 Kasım kararları 41A–49A ([#285](https://github.com/mehmetalisahingm/kararver/issues/285)). Olay akışı: [OPS_INCIDENT_RESPONSE.md](OPS_INCIDENT_RESPONSE.md) §5.

Bu belge **plan**dır: kod yok, hiçbir kanal açılmadı, kimseye e-posta veya push gönderilmedi. Amaç, #282/#283'ün üzerine eksikleri küçük ve test edilebilir dilimlere ayırmak.

## 1. Bugün ne var (#282/#283, taslak)

| Parça | Davranış |
| --- | --- |
| Değerlendirme | `security.alerts` worker işi 5 dakikada bir `audit_logs` ve `admin_access_denials` sayar. Kısmi UNIQUE `(rule, scope_key) WHERE status='OPEN'` ile aynı alarm iki kez açılmaz |
| Bildirim | Açılışta **bir kez** `security.alert.opened` → `SECURITY_ALERT` uygulama içi bildirimi (outbox). Alıcı: **yalnız SUPER_ADMIN**. İçerik: kural, önem, sayı; kişisel veri yok |
| Onay | `admin.securityAlerts.ack` (SUPER_ADMIN, gerekçe ister). "İncelendi" işaretidir, alarmı kapatmaz; ikinci onay 409 ve audit yazmaz |
| Panel | Ops panelinde alarm listesi |

Main'de yeniden kullanılacaklar:
- oturum bazlı 5 dakikalık MFA step-up (`session_mfa_stepups`, `me.mfa.stepup`);
- kritik onay kontrolü (`security/critical-approval.ts`: step-up zamanı onaydan sonra ve süresi içinde olmalı);
- e-posta gönderici (`mailer`).

## 2. Kararlar ile mevcut durum arasındaki farklar

| Karar | İstenen | Bugün | Fark |
| --- | --- | --- | --- |
| 43A | İlk uyarı **anında**, sonra **saatte bir**, aynı olay için birleştirilmiş | Açılışta tek bildirim, tekrar yok | **G1:** saatlik hatırlatma yok |
| 43A / 44A | Alıcı: gerekli yetkisi olan yöneticiler | Yalnız SUPER_ADMIN (bugün tek kişi) | **G2:** güvenlik sorumluları (Ümit, devirdeyse Mert) alıcı değil. Alıcı kümesi açık bir yetkiyle tanımlanmalı |
| 44A | Birincil kanal: **e-posta + güvenli panel** | Yalnız uygulama içi bildirim | **G3:** e-posta kanalı yok |
| 48A | Üstlenme yalnız **MFA korumalı panelden açık üstlenme** | Onay SUPER_ADMIN ister ama MFA step-up istemez; "incelendi" ile "üstlendim" ayrı değil | **G4:** onaya taze MFA step-up şartı; üstlenme kaydı |
| 45A / 46A / 47A | İkinci kanal: doğrulanmış yetkili cihaza push. Kayıt için MFA + cihaz sahipliği + bağımsız onay; kayıp cihazda hemen askıya alma | Yok | **G5:** push. 53A gereği sağlayıcı #288'de doğrulanana kadar **kapalı** |
| 49A | Push de başarısızsa devir kapalı, kuyruk ve uyarılar sürer | Devir akışı yok, dolayısıyla zaten kapalı | **G6:** devir gelince fail-closed negatif testi |
| 43A | Uyarıda sır, MFA kodu, token, kurtarma bağlantısı ve ifşa edici ayrıntı yok | Bildirim verisi kural/önem/sayı ile sınırlı | E-posta ve push için aynı sınırın testi (G3/G5) |

## 3. Önerilen dilimler

Her dilim ayrı, küçük bir PR; #282/#283 merge edildikten sonra ve Utku'yla koordineli.

### Dilim A: Üstlenme MFA ister (G4) — önce bu
- `admin.securityAlerts.ack` için oturumda **taze step-up** şartı (`critical-approval.ts` ile aynı TTL ve sıra kontrolü). Yoksa `403 FORBIDDEN` + `details: [{ code: "mfa_stepup_required" }]`.
- Step-up **tek kullanımlık**: aynı step-up ile ikinci kritik işlem yapılamaz (mevcut "transaction içinde tek sefer" notuyla aynı).
- Ayrı bir `claimedBy` / `claimedAt` alanı gerekip gerekmediği Utku'yla netleşmeli. Öneri: 48A'daki "üstlenme", MFA'lı onayın kendisi olsun, yeni kavram açılmasın.
- **Negatif testler:**
  - step-up yok → 403, audit yok;
  - süresi geçmiş step-up → 403;
  - başka oturumun step-up'ı → 403;
  - SUPER_ADMIN olmayan → 403;
  - aynı step-up'la ikinci onay → reddedilir;
  - e-posta teslimi veya bildirim okunması onay sayılmaz (DB'de `acknowledgedAt` hâlâ null).

### Dilim B: Saatlik hatırlatma (G1)
- Açık ve onaylanmamış alarm için: alarm satırında `lastNotifiedAt`; worker, `now - lastNotifiedAt ≥ 60 dk` ise tek bir hatırlatma olayı yazar. Koşullu UPDATE ile iki worker aynı saati iki kez göndermez.
- Onaylanınca veya kapanınca hatırlatma durur.
- Birleştirme: aynı alarmın hatırlatmaları tek bildirim satırında güncellenir; her saat yeni satır açılmaz.
- **Negatif testler:**
  - 59 dakikada hatırlatma yok;
  - 60 dakikada tam bir hatırlatma;
  - eşzamanlı iki worker → bir hatırlatma;
  - onaylanmış veya kapanmış alarm → hatırlatma yok;
  - worker uzun süre kapalı kalıp açılınca birikmiş saatler için tek hatırlatma (fırtına yok).

### Dilim C: Alıcı kümesi (G2)
- Alıcılar açık bir KV-04 yetkisiyle tanımlanır (ör. `security.alert.receive`). SUPER_ADMIN'e ek olarak, görev kabulü yapmış ve **MFA'sı etkin** güvenlik sorumlularına verilir.
- Devredilen yetki (Mert, en fazla 8 saat) bittiğinde alıcılıktan da düşer.
- **Negatif testler:**
  - MFA'sı kapalı hesap alıcı olmaz;
  - silinmiş, askıda veya yasaklı hesap alıcı olmaz;
  - süresi dolmuş devir alıcı olmaz;
  - normal kullanıcı alarmın varlığını göremez (404/403).

### Dilim D: E-posta kanalı (G3)
- Dilim B ve C'nin alıcılarına aynı zamanlamayla e-posta. Metin yalnız şunlardan oluşur: "KararVer'de yüksek öncelikli güvenlik uyarısı var, yönetici paneline giriş yap". Kural adı ve sayı **yazılmaz**; panel bağlantısı token taşımaz.
- Production'da gerçek e-posta sağlayıcısı #288/53A'ya bağlı; o zamana kadar yalnız staging Mailpit.
- **Negatif testler:**
  - e-posta gövdesinde kullanıcı adı, e-posta adresi, IP, kural ayrıntısı, token ve bağlantı parametresi yok;
  - teslim hatası alarmı kapatmaz veya onaylamaz;
  - aynı saat içinde aynı alıcıya ikinci e-posta yok.

### Dilim E: Push (G5), 53A kapısı açılınca
- Ön koşullar:
  - #288'de push sağlayıcısının aktarım değerlendirmesi;
  - 0 TL;
  - Mehmet'in onayı.
- Cihaz kaydı:
  - MFA step-up;
  - cihaz sahipliği kanıtı (kayıt anında cihaza giden tek kullanımlık kod);
  - **farklı** bir yetkili yöneticinin bağımsız onayı (46A).
- Kayıp cihaz (47A): güvenli kayıp bildirimiyle **hemen askıya alma**; kalıcı iptal inceleme sonrası. Kayıp cihaz kurtarmanın ön şartı değildir. Sahte askıya alma denemeleri hız sınırı ve audit ile korunur.
- Push metni e-postayla aynı asgari içerik.
- **Negatif testler:**
  - kendi cihazını kendisi onaylayamaz;
  - MFA'sız kayıt reddedilir;
  - askıya alınmış cihaza gönderim yok;
  - replay edilmiş kayıt kodu reddedilir;
  - push sağlayıcısı hatası → 49A: devir kapalı kalır, e-posta ve panel uyarısı sürer.

### Dilim F: Devir fail-closed (G6), devir akışıyla birlikte
- Mert'in devri için bağımsız onaycı yoksa devir **açılmaz**, alarm acil kuyrukta kalır (42A/49A).
- **Negatif testler:**
  - Mert kendi devrini onaylayamaz;
  - eğitim, MFA veya görev kabulü eksik aday onay veremez;
  - 8 saat sonunda devir otomatik biter ve uzamaz;
  - yarışta iki onay tek devir üretir.

## 4. Sıra ve bağımlılık

1. #282/#283 merge (Utku).
2. Dilim A (en küçük, 48A'nın çekirdeği).
3. B → C → D.
4. E yalnız #288/53A kapısı açılınca.
5. F, devir akışıyla birlikte.

Hiçbir dilim ücretli servis açmaz; hiçbiri gerçek kullanıcıya gönderim yapmaz. Testler sentetik hesaplarla ve yerel/CI PostgreSQL'de koşar; staging kabulü ayrıca yapılır.

**Durum: NO-GO.** Plan hazır; uygulama dilimleri açık.
