-- #289 / karar 54A: eski hesaplardan sonraki girişte 18+ öz beyanı alınır.
-- Yalnız ekleme: NULL'a izin veren kolon, varsayılan yok, geri doldurma yok.
-- Mevcut hesaplar bilerek NULL kalır (beyan yok); toplu silme/yasak uygulanmaz.
-- Öz beyan gerçek yaş doğrulaması değildir.
ALTER TABLE "users" ADD COLUMN "adult_declared_at" TIMESTAMPTZ(3);
