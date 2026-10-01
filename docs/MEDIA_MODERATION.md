# KararVer — Lokal Görsel Moderasyon Teknik Denemesi (KV-08)

> Issue: **KV-08 / #10** · Sahip: **Mert** (`@MertKAYAR`)
> Bağımlı: [KV-01](./TECH_DECISIONS.md) (✅), gerçek entegrasyon ve kapanış için [KV-16](https://github.com/mehmetalisahingm/kararver/issues/18)
> Kanıt: [`scripts/media-moderation-spike/`](../scripts/media-moderation-spike/) (`results.json`, çalıştırma tarihi 2026-09-27)
> Son güncelleme: 2026-09-27

Bu belge KV-08'in kabul koşullarını karşılar: model lisansı/kaynak/gecikme
kaydı, risk seviyeleri ve inceleme akışı tasarımı, storage/signed-URL
yaklaşımı. Gerçek upload pipeline'ı (`api/modules/media`, `worker/jobs/media`)
KV-16'da bu kararlar üzerine kurulur; bu issue kod teslimi değil, karar ve
kanıt teslimidir.

---

## 1. Özet

| Konu | Karar | Durum |
|---|---|---|
| Model | [NudeNet](https://github.com/notAI-tech/nudenet) `3.4.2` — bölge bazlı (bounding-box) çıplaklık tespiti, ONNX, MIT | ✅ Kabul |
| Çalışma ortamı | `apps/worker` (Node) içinde, model çıkarımı için **uzun ömürlü, havuzlanan Python alt-süreç** (satır bazlı JSON protokolü) | ✅ Kabul — TECH_DECISIONS §10 açık konu 5'i kapatır |
| MIME / re-encode / EXIF | `sharp` (Node, Apache-2.0): izin verilen MIME listesi doğrulanır → yeniden encode edilir → EXIF varsayılan olarak atılır | ✅ Kabul |
| Risk seviyeleri | Düşük / Orta / Yüksek, sınıf bazlı ağırlıklandırılmış güven skoru; eşikler admin ayarından (`system_settings`) | ✅ Kabul |
| Timeout / hata davranışı | 8 sn; timeout veya model hatası **her zaman** `QUARANTINED` sayılır (fail-closed) | ✅ Kabul |
| Storage erişimi | KV-01 §3.6 karantina akışı korunur: `PENDING`/`QUARANTINED`/`REJECTED` sadece kısa ömürlü signed URL ile, `APPROVED` public bucket/CDN | ✅ Kabul |

---

## 2. Değerlendirilen model seçenekleri

Hedef: ücretli dış API yok (MVP_PLAN §14/TECH_DECISIONS §3.7), sunucumuzda
çalışır, lisansı ticari kullanıma uygun.

| Seçenek | Lisans | Çıktı türü | Artı | Eksi |
|---|---|---|---|---|
| **NudeNet 3.4.2** ✅ | MIT | Bölge bazlı: 18 sınıf (`*_EXPOSED` / `*_COVERED`, yüz), her biri kutu + güven skoru | Model paketin içinde gömülü (~11,6 MB, ayrı indirme yok), ONNX → hem Python hem Node (`onnxruntime-node`) ile çalıştırılabilir, aktif bakılıyor (2025) | Sadece çıplaklık tespit eder; şiddet/silah gibi diğer risk türlerini kapsamaz (V1 kapsamı zaten sadece bu değil, bkz. §6) |
| GantMan/nsfw_model | Apache-2.0 | Görsel bazlı 5 sınıf (`drawing/hentai/neutral/porn/sexy`), kutu yok | Basit, tek skor | TensorFlow/Keras runtime gerekir (daha ağır), bölge bilgisi yok → kısmi bulanıklaştırma gibi ileri özellikler için kullanılamaz, 2019'dan beri majör güncelleme yok |
| Falconsai/nsfw_image_detection (HF ViT) | Apache-2.0 | 2 sınıf (`normal/nsfw`) | Transformer tabanlı, iyi doğruluk raporları | ~350 MB checkpoint, PyTorch runtime, CPU'da NudeNet'in onlarca katı gecikme; V1 kaynak bütçesine göre gereksiz ağır |
| Google Cloud Vision SafeSearch / AWS Rekognition Moderation | Ticari | — | Yüksek doğruluk, bakım yok | **Elenir:** ücretli dış API — MVP_PLAN §14 ve TECH_DECISIONS §3.7 bunu zaten dışarıda bırakıyor |

**Seçim gerekçesi:** NudeNet, bölge bazlı çıktısı sayesinde hem "yayınla/incele/reddet" kararını hem de ileride (V1.1+) kısmi bulanıklaştırma gibi ürün kararlarını destekler; model dosyası pakete gömülü olduğu için lisans ve tedarik zinciri nettir (bkz. `.spike` çıktısı: `nudenet==3.4.2`, MIT); CPU'da onlarca milisaniyede çalışır (bkz. §3), bu da worker'da ek kuyruklama gerektirmez.

---

## 3. Ölçüm sonuçları (kanıt)

Kaynak: [`scripts/media-moderation-spike/benchmark.py`](../scripts/media-moderation-spike/benchmark.py), çıktı [`results.json`](../scripts/media-moderation-spike/results.json). Ortam: local geliştirme makinesi, CPU (`CPUExecutionProvider`), tek süreç, tek thread — production donanımı farklı olabilir, sayılar üst sınır değil referans niteliğindedir.

| Ölçüm | Değer |
|---|---|
| Model boyutu | 11,6 MB (`320n.onnx`, pakete gömülü) |
| Soğuk başlatma (`NudeDetector()`, model yükleme) | ~88 ms |
| Görsel başına çıkarım (sıcak, 256×256 → 1600×1200 arası 5 örnek) | 20–38 ms, ortalama **26,7 ms** |
| Süreç RSS — model yüklenmeden önce | 49,6 MB |
| Süreç RSS — model yüklendikten sonra | 72,4 MB (**+22,8 MB**) |
| Süreç RSS — birkaç çıkarımdan sonra (istikrar durumu) | 88,3 MB |

**Örnek sonuçlar:** Test görselleri sentetiktir (düz renk, gradient, gürültü, basit çizim, avatar boyutu — bkz. `scripts/media-moderation-spike/README.md`), gerçek uygunsuz içerik içermez. Beklendiği gibi 5 görselin hepsi `detections: []` (hiçbir sınıf 0,2 ham eşiğini geçmedi) döndü. **Bu, modelin gerçek pozitif/negatif oranının kanıtı değildir** — sadece pipeline'ın çalıştığının ve gecikme/kaynak profilinin kanıtıdır. Modelin gerçek doğruluğu, etiketli (ve uygun şekilde erişim kısıtlanmış) bir örneklemle KV-16 entegrasyonunda ayrıca doğrulanmalıdır (bkz. §7 açık konular).

**Sonuç:** ~27 ms/görsel ve ~90 MB istikrarlı bellek, tek bir worker sürecinde saniyede onlarca görseli kuyruğa almadan işleyebilecek kadar hafif. V1 hacmi (MVP_PLAN §5 spam limitleri: kullanıcı başına günde en fazla 3–10 anket) için ayrı bir ölçekleme mekanizması gerekmez.

---

## 4. Model çalışma ortamı — Node mi, Python mu? (TECH_DECISIONS §10, açık konu 5)

**Karar: Python alt-süreç, `apps/worker` (Node) tarafından yönetilir. Ayrı bir ağ servisi değildir.**

Değerlendirilen seçenekler:

| Seçenek | Artı | Eksi |
|---|---|---|
| **Havuzlanan Python alt-süreç** (`child_process`, satır bazlı JSON stdin/stdout) ✅ | NudeNet'in test edilmiş Python pre/postprocessing'i (letterbox resize, YOLO decode, NMS) aynen kullanılır; ek ağ sınırı, TLS veya auth yok; tek deploy birimi (aynı container/host) | İkinci bir runtime (Python) kurulum/CI adımına eklenir |
| Ayrı Python mikroservisi (HTTP, kendi deploy'u) | Bağımsız ölçeklenebilir | TECH_DECISIONS §3.7'de "hosting kesinleşmesini bloke ediyor" olarak işaretli; V1 hacmi için gereksiz operasyonel yük (ayrı health-check, auth, ağ gecikmesi) |
| `onnxruntime-node` ile saf Node/TypeScript | Tek dil (KV-01 tercihiyle uyumlu), ekstra runtime yok | YOLO postprocessing'i (letterbox padding, anchor-free decode, NMS) sıfırdan TS'e taşımak gerekir; bir güvenlik özelliğinde postprocessing hatası **yanlış negatif** (gerçek uygunsuz içeriğin yayınlanması) riski taşır — Hafta 1 takviminde doğrulanmamış yeniden yazım riskli |

**Gerekçe:** Alt-süreç yaklaşımı, NudeNet'in kanıtlanmış Python implementasyonunu korurken TECH_DECISIONS §3.7'nin reddettiği "ayrı servis" operasyonel yükünü getirmez — süreç `apps/worker` ile aynı container'da doğar/ölür, ek port veya kimlik doğrulama yüzeyi yoktur. `media.process` job'u (TECH_DECISIONS §3.5, sahip: Mert) görseli re-encode ettikten sonra alt-sürece bir görsel yolu yollar, JSON satırı olarak `{ok, riskScore, riskLevel, classes}` alır.

**Yükseltme yolu (şimdi değil):** İleride tek worker'ın çıkarım hacmi darboğaz olursa iki seçenek kayıtlıdır: (a) postprocessing'i Node/ONNX'e taşımak (bu durumda §3 tablosundaki referans sayılar zaten Node tarafında da benzer olacaktır, çünkü asıl maliyet ONNX çıkarımıdır, dil değil), (b) TECH_DECISIONS §3.7'nin öngördüğü gibi modeli ayrı bir servise/VPS'e taşımak. Her iki yol da bu karardan etkilenmez çünkü sınır zaten JSON mesajlaşma ile çizilmiştir.

---

## 5. MIME doğrulama, re-encode, EXIF temizleme

Sıra (TECH_DECISIONS §3.6 karantina akışının ilk adımı):

1. **MIME/uzantı doğrulama (Node, `apps/api`):** İzin verilen liste `image/jpeg`, `image/png`, `image/webp`. Dosya imzası (magic bytes) kontrol edilir, sadece `Content-Type` header'ına güvenilmez. `image/gif` ve `image/svg+xml` V1'de reddedilir: SVG script içerebilir (XSS), animasyonlu GIF'in her karesinin moderasyonu ek karmaşıklık getirir — V1.1'e bırakılabilir açık konu.
2. **Boyut limiti:** Varsayılan öneri 8 MB (orijinal upload), admin ayarından değiştirilebilir (MVP_PLAN §14.6 ile tutarlı).
3. **Re-encode + EXIF temizleme (Node, `worker/jobs/media`):** [`sharp`](https://sharp.pixelplumbing.com/) (Apache-2.0, libvips sarmalayıcısı) ile görsel yeniden kodlanır. `sharp`, `.withMetadata()` çağrılmadığı sürece EXIF/ICC/XMP meta verisini **varsayılan olarak atar**; sadece `.rotate()` ile EXIF `Orientation` bilgisini piksellere uygulayıp sonra atıyoruz — yani konum/cihaz gibi hassas EXIF alanları hiçbir zaman depoya yazılmaz. Çıktı formatı `webp` (kalite 82) olarak standardize edilir; orijinal format ne olursa olsun tek bir dekoder/optimizasyon yolu kullanılır.
4. **Moderasyon:** Re-encode edilmiş (temiz) kopya §4'teki alt-sürece verilir. Orijinal, moderasyon sonucu ne olursa olsun private bucket'ta kalır (rapor/itiraz kanıtı, KV-38'in hash listesi için).

---

## 6. Risk seviyeleri, eşikler, timeout, manuel inceleme

### 6.1 Sınıf ağırlıklandırma

NudeNet'in 18 sınıfı üç gruba ayrılır (varsayılan; admin ayarından değiştirilebilir çıplaklık politikası MVP_PLAN §14.6 "moderasyon risk eşikleri" ile aynı ayar grubu):

| Grup | Sınıflar | Varsayılan davranış |
|---|---|---|
| **Yüksek** | `FEMALE_GENITALIA_EXPOSED`, `MALE_GENITALIA_EXPOSED`, `ANUS_EXPOSED`, `FEMALE_BREAST_EXPOSED`, `BUTTOCKS_EXPOSED` | Güven ≥ `HIGH_THRESHOLD` (varsayılan **0,65**) → otomatik karantina |
| **Orta** | Yukarıdakiler `MEDIUM_THRESHOLD`–`HIGH_THRESHOLD` arası (varsayılan **0,35–0,65**) güvenle; ayrıca yüksek güvenle `MALE_BREAST_EXPOSED`, `BELLY_EXPOSED` | `UNDER_REVIEW`, moderasyon kuyruğuna düşer ama otomatik reddedilmez |
| **Düşük** | Sadece `*_COVERED` sınıfları, `FACE_*`, veya hiç tespit yok, veya güven < `MEDIUM_THRESHOLD` | Otomatik yayın (`APPROVED`) |

Bir görseldeki **risk skoru = o görselde tespit edilen Yüksek/Orta grup sınıflarının en yüksek güven değeri**; birden fazla bölge varsa en kötüsü kazanır (fail-closed prensip, DATA_MODEL.md §7'deki "varsayılan RESTRICT" yaklaşımıyla tutarlı).

### 6.2 Timeout ve hata davranışı

- Alt-süreç çağrısına **8 saniye** timeout uygulanır (tek görsel için cömert bir üst sınır; §3'teki ölçümün ~300 katı).
- Timeout, alt-süreç çökmesi veya beklenmeyen çıktı → görsel **her zaman `QUARANTINED`** sayılır, asla `APPROVED`'a fail-open edilmez. Moderasyon kuyruğuna `reason=MODERATION_TIMEOUT` ile düşer; kuyruk KV-24'ün rapor/moderasyon sistemiyle aynıdır.
- Alt-süreç havuzu (ör. 2 kalıcı Python süreci) `apps/worker` başlarken oluşturulur; bir süreç çökerse otomatik yeniden başlatılır (crash-only tasarım — DATA_MODEL.md'deki "job tekrar çalışabilir" idempotency ilkesiyle aynı ruh).

### 6.3 Manuel inceleme akışı

1. Orta ve Yüksek risk + timeout/hata → `moderation_actions` kuyruğuna (KV-24, Mert) girer: risk seviyesi, sınıf/güven listesi, görselin private bucket signed URL'i.
2. Moderatör onaylarsa → görsel `APPROVED`'a geçer, public bucket'a kopyalanır (§7). Reddederse → `REJECTED`, private bucket'ta kalır, KV-38'in perceptual-hash listesine eklenmeye adaydır.
3. Yüksek risk + çok yüksek güven (ör. ≥ 0,9, ayrı bir admin ayarı) için MVP_PLAN §13 "aşırı rapor alan içerik" mantığına paralel, ileride otomatik reddetme (moderatör onayı beklemeden) V1.1'e bırakılabilecek bir seçenektir — V1'de varsayılan kapalı, açık konu olarak §7'de kayıtlı.

---

## 7. Storage erişimi ve kaldırılmış medyaya erişim

TECH_DECISIONS §3.6'daki iki-bucket akışı (presigned upload → private bucket → worker → onaylanan kopya public bucket) bu spike ile şöyle detaylanır:

| `MediaStatus` | Nerede durur | Kim, nasıl erişir |
|---|---|---|
| `PENDING` | Private bucket (`kararver-uploads-private`) | Sadece yükleyen kullanıcı, kısa ömürlü (ör. 5 dk) signed GET URL ile kendi bekleyen görselini görebilir |
| `APPROVED` | Public bucket (`kararver-media-public`) — private'daki orijinal **silinmez**, kopyalanır | Herkes, `MEDIA_PUBLIC_BASE_URL` + CDN üzerinden, doğrudan public URL |
| `QUARANTINED` | Private bucket | Moderatör/admin rolü (KV-04/KV-12 RBAC) kısa ömürlü signed URL ile; her erişim KV-39 audit log'una yazılır. Yükleyen kullanıcı da kendi görselinin **işlenmiş (EXIF'siz) kopyasını** 5 dk'lık signed URL ile önizler ("incelemede" durumu); orijinal dosya hiçbir zaman URL almaz |
| `REJECTED` | Private bucket, **kalıcı olarak saklanır** (silinmez) | Sadece admin, itiraz/hukuki talep durumunda signed URL ile; erişim audit'e yazılır. Amaç: KV-38'in yasaklı-görsel hash listesi ve olası itiraz süreci için kanıt |

**İlke:** Private bucket'taki hiçbir nesne asla herkese açık/tahmin edilebilir bir URL almaz; `APPROVED` olmayan hiçbir görsel CDN'e çıkmaz. Bu, DATA_MODEL.md §9'daki "sadece `status = APPROVED` görseller gösterilir" sorgu kuralıyla birebir uyumludur ve o kuralın storage katmanındaki karşılığıdır.

---

## 8. Açık konular / KV-16'ya devredilenler

| # | Konu | Not |
|---|---|---|
| 1 | Gerçek doğruluk doğrulaması | Bu spike'ın örnekleri sentetik/zararsız. Etiketli bir doğrulama seti (izin/erişim kısıtlı, yalnızca moderatör erişimli bir ortamda) KV-16'da hazırlanmalı. |
| 2 | GIF ve SVG desteği | V1'de reddediliyor (§5). Talep gelirse V1.1'de ayrı bir karar gerekir. |
| 3 | Perceptual hash / tekrar yükleme engeli | Bu spike kapsamında değil; KV-38'in konusu. `REJECTED` görsellerin private bucket'ta kalıcı saklanması (§7) KV-38'in ön koşuludur. |
| 4 | Yüksek güvende otomatik red (moderatör onayı olmadan) | V1'de kapalı, admin ayarı olarak ileride açılabilir (§6.3). |
| 5 | Alt-süreç havuzu boyutu ve `apps/worker` içindeki tam arayüz | KV-16'da, gerçek `worker/jobs/media` yazılırken netleşir; bu belge sadece protokolü (JSON stdin/stdout) ve fail-closed kuralını sabitler. |

---

## 9. Uygulama durumu (KV-16, #18)

| Parça | Yer | Durum |
|---|---|---|
| `POST /media/uploads`: ayar kontrolü (tür, boyut, yükleme anahtarı), `PENDING` kayıt, private bucket'a 10 dk'lık presigned PUT (`Content-Type` ve `Content-Length` imzada) | `apps/api/src/modules/media` | ✅ |
| `POST /media/:id/complete`: nesne yoklanır (yoksa 400 `not_uploaded`), boyut/tür tekrar kontrol edilir (uymazsa `REJECTED`), `media.process` kuyruğa alınır | aynı | ✅ |
| `GET /media/:id`: sahibine durum; public URL sadece `APPROVED`, önizleme sadece işlenmiş kopya | aynı | ✅ |
| Kuyruk: pg-boss `media.process`, `stately` politika + `singletonKey = mediaId` (aynı görsel için en fazla 1 bekleyen + 1 çalışan iş), 3 deneme, üstel bekleme | `apps/api/src/modules/media/queue.ts` | ✅ |
| Worker: imza (magic bytes) kontrolü → resize (uzun kenar 2048 px) / re-encode (webp q82) + EXIF temizleme → moderasyon → karantina / public bucket | `apps/worker/src/jobs/media` | ✅ |
| Sıkıştırma bombası koruması: 40 MP üstü girdi çözülmez (`INVALID_IMAGE`) | `image.ts` | ✅ |
| Python moderasyon alt-süreci (NudeNet, satır başına JSON), 8 sn zaman aşımı, takılan süreç öldürülür ve yeniden başlar | `python/moderate.py`, `moderator.ts` | ✅ |
| Geçici hata: pg-boss 3 kez yeniden dener; son denemede de olursa `QUARANTINED` / `PROCESSING_FAILED` (görsel beklemede kalmaz) | `job.ts` | ✅ |
| `GET /admin/media`: karantina / bekleyen / reddedilen kuyruğu (en eski önce). MODERATOR yalnız atandığı toplulukların görselini görür (anket galerisi veya topluluk görseli üzerinden); topluluğu olmayan görsel (avatar, topluluksuz anket) yalnız ADMIN+ kuyruğundadır. Önizleme işlenmiş kopyanın 5 dk'lık signed URL'idir; reddedilmiş görselin önizlemesini yalnız ADMIN+ alır | `apps/api/src/modules/media/admin-routes.ts` | ✅ |
| `POST /admin/media/:id/decision`: `APPROVE` (QUARANTINED/REJECTED → APPROVED) işlenmiş kopyayı public bucket'a kopyalar; `REJECT` (QUARANTINED/APPROVED → REJECTED) public nesneyi siler ve `public_object_key`'i aynı UPDATE'te boşaltır. Karar `moderation_actions`'a yazılır; reddedilen görselin açık raporları `ACTIONED` olur. PENDING 409, aynı karar tekrarı idempotent | aynı | ✅ |

Nesne anahtarları: orijinal `uploads/<uuid>/original` (private, API belirler, DB'de saklanır); işlenmiş ve public anahtarları worker belirler ve DB'ye yazar. Böylece API ve worker anahtar biçimini paylaşmak zorunda kalmaz.

Worker sonuç kodları (`media_assets.processing_error`): `INVALID_IMAGE`, `MISSING_ORIGINAL`, `TOO_LARGE` → `REJECTED`; `MODERATION_TIMEOUT`, `MODEL_ERROR`, `PROCESSING_FAILED` → `QUARANTINED`. Orta/yüksek risk hatasız `QUARANTINED`'dır (`risk_level` dolu).

**Deploy için açık konular:**
- Worker imajında Python 3 ve `apps/worker/python/requirements.txt` kurulu olmalı (`MODERATION_PYTHON`). Hosting kararı (TECH_DECISIONS §3.7) kesinleşince Dockerfile/Railway ayarı eklenmeli.
- Public bucket'ın anonim okunması: R2'de custom domain/public erişim, local SeaweedFS'te anonim `Read` kimliği (`infra/seaweedfs/s3.json`). Bu PR'da değiştirilmedi; `MEDIA_PUBLIC_BASE_URL` bu erişime göre ayarlanır.
- **Public bucket'a API de yazar (§7 ilkesinden sapma):** otomatik onayı worker yapar, moderatör onayı/kaldırması `admin.media.decide` ile API'den gelir (S3 `CopyObject`/`DeleteObject`, aynı deterministik anahtar `m/<id>.webp`). Bu yüzden API artık `S3_BUCKET_PUBLIC` ister (worker ile aynı değişken; staging/production'da zorunlu) ve hesabın public bucket'a yazma yetkisi olmalıdır. Sıra: onayda önce kopya sonra DB, kaldırmada önce silme sonra DB; yarım kalan işlem görseli yanlışlıkla yayında bırakmaz, tekrar denenebilir.
- **Audit:** signed preview erişimi ve reddedilmiş görsel erişimi (§7) `audit_logs` tablosu KV-39 (#41, Utku) ile gelince yazılacak; o zamana kadar kararın izi `moderation_actions`'tadır, erişim izlenmez.
- Moderasyon eşikleri ve `media.maxBytes` şimdilik sözleşme varsayılanlarından okunuyor; sistem ayarları servisi (KV-40) gelince oradan okunacak.

## 10. Referanslar

- [`scripts/media-moderation-spike/`](../scripts/media-moderation-spike/) — çalıştırılabilir kanıt (README, `requirements.txt`, `generate_samples.py`, `benchmark.py`, `results.json`)
- [`docs/TECH_DECISIONS.md`](./TECH_DECISIONS.md) §3.6 (object storage), §3.7 (hosting), §10 açık konu 5
- [`docs/DATA_MODEL.md`](./DATA_MODEL.md) §9 (Mert'in tablo sözleşmeleri: `media_assets`, `reports`)
- [NudeNet](https://github.com/notAI-tech/nudenet) (MIT)
