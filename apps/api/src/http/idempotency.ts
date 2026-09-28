// Idempotency-Key (API_CONTRACTS.md §4.5): başlık okuma ve PostgreSQL üzerinde "tekrar mı?" kontrolü.
// Kapsam kullanıcı + route + anahtar; kayıt işlemle aynı transaction'da en sonda eklenir. Aynı anahtarla
// gelen eşzamanlı istek unique index'te bekler; çakışınca kendi işi geri alınır ve kayıtlı sonuç döner.
// Not: polls modülü (KV-10) aynı mantığın kendi kopyasını kullanıyor; ayrı bir refactor PR'ında buraya taşınacak.
import { createHash } from "node:crypto";
import { headers, IdempotencyKey } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.ts";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyScope = { userId: string; route: string; key: string; requestHash: string; now: Date };

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

export type Replay = { resourceId: string; status: number };

function keyReused(): ApiError {
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

/** Süresi dolmamış kayıt varsa tekrar bilgisi; farklı gövdeyle kullanılmışsa 409 IDEMPOTENCY_KEY_REUSED. */
export async function findReplay(prisma: PrismaClient, scope: IdempotencyScope): Promise<Replay | null> {
  const row = await prisma.idempotencyKey.findUnique({
    where: { userId_route_key: { userId: scope.userId, route: scope.route, key: scope.key } },
  });
  if (!row || row.expiresAt <= scope.now) return null;
  if (row.requestHash !== scope.requestHash) throw keyReused();
  return { resourceId: row.resourceId, status: row.responseStatus };
}

/**
 * İşi transaction'da çalıştırır. İş bir kaynak oluşturursa (ok) kayıt aynı transaction'da eklenir;
 * reddederse (ok: false) hiçbir şey yazılmaz. Scope null ise sadece transaction.
 */
export async function runIdempotent<R>(
  prisma: PrismaClient,
  scope: IdempotencyScope | null,
  status: number,
  work: (tx: Tx) => Promise<{ ok: true; value: string } | { ok: false; reason: R }>,
): Promise<{ ok: true; value: string; replayed: boolean } | { ok: false; reason: R }> {
  if (scope) {
    const earlier = await findReplay(prisma, scope);
    if (earlier) return { ok: true, value: earlier.resourceId, replayed: true };
    const where = { userId: scope.userId, route: scope.route, key: scope.key };
    await prisma.idempotencyKey.deleteMany({ where: { ...where, expiresAt: { lte: scope.now } } });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const outcome = await work(tx);
      if (outcome.ok && scope) {
        await tx.idempotencyKey.create({
          data: {
            userId: scope.userId,
            route: scope.route,
            key: scope.key,
            requestHash: scope.requestHash,
            responseStatus: status,
            resourceId: outcome.value,
            createdAt: scope.now,
            expiresAt: new Date(scope.now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
      }
      return outcome;
    });
    return result.ok ? { ok: true, value: result.value, replayed: false } : result;
  } catch (err) {
    if (!scope || !isKeyConflict(err)) throw err;
    const later = await findReplay(prisma, scope);
    if (!later) throw err;
    return { ok: true, value: later.resourceId, replayed: true };
  }
}
