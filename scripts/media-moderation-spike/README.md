# KV-08 spike — lokal görsel moderasyon

`docs/MEDIA_MODERATION.md`'nin kanıt kaynağı. Ücretli/dış API kullanmadan,
sunucuda çalışan bir görsel moderasyon modelinin gecikme ve kaynak
tüketimini ölçer.

## Çalıştırma

```bash
cd scripts/media-moderation-spike
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python generate_samples.py
python benchmark.py
```

`benchmark.py`, `samples/` altındaki görselleri işler ve `results.json`
dosyasını üretir (bu dosya kanıt olarak commit'e dahildir).

## Notlar

- `samples/` içindeki görseller sentetiktir (düz renk, gradient, gürültü,
  basit şekil); gerçek uygunsuz içerik bulundurmaz veya üretmez. Bu yüzden
  hepsi "temiz" sınıflanır — buradaki ölçüm **gecikme/kaynak** kanıtıdır,
  modelin gerçek pozitif/negatif oranı için değildir. Etiketli bir
  örneklemle doğrulama KV-16 entegrasyonunda yapılır (bkz.
  `docs/MEDIA_MODERATION.md` §7).
- `.venv/` commit edilmez (kök `.gitignore`'daki `node_modules/` deseniyle
  karışmaması için burada ayrıca `.venv/` görmezden gelinir).
