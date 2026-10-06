// Medya hattı gecikme ve timeout ölçümü (KV-47 #49 → Mert'in payı; docs/KV-47_PERFORMANCE.md §Medya).
// Çalıştırma: MODERATION_PYTHON=<nudenet kurulu python> pnpm --filter @kararver/worker media:latency
//   → scripts/media-latency.results.json
//
// Gerçek parçalar: sharp ile re-encode/dHash, gerçek NudeNet alt-süreci (Python), gerçek `processMedia` akışı.
// Sahte parçalar: veritabanı (bellek) ve object storage (bellek + enjekte edilen gecikme). Bu makinede S3 yoktur; depolama
// gecikmesi bu yüzden parametriktir (0/200/1000/3000 ms) ve gerçek S3/R2 gecikmesi staging'de ayrıca ölçülmelidir.
// Hiçbir ağ çağrısı yapılmaz; sonuçlar donanıma bağlıdır (ortam bilgisi JSON'a yazılır).
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { processMedia, type MediaJobDeps } from "../src/jobs/media/job.ts";
import { createSubprocessModerator, type Moderator } from "../src/jobs/media/moderator.ts";
import type { MediaJobStore, Outcome } from "../src/jobs/media/store.ts";
import type { WorkerStorage } from "../src/jobs/media/storage.ts";

const PYTHON = process.env.MODERATION_PYTHON ?? "python3";
const SCRIPT = path.resolve(import.meta.dirname, "../python/moderate.py");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Yardımcılar ─────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fotoğraf benzeri: renkli şekiller + gürültü; JPEG boyutu gerçek yüklemelere yakın olsun diye gürültü eklenir. */
async function photo(seed: number, width: number, height: number, quality = 88): Promise<Buffer> {
  const r = mulberry32(seed);
  const color = () => `rgb(${Math.floor(r() * 256)},${Math.floor(r() * 256)},${Math.floor(r() * 256)})`;
  const shapes = Array.from({ length: 20 }, () => `<circle cx="${r() * width}" cy="${r() * height}" r="${20 + r() * (width / 5)}" fill="${color()}" fill-opacity="${0.4 + r() * 0.6}"/>`);
  const base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color()}"/>${shapes.join("")}</svg>`))
    .jpeg({ quality: 95 })
    .toBuffer();
  return sharp(base).modulate({ brightness: 1 }).composite([{ input: { create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 28 } } }, blend: "overlay" }]).jpeg({ quality }).toBuffer();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { n: s.length, min: round(s[0] ?? 0), p50: round(percentile(s, 50)), p95: round(percentile(s, 95)), p99: round(percentile(s, 99)), max: round(s.at(-1) ?? 0) };
}

type Latency = { read: number; write: number };

/** Bellek içi storage; her çağrıya `latency` ms gecikme eklenir ve aşama süreleri kaydedilir. */
function memoryStorage(latency: Latency, timings: Record<string, number[]>) {
  const priv = new Map<string, Buffer>();
  const pub = new Map<string, Buffer>();
  const timed = async <T>(name: string, ms: number, fn: () => T): Promise<T> => {
    const start = performance.now();
    await sleep(ms);
    const out = fn();
    (timings[name] ??= []).push(performance.now() - start);
    return out;
  };
  const storage: WorkerStorage = {
    readPrivate: (key) => timed("storage.read", latency.read, () => priv.get(key) ?? null),
    writePrivate: (key, data) => timed("storage.writePrivate", latency.write, () => void priv.set(key, data)),
    writePublic: (key, data) => timed("storage.writePublic", latency.write, () => void pub.set(key, data)),
    deletePublic: (key) => timed("storage.deletePublic", latency.write, () => void pub.delete(key)),
  };
  return { storage, priv, pub };
}

