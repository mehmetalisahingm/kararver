// AuthStore'un PostgreSQL/Prisma uygulaması. Tablolar: users, sessions, auth_tokens (DATA_MODEL.md).
import type { PrismaClient } from "@kararver/db";
import { grantInitialLoginPoints, PUBLISH_COST } from "../points/store.ts";
import type { AuthStore, NewToken, UserRecord } from "./store.ts";

const userSelect = {
  id: true,
  email: true,
  emailNormalized: true,
  username: true,
  displayName: true,
  passwordHash: true,
  status: true,
  emailVerifiedAt: true,
  bio: true,
  createdAt: true,
  deletedAt: true,
  avatarMedia: { select: { status: true, publicObjectKey: true } },
} as const;

type SelectedUser = Omit<UserRecord, "avatarPublicKey"> & {
  avatarMedia: { status: string; publicObjectKey: string | null } | null;
};

function toRecord({ avatarMedia, ...user }: SelectedUser): UserRecord {
  const avatarPublicKey = avatarMedia?.status === "APPROVED" ? avatarMedia.publicObjectKey : null;
  return { ...user, avatarPublicKey };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export function createPrismaAuthStore(prisma: PrismaClient): AuthStore {
  async function findUserBy(where: { id: string } | { emailNormalized: string }): Promise<UserRecord | null> {
    const user = await prisma.user.findUnique({ where, select: userSelect });
    return user ? toRecord(user) : null;
  }

  async function consumeToken(
    tx: Pick<PrismaClient, "authToken">,
    tokenHash: string,
    purpose: NewToken["purpose"],
    now: Date,
  ): Promise<string | null> {
    // Koşullu update: aynı token'la gelen paralel istekten sadece biri kazanır.
    const consumed = await tx.authToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return null;
    const token = await tx.authToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
    return token.userId;
  }

  return {
    findUserByEmail: (emailNormalized) => findUserBy({ emailNormalized }),
    findUserById: (id) => findUserBy({ id }),

    async usernameExists(usernameNormalized) {
      return (await prisma.user.count({ where: { usernameNormalized } })) > 0;
    },

    async createUser(user, token) {
      try {
        const created = await prisma.user.create({
          data: { ...user, authTokens: { create: token } },
          select: userSelect,
        });
        return { ok: true, user: toRecord(created) };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const emailTaken = (await prisma.user.count({ where: { emailNormalized: user.emailNormalized } })) > 0;
        return { ok: false, conflict: emailTaken ? "email" : "username" };
      }
    },

    async issueToken(userId, token, now) {
      await prisma.$transaction([
        prisma.authToken.updateMany({ where: { userId, purpose: token.purpose, usedAt: null }, data: { usedAt: now } }),
        prisma.authToken.create({ data: { userId, ...token } }),
      ]);
    },

    async createSession(session, now, initialGrant) {
      await prisma.$transaction(async (tx) => {
        // Login grant'i hesap başına tam bir kez: paralel loginleri kullanıcı satırı üzerinden sırala.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${session.userId}::uuid FOR UPDATE`;
        await tx.session.create({ data: { ...session, lastSeenAt: now } });
        await tx.user.update({ where: { id: session.userId }, data: { lastLoginAt: now } });
        await grantInitialLoginPoints(tx, session.userId, now, initialGrant);
      });
    },

    findSession: (tokenHash) =>
      prisma.session.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true, lastSeenAt: true },
      }),

    async touchSession(id, now) {
      await prisma.session.update({ where: { id }, data: { lastSeenAt: now } });
    },

    async revokeSession(id, now) {
      await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
    },

    verifyEmail: (tokenHash, now) =>
      prisma.$transaction(async (tx) => {
        const userId = await consumeToken(tx, tokenHash, "EMAIL_VERIFICATION", now);
        if (!userId) return false;
        await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
        return true;
      }),

    resetPassword: (tokenHash, passwordHash, now) =>
      prisma.$transaction(async (tx) => {
        const userId = await consumeToken(tx, tokenHash, "PASSWORD_RESET", now);
        if (!userId) return false;
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        // Sıfırlama bağlantısı e-postaya ulaşıldığını kanıtlar.
        await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
        await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.authToken.updateMany({ where: { userId, purpose: "PASSWORD_RESET", usedAt: null }, data: { usedAt: now } });
        return true;
      }),

    async isUsableAvatar(userId, mediaId) {
      const count = await prisma.mediaAsset.count({
        where: { id: mediaId, uploaderId: userId, purpose: "AVATAR", status: { not: "REJECTED" } },
      });
      return count > 0;
    },

    async updateProfile(userId, patch) {
      const user = await prisma.user.update({ where: { id: userId }, data: patch, select: userSelect });
      return toRecord(user);
    },

    async getPointsSummary(userId, publishCost) {
      const account = await prisma.pointAccount.findUnique({ where: { userId }, select: { balance: true } });
      return { balance: account?.balance ?? 0, publishCost: publishCost ?? PUBLISH_COST };
    },

    async listPointLedger(userId, after, limit) {
      return prisma.pointLedgerEntry.findMany({
        where: {
          userId,
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: { id: true, delta: true, balanceAfter: true, reason: true, referenceId: true, createdAt: true },
      });
    },
  };
}
