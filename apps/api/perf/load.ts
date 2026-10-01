// KV-47 (#49) yük testi. Çalışan bir API'ye (perf/README: docs/KV-47_PERFORMANCE.md) karışık trafik gönderir.
//   PERF_DATABASE_URL=... PERF_API=http://127.0.0.1:4100/v1 PERF_WEB=http://localhost:3000 \
//   PERF_VUS=50 PERF_DURATION_S=120 PERF_THINK_MS=0 node apps/api/perf/load.ts
// Sanal kullanıcıların %80'i giriş yapmış (oy verir), %20'si misafir. Kapalı döngü: her kullanıcı bir istek bitince
// (isteğe bağlı bekleme sonrası) yenisini atar. Yük sırasında trends.refresh de arka planda çalışır (worker taklidi).
// Hata: ağ hatası, 5xx veya eylem için beklenmeyen durum kodu. İş kuralı cevapları (ör. kapanmış ankete oy 409) ayrı sayılır.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPrismaClient } from "@kararver/db";
import { refreshTrends } from "../../worker/src/jobs/trends/job.ts";
import { PERF } from "./profile.ts";

const env = (k: string, d: string) => process.env[k] ?? d;
const API = env("PERF_API", "http://127.0.0.1:4100/v1");
const WEB = env("PERF_WEB", "http://localhost:3000");
const VUS = Number(env("PERF_VUS", "50"));
const DURATION_MS = Number(env("PERF_DURATION_S", "120")) * 1000;
const THINK_MS = Number(env("PERF_THINK_MS", "0"));
const TREND_EVERY_MS = Number(env("PERF_TREND_EVERY_S", "30")) * 1000;
const db = createPrismaClient(process.env.PERF_DATABASE_URL!);

type Action = "feed.for_you" | "feed.new" | "feed.top" | "poll.detail" | "vote" | "search" | "trends" | "comments";
const WEIGHTS: [Action, number][] = [
  ["feed.for_you", 20],
  ["feed.new", 10],
  ["feed.top", 5],
  ["poll.detail", 25],
  ["vote", 20],
  ["search", 8],
  ["trends", 7],
  ["comments", 5],
];
/** İş kuralı gereği beklenen ama başarı sayılmayan cevaplar (hata oranına girmez, ayrı raporlanır). */
const BUSINESS: Partial<Record<Action, number[]>> = { vote: [409] };

// Deterministik sözde rastgele (tekrar edilebilir koşu).
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
function pickAction(loggedIn: boolean): Action {
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [a, w] of WEIGHTS) {
    if ((x -= w) < 0) return a === "vote" && !loggedIn ? "poll.detail" : a;
  }
  return "poll.detail";
}

const samples = new Map<Action, number[]>();
const errors = new Map<Action, number>();
const business = new Map<Action, number>();
const statuses = new Map<string, number>();