function memoryStore() {
  const rows = new Map<string, { key: string; status: "PENDING" | "APPROVED" | "QUARANTINED" | "REJECTED"; error: string | null; attempts: number }>();
  const store: MediaJobStore = {
    async bannedHashes() {
      return [];
    },
    async claim(id) {
      const row = rows.get(id);
      if (!row || row.status !== "PENDING") return null;
      row.attempts++;
      return { id, originalObjectKey: row.key, processingAttempts: row.attempts };
    },
    async finish(id, outcome: Outcome) {
      const row = rows.get(id);
      if (!row || row.status !== "PENDING") return false;
      row.status = outcome.status;
      row.error = outcome.status === "APPROVED" ? null : outcome.error;
      return true;
    },
  };
  return { store, rows };
}

function timedModerator(inner: Moderator, timings: Record<string, number[]>): Moderator {
  return {
    async classify(image) {
      const start = performance.now();
      try {
        return await inner.classify(image);
      } finally {
        (timings["moderation.classify"] ??= []).push(performance.now() - start);
      }
    },
    close: () => inner.close(),
  };
}

const realModerator = (timeoutMs = 8_000, args = [SCRIPT], command = PYTHON) =>
  createSubprocessModerator({ command, args, timeoutMs, startupTimeoutMs: 60_000 });

type Harness = ReturnType<typeof harness>;
function harness(latency: Latency, moderator: Moderator) {
  const timings: Record<string, number[]> = {};
  const { storage, priv } = memoryStorage(latency, timings);
  const { store, rows } = memoryStore();
  const deps: MediaJobDeps = { store, storage, moderator: timedModerator(moderator, timings), now: () => new Date(), maxBytes: async () => 8 * 1024 * 1024, log: () => {} };
  return {
    timings,
    rows,
    deps,
    add(id: string, data: Buffer) {
      priv.set(`orig/${id}`, data);
      rows.set(id, { key: `orig/${id}`, status: "PENDING", error: null, attempts: 0 });
    },
    async run(id: string) {
      const start = performance.now();
      const result = await processMedia(id, deps);
      return { result, ms: performance.now() - start };
    },
  };
}

// ── Ölçümler ────────────────────────────────────────────────

async function coldStart() {
  const moderator = realModerator();
  const h = harness({ read: 0, write: 0 }, moderator);
  h.add("cold", await photo(1, 800, 600));
  const first = await h.run("cold"); // süreç başlatma + model yükleme dahil
  h.add("warm", await photo(2, 800, 600));
  const second = await h.run("warm");
  await moderator.close();
  return { firstJobMs: Math.round(first.ms), secondJobMs: Math.round(second.ms), firstResult: first.result };
}

const SIZES = [
  { name: "küçük 800x600", w: 800, h: 600 },
  { name: "orta 1920x1080", w: 1920, h: 1080 },
  { name: "büyük 4000x3000", w: 4000, h: 3000 },
] as const;

async function bySize(runs: number) {
  const out: Record<string, unknown> = {};
  const moderator = realModerator();
  for (const size of SIZES) {
    const h = harness({ read: 0, write: 0 }, moderator);
    const img = await photo(10, size.w, size.h);
    if (img.length > 8 * 1024 * 1024) throw new Error(`${size.name}: ${img.length} bayt > 8 MB sınırı; ölçüm geçersiz`);
    // ısınma
    h.add("warmup", img);
    await h.run("warmup");
    h.timings["moderation.classify"] = [];
    const totals: number[] = [];
    const results: Record<string, number> = {};
    for (let i = 0; i < runs; i++) {
      h.add(`m${i}`, await photo(100 + i, size.w, size.h));
      const { result, ms } = await h.run(`m${i}`);
      totals.push(ms);
      results[result] = (results[result] ?? 0) + 1;
    }
    out[size.name] = { inputKB: Math.round(img.length / 1024), totalMs: stats(totals), classifyMs: stats(h.timings["moderation.classify"]!), results };
  }
  await moderator.close();
  return out;
}

