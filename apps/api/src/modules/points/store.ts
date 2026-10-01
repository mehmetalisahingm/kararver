// V1 #67 — yayın puanı çekirdeği. Güven/itibar puanından ayrıdır.
// İlk başarılı giriş +20; başarılı anket/tartışma yayını -10. Bütün yazmalar ledger + bakiye ile aynı transaction'dadır.
import type { PrismaClient } from "@kararver/db";
import { ApiError } from "../../http/errors.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const INITIAL_LOGIN_GRANT = 20;
export const PUBLISH_COST = 10;
const INITIAL_GRANT_KEY = "initial-login";

export class InsufficientPointsError extends ApiError {
  readonly balance: number;
  readonly cost: number;

  constructor(balance: number, cost: number) {
    super("INSUFFICIENT_POINTS", "Yayın için yeterli puanınız yok.", [
      { code: "balance", value: balance },
      { code: "publish_cost", value: cost },
    ]);
    this.balance = balance;
    this.cost = cost;
  }
}

/**
 * Çağıran transaction kullanıcı satırını FOR UPDATE kilitlemelidir. Böylece iki paralel login aynı
 * hesabın ilk grant'ini yarıştıramaz. Unique (user_id, idempotency_key) ikinci savunma hattıdır.
 */
export async function grantInitialLoginPoints(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.pointAccount.upsert({
    where: { userId },
    create: { userId, balance: 0, updatedAt: now },
    update: {},
  });

  const alreadyGranted = await tx.pointLedgerEntry.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: INITIAL_GRANT_KEY } },
    select: { id: true },
  });
  if (alreadyGranted) return;

  const account = await tx.pointAccount.update({
    where: { userId },
    data: { balance: { increment: INITIAL_LOGIN_GRANT }, updatedAt: now },
    select: { balance: true },
  });
  await tx.pointLedgerEntry.create({
    data: {
      userId,
      delta: INITIAL_LOGIN_GRANT,
      balanceAfter: account.balance,
      reason: "INITIAL_GRANT",
      referenceId: null,
      idempotencyKey: INITIAL_GRANT_KEY,
      createdAt: now,
    },
  });
}

/**
 * Yayın transaction'ının içinden çağrılır. Koşullu UPDATE negatif bakiyeyi DB seviyesinde engeller;
 * yayın sonradan hata verirse aynı transaction rollback olduğu için harcama da geri alınır.
 */
export async function spendPublishPoints(
  tx: Tx,
  input: { userId: string; referenceId: string; idempotencyKey: string; now: Date; cost?: number },
): Promise<number> {
  const cost = input.cost ?? PUBLISH_COST;
  if (cost <= 0) {
    const account = await tx.pointAccount.findUnique({ where: { userId: input.userId }, select: { balance: true } });
    return account?.balance ?? 0;
  }

  await tx.pointAccount.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, balance: 0, updatedAt: input.now },
    update: {},
  });

  const existing = await tx.pointLedgerEntry.findUnique({
    where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
    select: { balanceAfter: true },
  });
  if (existing) return existing.balanceAfter;

  const changed = await tx.$queryRaw<Array<{ balance: number }>>`
    UPDATE point_accounts
       SET balance = balance - ${cost}, updated_at = ${input.now}
     WHERE user_id = ${input.userId}::uuid
       AND balance >= ${cost}
     RETURNING balance
  `;
  const row = changed[0];
  if (!row) {
    const account = await tx.pointAccount.findUnique({ where: { userId: input.userId }, select: { balance: true } });
    throw new InsufficientPointsError(account?.balance ?? 0, cost);
  }

  await tx.pointLedgerEntry.create({
    data: {
      userId: input.userId,
      delta: -cost,
      balanceAfter: row.balance,
      reason: "PUBLISH",
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    },
  });
  return row.balance;
}