async function login(i: number): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { origin: WEB, "content-type": "application/json" },
    body: JSON.stringify({ email: `perf${i}@perf.test`, password: PERF.password }),
  });
  if (res.status !== 200) throw new Error(`giriş başarısız perf${i}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return cookie;
}

const open = await db.$queryRaw<{ id: string; options: string[] }[]>`
  SELECT p.id::text, array_agg(o.id::text ORDER BY o.position) AS options
  FROM polls p JOIN poll_options o ON o.poll_id = p.id
  WHERE p.kind = 'POLL' AND p.status = 'ACTIVE' AND p.closed_at IS NULL AND p.closes_at > now() + interval '1 hour'
  GROUP BY p.id`;
const anyPolls = (await db.poll.findMany({ where: { status: "ACTIVE" }, select: { id: true } })).map((p) => p.id);
const categories = (await db.category.findMany({ where: { isActive: true }, select: { id: true } })).map((c) => c.id);
const TERMS = ["hangisini", "perf", "seçmeliyim", "gönderi 12", "araba", "ev"];
const FORMATS = ["DAILY_RISING", "WEEKLY_RISING", "WEEKLY_MOST_VOTED", "WEEKLY_MOST_DISCUSSED"];

function request(action: Action): { url: string; init?: RequestInit } {
  switch (action) {
    case "feed.for_you":
      return { url: `${API}/feed?tab=for_you&limit=20${rnd() < 0.3 ? `&categoryId=${pick(categories)}` : ""}` };
    case "feed.new":
      return { url: `${API}/feed?tab=new&limit=20` };
    case "feed.top":
      return { url: `${API}/feed?tab=top&limit=20` };
    case "poll.detail":
      return { url: `${API}/polls/${pick(anyPolls)}` };
    case "search":
      return { url: `${API}/search?q=${encodeURIComponent(pick(TERMS))}&limit=20` };
    case "trends":
      return { url: `${API}/trends/${pick(FORMATS)}?limit=20` };
    case "comments":
      return { url: `${API}/polls/${pick(anyPolls)}/comments?limit=20` };
    case "vote": {
      const p = pick(open);
      return {
        url: `${API}/polls/${p.id}/vote`,
        init: { method: "PUT", headers: { "content-type": "application/json", origin: WEB }, body: JSON.stringify({ optionId: pick(p.options) }) },
      };
    }
  }
}

async function vu(cookie: string | null, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const action = pickAction(cookie !== null);
    const { url, init } = request(action);
    const headers = { ...(init?.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) };
    const t = performance.now();
    let status = 0;
    try {
      const res = await fetch(url, { ...init, headers });
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = 0;
    }
    const ms = performance.now() - t;
    statuses.set(`${action} ${status}`, (statuses.get(`${action} ${status}`) ?? 0) + 1);
    const ok = status === 200 || status === 201;
    if (ok) (samples.get(action) ?? samples.set(action, []).get(action)!).push(ms);
    else if (BUSINESS[action]?.includes(status)) business.set(action, (business.get(action) ?? 0) + 1);
    else errors.set(action, (errors.get(action) ?? 0) + 1);
    if (THINK_MS > 0) await new Promise((r) => setTimeout(r, THINK_MS * (0.5 + rnd())));
  }
}

const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]! : NaN);

// ── Kurulum ──
const loggedIn = Math.round(VUS * 0.8);
console.log(`Giriş: ${loggedIn} kullanıcı (argon2)…`);
const cookies: string[] = [];
for (let i = 0; i < loggedIn; i++) cookies.push(await login(PERF.authors + 1 + i));
const before = { votes: await db.vote.count(), events: await db.voteEvent.count() };

// ── Yük ──
console.log(`Yük: ${VUS} sanal kullanıcı, ${DURATION_MS / 1000} sn, düşünme süresi ${THINK_MS} ms, trend her ${TREND_EVERY_MS / 1000} sn`);
const started = Date.now();
const deadline = started + DURATION_MS;
const trendRuns: { at: number; ms: number; ok: boolean }[] = [];
const trendLoop = (async () => {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(TREND_EVERY_MS, Math.max(0, deadline - Date.now()))));
    if (Date.now() >= deadline) break;
    const t = performance.now();
    const results = await refreshTrends({ prisma: db, now: () => new Date(), log: () => {} });
    trendRuns.push({ at: Date.now() - started, ms: Math.round(performance.now() - t), ok: results.every((r) => r.status !== "FAILED") });
  }
})();
await Promise.all([...cookies.map((c) => vu(c, deadline)), ...Array.from({ length: VUS - loggedIn }, () => vu(null, deadline)), trendLoop]);
const elapsed = (Date.now() - started) / 1000;

// ── Rapor ──
const rows = WEIGHTS.map(([a]) => {
  const s = (samples.get(a) ?? []).sort((x, y) => x - y);
  return { action: a, ok: s.length, errors: errors.get(a) ?? 0, business: business.get(a) ?? 0, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.at(-1) ?? NaN };
});
const totalOk = rows.reduce((n, r) => n + r.ok, 0);
const totalErr = rows.reduce((n, r) => n + r.errors, 0);
const totalBiz = rows.reduce((n, r) => n + r.business, 0);
const all = [...samples.values()].flat().sort((x, y) => x - y);
const feed = [...(samples.get("feed.for_you") ?? []), ...(samples.get("feed.new") ?? []), ...(samples.get("feed.top") ?? [])].sort((x, y) => x - y);
const vote = (samples.get("vote") ?? []).sort((x, y) => x - y);
const report = {
  at: new Date().toISOString(),
  host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, node: process.version },
  config: { vus: VUS, loggedIn, durationS: elapsed, thinkMs: THINK_MS, trendEveryS: TREND_EVERY_MS / 1000 },
  totals: { requests: totalOk + totalErr + totalBiz, rps: Math.round((totalOk + totalErr + totalBiz) / elapsed), errorRate: totalErr / (totalOk + totalErr + totalBiz), business: totalBiz, p95: pct(all, 95) },
  targets: { feedP95: pct(feed, 95), voteP95: pct(vote, 95) },
  rows,
  statuses: Object.fromEntries([...statuses].sort()),
  trendRuns,
  writes: { newVotes: (await db.vote.count()) - before.votes, newEvents: (await db.voteEvent.count()) - before.events },
};
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "-");
console.log(`\n| Eylem | Başarılı | Hata | İş kuralı | p50 ms | p95 ms | p99 ms | max ms |\n|---|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.action} | ${r.ok} | ${r.errors} | ${r.business} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.max)} |`);
console.log(`\nToplam ${report.totals.requests} istek, ${report.totals.rps} istek/sn, hata oranı ${(report.totals.errorRate * 100).toFixed(3)}%`);
console.log(`Hedefler: feed p95 ${f(report.targets.feedP95)} ms (< 800), oy p95 ${f(report.targets.voteP95)} ms (< 500), hata < %1`);
console.log(`Trend çalıştırmaları (yük altında):`, trendRuns);
const dir = path.resolve(import.meta.dirname, "results");
mkdirSync(dir, { recursive: true });
const out = path.join(dir, `load-${report.at.replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`Rapor: ${out}`);
await db.$disconnect();
