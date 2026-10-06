# KV-23 — Kararımı verdim ve sonucu takip et (#25)

Anket/tartışma sahibi seçim ve gerekçesini paylaşır; bu işlem oyları, sonuç görünürlüğünü ve kapanışı değiştirmez. Süresi dolmuş/kapalı içerikte karar verilebilir; moderasyonla LOCKED içerikte yazma 409, HIDDEN/UNDER_REVIEW/REMOVED içerikte okuma ve yazma 404 olur. Takibi kaldırma, içerik gizlense de mümkündür.

## API ve veri

- GET /polls/:id/decision: public karar + oturuma özel following/isAuthor, private/no-store.
- PUT /polls/:id/decision: yalnız sahip, POSTING yaptırımı uygulanır. Gerekçe 1–1000 karakter; seçilen seçenek aynı ankete ait olmalı; tartışmada null.
- PUT/DELETE /polls/:id/follow: giriş gerekir; doğal idempotent.
- poll_decisions ve poll_follows, growth modülüne ait; SQL foreign key ve bileşik seçenek FK'si uygulanır.
- Karar transaction'ı anket satırını kilitler; karar + poll_revisions + decision.updated outbox olayı beraber commit olur. Aynı değerle tekrar PUT timestamp/sürüm/olay oluşturmaz.
- Gerekçe event payload'ına girmez. Moderatörler mevcut admin.revisions.polls üzerinden karar metnini görebilir; rapor konusu ana POLL içeriğidir. Ana içeriği gizleme/kaldırma kararı da gizler.

## Bildirim ve arayüz

KV-21 ile entegrasyon: decision.updated ve poll.closed için geçerli oy verenler + açıkça takip edenler birleştirilir, kullanıcı bazında tekilleştirilir, mevcut dilimleme/50.000 alıcı sınırı ve bildirim politikası korunur. Teslim anındaki üyelik geçerlidir. Sadece takibi bırakmak, geçerli oyu olan kullanıcıyı oy veren bildirimlerinden çıkarmaz; bu KV-21 davranışı korunmuştur.

Anket detayında karar kartı ve takip butonu; sahibine seçim/gerekçe formu. Misafir okurken login açılmaz; takip işlemi login ister. Kaydetme sırasında tekrar tıklama kilitlenir, hata görünür, kayıt yeniden yüklemede okunur. Demo adapter desteklemediğinde panel gösterilmez; gerçek API adapter'ında aktiftir.

## Doğrulama

- apps/api/test/decisions.test.ts: gerçek Postgres, yetki, aynı/concurrent PUT, değişmeyen anket, sürüm geçmişi, kapanış/moderasyon, takip ve tekil bildirim.
- apps/web/test/states/decisions.spec.ts: masaüstü/mobil, karar formu, reload, takip, misafir login kapısı ve erişilebilirlik; HTTP cevapları fixture'dır.
- Migration eklemelidir; uygulama geri alınırsa yeni tablolar kalabilir. Staging/production migration ve dağıtım bu PR'ın merge edilmesinden sonra ayrı doğrulanmalıdır.
