// KV-47 (#49) yük sonrası doğruluk kontrolü (load.ts'den sonra, aynı API ve veritabanıyla).
//   PERF_DATABASE_URL=... PERF_API=http://127.0.0.1:4100/v1 node apps/api/perf/verify.ts
// 1) Oy doğruluğu: her anketin ve seçeneğin sayacı tablodaki geçerli oy sayısına eşit; her oyun CAST olayı var.
// 2) Trend doğruluğu: güncel WEEKLY_MOST_VOTED / DAILY_RISING çalıştırmasının bileşenleri SQL'le yeniden sayılınca aynı.
// 3) Cache gizliliği: kişiye özel cevaplar paylaşılan cache'e girmez (Cache-Control), eşzamanlı farklı kullanıcı
//    istekleri birbirinin izleyici alanını (oy, sahiplik) görmez.
import { createPrismaClient } from "@kararver/db";
import { PERF } from "./profile.ts";

const API = process.env.PERF_API ?? "http://127.0.0.1:4100/v1";
const WEB = process.env.PERF_WEB ?? "http://localhost:3000";
const db = createPrismaClient(process.env.PERF_DATABASE_URL!);
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "✔" : "✖"} ${message}`);
  if (!ok) failures.push(message);
};

// ── 1) Oy doğruluğu ──
const [counters] = await db.$queryRaw<{ bad_polls: number; bad_options: number; polls: number }[]>`
  SELECT
    (SELECT count(*)::int FROM polls p WHERE p.vote_count <> (SELECT count(*) FROM votes v WHERE v.poll_id = p.id AND v.invalidated_at IS NULL)) AS bad_polls,
    (SELECT count(*)::int FROM poll_options o WHERE o.vote_count <> (SELECT count(*) FROM votes v WHERE v.option_id = o.id AND v.invalidated_at IS NULL)) AS bad_options,
    (SELECT count(*)::int FROM polls) AS polls`;
check(counters!.bad_polls === 0 && counters!.bad_options === 0, `sayaçlar: ${counters!.polls} anketin hepsinde anket ve seçenek sayacı geçerli oy sayısına eşit (hatalı: ${counters!.bad_polls} anket, ${counters!.bad_options} seçenek)`);
const [events] = await db.$queryRaw<{ votes: number; without_cast: number; double_cast: number; option_mismatch: number }[]>`
  SELECT (SELECT count(*)::int FROM votes) AS votes,
    (SELECT count(*)::int FROM votes v WHERE NOT EXISTS (SELECT 1 FROM vote_events e WHERE e.vote_id = v.id AND e.type = 'CAST')) AS without_cast,
    (SELECT count(*)::int FROM (SELECT vote_id FROM vote_events WHERE type = 'CAST' GROUP BY vote_id HAVING count(*) > 1) d) AS double_cast,
    (SELECT count(*)::int FROM votes v WHERE v.invalidated_at IS NULL AND v.option_id <> (
       SELECT coalesce(e.to_option_id, e.from_option_id) FROM vote_events e WHERE e.vote_id = v.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1)) AS option_mismatch`;
check(events!.without_cast === 0 && events!.double_cast === 0, `oy olayları: ${events!.votes} oyun her birinin tek CAST olayı var`);
check(events!.option_mismatch === 0, `oy geçmişi: her geçerli oyun seçeneği son olayının seçeneğiyle aynı (uyuşmayan: ${events!.option_mismatch})`);
const dup = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM (SELECT poll_id, user_id FROM votes GROUP BY 1, 2 HAVING count(*) > 1) d`;
check(dup[0]!.n === 0, "tek aktif oy: (anket, kullanıcı) başına bir oy");

