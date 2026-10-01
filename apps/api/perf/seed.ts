// KV-47 (#49) yük testi verisi. Kullanım (boş bir *_perf veritabanında, migration'lar uygulanmış olmalı):
//   PERF_DATABASE_URL=postgresql://.../kararver_perf node apps/api/perf/seed.ts
// Deterministiktir: aynı parametreler aynı veriyi üretir (rastgelelik yok). Sayaçlar veriden hesaplanır.
// Kabul profili (#49): 10.000 anket, 100.000 oy. Ek: 4.000 kullanıcı, %10 tartışma, 20.000 yorum.
import { createPrismaClient } from "@kararver/db";
import { createArgon2Hasher } from "../src/modules/auth/crypto.ts";
import { PERF } from "./profile.ts";

const url = process.env.PERF_DATABASE_URL;
if (!url || !/_perf$/.test(new URL(url).pathname)) {
  console.error("PERF_DATABASE_URL gerekli ve veritabanı adı _perf ile bitmeli (yanlış veritabanını doldurmayalım).");
  process.exit(1);
}


const db = createPrismaClient(url);
const run = async (label: string, sql: string) => {
  const t = Date.now();
  const n = await db.$executeRawUnsafe(sql);
  console.log(`${label.padEnd(28)} ${String(n).padStart(7)} satır  ${Date.now() - t} ms`);
};

const existing = await db.poll.count();
if (existing > 0) {
  console.error(`Veritabanında zaten ${existing} anket var; seed boş veritabanında çalışır.`);
  process.exit(1);
}

const hash = await createArgon2Hasher().hash(PERF.password);
const NOW = "now()";

await run("kullanıcılar", `
  INSERT INTO users (id, email, email_normalized, username, username_normalized, display_name, password_hash, email_verified_at, updated_at)
  SELECT gen_random_uuid(), 'perf' || i || '@perf.test', 'perf' || i || '@perf.test', 'perf' || i, 'perf' || i, 'Perf ' || i,
    '${hash}', ${NOW}, ${NOW}
  FROM generate_series(1, ${PERF.users}) i`);

// Gönderiler son 30 güne yayılır; anketlerin süresi 1–30 gün (bir kısmı kapanmış). Her 10 gönderiden biri tartışma.
await run("gönderiler", `
  WITH u AS (SELECT array_agg(id ORDER BY username) a FROM users WHERE username LIKE 'perf%'),
       c AS (SELECT array_agg(id ORDER BY sort_order, id) a FROM categories WHERE is_active)
  INSERT INTO polls (id, public_id, slug, kind, author_id, category_id, title, description, results_visibility,
    opens_at, closes_at, updated_at)
  SELECT gen_random_uuid(), 'pf' || lpad(i::text, 8, '0'), 'perf-gonderi-' || i,
    CASE WHEN i > ${PERF.polls} THEN 'DISCUSSION'::poll_kind ELSE 'POLL'::poll_kind END,
    u.a[1 + i % ${PERF.authors}], c.a[1 + i % array_length(c.a, 1)],
    'Perf gönderi ' || i || ' hangisini seçmeliyim', 'Yük testi açıklaması ' || i,
    CASE WHEN i > ${PERF.polls} THEN NULL WHEN i % 3 = 0 THEN 'AFTER_VOTE'::results_visibility ELSE 'ALWAYS'::results_visibility END,
    ${NOW} - ((i % 30) || ' days')::interval - ((i % 1440) || ' minutes')::interval,
    CASE WHEN i > ${PERF.polls} THEN NULL
         ELSE ${NOW} - ((i % 30) || ' days')::interval + ((1 + i % 30) || ' days')::interval END,
    ${NOW}
  FROM generate_series(1, ${PERF.polls + PERF.discussions}) i, u, c`);

await run("seçenekler", `
  INSERT INTO poll_options (id, poll_id, position, label)
  SELECT gen_random_uuid(), p.id, k, 'Seçenek ' || (k + 1)
  FROM polls p, generate_series(0, 3) k
  WHERE p.kind = 'POLL' AND k < 2 + (substr(p.public_id, 3)::int % 3)`);

