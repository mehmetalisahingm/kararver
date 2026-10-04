// sanctions.expire — KV-33 PR-C (#35). Süresi dolan yaptırımlardan sonra users.status'u senkronlar.
// Kurallar: docs/KV-33_ADMIN_USERS.md §6, DATA_MODEL §9.1.
//
// Süre dolması bir kaldırma değildir: sanctions tablosuna yazılmaz (sanctions_guard / sanctions_lift_check aktörsüz
// kaldırmaya zaten izin vermez). "Aktif" zamana bağlı bir tanımdır (ends_at > now); bu job yalnız özet olan
// users.status'u kalan aktif yaptırımlardan yeniden hesaplar (contracts statusFromSanctions, API ile aynı fonksiyon).
//
// - Aday: durumu SUSPENDED/RESTRICTED olup yaptırımlardan hesaplanan değerden farklı olan kullanıcılar (en fazla
//   BATCH_SIZE). SQL yalnız ön filtredir; karar her kullanıcı için transaction içinde statusFromSanctions ile verilir.
//   BAN kalıcıdır (ends_at NULL, CHECK) ve süre dolumuyla değişmez; ACTIVE kullanıcının değişecek bir şeyi yoktur.
// - Her kullanıcı ayrı transaction: users satırı FOR NO KEY UPDATE (yönetici işlemleriyle aynı kilit, KV-33 PR-B),
//   kilitten sonra taze okuma, değiştiyse güncelleme + aynı transaction'da audit (WORKER, aktör NULL,
//   user.status.sync / sync). Değişmediyse hiçbir şey yazılmaz.
// - İdempotent: iki worker veya tekrar çalışma aynı kullanıcıda kilitte sıraya girer; ikincisi düzeltilmiş durumu
//   görür ve yazmaz (tek audit). Kuyruk ayrıca singleton'dır.
import { statusFromSanctions } from "@kararver/contracts";
import { Prisma, type PrismaClient, type UserStatus } from "@kararver/db";
import { writeWorkerAudit } from "./audit.ts";

export const SANCTIONS_EXPIRE_QUEUE = "sanctions.expire";
/**
 * Her dakika (pg-boss cron'u dakika çözünürlüklü). Cron izleyicisi varsayılan 30 sn'de bir çalıştığı için süresi dolan
 * yaptırım users.status'a en geç ~90 sn içinde (+ iş süresi) yansır; o arada giriş ve açık oturum SUSPENDED gibi davranır.
 */
export const SANCTIONS_EXPIRE_CRON = "* * * * *";
/** Bir turda en fazla işlenen kullanıcı; kalanlar sonraki turda. */
export const BATCH_SIZE = 500;

export type SanctionExpiryDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  batchSize?: number;
  /** Sadece test: kullanıcı satırı kilitlendikten sonra, okumadan önce çağrılır. */
  afterLock?: (userId: string) => Promise<void>;
};

export type SanctionExpiryResult = { candidates: number; changed: number; unchanged: number; failed: number };

/**
 * Durumu yaptırımlardan hesaplanan değerden farklı SUSPENDED/RESTRICTED kullanıcılar (statusFromSanctions'ın SQL ön filtresi).
 * Index: users_status_idx ile başlar, her aday için sanctions_user_id_lifted_at_ends_at_idx (migration gerekmez).
 */
export function candidatesSql(now: Date, limit: number): Prisma.Sql {
  // Zaman ISO metni olarak bağlanır ve açıkça timestamptz'ye çevrilir (DATA_MODEL §2.2).
  const at = now.toISOString();
  const active = (types: string[]) => Prisma.sql`
    EXISTS (SELECT 1 FROM sanctions s WHERE s.user_id = u.id AND s.lifted_at IS NULL AND s.type::text = ANY(${types}::text[])
            AND (s.ends_at IS NULL OR s.ends_at > ${at}::timestamptz))`;
  return Prisma.sql`
    SELECT u.id::text AS id FROM users u
    WHERE u.status IN ('SUSPENDED', 'RESTRICTED')
      AND u.status::text <> (CASE
        WHEN ${active(["BAN"])} THEN 'BANNED'
        WHEN ${active(["SUSPEND"])} THEN 'SUSPENDED'
        WHEN ${active(["RESTRICT_COMMENTS", "RESTRICT_POSTING"])} THEN 'RESTRICTED'
        ELSE 'ACTIVE' END)
    ORDER BY u.id
    LIMIT ${limit}`;
}

export async function findCandidates(prisma: PrismaClient, now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(candidatesSql(now, limit));
  return rows.map((r) => r.id);
}

/** Tek kullanıcı: kilitle, yeniden hesapla, değiştiyse yaz ve audit'le. Değişiklik olduysa true. */
export async function syncUserStatus(deps: SanctionExpiryDeps, userId: string): Promise<boolean> {
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const [user] = await tx.$queryRaw<{ status: UserStatus }[]>`
      SELECT status::text AS status FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    if (!user) return false;
    await deps.afterLock?.(userId);
    const open = await tx.sanction.findMany({ where: { userId, liftedAt: null }, select: { type: true, endsAt: true } });
    const next = statusFromSanctions(
      open.map((s) => ({ type: s.type, endsAt: s.endsAt?.toISOString() ?? null })),
      now,
    );
    if (next === user.status) return false;

    await tx.user.update({ where: { id: userId }, data: { status: next } });
    const expiredTypes = [...new Set(open.filter((s) => s.endsAt !== null && s.endsAt <= now).map((s) => s.type))].sort();
    await writeWorkerAudit(tx, {
      source: "WORKER",
      actorId: null,
      action: "user.status.sync",
      target: { type: "USER", id: userId },
      before: { status: user.status },
      after: { status: next, expiredTypes },
      requestId: null,
      at: now,
    });
    return true;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function expireSanctions(deps: SanctionExpiryDeps): Promise<SanctionExpiryResult> {
  const ids = await findCandidates(deps.prisma, deps.now(), deps.batchSize ?? BATCH_SIZE);
  const result: SanctionExpiryResult = { candidates: ids.length, changed: 0, unchanged: 0, failed: 0 };
  for (const id of ids) {
    try {
      if (await syncUserStatus(deps, id)) result.changed++;
      else result.unchanged++;
    } catch (err) {
      // Bir kullanıcıdaki hata turu durdurmaz; sonraki turda yeniden denenir.
      result.failed++;
      deps.log("error", "sanctions.expire kullanıcı senkronlanamadı", { userId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
