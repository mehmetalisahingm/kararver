# KararVer

Türkiye odaklı sosyal karar ve anket platformu.

## Ürün Planı

Detaylı V1 MVP kapsamı için [`MVP_PLAN.md`](./MVP_PLAN.md) dosyasına bakın.

Ana ürün döngüsü:

**Sor → Oy Al → Sonucu Gör → Tartış → Yükseleni Keşfet → Tekrar Katıl**

## İlk hedef

5 kişilik hibrit ekip (3 ana geliştirici + gerektiğinde geliştirmeye giren 2 reviewer/developer) ile yaklaşık 5 haftada public V1 MVP çıkarmak.

## Ortak UI — KV-05

Ümit'in framework bağımsız [tasarım sistemi önizlemesi](./ui/design-system/index.html), koyu/mor tema ve ortak bileşen örneklerini içerir. Çalıştırma, bileşen API'leri ve responsive/erişilebilirlik kuralları: [UI sözleşmesi](./docs/KV-05_UI_CONTRACT.md).

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory ui/design-system
```

Tarayıcıda `http://127.0.0.1:4173` adresini açın. Bu bir tasarım önizlemesidir; gerçek hesap, oy veya yayın işlemi yapmaz.
