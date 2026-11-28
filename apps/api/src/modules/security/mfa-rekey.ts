// #180/#291 — eski (v1, pepper'dan türetilmiş) MFA kayıtlarını ayrı anahtara (v2) taşır.
// Mantık burada; argüman, ortam değişkeni ve çıktı `mfa-rekey-cli.ts`'te. Runbook: docs/SA180_MFA_KEY_ROTATION.md.
//
// - Her satır kendi transaction'ında FOR UPDATE ile kilitlenir. Satır çözülür, v2 olarak şifrelenir, geri çözülerek
//   doğrulanır ve yalnız hâlâ v1 ise yazılır; eşzamanlı bir doğrulama aynı işi yapmışsa ikinci yazım olmaz (raced).
// - v2 kayıtlar da verilen anahtarla ÇÖZÜLEREK doğrulanır: CLI'a uygulamadakinden farklı bir MFA_ENCRYPTION_KEY verilirse
//   v2 kayıtlar çözülemez, `failed` sayılır ve çıkış 1 olur. Deneme de bunu yakalar.
// - İlk taşıma koruması: veritabanında henüz v2 kayıt yoksa anahtarın uygulamadakiyle aynı olduğu kanıtlanmamıştır;
//   toplu --apply reddedilir. Önce uygulamada bir MFA'lı test hesabıyla step-up (kayıt uygulamanın anahtarıyla v2 olur)
//   ya da `only` ile tek hesapta tatbikat yapılır.
// - Deneme modunda (apply=false) hiçbir şey yazılmaz. Veritabanı hataları "çözülemeyen" sayılmaz, yukarı fırlatılır.
// - Her taşıma aynı transaction'da `security.mfa.rekey` (CLI, aktörsüz) denetim kaydı yazar: sürüm 1 → 2, sır yok.
// Kurtarma kodları özet olarak saklandığı için taşınamaz; rapor kaç kullanılmamış kod kaldığını söyler.
import type { PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import { cipherVersion, recoverTotpSecret, rekeyTotpSecret, type MfaKeys } from "./encryption.ts";

export type RekeyReport = {
  total: number;
  v1: number;
  v2: number;
  /** v2 kayıtlardan verilen anahtarla çözülebilenler (anahtar doğru mu?). */
  v2Verified: number;
  rekeyed: number;
  /** Taşıma sırasında başka bir süreç (uygulamadaki step-up) önce taşımış. */
  raced: number;
  failed: number;
  unknown: number;
  unusedRecoveryCodes: number;
  applied: boolean;
};

/** Şifre çözme hatası mı (yanlış anahtar/eski sır, bozuk kayıt)? DB/ağ hataları değildir. */
/**
 * #373 P2: verilen v2 kayıtlardan biri bu anahtarla çözülüyorsa "ok", hiçbiri çözülmüyorsa "mismatch", kayıt yoksa
 * "unverified". Çözme dışı hata "unknown". Sır döndürmez, loglamaz.
 */
export function checkMfaKey(rows: { user_id: string; secret_cipher: Uint8Array }[], keys: MfaKeys): "ok" | "mismatch" | "unverified" | "unknown" {
  const v2 = rows.filter((r) => cipherVersion(r.secret_cipher) === 2);
  if (v2.length === 0) return "unverified";
  for (const row of v2) {
    try {
      recoverTotpSecret(row.secret_cipher, row.user_id, keys);
      return "ok";
    } catch (err) {
      if (!isDecryptError(err)) return "unknown";
    }
  }
  return "mismatch";
}

export function isDecryptError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Unsupported state or unable to authenticate data|MFA kaydı eski sırlarla çözülemedi|MFA_ENCRYPTION_KEY gerekli|Invalid encrypted MFA key|yeniden şifreleme doğrulanamadı/.test(message);
}

/**
 * `only`: yalnız bu hesaplar (tek hesap tatbikatı ve testler için); verilmezse bütün kayıtlar.
 * `requireVerifiedKey`: ilk taşıma koruması (varsayılan: `only` yoksa açık).
 */
export async function rekeyMfaCredentials(
  prisma: PrismaClient,
  keys: MfaKeys,
  { apply, only, requireVerifiedKey = !only }: { apply: boolean; only?: string[]; requireVerifiedKey?: boolean },
): Promise<RekeyReport> {
  if (!keys.current) throw new Error("MFA_ENCRYPTION_KEY tanımlı değil: taşınacak hedef anahtar yok");
  const rows = only
    ? await prisma.$queryRaw<{ user_id: string; secret_cipher: Uint8Array }[]>`
        SELECT user_id::text, secret_cipher FROM user_mfa_credentials WHERE user_id = ANY(${only}::uuid[]) ORDER BY user_id`
    : await prisma.$queryRaw<{ user_id: string; secret_cipher: Uint8Array }[]>`
        SELECT user_id::text, secret_cipher FROM user_mfa_credentials ORDER BY user_id`;
  const report: RekeyReport = { total: rows.length, v1: 0, v2: 0, v2Verified: 0, rekeyed: 0, raced: 0, failed: 0, unknown: 0, unusedRecoveryCodes: 0, applied: apply };

  // 1) Anahtar doğrulaması: mevcut v2 kayıtlar verilen anahtarla çözülmeli.
  for (const row of rows) {
    const version = cipherVersion(row.secret_cipher);
    if (version === 2) {
      report.v2++;
      try {
        recoverTotpSecret(row.secret_cipher, row.user_id, keys);
        report.v2Verified++;
      } catch (err) {
        if (!isDecryptError(err)) throw err;
        report.failed++;
      }
    } else if (version === 1) {
      report.v1++;
    } else {
      report.unknown++;
    }
  }
  // Yanlış anahtarla toplu yazım hesapları kilitler: v2 doğrulanamadıysa hiçbir şey yazılmaz.
  if (apply && report.failed > 0) return { ...report, applied: false };
  if (apply && requireVerifiedKey && report.v1 > 0 && report.v2Verified === 0) {
    throw new Error(
      "ilk taşıma: veritabanında anahtarı doğrulanmış v2 kayıt yok; toplu --apply reddedildi. Önce uygulamada MFA'lı bir test hesabıyla step-up yap (kayıt uygulamanın anahtarıyla v2 olur) ya da --only ile tek hesapta tatbikat yap",
    );
  }

  // 2) v1 kayıtlar: deneme çözmeyi sınar, uygulama taşır.
  for (const row of rows) {
    if (cipherVersion(row.secret_cipher) !== 1) continue;
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
        await writeAudit(tx, { source: "CLI", actorId: null, action: "security.mfa.rekey", target: { type: "USER", id: row.user_id },
          before: { cipherVersion: 1 }, after: { cipherVersion: 2 } });
        return true;
      });
      if (written) report.rekeyed++;
      else report.raced++;
    } catch (err) {
      // Yalnız şifre çözme hatası "çözülemeyen" sayılır (dokunulmaz, çıkış 1); DB/ağ hatası yukarı fırlatılır.
      if (!isDecryptError(err)) throw err;
      report.failed++;
    }
  }
  const [{ n }] = only
    ? await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM mfa_recovery_codes WHERE used_at IS NULL AND user_id = ANY(${only}::uuid[])`
    : await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM mfa_recovery_codes WHERE used_at IS NULL`;
  report.unusedRecoveryCodes = Number(n);
  return report;
}