/** Tek Python süreci seri çalışır (moderate.py satır satır okur): eşzamanlılık artınca sıra beklemesi timeout'a sayılır. */
async function byConcurrency(levels: number[], jobs: number) {
  const out: Record<string, unknown> = {};
  for (const concurrency of levels) {
    const moderator = realModerator();
    const h = harness({ read: 0, write: 0 }, moderator);
    h.add("warmup", await photo(1, 1920, 1080));
    await h.run("warmup");
    const ids = Array.from({ length: jobs }, (_, i) => `c${i}`);
    for (const [i, id] of ids.entries()) h.add(id, await photo(200 + i, 1920, 1080));
    const latencies: number[] = [];
    const results: Record<string, number> = {};
    const errors: Record<string, number> = {};
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          const { result, ms } = await h.run(id);
          latencies.push(ms);
          results[result] = (results[result] ?? 0) + 1;
          const e = h.rows.get(id)!.error;
          if (e) errors[e] = (errors[e] ?? 0) + 1;
        }
      }),
    );
    const wall = performance.now() - started;
    out[`eşzamanlılık ${concurrency}`] = { jobs, wallSeconds: Math.round(wall / 100) / 10, jobsPerSecond: Math.round((jobs / (wall / 1000)) * 10) / 10, totalMs: stats(latencies), classifyMs: stats(h.timings["moderation.classify"]!), results, errors };
    await moderator.close();
  }
  return out;
}

async function storageLatency(runs: number) {
  const out: Record<string, unknown> = {};
  const moderator = realModerator();
  const img = await photo(7, 1920, 1080);
  for (const ms of [0, 200, 1000, 3000]) {
    const h = harness({ read: ms, write: ms }, moderator);
    h.add("warmup", img);
    await h.run("warmup");
    const totals: number[] = [];
    for (let i = 0; i < runs; i++) {
      h.add(`s${i}`, img);
      totals.push((await h.run(`s${i}`)).ms);
    }
    // Bir iş: read(1) + writePrivate(1) + writePublic(1) çağrısı → storage payı ≈ 3×gecikme
    out[`storage ${ms} ms/çağrı`] = { totalMs: stats(totals), storageCallsPerJob: 3, expectedStorageShareMs: 3 * ms };
  }
  await moderator.close();
  return out;
}

