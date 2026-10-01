# KV-26: Kategori ve kapsamlı arama API (#28)

> Sahip: **Faruk** · Kod: `apps/api/src/modules/search`, `apps/api/src/modules/categories` · Sözleşme: `categories.list`, `search.query` (`packages/contracts/src/domains/discovery.ts`), `admin.categories.*` (`packages/contracts/src/domains/admin.ts`)
> Türkçe normalizasyon: [`TECH_DECISIONS.md` §3.9](./TECH_DECISIONS.md) (`kv_normalize`)

## Kategoriler

- **13 başlangıç kategorisi**, migration `20260928220000_faruk_kv26_categories_search` ile eklenir (PRODUCT_TEAM_PLAN §9): Teknoloji, Otomobil, Alışveriş, Eğitim, Üniversite, Yaşam, Seyahat, Oyun, Spor, Yemek, Ev / Emlak, Kariyer, Diğer. Sıra 1–13.
  - Referans veridir; her ortamda aynı id (sabit UUIDv7) ve slug ile bulunur.
  - Slug zaten varsa `ON CONFLICT DO NOTHING`; admin'in sonradan yaptığı değişiklikler ezilmez.
  - Ayrı bir seed komutu gerekmez; `prisma migrate deploy` yeterli.
- **`GET /v1/categories`:** Sadece aktif kategoriler, `sortOrder` ve `id` sırasıyla.
- **Pasif kategori davranışı:**
  - Listede ve kategori aramasında görünmez.
  - Yeni anket açılamaz (400 `VALIDATION_ERROR`, `field: categoryId`; KV-10).
  - **Mevcut anketleri görünür kalır:** detay, feed ve arama. Pasife almak içeriği gizlemez; içerik moderasyonla gizlenir.

## Admin kategori yönetimi: `/v1/admin/categories`

Yetki `category.manage` (ADMIN ve SUPER_ADMIN, KV-04); KV-12 RBAC katmanı router'ın kapısında verir. Misafir 401, kullanıcı ve moderatör 403. Silme yok; kategori `isActive=false` ile pasife alınır.

| Endpoint | Davranış |
|---|---|
| `GET /admin/categories` | Pasifler dahil, `sortOrder` + `id` sıralı, opak cursor. `pollCount`: kaldırılmamış (`REMOVED` hariç) anket sayısı; gizli/incelemedeki anketler yöneticiye sayılır. |
| `POST /admin/categories` | 201. Aynı slug 409 `CONFLICT` (`field: slug`). `Idempotency-Key` isteğe bağlı: aynı gövde aynı kaydı döner, farklı gövde 409 `IDEMPOTENCY_KEY_REUSED`. |
| `PATCH /admin/categories/:id` | Kısmi güncelleme. Başka kategorinin slug'ı 409; olmayan kategori 404. |

