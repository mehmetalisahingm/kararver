import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const children = new Set();
let apiExited = false;

// API, worker'ın aynı serviste çalıştığını bilir: heartbeat açılıştan sonra gelmezse /health worker'ı "down" sayar (#51).
const childEnv = (name) => (name === "api" ? { ...process.env, WORKER_HEARTBEAT_EXPECTED: "true" } : process.env);

function start(name) {
  console.error(`[launcher] starting ${name}`);
  // Run the installed Node directly: runtime Corepack caches are ephemeral on Render.
  // Keep each package's working directory and deliver shutdown signals to the app itself.
  const directory = new URL(`../apps/${name}/`, import.meta.url);
  const entry = new URL(name === "api" ? "src/server.ts" : "src/main.ts", directory);
  const child = spawn(process.execPath, [fileURLToPath(entry)], {
    cwd: fileURLToPath(directory), stdio: "inherit", env: childEnv(name),
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(`[${name}] spawn error`, error);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    console.error(`[${name}] exited`, { code, signal });
    if (name === "api") {
      apiExited = true;
      stop("SIGTERM");
      return;
    }
    if (!stopping) setTimeout(() => start(name), 2_000).unref();
  });
  return child;
}

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

// #301 migration kapısı: şema bu sürümle uyumlu değilse (bekleyen ya da yarım migration, DB'ye ulaşılamıyor) hiçbir
// süreç başlamaz. Kapı migration ÇALIŞTIRMAZ; uygulama kontrollü adımda yapılır (docs/KV-49_OPERATIONS.md).
const gate = spawnSync(process.execPath, [fileURLToPath(new URL("../packages/db/ops/migration-gate.ts", import.meta.url))], {
  cwd: fileURLToPath(new URL("../packages/db/", import.meta.url)), stdio: "inherit", env: process.env, timeout: 60_000,
});
if (gate.status !== 0) {
  console.error(`[launcher] migration gate failed (exit ${gate.status ?? gate.signal}); api and worker NOT started`);
  process.exit(1);
}

start("api");
start("worker");
console.error("[launcher] api and worker processes started");

while (!apiExited && !stopping) await new Promise((resolve) => setTimeout(resolve, 1_000));
process.exitCode = apiExited ? 1 : 0;
