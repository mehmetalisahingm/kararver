// Toplu içerik işi çalıştırıcısı — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §9.
//
// DB kuyruğu: QUEUED iş tek SQL ifadesiyle sahiplenilir (FOR UPDATE SKIP LOCKED); iki API süreci aynı işi almaz. PROCESSING'de
// takılan (süreç öldü) iş STALE_CLAIM_MS sonra yeniden alınır; öğe kayıtları (content_job_items) sayesinde işlenmiş içerik
// tekrar seçilmez. Tur bütçesi dolarsa iş QUEUED'a döner ve sonraki turda sürer.
//
// İçerik başına işlem MEVCUT moderasyon uygulamasından geçer (ModerationStore.apply): satır kilidi, durum geçişi, sayaçlar,
// moderation_actions, audit (moderation.*.apply), olay ve açık raporların kapanması aynı öğe transaction'ındadır; bu modül
// yeni bir durum geçişi kuralı icat etmez. Her grupta (CHUNK) aktörün yetkisi ve hedefin rolü yeniden doğrulanır; aktör yetkisini
// kaybettiyse iş FAILED (actor_not_authorized) olur ve kalan içeriğe dokunulmaz.
//
// Bilinen sınır: öğe kaydı, öğe transaction'ının ardından yazılır. İkisi arasında süreç ölürse içerik uygulanmış ama işte kaydı
// yoktur; bu içerik yeniden seçilmez (artık uygun değil) ve yalnız geri alınamaz (geçmişte moderation_actions'ta görünür).
import type { PrismaClient } from "@kararver/db";
import { decide } from "../admin-users/prisma-store.ts";
import type { ModerationStore } from "../moderation/store.ts";
import { nextCandidates, restorableItems, type Candidate } from "./eligible.ts";
import { scopeOf, type JobAction } from "./store.ts";

export const CHUNK = 25;
/** Bir turda bir iş için harcanan en çok süre; dolunca iş kuyruğa döner. */
export const TICK_BUDGET_MS = 20_000;
export const STALE_CLAIM_MS = 5 * 60 * 1000;
export const RUNNER_INTERVAL_MS = 5_000;

export type RunnerDeps = {
  prisma: PrismaClient;
  moderation: ModerationStore;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  /** Sadece test: bir öğe işlendikten sonra (iptal/yarış senaryosu). */
  afterItem?: (jobId: string, index: number) => Promise<void>;
  budgetMs?: number;
};

type Claimed = {
  id: string;
  userId: string;
  requestedById: string;
  kind: "HIDE" | "REMOVE" | "UNDO";
  reason: string;
  includePolls: boolean;
  includeComments: boolean;
  cutoffAt: Date;
  undoOfId: string | null;
};

type Counters = { applied: number; unchanged: number; failed: number; skipped: number };

async function claimNext(prisma: PrismaClient, at: Date): Promise<Claimed | null> {
  const now = at.toISOString();
  const stale = new Date(at.getTime() - STALE_CLAIM_MS).toISOString();
  const rows = await prisma.$queryRaw<
    { id: string; user_id: string; requested_by_id: string; kind: Claimed["kind"]; reason: string; include_polls: boolean; include_comments: boolean; cutoff_at: Date; undo_of_id: string | null }[]
  >`
    UPDATE content_jobs SET status = 'PROCESSING', claimed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz,
                            started_at = COALESCE(started_at, ${now}::timestamptz)
    WHERE id = (
      SELECT id FROM content_jobs
      WHERE status = 'QUEUED' OR (status = 'PROCESSING' AND claimed_at < ${stale}::timestamptz)
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id::text AS id, user_id::text AS user_id, requested_by_id::text AS requested_by_id, kind::text AS kind, reason,
              include_polls, include_comments, cutoff_at, undo_of_id::text AS undo_of_id`;
  const r = rows[0];
  return r
    ? { id: r.id, userId: r.user_id, requestedById: r.requested_by_id, kind: r.kind, reason: r.reason, includePolls: r.include_polls, includeComments: r.include_comments, cutoffAt: r.cutoff_at, undoOfId: r.undo_of_id }
    : null;
}

async function stillAuthorized(deps: RunnerDeps, job: Claimed): Promise<boolean> {
  const role = (await deps.prisma.userRole.findUnique({ where: { userId: job.userId }, select: { role: true } }))?.role ?? null;
  const decision = await decide(deps.prisma, job.requestedById, "user.content.bulk", { targetUserId: job.userId, targetRoles: role ? [role] : [] }, deps.now());
  return decision.allowed;
}

async function isCancelled(deps: RunnerDeps, jobId: string): Promise<boolean> {
  const row = await deps.prisma.contentJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return row?.status === "CANCELLED";
}

