// Idempotency-Key (API_CONTRACTS.md §4.5): başlık okuma ve PostgreSQL üzerinde "tekrar mı?" kontrolü.
// Kapsam kullanıcı + route + anahtar; kayıt işlemle aynı transaction'da en sonda eklenir. Aynı anahtarla
// gelen eşzamanlı istek unique index'te bekler; çakışınca kendi işi geri alınır ve kayıtlı sonuç döner.
// Bütün modüller (polls, comments) bu tek uygulamayı kullanır.
import { createHash } from "node:crypto";
import { headers, IdempotencyKey } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyScope = { userId: string; route: string; key: string; requestHash: string; now: Date };

export type IdempotentResult =
  | { kind: "created"; resourceId: string }
  | { kind: "replayed"; resourceId: string; status: number }
  | { kind: "key_reused" };

/**
 * İş, bir kilidi beklerken aynı anahtarlı isteğin tamamlandığını görürse fırlatılır (assertNoCommittedKey).
 * runIdempotent bunu yakalar ve limit/doğrulama hatası yerine kayıtlı sonucu döner.
 */
export class IdempotencyRace extends Error {}

/** Başlık yoksa null (key-optional) veya 400 IDEMPOTENCY_KEY_REQUIRED (key-required). */
export function readIdempotencyScope(
  request: FastifyRequest,
  opts: { userId: string; route: string; body: unknown; now: Date; required: boolean },
): IdempotencyScope | null {
  const raw = request.headers[headers.idempotencyKey.toLowerCase()];
  if (raw === undefined) {
    if (opts.required) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key başlığı gerekli.");
    return null;
  }
  const key = IdempotencyKey.safeParse(raw);
  if (!key.success) {
    throw new ApiError("VALIDATION_ERROR", "Idempotency-Key geçersiz.", [{ field: headers.idempotencyKey, code: "invalid_format" }]);
  }
  const requestHash = createHash("sha256").update(JSON.stringify(opts.body ?? null)).digest("hex");
  return { userId: opts.userId, route: opts.route, key: key.data, requestHash, now: opts.now };
}

export function idempotencyKeyReused(): ApiError {
  return new ApiError("IDEMPOTENCY_KEY_REUSED", "Bu Idempotency-Key farklı bir istekle kullanılmış.");
}

function isKeyConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002" &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("key")
  );
}

const byScope = (scope: IdempotencyScope) => ({ userId_route_key: { userId: scope.userId, route: scope.route, key: scope.key } });

/** Süresi dolmamış kayıt varsa sonucu; aynı anahtar farklı gövdeyle kullanılmışsa key_reused. */
export async function findIdempotentResult(prisma: PrismaClient, scope: IdempotencyScope): Promise<IdempotentResult | null> {
  const row = await prisma.idempotencyKey.findUnique({ where: byScope(scope) });
  if (!row || row.expiresAt <= scope.now) return null;
  if (row.requestHash !== scope.requestHash) return { kind: "key_reused" };
  return { kind: "replayed", resourceId: row.resourceId, status: row.responseStatus };
}

/** Kilit alındıktan sonra çağrılır: bekleme sırasında aynı anahtarlı istek commit ettiyse IdempotencyRace. */
export async function assertNoCommittedKey(tx: Tx, scope: IdempotencyScope): Promise<void> {
  const row = await tx.idempotencyKey.findUnique({ where: byScope(scope), select: { expiresAt: true } });
  if (row && row.expiresAt > scope.now) throw new IdempotencyRace();
}

/**
 * İşi transaction'da çalıştırır. İş bir kaynak oluşturursa (ok) kayıt aynı transaction'da eklenir;
 * reddederse (ok: false) hiçbir şey yazılmaz ve "rejected" döner. Scope null ise sadece transaction.
 */
export async function runIdempotent<R = never>(
  prisma: PrismaClient,
  scope: IdempotencyScope | null,
  status: number,
  work: (tx: Tx) => Promise<{ ok: true; value: string } | { ok: false; reason: R }>,
): Promise<IdempotentResult | { kind: "rejected"; reason: R }> {
  if (scope) {
    const earlier = await findIdempotentResult(prisma, scope);
    if (earlier) return earlier;
    await prisma.idempotencyKey.deleteMany({
      where: { userId: scope.userId, route: scope.route, key: scope.key, expiresAt: { lte: scope.now } },
    });
  }
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const result = await work(tx);
      if (result.ok && scope) {
        await tx.idempotencyKey.create({
          data: {
            userId: scope.userId,
            route: scope.route,
            key: scope.key,
            requestHash: scope.requestHash,
            responseStatus: status,
            resourceId: result.value,
            createdAt: scope.now,
            expiresAt: new Date(scope.now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
      }
      return result;
    });
    return outcome.ok ? { kind: "created", resourceId: outcome.value } : { kind: "rejected", reason: outcome.reason };
  } catch (err) {
    if (!scope || !(err instanceof IdempotencyRace || isKeyConflict(err))) throw err;
    const later = await findIdempotentResult(prisma, scope);
    if (!later) throw err;
    return later;
  }
}
