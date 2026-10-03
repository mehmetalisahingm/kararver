import type { PrismaClient } from "@kararver/db";
import { ApiError } from "../../http/errors.ts";
import { idempotencyKeyReused, runIdempotent, type IdempotencyScope } from "../../http/idempotency.ts";
import { writeAudit } from "../audit/write.ts";
import type { PointLedgerRecord } from "../auth/store.ts";
import { InsufficientPointsError } from "./store.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type PointAdjustment = {
  targetUserId: string;
  delta: number;
  reason: string;
  actorId: string;
  requestId: string;
  now: Date;
  scope: IdempotencyScope;
};

export interface PointAdminStore {
  adjust(input: PointAdjustment): Promise<PointLedgerRecord>;
}

function record(row: {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: "INITIAL_GRANT" | "PUBLISH" | "ADMIN_ADJUSTMENT" | "MODERATION_REFUND";
  referenceId: string | null;
  createdAt: Date;
}): PointLedgerRecord {
  return row;
}

async function applyAdjustment(tx: Tx, input: PointAdjustment): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } });
  if (!user) throw new ApiError("NOT_FOUND", "Kullanıcı bulunamadı.");

  await tx.pointAccount.upsert({
    where: { userId: input.targetUserId },
    create: { userId: input.targetUserId, balance: 0, updatedAt: input.now },
    update: {},
  });

  let balanceAfter: number;
  if (input.delta > 0) {
    const account = await tx.pointAccount.update({
      where: { userId: input.targetUserId },
      data: { balance: { increment: input.delta }, updatedAt: input.now },
      select: { balance: true },
    });
    balanceAfter = account.balance;
  } else {
    const cost = -input.delta;
    const changed = await tx.$queryRaw<Array<{ balance: number }>>`
      UPDATE point_accounts
         SET balance = balance - ${cost}, updated_at = ${input.now}
       WHERE user_id = ${input.targetUserId}::uuid
         AND balance >= ${cost}
       RETURNING balance
    `;
    const row = changed[0];
    if (!row) {
      const account = await tx.pointAccount.findUnique({ where: { userId: input.targetUserId }, select: { balance: true } });
      throw new InsufficientPointsError(account?.balance ?? 0, cost);
    }
    balanceAfter = row.balance;
  }

  const entry = await tx.pointLedgerEntry.create({
    data: {
      userId: input.targetUserId,
      delta: input.delta,
      balanceAfter,
      reason: "ADMIN_ADJUSTMENT",
      referenceId: null,
      idempotencyKey: `admin-adjust:${input.actorId}:${input.scope.key}`,
      createdAt: input.now,
    },
    select: { id: true },
  });

  await writeAudit(tx, {
    source: "API",
    actorId: input.actorId,
    action: "points.adjust",
    operation: "adjust",
    target: { type: "USER", id: input.targetUserId },
    reason: input.reason,
    before: { balance: balanceAfter - input.delta },
    after: { balance: balanceAfter, delta: input.delta },
    requestId: input.requestId,
    at: input.now,
  });

  return entry.id;
}

export function createPrismaPointAdminStore(prisma: PrismaClient): PointAdminStore {
  return {
    async adjust(input) {
      const result = await runIdempotent(prisma, input.scope, 201, async (tx) => ({
        ok: true as const,
        value: await applyAdjustment(tx, input),
      }));
      if (result.kind === "key_reused") throw idempotencyKeyReused();
      if (result.kind === "rejected") throw new Error("point adjustment unexpectedly rejected");

      const row = await prisma.pointLedgerEntry.findUnique({
        where: { id: result.resourceId },
        select: { id: true, delta: true, balanceAfter: true, reason: true, referenceId: true, createdAt: true },
      });
      if (!row) throw new Error("point adjustment ledger row missing");
      return record(row);
    },
  };
}
