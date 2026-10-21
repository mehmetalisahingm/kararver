# SA-180 — Tek SUPER_ADMIN için tam MFA kilitlenmesi

**Durum:** Güvenli operasyon prosedürü ve test kabul matrisi; çalışan bir otomatik kurtarma özelliği veya tamamlanmış canlı tatbikat **değildir**. Bağlantılar: #180, #194, #46, #53 ve [KV-12 bootstrap/kurtarma](KV-12_ADMIN_BOOTSTRAP.md).

## Olayı sınıflandır

- **Yalnız parola kaybı:** Normal şifre sıfırlama akışı kullanılır; MFA ve rol korunur.
- **MFA cihazı kayıp, kullanılmamış kurtarma kodu mevcut:** Hesap sahibinin parola ve mevcut oturumla kullandığı normal tek kullanımlık recovery akışı izlenir. Kod tek kez tüketilir. Yeni cihaz kurulumu yalnız uygulamanın desteklediği güvenli enrollment yolundan yapılabilir.
- **Cihaz da recovery kodları da kayıp:** Tek başına e-posta doğrulaması veya şifre reseti MFA'yı geçersiz kılmaz. Başka hesaba SUPER_ADMIN rolü vermek, `ROLE_APPROVALS_REQUIRED` bayrağıyla güvenliği gevşetmek, MFA sırrını DB'den elle silmek veya global MFA kuralını kapatmak kabul edilmez. Güvenlik olayı oluşturulur ve yüksek riskli işlemler fail-closed kalır.

## İki insanlı, fail-closed kurtarma kapısı

1. Ayrı **operatör** ve **bağımsız onaylayan**, kimlik/ortam/hedef hesap/ticket gerekçesini teyit eder. Aynı kişi iki rolü alamaz.
2. Salt-okuma DB kanıtıyla hedefin gerçekten ortamın **tek SUPER_ADMIN hesabı** olduğu ve güncel yedek snapshot'ının bütünlüğü doğrulanır. 0 veya 2+ SUPER_ADMIN bulunduğunda işlem durdurulur.
3. Yeni SUPER_ADMIN üretmek veya mevcut kullanıcı rolünü devretmek yerine, yalnızca **ayrıca incelenmiş ve onaylanmış** hedefe bağlı MFA yeniden-kayıt mekanizması kullanılabilir. Mevcut uygulamada bu mekanizmanın güvenli implementasyonu/gerçek tatbikatı yoktur; bu belge bir DB reset komutu sağlamaz.
4. İkinci operatör eski MFA secret/recovery kodlarının kullanılamadığını, yeni recovery kodlarının yalnız bir kez gösterilip hash olarak saklandığını, eski oturumların gerektiği gibi iptal edildiğini, denetlenebilir kayıtların yazıldığını doğrular.
5. Olay raporu yalnız maskeli kimlik ve teknik kanıt barındırır. Parola, recovery kodu, cookie, TOTP secret, imzalı URL veya PII issue/PR/loglara konulmaz.

## İzole staging kabul matrisi

**Ön koşul:** Paylaşılan staging/production gerçek sahibi kilitlemeden, yalnız izole test DB ve sentetik SUPER_ADMIN fixture'ı kullan. Gerçek token ve cihaz verilerini test repo'suna yükleme.

| Senaryo | Beklenen sonuç |
| --- | --- |
| Bağımsız ikinci onay yok, aynı kişi onaylıyor | Değişiklik yok, güvenli ret |
| Yanlış ortam/hedef, SUPER_ADMIN sayısı 0 veya 2+ | Değişiklik yok, olay kaydı |
| Eskimiş olay kimliği/approval TTL/replay | Değişiklik yok, tekrar kullanım reddi |
| Yetkili yeniden kayıt | Aynı kullanıcı ve rol, yalnız MFA materyali yenilenir |
| Eski TOTP/recovery kodu | Red, başarılı giriş mümkün değil |
| Eski/iptal edilmiş session | Aynı cookie ile 401 |
| Audit | Ayrı iki operatör, gerekçe, requestId, beklenen/gerçek sonuç; sırlar yok |
| İptal / hata / rollback | Fail-closed korunur; yetkiler gevşetilmez |

Kanıt: UTC+TRT zaman, sürüm SHA, izole test ortamı, iki sorumlunun rolleri, beklenen/gerçek HTTP statüleri, redakte audit, negatif testler ve veri bütünlüğü. Fixture testinin geçmesi gerçek cihaz ve SUPER_ADMIN kullanıcı kabulü yerine geçmez.

## Karar ve sonraki teslimler

- Güvenli hedefe bağlı MFA kurtarma implementasyonu ve otomatik PostgreSQL/rol/replay testleri ayrı PR ile hazırlanmalı.
- Gerçek staging operatör tatbikatı, #46 güvenlik koşusu ve #53 sürüm kabulüne bağlanmalı.
- Mevcut durum **NO-GO**. #180/#194 bu maddeler olmadan kapatılmaz. Tek SUPER_ADMIN politikası değişmez.
