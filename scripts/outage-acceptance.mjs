// KV-44 (#46) PR-2 — yerel kesinti kabul testi: pnpm outage:test [-- --out sonuc.json]
//
// Tek kullanımlık PostgreSQL container'ı (kararver-outage-<rastgele>, postgres:17.11-alpine, veri tmpfs'te, port yalnız
// 127.0.0.1'de rastgele) açar, migration'ları uygular ve gerçek scripts/start-api-with-worker.mjs ile API + worker'ı başlatır.
//   (a) DB durdur/başlat: postgres süreci container içinde durdurulur (veri korunur), API'nin cevapları ölçülür, sonra
//       DB geri açılır ve API'nin kendiliğinden toparlanma süresi ölçülür.
//   (b) Worker kill: worker süreci öldürülür; launcher'ın yeniden başlatması ve /health'in bu sırada ne dediği ölçülür.
// Staging'e bağlanmaz; .env okunmaz (APP_ENV ortamdan verilir). Parola ve pepper her koşuda üretilir, hiçbir yere yazılmaz.
// Docker yoksa ATLANDI yazar ve 0 ile çıkar. Container ve süreçler hata olsa bile finally içinde silinir.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_DIR = path.join(ROOT, "packages/db");
const IMAGE = "postgres:17.11-alpine";
const PGDATA = "/var/lib/postgresql/data";
const DB_NAME = "kararver_outage";
const OUTAGE_MS = 15_000;
const RECOVERY_LIMIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

// pnpm "pnpm outage:test -- --out x" çağrısında "--" ayıracını da geçirir; parseArgs onu konumsal argüman sayıp düşmesin.
const argv = process.argv.slice(2);
const { values: args } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { out: { type: "string" } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.error(`[outage] ${msg}`);

function docker(argv, opts = {}) {
  return spawnSync("docker", argv, { encoding: "utf8", ...opts });
}

if (docker(["info", "--format", "{{.ServerVersion}}"]).status !== 0) {
  console.log("ATLANDI: Docker çalışmıyor (docker info başarısız); kesinti testleri koşulmadı.");
  process.exit(0);
}

const id = randomBytes(4).toString("hex");
const name = `kararver-outage-${id}`;
const password = randomBytes(24).toString("hex");
const pepper = randomBytes(32).toString("hex");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const heartbeatFile = path.join(workDir, "heartbeat.json");
const logFile = path.join(os.tmpdir(), `${name}.log`);
const redact = (s) => s.replaceAll(password, "***").replaceAll(pepper, "***");

const t0 = Date.now();
const lines = [];
let launcher = null;
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (launcher?.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(launcher.pid), "/T", "/F"], { stdio: "ignore" });
    else try { process.kill(-launcher.pid, "SIGKILL"); } catch {}
  }
  docker(["rm", "-f", name], { stdio: "ignore" });
  const left = docker(["ps", "-a", "-q", "--filter", `name=^${name}$`]).stdout.trim();
  log(left ? `UYARI: container silinemedi: ${name}` : `container silindi: ${name}`);
  fs.writeFileSync(logFile, redact(lines.join("\n")) + "\n");
  fs.rmSync(workDir, { recursive: true, force: true });
}
process.once("SIGINT", () => void cleanup().finally(() => process.exit(130)));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(what, fn, limitMs, everyMs = 250) {
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    if (await fn()) return Date.now() - start;
    await sleep(everyMs);
  }
  throw new Error(`${what}: ${limitMs} ms içinde olmadı`);
}

