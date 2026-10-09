// Çok süreçli API girişi (KV-47, docs/KV-47_PERFORMANCE.md): WEB_CONCURRENCY kadar süreç aynı portu paylaşır.
//   WEB_CONCURRENCY=4 node src/cluster.ts
// Neden: API istek başına CPU'ya bağlı (Prisma client + JSON); tek Node süreci bir çekirdeği doyurur. Durumsuz
// olduğu için (oturum ve idempotency DB'de) süreç sayısıyla doğrusal ölçeklenir. Her süreç kendi bağlantı havuzunu
// açar: WEB_CONCURRENCY × DATABASE_POOL_MAX + worker, PostgreSQL max_connections'ı aşmamalı.
// Ölen süreç yeniden başlatılır; SIGINT/SIGTERM hepsine iletilir (server.ts düzgün kapanır).
import cluster from "node:cluster";
import { availableParallelism } from "node:os";

const wanted = Number(process.env.WEB_CONCURRENCY ?? 1);
if (!Number.isInteger(wanted) || wanted < 1 || wanted > availableParallelism()) {
  console.error(`WEB_CONCURRENCY 1–${availableParallelism()} arası tam sayı olmalı (şu an: ${process.env.WEB_CONCURRENCY})`);
  process.exit(1);
}

if (cluster.isPrimary) {
  let stopping = false;
  for (let i = 0; i < wanted; i++) cluster.fork();
  cluster.on("exit", (worker, code, signal) => {
    if (stopping) return;
    console.error(JSON.stringify({ level: 50, msg: "api süreci öldü, yeniden başlatılıyor", pid: worker.process.pid, code, signal }));
    cluster.fork();
  });
  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
} else {
  await import("./server.ts");
}