/** Timeout ve hata davranışları: hepsi QUARANTINED olmalı, APPROVED asla; sonraki iş toparlanmalı. */
async function timeoutBehaviour() {
  const out: Record<string, unknown> = {};
  const img = await photo(9, 800, 600);

  // 1) Takılan model: istek cevapsız kalır.
  {
    const hang = path.resolve(os.tmpdir(), "kv47-hang.py");
    writeFileSync(hang, "import sys, time, json\nsys.stdout.write(json.dumps({'ready': True})+'\\n'); sys.stdout.flush()\nfor line in sys.stdin:\n    time.sleep(3600)\n");
    const moderator = createSubprocessModerator({ command: PYTHON, args: [hang], timeoutMs: 1500, startupTimeoutMs: 10_000 });
    const h = harness({ read: 0, write: 0 }, moderator);
    h.add("hang", img);
    const { result, ms } = await h.run("hang");
    out["takılan model (timeout 1,5 sn)"] = { result, error: h.rows.get("hang")!.error, elapsedMs: Math.round(ms), approved: result === "APPROVED" };
    await moderator.close();
  }

  // 2) Timeout sonrası toparlanma: aynı moderatör nesnesi sonraki istekte süreci yeniden başlatır.
  {
    const moderator = realModerator(8_000);
    const h = harness({ read: 0, write: 0 }, moderator);
    h.add("ok1", img);
    await h.run("ok1");
    // Süreci zorla öldür: bir sonraki iş MODEL_ERROR ile karantinaya girmeli, sonrakisi yeniden başlatıp tamamlanmalı.
    const killed = createSubprocessModerator({ command: PYTHON, args: ["-c", "import sys; sys.exit(3)"], timeoutMs: 2_000, startupTimeoutMs: 5_000 });
    const hk = harness({ read: 0, write: 0 }, killed);
    hk.add("dead", img);
    const dead = await hk.run("dead");
    out["süreç hemen kapanıyor"] = { result: dead.result, error: hk.rows.get("dead")!.error, elapsedMs: Math.round(dead.ms), approved: dead.result === "APPROVED" };
    await killed.close();
    await moderator.close();
  }

  // 3) Model yüklenemiyor (başlangıç timeout'u).
  {
    const moderator = createSubprocessModerator({ command: PYTHON, args: ["-c", "import time; time.sleep(3600)"], timeoutMs: 1_000, startupTimeoutMs: 1_500 });
    const h = harness({ read: 0, write: 0 }, moderator);
    h.add("startup", img);
    const { result, ms } = await h.run("startup");
    out["model hazır olmuyor (başlangıç timeout 1,5 sn)"] = { result, error: h.rows.get("startup")!.error, elapsedMs: Math.round(ms), approved: result === "APPROVED" };
    await moderator.close();
  }

  // 4) Sıra beklemesi: tek süreç istekleri seri işler ve timeout, istek yazıldığı andan başlar (sıra beklemesi dahil).
  //    Sahte model görsel başına 400 ms sürer (yavaş CPU/büyük görsel benzetimi), timeout 2 sn, 12 eşzamanlı iş:
  //    sırada 5. ve sonrası zaman aşımına uğrar; süreç öldürülünce henüz cevabı gelmemiş DİĞER işler de düşer.
  {
    const slow = path.resolve(import.meta.dirname, "media-latency-slow-model.py");
    const moderator = createSubprocessModerator({ command: PYTHON, args: [slow], timeoutMs: 2_000, startupTimeoutMs: 10_000 });
    const h = harness({ read: 0, write: 0 }, moderator);
    const ids = Array.from({ length: 12 }, (_, i) => `q${i}`);
    for (const id of ids) h.add(id, img);
    const settled = await Promise.all(ids.map((id) => h.run(id)));
    const distribution: Record<string, number> = {};
    for (const id of ids) {
      const e = h.rows.get(id)!.error ?? "APPROVED";
      distribution[e] = (distribution[e] ?? 0) + 1;
    }
    // Sonraki iş süreci yeniden başlatıp tamamlayabiliyor mu?
    h.add("after", img);
    const after = await h.run("after");
    out["12 eşzamanlı iş, model 400 ms, timeout 2 sn (sıra beklemesi)"] = {
      distribution,
      maxElapsedMs: Math.round(Math.max(...settled.map((s) => s.ms))),
      afterRecovery: { result: after.result, error: h.rows.get("after")!.error, elapsedMs: Math.round(after.ms) },
    };
    await moderator.close();
  }
  return out;
}

// ── Çalıştır ────────────────────────────────────────────────

const quick = process.argv.includes("--quick");
const cpus = os.cpus();
const result = {
  environment: {
    date: new Date().toISOString(),
    cpu: cpus[0]?.model,
    logicalCores: cpus.length,
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    sharp: sharp.versions.sharp,
    python: PYTHON,
    sampleSizePerCell: quick ? 8 : 40,
    note: "DB ve object storage bellek içidir; storage gecikmesi parametriktir. Gerçek S3/R2 gecikmesi staging'de ölçülmelidir.",
  },
  coldStart: await coldStart(),
  bySize: await bySize(quick ? 8 : 40),
  byConcurrency: await byConcurrency([1, 2, 4], quick ? 12 : 48),
  storageLatency: await storageLatency(quick ? 4 : 10),
  timeoutBehaviour: await timeoutBehaviour(),
};
const out = path.resolve(import.meta.dirname, "media-latency.results.json");
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`\n→ ${out}`);
