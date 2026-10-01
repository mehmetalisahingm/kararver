# #66: Anketsiz tartışma gönderileri ve gönderi beğeni/dislike'ı

> Sahip: **Faruk** (backend) · Ümit (UI), Mert (moderasyon entegrasyonu) destekler · Kod: `apps/api/src/modules/polls` · Sözleşme: `polls.create` (`kind=DISCUSSION`), `reactions.poll.put/delete` (`packages/contracts/src/domains/polls.ts`)
> Kaynak: [V1_USER_FLOW.md](./V1_USER_FLOW.md): "iki içerik türü", "içerik tepkisi ile anket oyu farklıdır". **V1 yayın şartı.**

## Tartışma gönderisi

`POST /v1/polls` ile `kind: "DISCUSSION"`: başlık, açıklama, kategori, topluluk, etiket ve isteğe bağlı fotoğraf.

- **Seçenek, oy, süre ve sonuç görünürlüğü yoktur.** Bu alanlar gönderilirse 400 (sözleşmenin katı şeması).
- Detay ve kartta `kind: "DISCUSSION"`, `options: []`, `results: null`, `resultsVisibility: null`, `closesAt: null`.
- **Hiç kapanmaz:** `closed` her zaman `false`.
- `viewer.canVote` her zaman `false`, `voteBlockedReason: "NOT_A_POLL"`.
- **Ankete özgü işlemler 409 `NOT_A_POLL` döner:**
  - Oy. Sahip oy verse bile önce bu hata gelir; sözleşmedeki hata sırası böyle.
  - Seçenek veya `resultsVisibility` düzenleme.
  - Erken kapatma.
