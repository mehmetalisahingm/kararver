// #180/#291 — eski (v1, pepper'dan türetilmiş) MFA kayıtlarını ayrı anahtara (v2) taşır.
// Mantık burada; argüman, ortam değişkeni ve çıktı `mfa-rekey-cli.ts`'te. Runbook: docs/SA180_MFA_KEY_ROTATION.md.
//
// Her satır kendi transaction'ında FOR UPDATE ile kilitlenir. Satır çözülür, v2 olarak şifrelenir, geri çözülerek
// doğrulanır ve yalnız hâlâ v1 ise yazılır; eşzamanlı bir doğrulama da aynı işi yapmışsa ikinci yazım olmaz.
// Deneme modunda (apply=false) hiçbir şey yazılmaz: yalnız her v1 kaydın çözülebildiği doğrulanır.
// Kurtarma kodları özet olarak saklandığı için taşınamaz; rapor kaç kullanılmamış kod kaldığını söyler.
import type { PrismaClient } from "@kararver/db";
import { cipherVersion, recoverTotpSecret, rekeyTotpSecret, type MfaKeys } from "./encryption.ts";

export type RekeyReport = {
  total: number;
  v1: number;
  v2: number;
  rekeyed: number;
  failed: number;
  unknown: number;
  unusedRecoveryCodes: number;
  applied: boolean;
};

/** `only`: yalnız bu hesaplar (tek hesap kurtarma tatbikatı ve testler için); verilmezse bütün kayıtlar. */
export async function rekeyMfaCredentials(prisma: PrismaClient, keys: MfaKeys, { apply, only }: { apply: boolean; only?: string[] }): Promise<RekeyReport> {
  if (!keys.current) throw new Error("MFA_ENCRYPTION_KEY tanımlı değil: taşınacak hedef anahtar yok");
  const rows = only
    ? await prisma.$queryRaw<{ user_id: string; secret_cipher: Uint8Array }[]>`
        SELECT user_id::text, secret_cipher FROM user_mfa_credentials WHERE user_id = ANY(${only}::uuid[]) ORDER BY user_id`
    : await prisma.$queryRaw<{ user_id: string; secret_cipher: Uint8Array }[]>`
        SELECT user_id::text, secret_cipher FROM user_mfa_credentials ORDER BY user_id`;
  const report: RekeyReport = { total: rows.length, v1: 0, v2: 0, rekeyed: 0, failed: 0, unknown: 0, unusedRecoveryCodes: 0, applied: apply };
  for (const row of rows) {
    const version = cipherVersion(row.secret_cipher);
    if (version === 2) {
      report.v2++;
      continue;
    }
    if (version !== 1) {
      report.unknown++;
      continue;
    }
    report.v1++;
    try {
      if (!apply) {
        recoverTotpSecret(row.secret_cipher, row.user_id, keys);
        continue;
      }
      const written = await prisma.$transaction(async (tx) => {
        const [current] = await tx.$queryRaw<{ secret_cipher: Uint8Array }[]>`
          SELECT secret_cipher FROM user_mfa_credentials WHERE user_id = ${row.user_id}::uuid FOR UPDATE`;
        if (!current || cipherVersion(current.secret_cipher) !== 1) return false;
        const next = rekeyTotpSecret(current.secret_cipher, row.user_id, keys);
        await tx.$executeRaw`UPDATE user_mfa_credentials SET secret_cipher = ${next} WHERE user_id = ${row.user_id}::uuid`;
        return true;
      });
      if (written) report.rekeyed++;
    } catch {
      // Çözülemeyen kayıt (yanlış legacy sırrı ya da bozuk veri): dokunulmaz, sayılır; çıkış kodu 1.
      report.failed++;
    }
  }
  const [{ n }] = only
    ? await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM mfa_recovery_codes WHERE used_at IS NULL AND user_id = ANY(${only}::uuid[])`
    : await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM mfa_recovery_codes WHERE used_at IS NULL`;
  report.unusedRecoveryCodes = Number(n);
  return report;
}
