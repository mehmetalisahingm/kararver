# KV-53 — V1.1: gelişmiş kişiselleştirme ve trend grafikleri (#55)

> Sahip: **Faruk** · Aşama: V1.1, yayın sonrası backlog; V1'i bloke etmez · Kapanış bağımlılığı: #54 (public V1 yayın kararı)
> Kaynaklar: PRODUCT_TEAM_PLAN §24 "V1.1", [KV-07](./KV-07_PRODUCT_EVENTS_ACCEPTANCE_CONTENT.md) (olay ve metrik tanımları), [KV-27](./KV-27_FOR_YOU_FEED.md) ("Senin İçin"), [KV-28](./KV-28_TRENDS.md) / [KV-29](./KV-29_SNAPSHOTS_MOVERS.md) (trendler, snapshot'lar)

Bu belge bir **plan ve hipotez listesidir**; kod değişikliği yok. Amaç: V1 yayınlandıktan sonra ilk gerçek kullanıcı verisiyle neyin ölçüleceğini, neyin deneneceğini ve hangi alt işlere bölüneceğini önceden netleştirmek.

## 1. Bugünkü durum (V1)

**"Senin İçin" (KV-27):**
- Kural tabanlı puanlıyor: onboarding ilgi alanı (1.5), yenilik (2.0), son 24 saatte oy (1.0) ve yorum (0.7), toplam oy (0.3).
- Kartların %20'si keşif yuvası; 10 kartlık pencerede aynı yazar ve kategori için tekrar sınırı var.
- Kişisel sinyal **yalnız seçilen ilgi alanları**. Kullanıcının oy, yorum, kaydetme ve takip davranışı sıralamaya girmiyor.

**Trendler:**
- 5 dakikada bir 5 format hesaplanıyor: günün ve haftanın yükselenleri, en çok oy alanlar, en çok konuşulanlar, değişkenler.
- Günlük snapshot'lar (`poll_daily_snapshots`, `poll_option_daily_snapshots`) anket başına zaman serisini tutuyor.
- V1 grafik ekranları #32 kapsamında.

**Ölçüm (en kritik boşluk):**
- KV-07'deki ürün analitiği olayları (`feed_item_impression`, `discovery_source`, `trend_list_opened`, `poll_viewed` …) **tanımlı ama toplanmıyor**; kodda tablo ya da üretici yok.
- Domain olay outbox'ı (KV-21) bildirim içindir, 30 gün saklanır ve gösterim (impression) içermez.
- Sonuç: Bugün "Senin İçin" kartının oya dönüşüp dönüşmediği, yani feed'in işe yarayıp yaramadığı **ölçülemiyor**. Kişiselleştirme denemesinden önce ölçüm kurulmalı (§5, B1).

## 2. Metrikler: baseline ve hedef

**Baseline:**
- Kapalı beta ve public V1'in ilk 2 haftasında, mevcut sıralamayla (`ranking_version = kv27-v1`) ölçülür.
- 2 hafta, haftalık döngüyü (hafta içi ve hafta sonu) kapsar.
- Bütün metrikler gerçek kullanıcılarla hesaplanır: `actor_type = real`; test, seed ve admin hesapları hariç (KV-07 ilke 3).

| Metrik | Tanım | Rol | Hedef (hipotez, Mehmet teyidi) |
|---|---|---|---|
| **Feed → katkı dönüşümü** | "Senin İçin" gösterimlerinden sonraki 30 dk içinde aynı ankete oy, yorum, kaydetme veya takip yapılan oturumların oranı | **Birincil** | Baseline'a göre +%15 göreli |
| Kart başına katkı | Katkı / gösterim (`feed_item_impression`, `position` ile) | Birincil (ikincil görünüm) | +%10 göreli |
| İlk oy oranı (24 s) | KV-07 §4.2 | İkincil | ≥ baseline + 3 puan |
| D7 retention | KV-07 §4.6 | İkincil | ≥ baseline + 2 puan |
| Engaged DAU/WAU | KV-07 §4.4–4.5 | İkincil | Düşmemeli |
| **Yanıt alan soru oranı (24 s)** | KV-07 §4.3 | **Koruma (guardrail)** | Düşmemeli. Kişiselleştirme popüleri kayırıp yeni ve az oylu anketleri gömmemeli. |
| Keşif ve çeşitlilik | Kullanıcı başına gösterimlerde ilk 3 kategorinin payı; yazar başına gösterim payı (Gini) | Koruma | İlk 3 kategori payı ≤ %70; Gini artışı ≤ 0,05 |
| Olumsuz sinyal | "İlgilenmiyorum" / gizle oranı (B4 gelince); şikâyet oranı | Koruma | Artmamalı |
| Feed p95 gecikme | KV-47 ölçümü | Koruma | < 800 ms (bugün 148 ms) |

**Trend grafikleri:**
- **Kullanım:** `trend_list_opened` → `poll_viewed` dönüşümü; grafik etkileşim oranı (karşılaştırma açma).
- **Doğruluk:** Grafikteki seri, snapshot ve geçerli oylarla birebir uyuşmalı. KV-43'ten sonra yeniden üretilen günler grafikte de güncellenmeli.

## 3. Hipotezler

**Kişiselleştirme:**

| # | Hipotez | Sinyal / değişiklik | Beklenen etki |
|---|---|---|---|
| H1 | Örtük ilgi, beyan edilen ilgiden daha iyi | Son 30 gündeki oy, yorum, kaydetme ve takiplerin kategorileri, zamanla azalan (yarı ömür 7 gün) ağırlıkla ilgi terimine eklenir | Feed → katkı ↑. Onboarding'de ilgi seçmeyen kullanıcılarda en büyük kazanç |
| H2 | Takip edilen yazar ve toplulukların yeni anketleri | `poll_follows`, topluluk üyeliği → ek terim | Katkı ↑, geri dönüş ↑ |
| H3 | Olumsuz sinyal tekrarları azaltır | "İlgilenmiyorum" (B4), tekrar tekrar gösterilip etkileşim almayan kart için sönümleme | Olumsuz sinyal ↓, çeşitlilik ↑ |
| H4 | Zaten oy verilmiş anket aşağıda olmalı | Kullanıcının oy verdiği aktif anketler cezalandırılır (sonuç izlemek için tamamen çıkarılmaz) | Kart başına katkı ↑ |
| H5 | "Bunu oylayanlar şunu da oyladı" (iş birliğine dayalı) | Ortak oy veren kümeleri | **Ölçek gerektirir;** ancak günlük ≥ 5.000 oyda denenir |

**Trend grafikleri:**

| # | Hipotez | Özellik |
|---|---|---|
| H6 | Seçenek paylarının zaman içindeki değişimi, anlık sonuçtan daha ilgi çekici | Anket detayında seçenek payı zaman serisi (snapshot'lardan) |
| H7 | Karşılaştırma bağlam katar | Bir anketin oy hızını kategori ortalamasıyla karşılaştırmak; "Değişkenler"de değişimin ne zaman olduğunu göstermek |
| H8 | Kategori ve topluluk trend özeti geri dönüşü artırır | Haftalık kategori/topluluk özet grafiği (yalnız toplulaştırılmış) |

## 4. Gizlilik, örneklem ve değerlendirme yöntemi

**Gizlilik:**
- **Veri en aza indirilir:** Analitik olaylarında yalnız dahili kimlikler bulunur (`user_id`, `poll_id`); IP, e-posta, serbest metin ve token yoktur (KV-07 ilke 4, KV-49 log politikası).
- **Oy seçimi hassastır (KV-04):**
  - `feed_item_impression` ve dönüşüm olayları hangi seçeneğe oy verildiğini **içermez**, yalnız "katkı yapıldı" bilgisini taşır.
  - Kişiselleştirme oyun varlığını kullanır; seçeneğin kendisini kullanmaz.
- **Toplulaştırma eşiği:**
  - Herhangi bir segment ya da karşılaştırma grafiği (kategori, topluluk, zaman dilimi) **en az 20 benzersiz oy veren** içermiyorsa gösterilmez ya da "yetersiz veri" olarak gösterilir. Bu, küçük topluluklarda kimin ne oyladığının çıkarılmasını önler.
  - Admin raporları da aynı kurala tabidir.
- **Saklama:**
  - Ham gösterim olayları 90 gün tutulur, sonra günlük toplamlara indirilip silinir.
  - Toplamlar süresiz tutulabilir, çünkü kişi düzeyinde değildir.
- **Kullanıcı kontrolü:**
  - "Kişiselleştirmeyi sıfırla" (örtük ilgi geçmişini siler) ve "kişiselleştirmeyi kapat" (genel sıralama).
  - Feed kartında "Neden bunu görüyorum?" açıklaması (U3).
- **Yasal metin:** Davranışa dayalı kişiselleştirmenin KVKK aydınlatma metnine eklenmesi **Mehmet kararı** (§6).
- **Üçüncü taraf yok:** Olaylar kendi veritabanımızda tutulur; harici analitik servisine kişi düzeyinde veri gitmez.

**Örneklem:**
- **Birim:** Kullanıcı (aynı kullanıcının oturumları birbirinden bağımsız sayılmaz).
- **Örnek büyüklük hesabı:** Baseline dönüşüm %20 ve en küçük anlamlı etki +%15 göreli (%23) için, α = 0,05 ve güç %80 ile kol başına yaklaşık **2.900 aktif kullanıcı** gerekir. Kullanıcı başına çok oturum olduğundan pratikte bu kadar kullanıcı ve ≥ 2 hafta hedeflenir.
- **Trafik yetmezse:** Kol başına < 1.000 kullanıcıda A/B yerine **interleaving** kullanılır: iki sıralama tek listede karıştırılır, hangisinin kartının seçildiği sayılır. Bu yöntem 10–100 kat daha az trafikle karar verir. A/B yalnız guardrail'ler için uzun süreli koşar.
- **Kollara atama:** `hash(user_id, deney_adı) mod 100` ile deterministik. Misafirler kontrol kolundadır (kişisel sinyalleri yok).

**Değerlendirme:**
1. **Çevrim dışı tekrar (replay):** Toplanmış gösterim ve etkileşimlerle yeni sıralamanın, geçmişte etkileşim alan kartları ne kadar üste taşıdığı ölçülür (NDCG@10, recall@20). Sinyal yoksa çevrim içi denemeye geçilmez.
2. **Çevrim içi:** Interleaving ya da A/B (%10 tedavi kolu ile başla). Her yanıtta `ranking_version` döner; olaylar bu sürümle etiketlenir.
3. **Durdurma kuralları:**
   - Herhangi bir guardrail ≥ 2 gün üst üste eşiği aşarsa deney durdurulur.
   - Sonuç yalnız önceden belirlenmiş süre dolunca okunur (ara ara bakıp erken karar yok).
   - Birincil metrik ile ikincillerin yönü çelişiyorsa ürün kararı Mehmet'tedir.
4. **Kayıt:** Her deney için hipotez, sürüm, tarih aralığı, örneklem ve sonuç bu belgeye eklenir.

## 5. Uygulama kapsamı ve alt işler (yayın sonrası ayrı issue'lar)

V1 yayınından (#54) sonra ayrı issue olarak açılır. Sıra, ölçüm olmadan deney yapılamayacağı varsayımına göredir.

| # | İş | Alan | Sahip önerisi | Bağımlılık |
|---|---|---|---|---|
| B1 | **Ürün analitiği olay toplama:** `product_events` tablosu (ya da toplu yazım ucu), KV-07 zarfı, `event_id` ile tekrar koruması, `actor_type`, `discovery_source`, 90 günlük ham saklama ve günlük toplama job'u | Backend + worker | Faruk | — |
| U1 | Web'de gösterim ve keşif kaynağı izleme (`feed_item_impression` viewport'ta bir kez, `position`, `ranking_version`); sayfa ve aksiyon kaynağı | Web | Ümit | B1 |
| B2 | Feed cevabında `ranking_version`; deney kolu ataması (hash), kol başına sıralama seçimi; ayar anahtarı (`feed.experiment.*`) | API + contracts | Faruk | B1 |
| B3 | Örtük ilgi (H1) ve takip sinyali (H2): kullanıcı başına kategori ağırlıklarının arka planda hesaplanması (worker, günlük) | Worker + API | Faruk | B1, B2 |
| B4 | "İlgilenmiyorum" olumsuz sinyali (H3): sözleşme, saklama, sıralamaya etkisi | API + contracts | Faruk | B2 |
| U2 | "İlgilenmiyorum" ve "Neden bunu görüyorum?" UI; kişiselleştirmeyi sıfırla/kapat ayarı | Web | Ümit | B4 |
| B5 | Metrik sorguları (feed → katkı, guardrail'ler); admin dashboard'una (#188) deney görünümü; test/seed/admin hariç | API | Faruk + Mehmet (dashboard) | B1 |
| B6 | Trend karşılaştırma API'si (H6–H8): seçenek payı serisi, kategori ortalaması, k ≥ 20 eşiği | API | Faruk | — (snapshot'lar hazır) |
| U3 | Karşılaştırma grafikleri: erişilebilir, veri tablosu alternatifli, koyu/açık tema, mobil | Web | Ümit / Mehmet | B6 |
| B7 | Çevrim dışı replay aracı (NDCG/recall) ve deney raporu şablonu | Araç | Faruk | B1 + ≥ 2 hafta veri |

**V1.1 dışında bırakılanlar:** H5 (iş birliğine dayalı filtreleme) ölçek gelene kadar, ayrıca makine öğrenmesi modeli ve harici öneri servisi.

## 6. Açık kararlar (Mehmet)

1. Hedef değerlerin teyidi (§2).
2. Davranışa dayalı kişiselleştirme için KVKK aydınlatma metni ve "kişiselleştirmeyi kapat" seçeneğinin varsayılanı.
3. Olay saklama: kendi veritabanımız (önerilen) mı, ayrı bir analitik deposu mu?
4. Deneylerin public kullanıcılarda hangi oranla başlayacağı (önerilen: interleaving ya da %10).

## 7. #55 kabul koşulları

| Koşul | Bu belgede |
|---|---|
| Beta/public baseline ve hedef metrik tanımlı | §2 |
| Gizlilik/örneklem ve değerlendirme yöntemi belli | §4 |
| Uygulama kapsamı ve UI/backend alt işleri yayın sonrası ayrı planlanmış | §5 (issue'lar #54 sonrasında açılır) |
| Kanıt ve kalan engeller | Bu PR; kalanlar §6 ve #54 |
