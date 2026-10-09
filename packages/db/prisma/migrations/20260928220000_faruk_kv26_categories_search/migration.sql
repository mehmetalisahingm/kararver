-- KV-26 (#28) · Sahip: Faruk · Başlangıç kategorileri ve Türkçe arama index'leri
-- Sadece elle yazılan SQL; Prisma schema'sında değişiklik yok.

-- ─── 13 başlangıç kategorisi (PRODUCT_TEAM_PLAN §9 "İlk kategoriler") ───
-- Referans veridir; her ortamda aynı id ve slug ile bulunur. Zaten varsa dokunulmaz (admin
-- sonradan adını, ikonunu, sırasını veya aktifliğini değiştirmiş olabilir).
-- id'ler sabit UUIDv7'dir (DATA_MODEL §2.1); PostgreSQL 17'de yerleşik uuidv7() yok.
INSERT INTO "categories" ("id", "slug", "name", "sort_order", "is_active", "updated_at") VALUES
  ('01a0ea08-2f00-71b0-a833-66a50d4bfdcd', 'teknoloji', 'Teknoloji', 1, true, now()),
  ('01a0ea08-2f01-78db-87fa-9ed771832e71', 'otomobil', 'Otomobil', 2, true, now()),
  ('01a0ea08-2f02-7913-977c-fe217146bcbf', 'alisveris', 'Alışveriş', 3, true, now()),
  ('01a0ea08-2f03-758b-adc8-77eb1fc14eb4', 'egitim', 'Eğitim', 4, true, now()),
  ('01a0ea08-2f04-72bb-be74-1d1a726c77ff', 'universite', 'Üniversite', 5, true, now()),
  ('01a0ea08-2f05-75a4-bad7-38b939a12c2e', 'yasam', 'Yaşam', 6, true, now()),
  ('01a0ea08-2f06-788d-ab76-97742cde1ee8', 'seyahat', 'Seyahat', 7, true, now()),
  ('01a0ea08-2f07-7e9b-87d1-55419ba02699', 'oyun', 'Oyun', 8, true, now()),
  ('01a0ea08-2f08-7ce4-a760-514b90204198', 'spor', 'Spor', 9, true, now()),
  ('01a0ea08-2f09-76fd-855d-82e4688d7de1', 'yemek', 'Yemek', 10, true, now()),
  ('01a0ea08-2f0a-7094-9722-2500269dc5d0', 'ev-emlak', 'Ev / Emlak', 11, true, now()),
  ('01a0ea08-2f0b-719a-b71d-8467ac35c09a', 'kariyer', 'Kariyer', 12, true, now()),
  ('01a0ea08-2f0c-72e5-9318-1a1cf0aeb805', 'diger', 'Diğer', 13, true, now())
ON CONFLICT ("slug") DO NOTHING;

-- ─── Arama index'leri (TECH_DECISIONS §3.9, API_CONTRACTS search.query) ───
-- Arama kv_normalize(sütun) LIKE '%' || kv_normalize(q) || '%' biçimindedir; pg_trgm GIN index'i
-- bu aramayı destekler. İfade index'leri Prisma'ya görünmez ve drift üretmez (KV-26'da doğrulandı).
CREATE INDEX "polls_title_search_idx" ON "polls" USING gin (kv_normalize("title") gin_trgm_ops);
CREATE INDEX "polls_description_search_idx" ON "polls" USING gin (kv_normalize(coalesce("description", '')) gin_trgm_ops);
CREATE INDEX "users_username_search_idx" ON "users" USING gin (kv_normalize("username") gin_trgm_ops);
CREATE INDEX "users_display_name_search_idx" ON "users" USING gin (kv_normalize("display_name") gin_trgm_ops);
CREATE INDEX "communities_name_search_idx" ON "communities" USING gin (kv_normalize("name") gin_trgm_ops);
