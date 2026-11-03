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

/**
 * Staging-only: Mailpit's HTTPS send API captures verification messages in its
 * protected test inbox. SMTP strict-STARTTLS remains enforced in production.
 * This deliberately does NOT deliver email to the recipient's real mailbox.
 */
export function createMailpitApiMailer(options: {
  sendUrl: string; sendAuth: string; from: string;
  retry?: { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; now?: () => number };
}): Mailer {
  const endpoint = new URL("/api/v1/send", options.sendUrl).toString();
  const displayFrom = options.from.match(/^(.+?)\s*<([^<>]+)>$/);
  const from = displayFrom
    ? { Email: displayFrom[2]!, Name: displayFrom[1]!.trim().replace(/^["']|["']$/g, "") }
    : { Email: options.from };
  return {
    async send(mail) {
      const fetcher = options.retry?.fetcher ?? fetch;
      const wait = options.retry?.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      const now = options.retry?.now ?? Date.now;
      // Render Free may return a transient gateway error while the test inbox wakes.
      // Retries are staging-only, bounded by both a deadline and an attempt limit.
      const deadline = now() + 90_000;
      const request = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(options.sendAuth, "utf8").toString("base64")}`,
        },
        body: JSON.stringify({
          From: from,
          To: [{ Email: mail.to }],
          Subject: mail.subject,
          Text: mail.text,
        }),
      };
      let lastStatus: number | undefined;
      for (let attempt = 0; attempt < 8; attempt++) {
        const remaining = deadline - now();
        if (remaining <= 0) break;
        let response: Response | undefined;
        try {
          response = await fetcher(endpoint, { ...request, signal: AbortSignal.timeout(Math.min(10_000, remaining)) });
        } catch { /* A network failure may be the inbox waking; no URL or credentials are exposed. */ }
        if (response) {
          lastStatus = response.status;
          try { await response.body?.cancel(); } catch { /* Discard untrusted response bodies. */ }
          if (response.ok) return;
          if (![408, 429, 502, 503, 504].includes(response.status)) {
            throw new Error(`Mailpit test inbox rejected mail (HTTP ${response.status})`);
          }
        }
        if (attempt === 7) break;
        const delay = Math.min(1000 * 2 ** attempt, 16_000, deadline - now());
        if (delay <= 0) break;
        await wait(delay);
      }
      // Never log the response body: an untrusted relay may echo message content.
      throw new Error(`Mailpit test inbox unavailable${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
    },
  };
}

export function createMailer(config: MailConfig): Mailer {
  if (config.transport === "console") return createConsoleMailer(config.from);
  if (config.transport === "mailpit_api") return createMailpitApiMailer(config);
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
