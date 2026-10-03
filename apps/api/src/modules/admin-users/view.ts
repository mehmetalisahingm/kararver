// admin.users.* cevap görünümleri — sözleşme: contracts/domains/admin.ts (AdminUserSummary, AdminUserDetail, Sanction,
// AdminUserReport, AdminUserActivity). Avatar yalnız APPROVED görselin public anahtarıyla URL olur.
import type { ActivityRow, AdminUserDetailRow, AdminUserRow, ReportRow, SanctionRow, UserRef } from "./store.ts";

export function toPublicUser(u: UserRef, mediaBase: string) {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarPublicKey ? `${mediaBase}/${u.avatarPublicKey}` : null };
}

export function toSanction(s: SanctionRow, mediaBase: string) {
  return {
    id: s.id,
    type: s.type,
    reason: s.reason,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt?.toISOString() ?? null,
    liftedAt: s.liftedAt?.toISOString() ?? null,
    createdBy: toPublicUser(s.createdBy, mediaBase),
    liftedBy: s.liftedBy ? toPublicUser(s.liftedBy, mediaBase) : null,
    liftReason: s.liftReason,
  };
}

export function toAdminUserSummary(u: AdminUserRow, mediaBase: string) {
  return {
    ...toPublicUser(u, mediaBase),
    email: u.email,
    status: u.status,
    // Kullanıcı başına tek global rol; satır yoksa USER.
    roles: [u.role ?? "USER"],
    createdAt: u.createdAt.toISOString(),
    reportCount: u.reportCount,
  };
}

export function toAdminUserDetail(u: AdminUserDetailRow, mediaBase: string) {
  return {
    ...toAdminUserSummary(u, mediaBase),
    emailVerified: u.emailVerified,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    stats: u.stats,
    activeSanctions: u.activeSanctions.map((s) => toSanction(s, mediaBase)),
  };
}

export function toReport(r: ReportRow) {
  return { ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null };
}

export function toActivity(a: ActivityRow) {
  return { ...a, createdAt: a.createdAt.toISOString() };
}
