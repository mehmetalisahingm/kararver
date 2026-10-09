# KV-22 — Profil ekranları ve private kaydetme

Issue: #24 · Sahip: Mehmet

## Public profil

`GET /v1/profiles/:username` yalnız aktif/kısıtlı ve silinmemiş hesabın public alanlarını döndürür. E-posta, oturum veya private alanlar profile taşınmaz.

Sayaçlar DB'den hesaplanır:
- gönderi: yalnız `ACTIVE` / `LOCKED`,
- alınan oy: görünür gönderilerin `vote_count` toplamı,
- yorum: silinmemiş `ACTIVE` yorumlar ve görünür gönderiler.

`GET /v1/profiles/:username/polls` ve `/comments` deterministik `(created_at DESC, id DESC)` cursor sayfalaması kullanır. Kaldırılmış/gizli içerik listelenmez.

## Private bookmarks

`PUT /v1/polls/:id/bookmark` ve `DELETE /v1/polls/:id/bookmark` doğal idempotenttir.

- `(user_id, poll_id)` bileşik PK duplicate kaydı engeller.
- PUT yalnız görünür (`ACTIVE` / `LOCKED`) içerikte çalışır; aynı transaction'da hedef satır `FOR SHARE` ile doğrulanır.
- `save_count` yalnız gerçekten yeni bookmark yaratıldığında bir kez artar.
- DELETE yalnız gerçekten var olan kayıt silindiğinde bir kez azaltır.
- `GET /v1/me/bookmarks` kullanıcı kimliğini request body/query'den almaz; yalnız doğrulanmış oturumdaki `viewer.id` kullanılır. Bu nedenle başka hesabın private listesine API üzerinden seçim yapılamaz.
- Liste görünmez/kaldırılmış içeriği sızdırmaz ve cursor pagination kullanır.

## Web

- `/hesap`: görünen ad/biyografi düzenleme, gerçek profil sayaçları, private kaydedilenler, boş/loading/pagination durumları.
- `/profil/[username]`: public profil, gönderiler ve yorumlar.
- `/karar/...`: giriş gerektiren `Kaydet / Kaydı kaldır`; giriş gerekiyorsa aynı içeriğe geri dönüş korunur.

## Test kanıtı

`apps/api/test/profiles-bookmarks.test.ts` gerçek PostgreSQL üzerinde:
1. profil düzenleme ve gerçek sayaçları,
2. iki hesap arasında private bookmark izolasyonunu,
3. çift PUT → tek satır / `save_count=1`, çift DELETE → `save_count=0`,
4. boş durum ve cursor pagination davranışını doğrular.

CI ayrıca Prisma migration/schema drift, workspace typecheck, web production build, Playwright ve gerçek PostgreSQL entegrasyon kontrollerini çalıştırır.
