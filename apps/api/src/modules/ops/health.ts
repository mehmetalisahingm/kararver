// KV-49 (#51) /health: deploy kapısı (Railway healthcheck), uptime izleme ve staging-monitor bunu okur. #262 kesinti testi iki
// kör nokta buldu: DB kapalıyken ve worker saatlerdir sessizken /health 200 "ok" dönüyordu. Kural:
//   - DB: kısa zaman aşımlı yoklama; hata ya da zaman aşımı → down.
//   - Worker: heartbeat yaşı classifyWorker eşikleriyle (≤ 3 dk ready, ≤ 10 dk stale/degraded, daha eski down).
//     Heartbeat dosyası yoksa: worker aynı serviste bekleniyorsa (WORKER_HEARTBEAT_EXPECTED, launcher verir) açılıştan
//     WORKER_STARTUP_GRACE_MS sonra down; beklenmiyorsa (ayrı servis, testler) unknown ve sağlıksız sayılmaz.
//   - Biri down ise HTTP 503 ve status "down"; worker degraded ise 200 ve status "degraded"; aksi halde 200 "ok".
// "Bilinmiyor" 503 değildir: yeni deploy'da heartbeat henüz yazılmamışken ya da worker ayrı servisteyken deploy engellenmesin.
import { classifyWorker, readHeartbeatFile } from "./status.ts";
import type { OpsProbe } from "./probe.ts";

export const HEALTH_DB_TIMEOUT_MS = 2_000;
/** /health herkese açık: DB yoklaması bu süre boyunca paylaşılır, eşzamanlı istekler tek sorguyu bekler (havuz dolmasın). */
export const HEALTH_DB_CACHE_MS = 5_000;
/** Worker'ın aynı serviste ilk heartbeat'i yazması için tanınan süre (launcher 2 sn'de yeniden başlatır, heartbeat 10 sn'de bir). */
export const WORKER_STARTUP_GRACE_MS = 120_000;

export type HealthDeps = {
  probe?: Pick<OpsProbe, "database">;
  now: () => Date;
  startedAt: Date;
  env: string;
  sha: string | null;
  workerExpected: boolean;
  readHeartbeat?: () => { status: string; at: string } | null;
  dbTimeoutMs?: number;
  /** Verilirse DB durumu buradan okunur (uygulama önbellekli denetimi verir, bkz. cachedDatabaseCheck). */
  databaseCheck?: () => Promise<HealthBody["database"]>;
};

export type HealthBody = {
  status: "ok" | "degraded" | "down";
  database: { status: "ok" | "down" | "unknown"; latencyMs?: number };
  worker:
    | { status: string; at: string; ageMs: number; health: "ok" | "degraded" | "down" }
    | { status: "unknown" | "missing"; health: "unknown" | "down" };
  release: { sha: string | null; env: string };
};

async function databaseState(deps: Pick<HealthDeps, "probe" | "dbTimeoutMs">): Promise<HealthBody["database"]> {
  if (!deps.probe) return { status: "unknown" };
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), deps.dbTimeoutMs ?? HEALTH_DB_TIMEOUT_MS);
    });
    const { latencyMs } = await Promise.race([deps.probe.database(), timeout]);
    return { status: "ok", latencyMs };
  } catch {
    // Hata ayrıntısı (bağlantı adresi olabilir) yanıta yazılmaz.
    return { status: "down" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Önbellekli ve birleştirilmiş DB denetimi: sonuç HEALTH_DB_CACHE_MS boyunca yeniden kullanılır; yoklama sürerken gelen
 * istekler aynı sözü bekler. Kesintide her /health isteği yeni bir sorgu açıp bağlantı havuzunu doldurmaz.
 */
export function cachedDatabaseCheck(
  probe: Pick<OpsProbe, "database"> | undefined,
  options: { cacheMs?: number; timeoutMs?: number; nowMs?: () => number } = {},
): () => Promise<HealthBody["database"]> {
  const cacheMs = options.cacheMs ?? HEALTH_DB_CACHE_MS;
  const nowMs = options.nowMs ?? Date.now;
  let last: { at: number; value: HealthBody["database"] } | null = null;
  let inflight: Promise<HealthBody["database"]> | null = null;
  return () => {
    if (last && nowMs() - last.at < cacheMs) return Promise.resolve(last.value);
    inflight ??= databaseState({ probe, dbTimeoutMs: options.timeoutMs }).then((value) => {
      last = { at: nowMs(), value };
      inflight = null;
      return value;
    });
    return inflight;
  };
}

function workerState(deps: HealthDeps): HealthBody["worker"] {
  const now = deps.now();
  const beat = (deps.readHeartbeat ?? readHeartbeatFile)();
  if (!beat) {
    const pastGrace = now.getTime() - deps.startedAt.getTime() > WORKER_STARTUP_GRACE_MS;
    return deps.workerExpected && pastGrace ? { status: "missing", health: "down" } : { status: "unknown", health: "unknown" };
  }
  const health = classifyWorker(new Date(beat.at), now).status as "ok" | "degraded" | "down";
  // Worker kendi durumunu "ready" yazsa da heartbeat bayatsa "stale" raporlanır (#262: 1 saatlik heartbeat "ready" görünüyordu).
  const status = beat.status === "ready" && health !== "ok" ? "stale" : beat.status;
  return { status, at: beat.at, ageMs: Math.max(0, now.getTime() - Date.parse(beat.at)), health };
}

export async function buildHealth(deps: HealthDeps): Promise<{ httpStatus: 200 | 503; body: HealthBody }> {
  const database = deps.databaseCheck ? await deps.databaseCheck() : await databaseState(deps);
  const worker = workerState(deps);
  const down = database.status === "down" || worker.health === "down";
  const status = down ? "down" : worker.health === "degraded" ? "degraded" : "ok";
  return { httpStatus: down ? 503 : 200, body: { status, database, worker, release: { sha: deps.sha ? deps.sha.slice(0, 12) : null, env: deps.env } } };
}
