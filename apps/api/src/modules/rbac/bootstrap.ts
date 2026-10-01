// İlk SUPER_ADMIN bootstrap'ı — KV-12 (#14). Karar: DATA_MODEL §11.4/6, runbook: docs/KV-12_ADMIN_BOOTSTRAP.md.
// Giriş noktası bootstrap-cli.ts; mantık burada, test/admin-bootstrap.test.ts doğrudan çağırır.
//
// DB `user_roles_bootstrap_check` ile verensiz (granted_by_id NULL) satırı her SUPER_ADMIN'e izin verir;
// "hiç SUPER_ADMIN yokken, tek bir kez" kuralını DB korumaz, tamamı buradadır.
import type { PrismaClient, Role } from "@kararver/db";
import { normalizeEmail } from "../auth/routes.ts";

/**
 * Sabit advisory lock anahtarı. SUPER_ADMIN satırı yokken `FOR UPDATE` ile kilitlenecek satır da yoktur;
 * eşzamanlı iki bootstrap bu kilitle sıraya girer, ikincisi birincinin yazdığı satırı görüp reddeder.
 */
export const BOOTSTRAP_LOCK_KEY = "kararver.rbac.super_admin_bootstrap";

export type BootstrapRejection =
  | "USER_NOT_FOUND"
  | "USER_DELETED"
  | "EMAIL_NOT_VERIFIED"
  | "USER_NOT_ACTIVE"
  | "SUPER_ADMIN_EXISTS";

type Target = { userId: string; username: string };

export type BootstrapResult =
  /** planned: dry-run, hiçbir şey yazılmadı. applied: satır yazıldı. previousRole null ise yeni satır. */
  | (Target & { kind: "planned" | "applied"; previousRole: Role | null })
  /** Hedef zaten tek SUPER_ADMIN; değişiklik yok. */
  | (Target & { kind: "already" })
  | { kind: "rejected"; reason: BootstrapRejection };

export type BootstrapOptions = {
  email: string;
  /** false (varsayılan dry-run): transaction READ ONLY açılır, hiçbir satır yazılmaz. */
  apply: boolean;
  /** Sadece test: kontroller bittikten sonra, yazmadan önce (kilit tutulurken) çağrılır. */
  afterChecks?: () => Promise<void>;
};

export async function bootstrapSuperAdmin(prisma: PrismaClient, opts: BootstrapOptions): Promise<BootstrapResult> {
  return prisma.$transaction(
    async (tx): Promise<BootstrapResult> => {
      // Dry-run'da yazmamayı DB de garanti etsin; transaction'ın ilk komutu olmalı.
      if (!opts.apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BOOTSTRAP_LOCK_KEY}, 0))`;

      // Uygunluk "zaten" kontrolünden önce: SUPER_ADMIN olup sonradan askıya alınan/silinen hedefe "zaten" denmez.
      const user = await tx.user.findUnique({
        where: { emailNormalized: normalizeEmail(opts.email) },
        select: { id: true, username: true, status: true, emailVerifiedAt: true, deletedAt: true, role: { select: { role: true } } },
      });
      if (!user) return { kind: "rejected", reason: "USER_NOT_FOUND" };
      if (user.deletedAt) return { kind: "rejected", reason: "USER_DELETED" };
      if (!user.emailVerifiedAt) return { kind: "rejected", reason: "EMAIL_NOT_VERIFIED" };
      if (user.status !== "ACTIVE") return { kind: "rejected", reason: "USER_NOT_ACTIVE" };
      const target = { userId: user.id, username: user.username };

      // Sahibinin durumu ne olursa olsun (silinmiş, banlı) her SUPER_ADMIN satırı sayılır.
      const superAdmins = await tx.userRole.findMany({ where: { role: "SUPER_ADMIN" }, select: { userId: true } });
      if (superAdmins.length === 1 && superAdmins[0]!.userId === user.id) return { ...target, kind: "already" };
      if (superAdmins.length > 0) return { kind: "rejected", reason: "SUPER_ADMIN_EXISTS" };

      const previousRole = user.role?.role ?? null;
      await opts.afterChecks?.();
      if (!opts.apply) return { ...target, kind: "planned", previousRole };

      // Kullanıcı başına tek rol satırı (PK user_id): MODERATOR/ADMIN yükseltilir, yoksa eklenir.
      await tx.userRole.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role: "SUPER_ADMIN", grantedById: null },
        update: { role: "SUPER_ADMIN", grantedById: null },
      });
      return { ...target, kind: "applied", previousRole };
    },
    // Kilit beklemesi transaction süresine dahildir; Prisma'nın 5 sn varsayılanı eşzamanlı çalıştırmada dar kalır.
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Çıktı için hedef DB: `host:port/veritabanı`. Kullanıcı adı, parola ve parametreler yazılmaz. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
  } catch {
    return "(ayrıştırılamayan DATABASE_URL)";
  }
}

/** Hata mesajlarında bağlantı dizesi veya parola geçerse gizler. */
export function redactSecrets(text: string, url: string): string {
  let out = text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgresql://***");
  try {
    const password = new URL(url).password;
    if (password) {
      for (const p of new Set([password, decodeURIComponent(password)])) out = out.split(p).join("***");
    }
  } catch {
    // ayrıştırılamayan URL: yalnız genel desen uygulanır
  }
  return out;
}
