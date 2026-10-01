"""KV-08 spike — sentetik test görselleri üretir.

Gerçek uygunsuz içerik kullanılmaz/saklanmaz. Bu script sadece pipeline'ın
gecikme/kaynak davranışını ölçmek için zararsız örnekler üretir. Modelin
gerçek pozitif/negatif kalitesi KV-16 entegrasyonunda etiketli bir örneklemle
ayrıca doğrulanmalıdır (bkz. docs/MEDIA_MODERATION.md §7).
"""

import os
import random

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "samples")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    Image.new("RGB", (800, 600), (30, 30, 40)).save(f"{OUT}/solid.jpg", quality=90)

    img = Image.new("RGB", (1200, 800))
    px = img.load()
    for x in range(1200):
        for y in range(0, 800, 4):
            px[x, y] = (x % 256, y % 256, (x + y) % 256)
    img.save(f"{OUT}/gradient.jpg", quality=90)

    img = Image.new("RGB", (1000, 700), (200, 200, 200))
    d = ImageDraw.Draw(img)
    d.rectangle([150, 300, 850, 550], fill=(180, 30, 30))
    d.ellipse([200, 500, 350, 620], fill=(20, 20, 20))
    d.ellipse([650, 500, 800, 620], fill=(20, 20, 20))
    img.save(f"{OUT}/car_sketch.jpg", quality=90)

    random.seed(0)
    img = Image.new("RGB", (1600, 1200))
    img.putdata(
        [
            (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
            for _ in range(1600 * 1200)
        ]
    )
    img.save(f"{OUT}/noise.jpg", quality=90)

    Image.new("RGB", (256, 256), (100, 150, 200)).save(f"{OUT}/avatar.jpg", quality=90)

    print("Örnekler üretildi:", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
