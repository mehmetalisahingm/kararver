# #366 — moderasyon/itiraz ve puan geçmişi UI

10 Kasım 2026. Bu çalışma #360 head `378f7743db536fa72130ec6f10a10482651d800c` üzerine stack'tir. #353/#357/#358/#359/#360 birleşmiş veya production'da açık varsayılmaz. Backend, ledger, migration ve moderasyon yetkileri değiştirilmedi.

## Teslim

- Mevcut 202 `UNDER_REVIEW` gönderim makbuzu ve yanlış “yayımlandı” vermeyen composer davranışı korunur.
- `/hesap/itiraz/[rejectionActionId]` gerçek `me.moderationAppeals.get/file` sözleşmesini kullanır. Teslim, son tarih, FILED/EXPIRED durumu yalnız API'den gelir; frontend 30 günlük deadline üretmez.
- 14 takvim günü yalnız hedef olarak açıklanır; otomatik kabul, ücretsiz yayın gerçekleştiği veya kesin sonuç sözü verilmez. POST 200 yetmez: FILED ve filedAt de doğrulanmalıdır.
- 10–1000 karakter gerekçe, istek kilidi, hata halinde korunmuş form, açık durum yenileme ve 401/403/404 güvenli görünüm vardır. Başka kullanıcının özel tarihleri API 200 olmadan gösterilmez.
- `/hesap/puanlar` yalnız `points.ledger` kayıtlarını gösterir; `MODERATION_REFUND` miktarı/bakiyesi sunucunun gerçek satırıdır. Aynı ledger ID'si sayfa tekrarında çoğalmaz. Yeni kredi isteği, yerel bakiye toplama veya uydurma +10 yoktur. Hesap değişince eski kayıtlar temizlenir.

## Test

`apps/web` içinde:

```text
KV_BROWSER=<chromium|firefox|webkit> playwright test -c playwright.states.config.ts test/states/moderation-appeal.spec.ts
tsc --noEmit
```

Motor başına 360/1440px'te 20 test yerelde geçti (üç motor 60/60): 400/403/409/500/ağ kopması ve retry; 401/403/404 read; gecikme/yinelenen gönderim engeli; API'den süre dolması ve onaylanmış FILED; tekrarlayan ledger sayfalarında tek satır. Typecheck geçti. Axe, taşma ve screenshot dahildir. Foundation mevcut üç motor durum paketinde bu dosyayı çalıştırır. Bu izole sözleşme adapteridir; gerçek API sunucusu/PostgreSQL, canlı ledger veya fiziksel VoiceOver çalışması değildir. Kesin head SHA için birleşik CI sonucu ayrıca PR kontrollerinden doğrulanmalıdır.

## Faruk/Mert için eksik sözleşme ve entegrasyon

1. `notificationData.MODERATION_APPLIED` ve worker yalnız action/toStatus gönderiyor. İtiraz GET'i **rejectionActionId** ister; notification.id veya pollId bunun yerine geçirilemez. Backend sahibi asıl ret kararına yetkili deep-link/karar kimliği sağlamadan bildirimden ekrana giriş bağlanamaz. Bu PR sahte kimlik üretmez, backend alanı eklemez.
2. Mevcut `MyModerationAppealView` yalnız rejectionActionId, deliveredAt, deadlineAt, filedAt ve OPEN/FILED/EXPIRED verir. Özel ret gerekçesi, başvurunun çözümlenme/nihai karar durumu ve ücretsiz yeniden yayın makbuzu yoktur. #341/ilgili çözüm-SLA modeliyle owner yetkili read sözleşmesi netleşmeden sonuç/reason ekranı tamamlandı denemez.
3. Ledger geçmişi gerçek iade satırını gösterebilir. Bunun tek-seferlik transaction/concurrency kabulü #358'e; kabul edilen itirazın ücretsiz yeniden yayını ve bunun özel okunabilir makbuzu #359'a bağlıdır. UI politika kopyasından kredi/yayın başarısı çıkarmıyor.
4. #357'de ek açıklamayla risk-review atlama bulgusu ve #358–#360 stack çakışmaları çözülüp yeni head CI/gerçek API kabulü alınmalı. Bu PR'ın saf UI testleri o güvenlik incelemesini kapatmaz.

Bağlantı/sonuç sözleşmesi, aynı-SHA staging ve fiziksel iPhone/Safari/VoiceOver kabulü bekliyor. Gerçek kullanıcı içeriğine veya moderasyon kararına dokunulmadı. #366/#290/#327 açık kalır; merge Mehmet'te, yayın GO verilmez.
