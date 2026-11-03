// MFA anahtar taşıma CLI'ı — #180/#291: pnpm --filter @kararver/api mfa:rekey [--apply]
// Ortam: DATABASE_URL, AUTH_TOKEN_PEPPER, MFA_ENCRYPTION_KEY (zorunlu), MFA_LEGACY_PEPPERS (pepper değiştiyse BÜTÜN eski değerler, virgülle).
// Varsayılan deneme: hiçbir şey yazmaz, her v1 kaydın çözülebildiğini doğrular. Çıkış kodu: 0 = tamam, 1 = çözülemeyen
// kayıt ya da hata, 2 = kullanım hatası. Rapor yalnız sayı içerir. Runbook: docs/SA180_MFA_KEY_ROTATION.md
import { parseArgs } from "node:util";
import { createPrismaClient } from "@kararver/db";
import { rekeyMfaCredentials } from "./mfa-rekey.ts";

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const { values } = parseArgs({ args: argv, options: { apply: { type: "boolean", default: false } }, strict: true });

const need = (k: string) => {
  const v = process.env[k] ?? "";
  if (v.length < 32) {
    console.error(`${k} gerekli (en az 32 karakter)`);
    process.exit(2);
  }
  return v;
};
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL gerekli");
  process.exit(2);
}
const pepper = need("AUTH_TOKEN_PEPPER");
const current = need("MFA_ENCRYPTION_KEY");
if (current === pepper) {
  console.error("MFA_ENCRYPTION_KEY, AUTH_TOKEN_PEPPER ile aynı olamaz");
  process.exit(2);
}
const previous = (process.env.MFA_LEGACY_PEPPERS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
if (previous.some((v) => v.length < 32) || previous.includes(current)) {
  console.error("MFA_LEGACY_PEPPERS geçersiz: her değer en az 32 karakter olmalı ve MFA_ENCRYPTION_KEY listede olamaz");
  process.exit(2);
}
const legacy = [...new Set([pepper, ...previous])];

const prisma = createPrismaClient(databaseUrl);
try {
  const r = await rekeyMfaCredentials(prisma, { current, legacy }, { apply: values.apply });
  console.log(`mfa:rekey ${r.applied ? "UYGULANDI" : "DENEME (yazılmadı; kalıcı için --apply)"}`);
  console.log(`  kayıt: ${r.total} · v1 (pepper'a bağlı): ${r.v1} · v2 (ayrı anahtar): ${r.v2} · taşınan: ${r.rekeyed} · çözülemeyen: ${r.failed} · tanınmayan: ${r.unknown}`);
  console.log(`  kullanılmamış kurtarma kodu: ${r.unusedRecoveryCodes} (özet olarak saklanır, taşınamaz; v1/v2 ayrımı özetten anlaşılamaz)`);
  console.log(`  eski sır listesi: güncel pepper + ${previous.length} eski pepper`);
  const pending = r.applied ? r.v1 - r.rekeyed : r.v1;
  console.log(
    r.failed || r.unknown
      ? "SONUÇ: çözülemeyen kayıt var — pepper DEĞİŞTİRİLMEZ"
      : pending > 0
        ? `SONUÇ: ${pending} v1 kayıt çözülebilir; --apply ile taşı`
        : r.unusedRecoveryCodes > 0
          ? "SONUÇ: TOTP kayıtları ayrı anahtarda. Pepper değiştirilebilir AMA ŞART: değiştirirken GÜNCEL AUTH_TOKEN_PEPPER değeri MFA_LEGACY_PEPPERS listesine EKLENMELİ (mevcut değerler silinmeden); yoksa eski kurtarma kodları sessizce geçersiz olur."
          : "SONUÇ: TOTP kayıtları ayrı anahtarda ve kullanılmamış kurtarma kodu yok; pepper değiştirilebilir",
  );
  process.exitCode = r.failed || r.unknown ? 1 : 0;
} catch (err) {
  console.error(`mfa:rekey başarısız: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