// ── 2) Trend doğruluğu ──
for (const format of ["WEEKLY_MOST_VOTED", "DAILY_RISING"] as const) {
  const run = await db.trendRun.findFirst({
    where: { format, status: "SUCCEEDED" },
    orderBy: [{ windowEnd: "desc" }, { finishedAt: "desc" }],
    include: { scores: { orderBy: { rank: "asc" }, take: 20 } },
  });
  if (!run) {
    check(false, `${format}: başarılı çalıştırma yok`);
    continue;
  }
  let mismatches = 0;
  for (const s of run.scores) {
    const [r] = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM votes WHERE poll_id = ${s.pollId}::uuid AND invalidated_at IS NULL
        AND created_at > ${run.windowStart.toISOString()}::timestamptz AND created_at <= ${run.windowEnd.toISOString()}::timestamptz`;
    if ((s.components as { voters: number }).voters !== r!.n) mismatches++;
  }
  check(mismatches === 0, `${format}: güncel çalıştırmanın ilk ${run.scores.length} sırasında oy veren sayısı SQL ile aynı (uyuşmayan: ${mismatches})`);
}

// ── 3) Cache gizliliği ──
async function login(i: number) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { origin: WEB, "content-type": "application/json" },
    body: JSON.stringify({ email: `perf${i}@perf.test`, password: PERF.password }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
const [a, b] = [PERF.authors + 1001, PERF.authors + 1002];
const [cookieA, cookieB] = [await login(a), await login(b)];
const [poll] = await db.$queryRaw<{ id: string; option: string }[]>`
  SELECT p.id::text, o.id::text AS option FROM polls p JOIN poll_options o ON o.poll_id = p.id
  WHERE p.kind = 'POLL' AND p.results_visibility = 'AFTER_VOTE' AND p.closes_at > now() + interval '10 minutes'
    AND NOT EXISTS (SELECT 1 FROM votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = p.id AND u.username IN (${`perf${a}`}, ${`perf${b}`}))
  ORDER BY p.public_id LIMIT 1`;
const voted = await fetch(`${API}/polls/${poll!.id}/vote`, {
  method: "PUT",
  headers: { cookie: cookieA, origin: WEB, "content-type": "application/json" },
  body: JSON.stringify({ optionId: poll!.option }),
});
check(voted.status === 201, `hazırlık: A kullanıcısı AFTER_VOTE ankete oy verdi (${voted.status})`);

const urls = [`/polls/${poll!.id}`, "/feed?tab=for_you&limit=5", "/feed?tab=new&limit=5", "/search?q=hangisini&limit=5", "/trends/WEEKLY_MOST_VOTED?limit=5"];
let headerProblems = 0;
for (const u of urls) {
  for (const cookie of [cookieA, null]) {
    const res = await fetch(`${API}${u}`, { headers: cookie ? { cookie } : {} });
    await res.arrayBuffer();
    const cc = res.headers.get("cache-control") ?? "";
    if (!/private/.test(cc) || !/no-store/.test(cc)) headerProblems++;
  }
}
check(headerProblems === 0, `Cache-Control: ${urls.length} uç noktanın misafir ve giriş cevaplarının hepsi "private, no-store" (paylaşılan cache'e girmez)`);

// Aynı anket detayına aynı anda 200 istek (A, B, misafir karışık): herkes kendi görünümünü almalı.
const mixed = await Promise.all(
  Array.from({ length: 200 }, async (_, i) => {
    const who = i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "misafir";
    const cookie = who === "A" ? cookieA : who === "B" ? cookieB : null;
    const res = await fetch(`${API}/polls/${poll!.id}`, { headers: cookie ? { cookie } : {} });
    const body = (await res.json()) as { data: { viewer: { vote: string | null } | null; results: { visible: boolean } } };
    return { who, viewer: body.data.viewer, results: body.data.results };
  }),
);
const wrong = mixed.filter(
  (r) =>
    (r.who === "A" && (r.viewer?.vote !== poll!.option || r.results.visible !== true)) ||
    (r.who === "B" && (r.viewer?.vote !== null || r.results.visible !== false)) ||
    (r.who === "misafir" && (r.viewer !== null || r.results.visible !== false)),
);
check(wrong.length === 0, `eşzamanlı 200 istekte izleyici alanı ve AFTER_VOTE sonucu kişiye özel kaldı (karışan: ${wrong.length})`);

await db.$disconnect();
console.log(failures.length === 0 ? "\nBütün kontroller geçti." : `\n${failures.length} kontrol başarısız.`);
process.exit(failures.length === 0 ? 0 : 1);
