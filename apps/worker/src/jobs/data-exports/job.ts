// data-exports.build — #181 KVKK veri dışa aktarma. Kurallar ve kapsam: docs/KV-33_ADMIN_USERS.md §8.
//
// Her turda (dakikada bir): 1) süresi dolan paketleri siler (nesne + anahtar + token), 2) bekleyen talepleri sırayla işler.
// - Talep tek SQL ifadesiyle sahiplenilir (FOR UPDATE SKIP LOCKED): iki worker aynı talebi almaz. PROCESSING'de takılan
//   (worker çöktü) talep STALE_CLAIM_MS sonra yeniden alınır.
// - Paket: JSON → gzip → AES-256-GCM (rastgele anahtar, AAD = talep id'si). Nesne anahtarı denemeye özgüdür; bir deneme
//   kaybederse (talep başka worker'a geçti) kendi nesnesini siler, böylece satırdaki anahtarla çözülemeyen nesne kalmaz.
// - Başarısızlıkta talep FAILED + kısa hata kodu olur (ham hata metni DB'ye yazılmaz); yönetici yeni talep açar.
// - İdempotent: tekrar çalışma hazır/başarısız talebe dokunmaz.
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@kararver/db";
import { collectPackage, PackageTooLargeError } from "./collect.ts";
import { encryptPackage, newPackageKey } from "./crypto.ts";

export const DATA_EXPORTS_QUEUE = "data-exports.build";
export const DATA_EXPORTS_CRON = "* * * * *";
/** Hazır paketin saklanma süresi; sonra nesne ve anahtar silinir (EXPIRED). */
export const PACKAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** PROCESSING'de bu süreden uzun kalan talep takılmış sayılır ve yeniden alınır. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;
/** Şifrelenmeden önceki JSON üst sınırı. */
export const MAX_PLAIN_BYTES = 25 * 1024 * 1024;
/** Bir turda işlenen en çok talep (kalanlar sonraki turda). */
export const BATCH_SIZE = 5;

export type ExportStorage = {
  writePrivate(key: string, data: Buffer, contentType: string): Promise<void>;
  deletePrivate(key: string): Promise<void>;
};

export type DataExportDeps = {
  prisma: PrismaClient;
  storage: ExportStorage;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  /** Sadece test: paket toplama yerine (ör. hata/büyüklük senaryosu). */
  collect?: typeof collectPackage;
  /** Sadece test: talep sahiplenildikten sonra, işlemeden önce. */
  afterClaim?: (id: string) => Promise<void>;
};

export type DataExportResult = { built: number; failed: number; lost: number; expired: number };

type Claimed = { id: string; userId: string };

async function claimNext(prisma: PrismaClient, at: Date): Promise<Claimed | null> {
  const stale = new Date(at.getTime() - STALE_CLAIM_MS).toISOString();
  const now = at.toISOString();
  const rows = await prisma.$queryRaw<Claimed[]>(Prisma.sql`
    UPDATE data_exports SET status = 'PROCESSING', claimed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
    WHERE id = (
      SELECT id FROM data_exports
      WHERE status = 'PENDING' OR (status = 'PROCESSING' AND claimed_at < ${stale}::timestamptz)
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id::text AS id, user_id::text AS "userId"`);
  return rows[0] ?? null;
}

function failureCode(err: unknown): string {
  if (err instanceof PackageTooLargeError) return "too_large";
  return "build_failed";
}

async function buildOne(deps: DataExportDeps, claimed: Claimed, claimedAt: Date): Promise<"built" | "failed" | "lost"> {
  const { prisma, storage } = deps;
  const guard = { id: claimed.id, status: "PROCESSING" as const, claimedAt };
  let objectKey: string | null = null;
  try {
    await deps.afterClaim?.(claimed.id);
    const now = deps.now();
    const pkg = await (deps.collect ?? collectPackage)(prisma, claimed.userId, now);
    const json = Buffer.from(JSON.stringify(pkg));
    if (json.length > MAX_PLAIN_BYTES) throw new PackageTooLargeError(`${json.length} bayt`);
    const key = newPackageKey();
    const encrypted = encryptPackage(gzipSync(json), key, claimed.id);
    objectKey = `exports/${claimed.id}-${randomBytes(6).toString("hex")}.bin`;
    await storage.writePrivate(objectKey, encrypted, "application/octet-stream");
    const done = await prisma.dataExport.updateMany({
      where: guard,
      data: {
        status: "READY",
        objectKey,
        sizeBytes: encrypted.length,
        encKey: new Uint8Array(key),
        readyAt: now,
        expiresAt: new Date(now.getTime() + PACKAGE_TTL_MS),
        claimedAt: null,
        failure: null,
      },
    });
    if (done.count === 0) {
      // Talep başka bir worker'a geçti: bu denemenin nesnesi satırdaki anahtarla çözülemez, sil.
      await storage.deletePrivate(objectKey).catch(() => {});
      return "lost";
    }
    return "built";
  } catch (err) {
    deps.log("error", "data-exports.build başarısız", { id: claimed.id, failure: failureCode(err) });
    if (objectKey) await storage.deletePrivate(objectKey).catch(() => {});
    await prisma.dataExport.updateMany({ where: guard, data: { status: "FAILED", failure: failureCode(err), claimedAt: null } });
    return "failed";
  }
}

/** Süresi dolunca anahtar/token hemen silinir; depolama erişilemiyorsa şifreli nesnenin silinmesi yeniden denenir. */
async function expirePackages(deps: DataExportDeps): Promise<number> {
  const { prisma, storage } = deps;
  const closed = await prisma.dataExport.updateMany({
    where: { status: "READY", expiresAt: { lte: deps.now() } },
    data: { status: "EXPIRED", encKey: null, tokenHash: null, tokenExpiresAt: null },
  });
  const due = await prisma.dataExport.findMany({
    where: { status: "EXPIRED", objectKey: { not: null } },
    orderBy: { expiresAt: "asc" },
    take: 100,
    select: { id: true, objectKey: true },
  });
  for (const row of due) {
    try {
      if (row.objectKey) await storage.deletePrivate(row.objectKey);
      await prisma.dataExport.updateMany({
        where: { id: row.id, status: "EXPIRED", objectKey: row.objectKey },
        data: { objectKey: null },
      });
    } catch {
      deps.log("warn", "data-exports süresi dolan paket silinemedi", { id: row.id, failure: "delete_failed" });
    }
  }
  return closed.count;
}

export async function runDataExports(deps: DataExportDeps): Promise<DataExportResult> {
  const result: DataExportResult = { built: 0, failed: 0, lost: 0, expired: await expirePackages(deps) };
  for (let i = 0; i < BATCH_SIZE; i++) {
    const claimedAt = deps.now();
    const claimed = await claimNext(deps.prisma, claimedAt);
    if (!claimed) break;
    result[await buildOne(deps, claimed, claimedAt)]++;
  }
  return result;
}
