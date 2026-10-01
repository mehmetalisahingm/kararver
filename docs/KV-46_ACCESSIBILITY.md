# KV-46 / #48 — Mobil ve ekran durumları kabulü

## 1 Ekim başlangıç teslimi

- #110 main'e birleştirildi; #32, #79 teslimi ve gerçek PostgreSQL/test kanıtıyla kapatıldı.
- Sayfa hata ekranı Next 16.3 `retry` ile yeniden veri ister. `reset` yalnızca
  hata durumunu temizlediğinden geçici sunucu hatasından kurtulma için yeterli değildir.
- Root layout/provider hatasında Türkçe, kendi stilleri olan global hata belgesi
  gösterilir. Ham hata/stack kullanıcıya açılmaz. Retry ve ana sayfa çıkışı bulunur.
- Ortak route loading ekranı mevcut skeleton ve canlı durum bildirimini kullanır.
- 404 üzerinde klavyeyle içeriğe geçiş, dönüş navigasyonunda main odağı, yatay
  taşma ve axe WCAG A/AA kontrolü 360 ve 1440 pikselde geçti.

## Kanıt ve sınır matrisi

| Kontrol | Kanıt | Durum |
| --- | --- | --- |
| Edge, 360/1440, 404, skip link, odak dönüşü | `test/browser/states.spec.ts`, `404-360.png`, `404-1440.png` test çıktıları | Geçti |
| Retry çağrısı / hata bilgisinin gizliliği | `test/error-boundaries.test.mjs`, 2 test | Geçti |
| Üretim/TypeScript | `pnpm --filter @kararver/web build` | Geçti |
| Auth/oy/form/modal | `test/browser/flows.spec.ts` mevcut regresyonları | Önceki teslim kanıtı |
| Galeri/sosyal/tema/hata geri alma | `test/browser/social.spec.ts`, #110 | Önceki teslim kanıtı |
| Keşfet/kategori/5 trend/grafik/tablo | `test/browser/discovery.spec.ts`, #79 | Önceki teslim kanıtı |
| Ortak admin erişim/navigasyon | `test/browser/admin.spec.ts` | Mevcut CI; tüm alt modüller için tam kabul değil |
| Fiziksel Android/iOS, Safari, Firefox | Cihaz ve tarayıcı sürümüyle ayrı kayıt gerekli | Bekliyor |
| Gerçek root/server 500 → başarılı retry | Fonksiyon testi var; staging hata enjeksiyonu henüz yapılmadı | Bekliyor |
| Tüm yeni profil/admin/onboarding ekran durumları | Loading/empty/error/permission/offline matrisi genişletilecek | Bekliyor |
| Medya ve beta kabulü | #20 → #18, ayrıca #47 | Bağımlılıklar açık |

Ekran görüntüleri Playwright test-results dizinine üretilir; git'e binary eklenmez.
Emülasyon fiziksel cihaz kabulü değildir. #48 bu başlangıç teslimiyle kapanmaz.
