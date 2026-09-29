// E-posta gönderimi. Local/test ortamında console mailer kullanılır (TECH_DECISIONS.md §7);
// staging/production SMTP sağlayıcısı henüz seçilmedi (TECH_DECISIONS.md §10, açık konu #2).
import type { FastifyBaseLogger } from "fastify";

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Maili stdout'a yazar. Doğrulama bağlantısı içerdiği için config sadece local/test'te izin verir. */
export function createConsoleMailer(from: string): Mailer {
  return {
    async send(mail) {
      process.stdout.write(`\n── mail (console) ──\nFrom: ${from}\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n────────────────────\n`);
    },
  };
}

export function createMailer(transport: "console" | "smtp", from: string): Mailer {
  if (transport === "console") return createConsoleMailer(from);
  throw new Error("MAIL_TRANSPORT=smtp henüz uygulanmadı: sağlayıcı seçimi bekleniyor (TECH_DECISIONS.md §10 #2)");
}

/**
 * Mail gönderimi isteğin sonucunu değiştirmez (hesap varlığı sızmasın, kullanıcı tekrar deneyebilsin).
 * Hata loglanır; alıcı adresi ve içerik loglanmaz.
 */
export async function sendSafely(mailer: Mailer, mail: Mail, log: FastifyBaseLogger): Promise<void> {
  try {
    await mailer.send(mail);
  } catch (err) {
    log.error({ err, subject: mail.subject }, "mail gönderilemedi");
  }
}