- **Slug tekilliği:** Aynı slug'a yazan işlemler slug üzerinde transaction advisory lock alır ve sonra kontrol eder. Çakışma unique index hatası (500) değil, 409 olur. Kilidi beklerken aynı `Idempotency-Key`'li istek tamamlandıysa 409 yerine kayıtlı sonuç döner (`assertNoCommittedKey`).
- **`sortOrder`:** Sözleşme sadece tam sayı ister; sütun `int4` olduğundan aralık dışı değer 400 `VALIDATION_ERROR` olur.
- **Bilinen açık: audit kaydı yok.** Gövdedeki `reason` doğrulanır ama saklanmaz. KV-04 §4.4'e göre audit kaydı işlemle aynı transaction'da yazılmalı; `audit_logs` tablosu KV-39 (#41, Utku) ile gelince create/update'e eklenecek.

## Arama: `GET /v1/search?q=&type=`

| `type` | Eşleşme | Sıralama | Görünürlük |
|---|---|---|---|
| `polls` (varsayılan) | Başlık veya açıklama | Başlık eşleşmesi önce, sonra `opensAt` ↓, `id` ↓ | Sadece `ACTIVE`/`LOCKED`; kart sonuç gizliliğine uyar |
| `users` | Kullanıcı adı veya görünen ad | Kullanıcı adının başıyla eşleşen önce, sonra kullanıcı adı ↑ | Silinmiş, `SUSPENDED` ve `BANNED` hesap yok; e-posta dönmez |
| `categories` | Ad veya slug | `sortOrder` ↑ | Sadece aktif |
| `communities` | Ad veya slug | Üye sayısı ↓ | Sadece `ACTIVE` |

- **Eşleşme biçimi:** `kv_normalize(sütun) LIKE '%' || kv_normalize(q) || '%'`. Türkçe karakter ve büyük/küçük harf farkı sayılmaz: "cicekci isigi" ile "ÇİÇEKÇİ IŞIĞI" aynı sonucu bulur.
- **Joker karakterler:** Kullanıcının yazdığı `%` ve `_` düz metin aranır (`ESCAPE`).
- **Pagination:** `q` en az 2 karakter. Opak cursor; `q` veya `type` değişirse 400 `INVALID_CURSOR`.
- **Görünürlük iki katmanda uygulanır:** Arama sorgusunda ve kartları yükleyen `listByIds`'te. Test, iki katman birlikte kaldırılınca kırılıyor.
- **Zaman cursor'ı** ISO metni olarak gönderilip `::timestamptz` ile çevrilir. Ayrıca DB oturumu UTC'dir (DATA_MODEL §2.2). Yerelde (docker-compose `TZ=Europe/Istanbul`) `Date` parametresi 3 saat kayıyordu ve sayfalama kayıt atlıyordu; CI UTC olduğu için görünmüyordu.

## Index'ler ve sorgu planları

Migration ile pg_trgm GIN ifade index'leri eklendi:
- `polls_title_search_idx`, `polls_description_search_idx`
- `users_username_search_idx`, `users_display_name_search_idx`
- `communities_name_search_idx`

İfade index'leri Prisma'ya görünmez ve drift üretmez (`migrate diff --exit-code` 0, doğrulandı). Kategori tablosu küçük olduğu için index eklenmedi.

Aşağıdaki planlar 100.000 anket ve 20.000 kullanıcılık sentetik veride, `ANALYZE` sonrası alındı (yerel PostgreSQL 17, embedded). Anket sorgusunda başlıkların 1/6'sı eşleşiyor (16.667 satır); bu kötü bir senaryo. Seçici sorgularda süre çok daha kısadır.

```
### polls (başlık veya açıklama)
Limit (actual time=162.843..165.384 rows=21 loops=1)
  ->  Gather Merge (actual time=162.841..165.380 rows=21 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        ->  Sort (actual time=49.404..49.405 rows=14 loops=3)
              Sort Key: (CASE WHEN (kv_normalize((title)::text) ~~ '%cicekci onerisi%'::text) THEN 0 ELSE 1 END), opens_at DESC, id DESC
              Sort Method: top-N heapsort  Memory: 26kB
              Worker 0:  Sort Method: top-N heapsort  Memory: 26kB
              Worker 1:  Sort Method: quicksort  Memory: 25kB
              ->  Parallel Bitmap Heap Scan on polls p (actual time=17.415..48.561 rows=5556 loops=3)
                    Recheck Cond: ((kv_normalize((title)::text) ~~ '%cicekci onerisi%'::text) OR (kv_normalize(COALESCE(description, ''::text)) ~~ '%cicekci onerisi%'::text))
                    Filter: (status = ANY ('{ACTIVE,LOCKED}'::content_status[]))
                    Heap Blocks: exact=1398
                    ->  BitmapOr (actual time=48.717..48.718 rows=0 loops=1)
                          ->  Bitmap Index Scan on polls_title_search_idx (actual time=38.731..38.732 rows=16667 loops=1)
                                Index Cond: (kv_normalize((title)::text) ~~ '%cicekci onerisi%'::text)
                          ->  Bitmap Index Scan on polls_description_search_idx (actual time=9.979..9.980 rows=0 loops=1)
                                Index Cond: (kv_normalize(COALESCE(description, ''::text)) ~~ '%cicekci onerisi%'::text)
Planning Time: 0.518 ms
Execution Time: 165.525 ms

### users
Limit (actual time=31.156..31.167 rows=11 loops=1)
  ->  Sort (actual time=31.155..31.162 rows=11 loops=1)
        Sort Key: username_normalized, id
        Sort Method: quicksort  Memory: 25kB
        ->  Bitmap Heap Scan on users u (actual time=30.909..31.109 rows=11 loops=1)
              Recheck Cond: ((kv_normalize((username)::text) ~~ '%kullanici_1234%'::text) OR (kv_normalize((display_name)::text) ~~ '%kullanici_1234%'::text))
              Rows Removed by Index Recheck: 1
              Filter: ((deleted_at IS NULL) AND (status = ANY ('{ACTIVE,RESTRICTED}'::user_status[])))
              Heap Blocks: exact=3
              ->  BitmapOr (actual time=30.550..30.553 rows=0 loops=1)
                    ->  Bitmap Index Scan on users_username_search_idx (actual time=12.826..12.827 rows=12 loops=1)
                          Index Cond: (kv_normalize((username)::text) ~~ '%kullanici_1234%'::text)
                    ->  Bitmap Index Scan on users_display_name_search_idx (actual time=17.719..17.719 rows=12 loops=1)
                          Index Cond: (kv_normalize((display_name)::text) ~~ '%kullanici_1234%'::text)
Planning Time: 0.190 ms
Execution Time: 31.731 ms
```

Küçük tablolarda (test veritabanı) planlayıcı `status` index'ini seçebilir; beklenen bir durumdur. Test (`search.test.ts`), `enable_seqscan=off` ile başlık index'inin kullanılabildiğini doğrular.

## Testler

`apps/api/test/search.test.ts`: 12 senaryo + 1 birim testi. Gerçek PostgreSQL gerektirir. Arama bütün veritabanında çalıştığı için her test, Türkçe karakterli benzersiz bir "iz" kelimesiyle kendi verisini bulur.

`apps/api/test/admin-categories.test.ts`: 8 senaryo (yetki, oluşturma/çakışma, idempotency, eşzamanlı aynı slug ve aynı anahtar, açık transaction ile deterministik slug yarışı, güncelleme, pasife alma, sayfalama). Mutasyon kontrolü: slug kilidi kaldırılınca deterministik yarış testi 500 alır; `assertNoCommittedKey` kaldırılınca aynı anahtarlı eşzamanlı istekler 409 alır.

## Kalan işler

| Konu | İş |
|---|---|
| Admin kategori işlemlerinin audit kaydı (`reason` saklanmıyor) | KV-39 (#41, Utku) `audit_logs` gelince Faruk ekler |
| Admin kategori yönetim ekranı | KV-41 (#43), Mehmet |
| Arama sonucu sıralamasında benzerlik puanı (`similarity`) | Gerekirse ürün geri bildirimiyle |
| Hız sınırı (arama spam'i) | KV-19 (#21), Utku |