// Oy (kullanıcı, anket) çiftleri tekildir: sabit kullanıcı için r turu farklı anket seçer (997 ile 9000 aralarında asal).
// Oy zamanı anketin açılışıyla şimdi (veya kapanış) arasında.
await run("oylar", `
  WITH u AS (SELECT array_agg(id ORDER BY username) a FROM users WHERE username LIKE 'perf%'),
       p AS (SELECT array_agg(id ORDER BY public_id) a FROM polls WHERE kind = 'POLL'),
       pairs AS (
         SELECT i, ${PERF.authors} + (i % ${PERF.users - PERF.authors}) AS uidx, i / ${PERF.users - PERF.authors} AS r
         FROM generate_series(0, ${PERF.votes - 1}) i
       ),
       chosen AS (
         SELECT pr.i, u.a[1 + pr.uidx] AS user_id, p.a[1 + ((pr.uidx * 37 + pr.r * 997) % ${PERF.polls})] AS poll_id
         FROM pairs pr, u, p
       )
  INSERT INTO votes (id, poll_id, option_id, user_id, created_at, updated_at)
  SELECT gen_random_uuid(), c.poll_id, o.id, c.user_id,
    pl.opens_at + (least(coalesce(pl.closes_at, ${NOW}), ${NOW}) - pl.opens_at) * ((c.i % 997) / 997.0), ${NOW}
  FROM chosen c
  JOIN polls pl ON pl.id = c.poll_id
  JOIN LATERAL (
    SELECT id FROM poll_options WHERE poll_id = c.poll_id ORDER BY position
    OFFSET (c.i % (SELECT count(*) FROM poll_options WHERE poll_id = c.poll_id)) LIMIT 1
  ) o ON true`);

await run("oy olayları (CAST)", `
  INSERT INTO vote_events (id, vote_id, poll_id, user_id, type, to_option_id, occurred_at)
  SELECT gen_random_uuid(), v.id, v.poll_id, v.user_id, 'CAST', v.option_id, v.created_at FROM votes v`);

await run("yorumlar", `
  WITH u AS (SELECT array_agg(id ORDER BY username) a FROM users WHERE username LIKE 'perf%'),
       p AS (SELECT array_agg(id ORDER BY public_id) a, count(*) n FROM polls)
  INSERT INTO comments (id, poll_id, author_id, body, created_at, updated_at)
  SELECT gen_random_uuid(), p.a[1 + (i * 7) % p.n], u.a[1 + i % ${PERF.users}], 'Perf yorum ' || i,
    ${NOW} - ((i % 20000) || ' minutes')::interval, ${NOW}
  FROM generate_series(1, ${PERF.comments}) i, u, p`);

await run("seçenek sayaçları", `
  UPDATE poll_options o SET vote_count = c.n
  FROM (SELECT option_id, count(*)::int n FROM votes WHERE invalidated_at IS NULL GROUP BY option_id) c WHERE c.option_id = o.id`);
await run("anket sayaçları", `
  UPDATE polls p SET vote_count = coalesce(v.n, 0), comment_count = coalesce(c.n, 0)
  FROM polls p2
  LEFT JOIN (SELECT poll_id, count(*)::int n FROM votes WHERE invalidated_at IS NULL GROUP BY poll_id) v ON v.poll_id = p2.id
  LEFT JOIN (SELECT poll_id, count(*)::int n FROM comments GROUP BY poll_id) c ON c.poll_id = p2.id
  WHERE p.id = p2.id`);
await run("ANALYZE", "ANALYZE");

console.log("\nÖzet:", {
  users: await db.user.count(),
  polls: await db.poll.count({ where: { kind: "POLL" } }),
  discussions: await db.poll.count({ where: { kind: "DISCUSSION" } }),
  votes: await db.vote.count(),
  comments: await db.comment.count(),
});
await db.$disconnect();
