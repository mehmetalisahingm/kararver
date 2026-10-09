// İlk SUPER_ADMIN CLI'ı — KV-12 (#14): pnpm --filter @kararver/api admin:bootstrap --email <e-posta> [--apply]
// Varsayılan dry-run. Mantık bootstrap.ts'te; burası argüman, env, çıktı ve çıkış kodu.
// Çıkış kodu: 0 = yazıldı / zaten / dry-run planı, 1 = kural reddi veya hata, 2 = kullanım hatası.
// Runbook: docs/KV-12_ADMIN_BOOTSTRAP.md
import path from "node:path";
import { parseArgs } from "node:util";
import { createPrismaClient } from "@kararver/db";
import { bootstrapSuperAdmin, describeDatabase, redactSecrets, type BootstrapRejection } from "./bootstrap.ts";

const USAGE = "Kullanım: pnpm --filter @kararver/api admin:bootstrap --email <e-posta> [--apply]";

const REJECTIONS: Record<BootstrapRejection, string> = {
  USER_NOT_FOUND: "Bu e-postayla kullanıcı bulunamadı. Hedef önce normal kayıt akışıyla hesap açmalı.",
  USER_DELETED: "Kullanıcı silinmiş.",
  EMAIL_NOT_VERIFIED: "Kullanıcının e-postası doğrulanmamış.",
  USER_NOT_ACTIVE: "Kullanıcının durumu ACTIVE değil.",
  SUPER_ADMIN_EXISTS: "Zaten bir SUPER_ADMIN var; bootstrap yalnız hiç SUPER_ADMIN yokken çalışır. Rol ataması admin panelinden yapılır.",
};

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

// `pnpm … admin:bootstrap -- --email …` biçiminde gelen ayırıcıyı yok say.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

let email: string;
let apply: boolean;
try {
  const { values } = parseArgs({
    args: argv,
    options: { email: { type: "string" }, apply: { type: "boolean", default: false } },
    strict: true,
    allowPositionals: false,
  });
  email = values.email?.trim() ?? "";
  apply = values.apply;
} catch (err) {
  usageError(err instanceof Error ? err.message : String(err));
}
if (!email) usageError("--email zorunlu.");

// server.ts ile aynı: local'de repo kökündeki .env, staging/production'da ortam değişkenleri.
if (!process.env.APP_ENV) {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../../../../.env"));
  } catch {
    // .env yok: ortam değişkenleri kullanılır
  }
}
const url = process.env.DATABASE_URL;
if (!url) usageError("DATABASE_URL tanımlı değil (bkz. .env.example).");
const database = describeDatabase(url);

console.log(`Hedef veritabanı: ${database}`);
console.log(`Mod: ${apply ? "APPLY (yazar)" : "DRY-RUN (hiçbir şey yazılmaz)"}`);

const prisma = createPrismaClient(url);
try {
  const result = await bootstrapSuperAdmin(prisma, { email, apply });
  switch (result.kind) {
    case "rejected":
      console.error(`Reddedildi (${result.reason}): ${REJECTIONS[result.reason]}`);
      process.exitCode = 1;
      break;
    case "already":
      console.log(`Değişiklik yok: @${result.username} (${result.userId}) zaten tek SUPER_ADMIN.`);
      break;
    case "planned": {
      const change = result.previousRole ? `${result.previousRole} → SUPER_ADMIN (yükseltme)` : "USER → SUPER_ADMIN (yeni satır)";
      console.log(`Yapılacak: @${result.username} (${result.userId}): ${change}, granted_by_id = NULL`);
      console.log("Yazmak için aynı komutu --apply ile çalıştırın.");
      break;
    }
    case "applied":
      // Aynı kayıt rol yazımıyla aynı transaction'da audit_logs'a da yazıldı (KV-39: source CLI, actor NULL,
      // action user.role.assign, hedef USER). Bu satır operatörün çıktısıdır; kalıcı iz audit kaydıdır.
      console.log(
        JSON.stringify({
          event: "rbac.super_admin_bootstrap",
          userId: result.userId,
          username: result.username,
          previousRole: result.previousRole,
          role: "SUPER_ADMIN",
          database,
          at: new Date().toISOString(),
        }),
      );
      break;
  }
} catch (err) {
  console.error(`Beklenmeyen hata: ${redactSecrets(err instanceof Error ? err.message : String(err), url)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
