// Yönetici kullanıcı işlemleri — KV-33 (#35). Üretim uygulaması: prisma-store.ts. Kurallar: docs/KV-33_ADMIN_USERS.md,
// DATA_MODEL §9.1 (yaptırım servis kuralları), KV-04 (yetki).
//
// Her değiştiren işlem tek transaction'dadır: hedef kullanıcı satırı kilitlenir, gerekirse SUPER_ADMIN rol satırları
// kilitlenir, yetki o transaction'da taze okunan aktör/hedefle yeniden verilir; ardından yaptırım/rol, users.status
// senkronu, (SUSPEND/BAN'da) oturum iptali ve audit kaydı (writeAudit) aynı transaction'da yazılır.
import type { Role, SanctionType, UserStatus } from "@kararver/db";
import type { IdempotencyScope, IdempotentResult } from "../../http/idempotency.ts";

export type UserRef = { id: string; username: string; displayName: string; avatarPublicKey: string | null };

export type SanctionRow = {
  id: string;
  type: SanctionType;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
  liftedAt: Date | null;
  liftReason: string | null;
  createdAt: Date;
  createdBy: UserRef;
  liftedBy: UserRef | null;
};

export type AdminUserRow = UserRef & {
  email: string;
  status: UserStatus;
  /** user_roles satırı; yoksa null (USER). */
  role: Role | null;
  createdAt: Date;
  /** Hesaba veya içeriğine (anket, yorum, görsel) yapılan raporlar, her durumda. */
  reportCount: number;
};

export type AdminUserDetailRow = AdminUserRow & {
  emailVerified: boolean;
  lastLoginAt: Date | null;
  stats: { pollCount: number; commentCount: number; voteCount: number };
  activeSanctions: SanctionRow[];
};

export type UserListFilter = {
  q?: string;
  status?: UserStatus;
  /** Keyset: id azalan (UUIDv7 ≈ kayıt zamanı). */
  afterId: string | null;
};

export type TimeCursor = { createdAt: Date; id: string } | null;

export type ReportSide = "against" | "filed";
export type ReportRow = {
  id: string;
  target: { type: "POLL" | "COMMENT" | "MEDIA" | "USER"; id: string };
  reason: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
  createdAt: Date;
  resolvedAt: Date | null;
};

export type ActivityRow = {
  kind: "POLL" | "COMMENT";
  id: string;
  pollId: string;
  excerpt: string;
  status: "ACTIVE" | "HIDDEN" | "UNDER_REVIEW" | "LOCKED" | "REMOVED";
  createdAt: Date;
};

/** Yetki için hedef: rol ve silinmişlik DB'den okunur (KV-04 §4.2). */
export type TargetInfo = { id: string; role: Role | null; status: UserStatus; deleted: boolean };

/**
 * KV-04 `roleAssignment` kuralına verilecek aktif SUPER_ADMIN sayısı. Kural "son aktif SUPER_ADMIN düşürülemez" der;
 * ACTIVE olmayan veya silinmiş bir SUPER_ADMIN'i düşürmek aktif sayıyı azaltmaz, bu yüzden o hedef sayıya eklenir.
 * Handler'daki istek öncesi karar ve store'daki transaction içi karar aynı hesabı kullanır.
 */
export function superAdminCountForRoleRule(activeSuperAdmins: number, target: Pick<TargetInfo, "role" | "status" | "deleted">): number {
  const targetCounted = target.status === "ACTIVE" && !target.deleted;
  return target.role === "SUPER_ADMIN" && !targetCounted ? activeSuperAdmins + 1 : activeSuperAdmins;
}

/** Bütün değiştiren işlemlerde: audit kaydının aktörü, request id'si ve işlem anı. */
export type Mutation = { actorId: string; requestId: string; now: Date };

/** reportId (KV-37): moderasyon kuyruğundan uygulanan yaptırım; rapor, hedefin sahibi bu kullanıcı olan bir rapor olmalı. */
export type ApplyInput = Mutation & { userId: string; type: SanctionType; reason: string; endsAt: Date | null; reportId?: string };
export type LiftInput = Mutation & { userId: string; sanctionId: string; reason: string };
export type RoleInput = Mutation & { userId: string; role: Role; reason: string };

/** Transaction içi yeniden kontrolün sonucu: hedef yok, iş kuralı veya taze yetki reddi. */
export type ApplyRejection = "not_found" | "already_active" | "user_deleted" | "last_super_admin" | "forbidden" | "report_not_found" | "report_mismatch";
export type LiftRejection = "not_found" | "already_lifted" | "expired" | "forbidden";
export type RoleRejection = "not_found" | "last_super_admin" | "self" | "forbidden";

export type RoleResult =
  | { kind: "changed" | "unchanged"; role: Role }
  | { kind: "rejected"; reason: RoleRejection };

export interface AdminUserStore {
  listSessions(userId: string, afterId: string | null, limit: number, now: Date): Promise<Array<{ id: string; createdAt: Date; expiresAt: Date; lastSeenAt: Date | null; ipAddress: string | null; userAgent: string | null }>>;
  revokeSessions(input: Mutation & { userId: string; sessionId?: string; reason: string }): Promise<number | null>;
  list(filter: UserListFilter, limit: number): Promise<AdminUserRow[]>;
  get(id: string, now: Date): Promise<AdminUserDetailRow | null>;
  target(id: string): Promise<TargetInfo | null>;
  /** status = ACTIVE ve silinmemiş SUPER_ADMIN sayısı (yetki kararının girdisi; transaction'da yeniden sayılır). */
  activeSuperAdminCount(): Promise<number>;
  findSanction(userId: string, sanctionId: string): Promise<SanctionRow | null>;
  listSanctions(userId: string, after: TimeCursor, limit: number): Promise<SanctionRow[]>;
  listReports(userId: string, side: ReportSide, after: TimeCursor, limit: number): Promise<ReportRow[]>;
  listActivity(userId: string, after: TimeCursor, limit: number): Promise<ActivityRow[]>;

  /** Yaptırım uygular. Idempotency key verilmişse kayıt aynı transaction'da yazılır (key-optional). */
  applySanction(scope: IdempotencyScope | null, input: ApplyInput): Promise<IdempotentResult | { kind: "rejected"; reason: ApplyRejection }>;
  liftSanction(input: LiftInput): Promise<{ kind: "lifted" } | { kind: "rejected"; reason: LiftRejection }>;
  setRole(input: RoleInput): Promise<RoleResult>;
}
