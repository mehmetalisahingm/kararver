// E-posta gönderimi. Local/test ortamında console mailer kullanılır (TECH_DECISIONS.md §7);
// staging/production'da sağlayıcıdan bağımsız SMTP (SMTP_URL). Sağlayıcı değişirse yalnız SMTP_URL değişir.
import type { FastifyBaseLogger } from "fastify";
import { createTransport } from "nodemailer";
import type { MailConfig } from "../config.ts";

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

/**
 * SMTP_URL ile gönderir: smtp://kullanici:parola@host:587 (STARTTLS) veya smtps://...:465 (doğrudan TLS).
 * requireTls açıkken (staging/production) smtp:// sunucusu STARTTLS sunmazsa gönderim yapılmaz.
 * Her mail ayrı bağlantıyla gider (hacim düşük: doğrulama ve sıfırlama). Zaman aşımları kısa tutulur:
 * gönderim isteğin içinde beklenir, takılan sağlayıcı API cevabını dakikalarca bekletmesin.
 */
export function createSmtpMailer(options: { smtpUrl: string; from: string; requireTls: boolean }): Mailer {
  const transport = createTransport(
    {
      url: options.smtpUrl,
      requireTLS: options.requireTls,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      dnsTimeout: 10_000,
    },
    { from: options.from },
  );
  return {
    async send(mail) {
      await transport.sendMail({ to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

export function createMailer(config: MailConfig): Mailer {
  if (config.transport === "console") return createConsoleMailer(config.from);
  return createSmtpMailer(config);
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
