// AuthStore'un bellek içi uygulaması. Sadece test içindir; aynı senaryolar DB varken
// PrismaAuthStore ile de koşar (test/auth.test.ts), iki uygulama arasındaki fark orada yakalanır.
import { randomUUID } from "node:crypto";
import { INITIAL_LOGIN_GRANT, PUBLISH_COST } from "../../src/modules/points/store.ts";
import type { AuthStore, NewToken, PointLedgerRecord, SessionRecord, UserRecord } from "../../src/modules/auth/store.ts";

type StoredUser = Omit<UserRecord, "avatarPublicKey"> & { usernameNormalized: string; avatarMediaId: string | null; lastLoginAt: Date | null };
type StoredToken = NewToken & { userId: string; usedAt: Date | null };
type StoredMedia = { id: string; uploaderId: string; purpose: "AVATAR" | "POLL"; status: "PENDING" | "APPROVED" | "QUARANTINED" | "REJECTED"; publicKey: string | null };

export type MemoryAuthStore = AuthStore & {
  users: Map<string, StoredUser>;
  sessions: Map<string, SessionRecord & { tokenHash: string }>;
  tokens: StoredToken[];
  media: Map<string, StoredMedia>;
  pointBalances: Map<string, number>;
  pointLedger: Map<string, PointLedgerRecord[]>;
};

export function createMemoryAuthStore(): MemoryAuthStore {
  const users = new Map<string, StoredUser>();
  const sessions = new Map<string, SessionRecord & { tokenHash: string }>();
  const tokens: StoredToken[] = [];
  const media = new Map<string, StoredMedia>();
  const pointBalances = new Map<string, number>();
  const pointLedger = new Map<string, PointLedgerRecord[]>();

  function toRecord(user: StoredUser): UserRecord {
    const { usernameNormalized: _u, avatarMediaId, lastLoginAt: _l, ...rest } = user;
    const avatar = avatarMediaId ? media.get(avatarMediaId) : undefined;
    return { ...rest, avatarPublicKey: avatar?.status === "APPROVED" ? avatar.publicKey : null };
  }

  function consume(tokenHash: string, purpose: NewToken["purpose"], now: Date): string | null {
    const token = tokens.find((t) => t.tokenHash === tokenHash && t.purpose === purpose && !t.usedAt && t.expiresAt > now);
    if (!token) return null;
    token.usedAt = now;
    return token.userId;
  }

  return {
    users,
    sessions,
    tokens,
    media,
    pointBalances,
    pointLedger,

    async findUserByEmail(emailNormalized) {
      const user = [...users.values()].find((u) => u.emailNormalized === emailNormalized);
      return user ? toRecord(user) : null;
    },
    async findUserById(id) {
      const user = users.get(id);
      return user ? toRecord(user) : null;
    },
    async usernameExists(usernameNormalized) {
      return [...users.values()].some((u) => u.usernameNormalized === usernameNormalized);
    },
    async createUser(user, token) {
      const all = [...users.values()];
      if (all.some((u) => u.emailNormalized === user.emailNormalized)) return { ok: false, conflict: "email" };
      if (all.some((u) => u.usernameNormalized === user.usernameNormalized)) return { ok: false, conflict: "username" };
      const stored: StoredUser = {
        ...user,
        id: randomUUID(),
        status: "ACTIVE",
        emailVerifiedAt: null,
        bio: null,
        avatarMediaId: null,
        lastLoginAt: null,
        createdAt: new Date(),
        deletedAt: null,
      };
      users.set(stored.id, stored);
      tokens.push({ ...token, userId: stored.id, usedAt: null });
      return { ok: true, user: toRecord(stored) };
    },
    async issueToken(userId, token, now) {
      for (const t of tokens) if (t.userId === userId && t.purpose === token.purpose && !t.usedAt) t.usedAt = now;
      tokens.push({ ...token, userId, usedAt: null });
    },
    async createSession(session, now) {
      const id = randomUUID();
      sessions.set(id, { id, userId: session.userId, tokenHash: session.tokenHash, expiresAt: session.expiresAt, revokedAt: null, lastSeenAt: now });
      users.get(session.userId)!.lastLoginAt = now;
      const ledger = pointLedger.get(session.userId) ?? [];
      if (!ledger.some((entry) => entry.reason === "INITIAL_GRANT")) {
        const balance = (pointBalances.get(session.userId) ?? 0) + INITIAL_LOGIN_GRANT;
        pointBalances.set(session.userId, balance);
        ledger.push({ id: randomUUID(), delta: INITIAL_LOGIN_GRANT, balanceAfter: balance, reason: "INITIAL_GRANT", referenceId: null, createdAt: now });
        pointLedger.set(session.userId, ledger);
      }
    },
    async findSession(tokenHash) {
      const session = [...sessions.values()].find((s) => s.tokenHash === tokenHash);
      if (!session) return null;
      const { tokenHash: _t, ...record } = session;
      return record;
    },
    async touchSession(id, now) {
      sessions.get(id)!.lastSeenAt = now;
    },
    async revokeSession(id, now) {
      const session = sessions.get(id);
      if (session && !session.revokedAt) session.revokedAt = now;
    },
    async verifyEmail(tokenHash, now) {
      const userId = consume(tokenHash, "EMAIL_VERIFICATION", now);
      if (!userId) return false;
      const user = users.get(userId)!;
      user.emailVerifiedAt ??= now;
      return true;
    },
    async resetPassword(tokenHash, passwordHash, now) {
      const userId = consume(tokenHash, "PASSWORD_RESET", now);
      if (!userId) return false;
      const user = users.get(userId)!;
      user.passwordHash = passwordHash;
      user.emailVerifiedAt ??= now;
      for (const s of sessions.values()) if (s.userId === userId && !s.revokedAt) s.revokedAt = now;
      for (const t of tokens) if (t.userId === userId && t.purpose === "PASSWORD_RESET" && !t.usedAt) t.usedAt = now;
      return true;
    },
    async isUsableAvatar(userId, mediaId) {
      const m = media.get(mediaId);
      return !!m && m.uploaderId === userId && m.purpose === "AVATAR" && m.status !== "REJECTED";
    },
    async updateProfile(userId, patch) {
      const user = users.get(userId)!;
      if (patch.displayName !== undefined) user.displayName = patch.displayName;
      if (patch.bio !== undefined) user.bio = patch.bio;
      if (patch.avatarMediaId !== undefined) user.avatarMediaId = patch.avatarMediaId;
      return toRecord(user);
    },
    async getPointsSummary(userId) {
      return { balance: pointBalances.get(userId) ?? 0, publishCost: PUBLISH_COST };
    },
    async listPointLedger(userId, after, limit) {
      const entries = [...(pointLedger.get(userId) ?? [])].sort((a, b) => {
        const byDate = b.createdAt.getTime() - a.createdAt.getTime();
        return byDate || b.id.localeCompare(a.id);
      });
      const filtered = after
        ? entries.filter((entry) => entry.createdAt < after.createdAt || (entry.createdAt.getTime() === after.createdAt.getTime() && entry.id < after.id))
        : entries;
      return filtered.slice(0, limit);
    },
  };
}