- Başlık, açıklama, kategori ve etiket düzenlenir; silme anketle aynıdır.
- Yorum, cevap, feed (bütün sekmeler, "Senin İçin" dahil), arama ve raporlama anketle aynı çalışır.
- **Yayın kuralları iki türde aynı:**
  - Cooldown ve günlük limit (KV-20) aynen geçerli.
  - Aynı başlık kuralında tartışma süresiz olduğu için kaldırılana kadar "açık" sayılır.
  - Yayın puanı (#67, Mehmet) gelene kadar iki tür de puansız yayınlanır.
- **Trendler:** Tartışma oy almadığı için oy temelli listelere girmez. "En Çok Konuşulanlar"a yorumla girebilir. Snapshot ve Haftanın Değişkenleri'ne girmez (süresiz ve sonucu yok).

## Gönderi tepkileri: `PUT` / `DELETE /v1/polls/:id/reaction`

- `{ value: "LIKE" | "DISLIKE" }`. Cevap `{ likes, dislikes, viewer }`.
- Anket ve tartışmada çalışır; **anket oyundan ayrıdır**: oy sayısını ve sonucu değiştirmez.
- **Hesap + gönderi başına tek aktif tepki:**
  - Aynı değer tekrar gönderilirse 200 döner, sayaç değişmez.
  - `LIKE ↔ DISLIKE` sayaçları taşır.
  - `DELETE` idempotent: tepki yoksa da 200.
- **Retry ve eşzamanlılık tutarlılığı:** Gönderi satırı `FOR UPDATE` ile kilitlenir; tepki satırı ve sayaçlar aynı transaction'da yazılır. Aynı hesabın 10 eşzamanlı LIKE'ı tek beğeni üretir; sayaç her zaman tablodaki tepki sayısına eşittir.
- **Durum kuralları:**
  - Kapanmış ankette tepki verilebilir.
  - Kilitli (`LOCKED`) gönderide yeni tepki 409 `CONTENT_LOCKED`; mevcut tepki kaldırılabilir (sözleşmede `DELETE`'in hata listesi boş).
  - Görünmeyen gönderi 404, misafir 401.
- **Sahip kendi gönderisine tepki verebilir.** Yorum tepkisiyle (KV-17) aynı kural; ürün aksini isterse kolayca değişir.
- Detayda `reactions` (sayılar herkese açık) ve `viewer.reaction` (izleyicinin kendi tepkisi) dolu.

## Veri modeli: `20261001120000_faruk_kv66_discussions_reactions`

**Mevcut veri korunur:** Bütün mevcut satırlar `kind = 'POLL'` olur; süre ve sonuç görünürlüğü dolu kalır.

| Değişiklik | Ayrıntı |
|---|---|
| `polls.kind` | `poll_kind` enum'u: `POLL` / `DISCUSSION`, varsayılan `POLL` |
| `polls.closes_at`, `polls.results_visibility` | Boş olabilir. `polls_kind_shape_check`: anket ikisini de ister; tartışmada ikisi ve `closed_at` boş |
| `polls.like_count`, `polls.dislike_count` | ≥ 0 (CHECK) |
| `poll_reactions` | PK `(poll_id, user_id)`, `value` (`reaction_value`), index `user_id`; gönderi veya kullanıcı silinince CASCADE |
| Trigger `polls_kind_immutable` | Tür sonradan değişmez (`KV_POLL_KIND_IMMUTABLE` → 500) |
| Trigger `poll_options_check_kind`, `votes_check_kind` | Tartışmaya seçenek ve oy yazılamaz (`KV_NOT_A_POLL` → 409 `NOT_A_POLL`); API'yi atlayan yazmayı da reddeder |

## Testler

`apps/api/test/discussions.test.ts` (9, PostgreSQL):
- Tartışma oluşturma, alanlar ve kapanmama.
- Ankete özgü alanların reddi ve aynı başlık kuralı.
- Oy, düzenleme ve kapatmada `NOT_A_POLL`.
- Feed, arama, yorum ve silme.
- DB kısıtları ve trigger'lar.
- Tepki akışı; tepki ile oyun ayrılığı; yetki ve durum.
- Eşzamanlı ve tekrar istekler.

**Mutasyon kontrolü:** Tepkideki satır kilidi kaldırılınca eşzamanlılık testi kırılıyor (sayaç 5/4, tablo 15/7).

## İçerik sürüm geçmişi: `GET /v1/admin/polls/:id/revisions`, `/v1/admin/comments/:id/revisions`

Kaynak: V1_USER_FLOW "Yetkili admin içerik geçmişinden kimin ne paylaştığını ve hangi sürümü değiştirdiğini inceleyebilir."

- **Yazım:** Her oluşturma ve düzenlemede, içeriğin o anki hali yeni sürüm olur.
  - Sürüm 1 ilk paylaşımdır ("kim ne paylaştı"); editör ve zaman da yazılır.
  - Yazım içerikle aynı transaction'da yapılır: reddedilen düzenleme (ör. ilk oydan sonra başlık) sürüm üretmez.
  - Sürüm numarası, içerik satırının kilidiyle sıralanır. Eşzamanlı düzenlemeler 1, 2, 3 … diye boşluksuz ilerler (açık kilit kaldırılınca test kırılıyor).
- **Anlık görüntü** (`snapshot`) biçimi tek yerde, DB fonksiyonlarında: `kv_poll_snapshot`, `kv_comment_snapshot`.
  - Gönderi: tür, başlık, açıklama, kategori, topluluk, etiketler, fiyat, ek bilgi, yorum izni, sonuç görünürlüğü, kapanış, seçenekler, görseller.
  - Yorum: tür, metin, üst yorum.
  - Sayaçlar ve durum içerik değildir; onların izi `moderation_actions`'tadır.
- **Okuma:**
  - Yalnız ADMIN+ (`revision.read`). Moderatör, kullanıcı ve yazarın kendisi 403.
  - En yeni sürüm önce, opak cursor.
  - Kaldırılmış içeriğin geçmişi de açık (inceleme/itiraz).
- **Değiştirilemez:** `poll_revisions` / `comment_revisions` append-only (`KV_REVISIONS_APPEND_ONLY`).
- **Mevcut içerik:** Migration, şu anki hali sürüm 1 olarak yazar (editör = yazar).
  - Zaman: anket için oluşturma anı, yorum için son düzenleme veya oluşturma anı.
  - Migration'dan önceki düzenlemelerin ara sürümleri bilinmez; bu bilinçli bir sınır.
- **Testler:** `apps/api/test/revisions.test.ts` (5).

## Kalan işler

| Konu | İş |
|---|---|
| Geçmiş okumasının kendisinin audit kaydı ("log erişimi de izlenebilir") | KV-39 (#41, Utku) `audit_logs` gelince |
| Saklama/silme süreleri ("yayından önce belirlenir") | Ürün kararı (Mehmet); şu an süresiz saklanıyor |
| Yayın puanı (10 puan) ve bakiye kontrolü | #67, Mehmet |
| Tartışma kartı ve tepki düğmeleri (UI) | Ümit (#20) |
| Kullanıcı tepki/oy değişimi logları (V1_USER_FLOW "Kullanıcı ve admin logları") | Audit/olay altyapısı: KV-39 (#41, Utku); `reaction.changed` olayı outbox'la birlikte |
