// KV-186 (#186) operasyon durumu: yoklama + süreç telemetrisinden `OpsStatus` üretir. Kural: ölçülemeyen şey
// `unknown`/`null` döner, asla 0 ya da "ok" değil (fail-safe gösterim). Eşikler KV-49 izleme tablosuyla uyumludur.
import fs from "node:fs";
import type { LoginLimits, OpsProbe, QueueRow } from "./probe.ts";
import type { HttpSnapshot, OpsTelemetry, SecuritySnapshot } from "./telemetry.ts";

export type Health = "ok" | "degraded" | "down" | "unknown";

/** Worker'ın son izi bu kadar saniyeden eskiyse `degraded`, `WORKER_DOWN_SECONDS`'tan eskiyse `down` (dakikalık cron). */
export const WORKER_OK_SECONDS = 180;
export const WORKER_DOWN_SECONDS = 600;
/** Bekleyen en eski iş bu kadar saniyedir başlamadıysa kuyruk `degraded`. */
export const QUEUE_BACKLOG_SECONDS = 300;
export const DB_SLOW_MS = 500;
/** Günlük yedek beklenir: 26 saate kadar `ok` (zamanlama kayması payı), 72 saate kadar `degraded`, sonra `down`. */
export const BACKUP_OK_HOURS = 26;
export const BACKUP_DOWN_HOURS = 72;
/** 5xx oranı; az istekte gürültü olmasın diye en az `ERROR_RATE_MIN_REQUESTS` istek gerekir. */
export const ERROR_RATE_DEGRADED = 0.05;
export const ERROR_RATE_MIN_REQUESTS = 20;

/** Son başarılı restore tatbikatı (KV-48, #50): staging, yedek → restore → API geçişi → smoke, 314,7 sn. */
export const RESTORE_DRILL = { at: "2026-10-05", environment: "staging", rtoSeconds: 315, reference: "#50 · docs/KV-48_BACKUP_RESTORE.md" } as const;

export function heartbeatPath(): string {
  return process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/kararver-worker-heartbeat.json";
}

/** Aynı serviste çalışan worker'ın dosya heartbeat'i (staging); ayrı serviste yoktur. */
export function readHeartbeatFile(): { status: string; at: string } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(heartbeatPath(), "utf8")) as { status?: unknown; at?: unknown };
    return typeof parsed.status === "string" && typeof parsed.at === "string" && !Number.isNaN(Date.parse(parsed.at))
      ? { status: parsed.status, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

export function classifyWorker(lastSeen: Date | null, now: Date): { status: Health; lastSeenAt: string | null; ageSeconds: number | null } {
  if (!lastSeen) return { status: "unknown", lastSeenAt: null, ageSeconds: null };
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - lastSeen.getTime()) / 1000));
  const status = ageSeconds <= WORKER_OK_SECONDS ? "ok" : ageSeconds <= WORKER_DOWN_SECONDS ? "degraded" : "down";
  return { status, lastSeenAt: lastSeen.toISOString(), ageSeconds };
}

/** Kayıt yoksa ya da okunamıyorsa `unknown`: "yedek yok" ile "bilinmiyor" ayrımı panelde `lastBackupAt` ile yapılır. */
export function classifyBackup(last: Date | null, now: Date): Health {
  if (!last) return "unknown";
  const hours = (now.getTime() - last.getTime()) / 3_600_000;
  return hours <= BACKUP_OK_HOURS ? "ok" : hours <= BACKUP_DOWN_HOURS ? "degraded" : "down";
}

export function classifyQueues(queues: QueueRow[]): Health {
  if (queues.length === 0) return "unknown";
  const backlog = queues.some((q) => (q.oldestWaitingSeconds ?? 0) > QUEUE_BACKLOG_SECONDS);
  const failing = queues.some((q) => q.failed24h > 0);
  return backlog || failing ? "degraded" : "ok";
}

export function classifyApi(http: HttpSnapshot): Health {
  if (http.requests >= ERROR_RATE_MIN_REQUESTS && (http.errorRate ?? 0) > ERROR_RATE_DEGRADED) return "degraded";
  return "ok";
}

const settle = async <T>(work: (() => Promise<T>) | undefined): Promise<{ ok: true; value: T } | { ok: false }> => {
  if (!work) return { ok: false };
  try {
    return { ok: true, value: await work() };
  } catch {
    return { ok: false };
  }
};

export type OpsStatusDeps = {
  probe?: OpsProbe;
  telemetry: OpsTelemetry;
  env: string;
  startedAt: Date;
  now: () => Date;
  /** KV-19 giriş sınırları (`limits.loginFailuresPer*`); kilit sayımı aynı eşiği kullanır. */
  loginLimits?: () => Promise<LoginLimits>;
};

export async function buildOpsStatus(deps: OpsStatusDeps) {
  const { probe, telemetry } = deps;
  const [database, workerSeen, queues, lastBackup, signals] = await Promise.all([
    settle(probe ? () => probe.database() : undefined),
    settle(probe ? () => probe.workerLastSeen() : undefined),
    settle(probe ? () => probe.queues() : undefined),
    settle(probe ? () => probe.lastBackup() : undefined),
    settle(probe && deps.loginLimits ? async () => probe.securitySignals(await deps.loginLimits!()) : undefined),
  ]);
  const now = deps.now();
  // İki iz varsa yenisi: dosya heartbeat'i (aynı servis) ya da worker'ın aldığı son iş (ayrı servis).
  const file = readHeartbeatFile();
  const fileSeen = file && file.status === "ready" ? new Date(file.at) : null;
  const dbSeen = workerSeen.ok ? workerSeen.value : null;
  const lastSeen = fileSeen && dbSeen ? (fileSeen > dbSeen ? fileSeen : dbSeen) : (fileSeen ?? dbSeen);
  const { http, security }: { http: HttpSnapshot; security: SecuritySnapshot } = telemetry.snapshot();
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null;

  return {
    generatedAt: now.toISOString(),
    release: { sha: sha ? sha.slice(0, 12) : null, env: deps.env, startedAt: deps.startedAt.toISOString() },
    components: {
      api: { status: classifyApi(http), uptimeSeconds: Math.max(0, Math.floor((now.getTime() - deps.startedAt.getTime()) / 1000)) },
      database: database.ok
        ? { status: (database.value.latencyMs > DB_SLOW_MS ? "degraded" : "ok") as Health, latencyMs: database.value.latencyMs, version: database.value.version }
        : { status: (probe ? "down" : "unknown") as Health, latencyMs: null, version: null },
      worker: classifyWorker(lastSeen, now),
      queue: queues.ok ? { status: classifyQueues(queues.value), queues: queues.value } : { status: "unknown" as Health, queues: [] },
    },
    http,
    security: {
      ...security,
      lockedLogins: signals.ok ? signals.value.lockedLogins : null,
      adminActions24h: signals.ok ? signals.value.adminActions24h : null,
    },
    // Son yedek `db:backup` kaydından (ops_backup_runs); tatbikat kanıtı KV-48'den.
    backup: {
      status: lastBackup.ok ? classifyBackup(lastBackup.value, now) : ("unknown" as Health),
      lastBackupAt: lastBackup.ok && lastBackup.value ? lastBackup.value.toISOString() : null,
      restoreDrill: { ...RESTORE_DRILL },
    },
  };
}