const pgReady = () => docker(["exec", name, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres", "-d", DB_NAME]).status === 0;

let api = "";
async function probe(route) {
  const start = Date.now();
  try {
    const res = await fetch(`${api}${route}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, ms: Date.now() - start, code: body?.error?.code ?? null, body };
  } catch (error) {
    return { status: 0, ms: Date.now() - start, code: error.name === "TimeoutError" ? "TIMEOUT" : (error.cause?.code ?? error.name), body: null };
  }
}
const healthView = (p) => ({ http: p.status, status: p.body?.status ?? null, worker: p.body?.worker ?? null });
const readBeat = () => { try { return JSON.parse(fs.readFileSync(heartbeatFile, "utf8")); } catch { return null; } };
const count = (samples) => Object.entries(samples.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ×${n}`);
const workerExitsSince = (t) => lines.filter((l) => Number(l.split(" ", 1)[0]) >= t && l.includes("[worker] exited")).length;
const launcherAlive = () => launcher.exitCode === null;

const result = { container: name, image: IMAGE, startedAt: new Date(t0).toISOString(), tests: [], health: {} };
const check = (test, label, ok, detail) => test.checks.push({ label, ok, ...(detail === undefined ? {} : { detail }) });

try {
  // ─── Container ───────────────────────────────────────────────
  // PID 1 bir döngü: /tmp/hold varken postgres'i başlatmaz. Böylece postgres container durmadan (tmpfs silinmeden) kapatılabilir.
  const loop = "while :; do if [ -f /tmp/hold ]; then sleep 0.2; else docker-entrypoint.sh postgres; fi; done";
  const run = docker([
    "run", "-d", "--name", name, "-p", "127.0.0.1::5432", "--tmpfs", `${PGDATA}:rw,size=512m`,
    "-e", "POSTGRES_PASSWORD", "-e", `POSTGRES_DB=${DB_NAME}`, "--entrypoint", "sh", IMAGE, "-c", loop,
  ], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (run.status !== 0) throw new Error(`docker run başarısız: ${run.stderr.trim()}`);
  const port = docker(["port", name, "5432/tcp"]).stdout.trim().split(/\r?\n/)[0].split(":").pop();
  log(`container ${name} → 127.0.0.1:${port}`);
  const pgStartMs = await waitFor("postgres hazır", pgReady, 120_000, 500);
  result.postgresInitMs = pgStartMs;
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${DB_NAME}`;

  // Ana makinedeki .env / staging değerleri çocuk süreçlere sızmasın.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(DATABASE_URL|TEST_DATABASE_URL|DIRECT_URL|S3_|SMTP_|MAIL|BACKUP_|RAILWAY_|SESSION_|AUTH_|STAGING|KV44|NEXT_PUBLIC_)|(TOKEN|SECRET|PASSWORD|PEPPER)/i.test(k)));

  const prismaCli = createRequire(path.join(DB_DIR, "package.json")).resolve("prisma/build/index.js");
  const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: DB_DIR, env: { ...env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy başarısız:\n${redact(migrate.stdout + migrate.stderr)}`);
  log("migration'lar uygulandı");

  // ─── API + worker (gerçek launcher) ─────────────────────────
  const apiPort = await freePort();
  api = `http://127.0.0.1:${apiPort}`;
  Object.assign(env, {
    APP_ENV: "test", LOG_LEVEL: "warn", DATABASE_URL: databaseUrl, PORT: String(apiPort), API_URL: api,
    WEB_URL: "http://127.0.0.1:3999", SESSION_COOKIE_SECURE: "false", AUTH_TOKEN_PEPPER: pepper, RATE_LIMIT_ENABLED: "false",
    MAIL_TRANSPORT: "console", MAIL_FROM: "KararVer <outage@kararver.test>", MEDIA_PUBLIC_BASE_URL: "http://127.0.0.1:9/media",
    // Worker S3 ister; bu testte medya işi yok, adres kasıtlı olarak erişilemez.
    S3_ENDPOINT: "http://127.0.0.1:9", S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: "outage-dummy", S3_SECRET_ACCESS_KEY: "outage-dummy",
    S3_BUCKET_PRIVATE: "outage-private", S3_BUCKET_PUBLIC: "outage-public", WORKER_HEARTBEAT_PATH: heartbeatFile, BACKUP_ENABLED: "false",
  });
  launcher = spawn(process.execPath, [path.join(ROOT, "scripts/start-api-with-worker.mjs")], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  for (const stream of [launcher.stdout, launcher.stderr]) {
    let rest = "";
    stream.setEncoding("utf8").on("data", (chunk) => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      for (const p of parts) if (p.trim()) lines.push(`${Date.now()} ${p}`);
    });
  }
  const bootMs = await waitFor("API + worker hazır", async () => {
    if (!launcherAlive()) throw new Error("launcher erken çıktı");
    return (await probe("/health")).status === 200 && (await probe("/v1/categories")).status === 200 && readBeat()?.status === "ready";
  }, 180_000, 500);
  result.bootMs = bootMs;
  result.health.baseline = healthView(await probe("/health"));
  log(`API + worker hazır (${bootMs} ms)`);

  // ─── (a) DB durdur / başlat ─────────────────────────────────
  {
    const test = { name: "(a) DB durdur/başlat", checks: [] };
    result.tests.push(test);
    const tStart = Date.now();
    check(test, "başlangıçta GET /v1/categories 200", (await probe("/v1/categories")).status === 200);

    const stopAt = Date.now();
    docker(["exec", name, "touch", "/tmp/hold"]);
    const stop = docker(["exec", "-u", "postgres", name, "pg_ctl", "-D", PGDATA, "stop", "-m", "immediate"]);
    check(test, "postgres durduruldu (pg_ctl stop -m immediate)", stop.status === 0 && !pgReady(), stop.stderr.trim() || undefined);

    const outage = [];
    while (Date.now() - stopAt < OUTAGE_MS) {
      const [cat, health] = await Promise.all([probe("/v1/categories"), probe("/health")]);
      outage.push({ t: Date.now() - stopAt, cat, health });
      await sleep(500);
    }
    test.outage = {
      windowMs: OUTAGE_MS,
      categories: count(outage.map((s) => `${s.cat.status} ${s.cat.code ?? ""}`.trim())),
      categoriesMaxMs: Math.max(...outage.map((s) => s.cat.ms)),
      health: count(outage.map((s) => `${s.health.status} ${s.health.body?.status ?? "-"} worker=${s.health.body?.worker?.status ?? "-"}`)),
    };
    result.health.duringDbOutage = healthView(outage.at(-1).health);
    check(test, "DB yokken /v1/categories hiç 200 dönmedi", outage.every((s) => s.cat.status !== 200));
    check(test, "DB yokken cevaplar 5xx (asılı kalma/bağlantı hatası yok)", outage.every((s) => s.cat.status >= 500), test.outage.categories);
    check(test, `DB yokken her istek ${REQUEST_TIMEOUT_MS} ms içinde cevaplandı`, test.outage.categoriesMaxMs < REQUEST_TIMEOUT_MS, `${test.outage.categoriesMaxMs} ms`);
    check(test, "DB yokken API süreci ayakta", launcherAlive());

    const startAt = Date.now();
    docker(["exec", name, "rm", "-f", "/tmp/hold"]);
    test.postgresBackMs = await waitFor("postgres geri geldi", pgReady, 60_000);
    let firstOk = null;
    const after = [];
    try {
      await waitFor("API toparlandı", async () => {
        const p = await probe("/v1/categories");
        after.push(`${p.status} ${p.code ?? ""}`.trim());
        if (p.status === 200) firstOk = Date.now() - startAt;
        return p.status === 200;
      }, RECOVERY_LIMIT_MS);
    } catch {}
    test.recoveryMs = firstOk;
    test.afterRestart = count(after);
    let stable = 0;
    for (let i = 0; i < 10; i++) if ((await probe("/v1/categories")).status === 200) stable++;
    check(test, `DB geri gelince API ${RECOVERY_LIMIT_MS / 1000} sn içinde toparlandı`, firstOk !== null, firstOk === null ? "toparlanmadı" : `${firstOk} ms (postgres ${test.postgresBackMs} ms'de hazırdı)`);
    check(test, "toparlandıktan sonra 10/10 istek 200", stable === 10, `${stable}/10`);
    check(test, "API süreci yeniden başlamadan toparlandı", launcherAlive() && !lines.some((l) => l.includes("[api] exited")));
    test.workerExits = workerExitsSince(stopAt);
    await waitFor("worker heartbeat tazelendi", () => { const b = readBeat(); return b && Date.now() - Date.parse(b.at) < 12_000; }, 60_000, 500).catch(() => {});
    test.durationMs = Date.now() - tStart;
  }

  // ─── (b) Worker kill ────────────────────────────────────────
  {
    const test = { name: "(b) worker kill", checks: [] };
    result.tests.push(test);
    const tStart = Date.now();
    const before = readBeat();
    check(test, "heartbeat'te worker pid var", Number.isInteger(before?.pid));

    const killAt = Date.now();
    process.kill(before.pid, "SIGKILL");
    // Bayat heartbeat: worker ölüyken dosyada 1 saat önceki "ready" kalmış gibi. /health bunu ayırt ediyor mu?
    fs.writeFileSync(heartbeatFile, JSON.stringify({ status: "ready", at: new Date(Date.now() - 3_600_000).toISOString(), pid: before.pid }));
    const staleHealth = await probe("/health");
    result.health.staleHeartbeat = healthView(staleHealth);
    test.categoriesWhileWorkerDead = (await probe("/v1/categories")).status;

    test.restartMs = await waitFor("worker yeniden başladı", () => {
      const b = readBeat();
      return b && b.pid !== before.pid && Date.now() - Date.parse(b.at) < 12_000;
    }, 120_000, 250).catch(() => null);
    test.workerExits = workerExitsSince(killAt);
    check(test, "launcher worker çıkışını gördü", test.workerExits >= 1, `${test.workerExits} çıkış`);
    check(test, "worker yeni pid ile yeniden başladı ve heartbeat yazdı", test.restartMs !== null, test.restartMs === null ? "olmadı" : `${test.restartMs} ms`);
    check(test, "worker yokken API cevap vermeye devam etti", test.categoriesWhileWorkerDead === 200);
    check(test, "API süreci etkilenmedi", launcherAlive() && !lines.some((l) => l.includes("[api] exited")));
    result.health.afterWorkerRestart = healthView(await probe("/health"));
    test.durationMs = Date.now() - tStart;
  }
} catch (error) {
  result.error = redact(String(error?.stack ?? error));
} finally {
  await cleanup();
}

result.durationMs = Date.now() - t0;
result.log = logFile;
result.ok = !result.error && result.tests.length === 2 && result.tests.every((t) => t.checks.every((c) => c.ok));
const json = redact(JSON.stringify(result, null, 2));
if (args.out) fs.writeFileSync(path.resolve(args.out), json + "\n");
console.log(json);
for (const t of result.tests) for (const c of t.checks) console.error(`${c.ok ? "✔" : "✖"} ${t.name}: ${c.label}${c.detail ? ` — ${Array.isArray(c.detail) ? c.detail.join(", ") : c.detail}` : ""}`);
console.error(result.ok ? "SONUÇ: geçti" : `SONUÇ: kaldı${result.error ? ` (${result.error.split("\n")[0]})` : ""}`);
process.exitCode = result.ok ? 0 : 1;
