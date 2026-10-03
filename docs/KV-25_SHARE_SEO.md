# KV-25 — Paylaşım, SEO ve kaynak ölçümü

Issue: #27 · Sahip: Mehmet

## Canonical ve indeksleme

- Public içerik URL'si `/karar/{slug}-{publicId}` biçimindedir.
- Karar sayfası `title`, `description`, canonical ve OpenGraph metadata'sını yalnız public `PollDetail` cevabından üretir.
- Sonuçları gizli (`AFTER_VOTE`) ankette metadata sonuç yüzdesi, toplam oy veya seçenek oy sayılarını içermez.
- API public detayı vermiyorsa sayfa metadata'sı `noindex,nofollow` olur.
- `sitemap.xml` yalnız public feed'de görünen `ACTIVE/LOCKED` içeriklerden üretilir; kaldırılmış/gizli içerik sitemap'e giremez.
- Local/staging tamamen `noindex`; robots yalnız `APP_ENV=production` iken public gezinmeye izin verir.

## Paylaşım bağlantısı

`POST /v1/polls/:id/shares` gövdesi `{ channel: "x" | "whatsapp" | "copy" | "other" }` alır.

Sunucu:
1. anket satırını transaction içinde `FOR SHARE` ile okur,
2. yalnız `ACTIVE` veya `LOCKED` içeriğe izin verir,
3. `share_links` tablosuna opak UUID + poll + kanal + zaman yazar,
4. `/karar/{slug}-{publicId}?src={shareId}` döndürür.

URL'de kullanıcı ID'si, e-posta, session, token veya başka kişisel veri bulunmaz. `src` yalnız paylaşım kaydının opak UUID'sidir.

## Kaynak → kayıt → ilk katkı tanımı

V1 attribution anahtarı `shareId`'dir. Landing sırasında web uygulaması geçerli `src` UUID'sini `kv.share.attribution` first-touch kaydı olarak 30 gün saklar; sonraki paylaşım tıklamaları ilk kaynağı ezmez.

#38 analitik hattı kayıt ve ilk katkı eventlerini eklediğinde aşağıdaki alanı bu helper'dan okuyacaktır:

```text
attribution.shareId = readShareAttribution()?.shareId ?? null
```

Böylece üç aşama aynı opak anahtarla join edilebilir:

```text
share_links.id
  -> registration attribution.shareId
  -> first_contribution attribution.shareId
```

Ham URL, e-posta, IP, cookie veya session kimliği analitik kaynağı olarak kullanılmaz. Attribution penceresi 30 gündür; süresi dolan local kayıt otomatik temizlenir.

## Kabul / test kanıtı

- API PostgreSQL testi: aktif/kilitli içerik paylaşılabilir; `HIDDEN/REMOVED` 404 ve kayıt üretmez; geçersiz kanal 400.
- URL testi: tek query parametresi `src`; kullanıcı ID/e-posta bulunmaz.
- Web build/typecheck: metadata, robots, sitemap ve paylaşım UI tip kontrolünden geçmelidir.
- Production/staging preview kabulü #52 kapsamında gerçek sosyal preview yüzeylerinde ayrıca doğrulanır.
