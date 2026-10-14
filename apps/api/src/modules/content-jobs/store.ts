// Kullanıcıya ait içeriğin toplu gizlenmesi/kaldırılması — #181. Üretim uygulaması: prisma-store.ts; işleyen: runner.ts.
// Kurallar ve sınırlar: docs/KV-33_ADMIN_USERS.md §9.
import type { ContentStatus } from "../moderation/store.ts";

export type JobAction = "HIDE" | "REMOVE";
export type JobScope = "all" | "polls" | "comments";
export type JobKind = JobAction | "UNDO";
export type JobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED" | "CANCELLED";

export type Counts = { polls: number; comments: number };

export type JobRow = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  includePolls: boolean;
  includeComments: boolean;
  reason: string;
  expectedPolls: number;
  expectedComments: number;
  applied: number;
  unchanged: number;
  failed: number;
  skipped: number;
  failure: string | null;
  undoOfId: string | null;
  canUndo: boolean;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type JobMutation = { actorId: string; requestId: string; now: Date };

export type CreateRejection = "not_found" | "forbidden" | "user_deleted" | "preview_expired" | "preview_stale" | "nothing_to_do" | "too_many" | "job_open";
export type UndoRejection = "not_found" | "forbidden" | "user_deleted" | "not_undoable" | "job_open";
export type CancelRejection = "not_found" | "forbidden" | "not_cancellable";

export type CreateInput = JobMutation & {
  userId: string;
  action: JobAction;
  scope: JobScope;
  cutoffAt: Date;
  expected: Counts;
  reason: string;
  maxItems: number;
  /** Önizlemenin geçerlilik süresi (cutoffAt bu kadar eskiyse preview_expired). */
  previewTtlMs: number;
};

export interface ContentJobStore {
  /** Hesap varsa uygun içerik sayıları (cutoff ve action'a göre); yoksa null. */
  preview(userId: string, action: JobAction, scope: JobScope, cutoffAt: Date): Promise<Counts | null>;
  list(userId: string, limit: number): Promise<JobRow[]>;
  create(input: CreateInput): Promise<{ kind: "created"; job: JobRow } | { kind: "rejected"; reason: CreateRejection }>;
  undo(input: JobMutation & { userId: string; jobId: string; reason: string }): Promise<{ kind: "created"; job: JobRow } | { kind: "rejected"; reason: UndoRejection }>;
  cancel(input: JobMutation & { userId: string; jobId: string; reason: string }): Promise<{ kind: "cancelled"; job: JobRow } | { kind: "rejected"; reason: CancelRejection }>;
}

export const scopeOf = (row: Pick<JobRow, "includePolls" | "includeComments">): JobScope =>
  row.includePolls && row.includeComments ? "all" : row.includePolls ? "polls" : "comments";

export type { ContentStatus };