async function processItem(deps: RunnerDeps, job: Claimed, item: Candidate, action: "HIDE" | "REMOVE" | "RESTORE", expectedStatus: string | null): Promise<{ result: "APPLIED" | "UNCHANGED" | "FAILED" | "SKIPPED"; from: string | null; to: string | null; detail: string | null }> {
  const kind = item.type === "POLL" ? "polls" : "comments";
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await deps.moderation.findTarget(kind, item.id);
    if (!target) return { result: "FAILED", from: null, to: null, detail: "not_found" };
    // Geri alma: işten sonra durumu başka biri değiştirdiyse dokunma (sürüm kontrolü).
    if (expectedStatus !== null && target.status !== expectedStatus) return { result: "SKIPPED", from: target.status, to: null, detail: "changed" };
    const res = await deps.moderation.apply({
      kind,
      id: item.id,
      actorId: job.requestedById,
      action,
      reason: job.reason,
      now: deps.now(),
      requestId: `content-job:${job.id}`,
      actorIsAdmin: true,
      communityId: target.communityId,
    });
    if (res.kind === "applied") return { result: "APPLIED", from: target.status, to: res.outcome.status, detail: null };
    if (res.kind === "unchanged") return { result: "UNCHANGED", from: target.status, to: res.outcome.status, detail: null };
    // Topluluk okuma ile kilit arasında değiştiyse bir kez yeniden oku.
    if (res.kind === "conflict" && res.reason === "community_changed" && attempt === 0) continue;
    return { result: "FAILED", from: target.status, to: null, detail: res.kind === "conflict" ? res.reason : res.kind === "forbidden" ? res.reason : res.kind };
  }
  return { result: "FAILED", from: null, to: null, detail: "community_changed" };
}

async function record(deps: RunnerDeps, jobId: string, item: Candidate, r: Awaited<ReturnType<typeof processItem>>): Promise<void> {
  const column = { APPLIED: "applied", UNCHANGED: "unchanged", FAILED: "failed", SKIPPED: "skipped" } as const;
  await deps.prisma.$transaction([
    deps.prisma.contentJobItem.create({ data: { jobId, targetType: item.type, targetId: item.id, fromStatus: r.from, toStatus: r.to, result: r.result, detail: r.detail } }),
    deps.prisma.contentJob.update({ where: { id: jobId }, data: { [column[r.result]]: { increment: 1 } } }),
  ]);
}

async function finish(deps: RunnerDeps, jobId: string, status: "DONE" | "FAILED", failure: string | null): Promise<void> {
  // Koşullu: iş bu arada iptal edildiyse CANCELLED kalır.
  await deps.prisma.contentJob.updateMany({ where: { id: jobId, status: "PROCESSING" }, data: { status, failure, finishedAt: deps.now(), claimedAt: null } });
}

async function requeue(deps: RunnerDeps, jobId: string): Promise<void> {
  await deps.prisma.contentJob.updateMany({ where: { id: jobId, status: "PROCESSING" }, data: { status: "QUEUED", claimedAt: null } });
}

async function runJob(deps: RunnerDeps, job: Claimed): Promise<number> {
  const started = Date.now();
  const budget = deps.budgetMs ?? TICK_BUDGET_MS;
  const scope = scopeOf(job);
  let processed = 0;

  while (true) {
    if (await isCancelled(deps, job.id)) return processed;
    if (!(await stillAuthorized(deps, job))) {
      deps.log("warn", "content-jobs aktör yetkisini kaybetti", { jobId: job.id });
      await finish(deps, job.id, "FAILED", "actor_not_authorized");
      return processed;
    }
    const chunk: { item: Candidate; expectedStatus: string | null }[] =
      job.kind === "UNDO"
        ? (await restorableItems(deps.prisma, job.undoOfId!, job.id, CHUNK)).map((r) => ({ item: { type: r.type, id: r.id }, expectedStatus: r.toStatus }))
        : (await nextCandidates(deps.prisma, job.id, job.userId, job.kind as JobAction, scope, job.cutoffAt, CHUNK)).map((item) => ({ item, expectedStatus: null }));
    if (chunk.length === 0) {
      await finish(deps, job.id, "DONE", null);
      return processed;
    }
    for (const { item, expectedStatus } of chunk) {
      if (await isCancelled(deps, job.id)) return processed;
      const action = job.kind === "UNDO" ? "RESTORE" : (job.kind as JobAction);
      let result: Awaited<ReturnType<typeof processItem>>;
      try {
        result = await processItem(deps, job, item, action, expectedStatus);
      } catch (err) {
        deps.log("error", "content-jobs öğe işlenemedi", { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
        result = { result: "FAILED", from: null, to: null, detail: "error" };
      }
      await record(deps, job.id, item, result);
      await deps.afterItem?.(job.id, processed);
      processed++;
    }
    if (Date.now() - started > budget) {
      await requeue(deps, job.id);
      return processed;
    }
  }
}

/** Bir tur: sıradaki işi (varsa) bütçe dolana veya bitene kadar işler. Tekrar çağrı zararsızdır. */
export async function runContentJobs(deps: RunnerDeps): Promise<{ jobs: number; processed: number }> {
  const job = await claimNext(deps.prisma, deps.now());
  if (!job) return { jobs: 0, processed: 0 };
  try {
    return { jobs: 1, processed: await runJob(deps, job) };
  } catch (err) {
    deps.log("error", "content-jobs iş başarısız", { jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    await finish(deps, job.id, "FAILED", "runner_error");
    return { jobs: 1, processed: 0 };
  }
}

/** API sürecinde periyodik çalıştırıcı; tur içinde çakışma yok (bayrak), süreç kapanırken durdurulur. */
export function startContentJobRunner(deps: RunnerDeps, intervalMs = RUNNER_INTERVAL_MS): { stop(): void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runContentJobs(deps)
      .catch((err) => deps.log("error", "content-jobs turu başarısız", { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
