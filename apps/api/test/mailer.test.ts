/**
 * SMTP mailer (TECH_DECISIONS §10 #2): sağlayıcıdan bağımsız, SMTP_URL ile. Testte ağ kullanılmaz:
 * süreç içinde açılan küçük bir sahte SMTP sunucusu konuşmayı kaydeder.
 */
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Server } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { after, before, describe, test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { loadConfig } from "../src/config.ts";
import { createMailer, createMailpitApiMailer, createSmtpMailer, sendSafely } from "../src/mail/mailer.ts";

type Session = { auth: string[]; mailFrom?: string; rcptTo: string[]; data?: string; commands: string[] };

/** EHLO, AUTH PLAIN, MAIL/RCPT/DATA ve QUIT konuşan asgari sunucu. STARTTLS sunmaz. */
async function fakeSmtp(credentials: { user: string; pass: string }) {
  const sessions: Session[] = [];
  const server: Server = createServer((socket) => {
    const s: Session = { auth: [], rcptTo: [], commands: [] };
    sessions.push(s);
    let buffer = "";
    let inData = false;
    socket.write("220 fake.smtp ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          s.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 2.0.0 kuyruğa alındı\r\n");
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.split(" ")[0]!.toUpperCase();
        s.commands.push(verb);
        if (verb === "EHLO") socket.write("250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (verb === "AUTH") {
          const [, user, pass] = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8").split("\0");
          s.auth.push(`${user}:${pass}`);
          socket.write(user === credentials.user && pass === credentials.pass ? "235 2.7.0 tamam\r\n" : "535 5.7.8 kimlik reddedildi\r\n");
        } else if (verb === "MAIL") {
          s.mailFrom = line;
          socket.write("250 2.1.0 tamam\r\n");
        } else if (verb === "RCPT") {
          s.rcptTo.push(line);
          socket.write("250 2.1.5 tamam\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 devam\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 2.0.0 hoşça kal\r\n");
          return;
        } else socket.write("502 5.5.2 bilinmiyor\r\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    sessions,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const USER = "kararver@mail.test";
// URL'de yüzde-kodlanmış özel karakterler doğru çözülmeli.
const PASS = "p@ss:w/rd#1";
const FROM = "KararVer <no-reply@kararver.test>";
const MAIL = { to: "ayse@example.com", subject: "E-posta adresini dogrula", text: "Baglanti: https://kararver.test/verify#token=abc123" };

describe("SMTP mailer", () => {
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
  const url = (pass = PASS) => `smtp://${encodeURIComponent(USER)}:${encodeURIComponent(pass)}@127.0.0.1:${smtp?.port}`;

  before(async () => {
    smtp = await fakeSmtp({ user: USER, pass: PASS });
  });
  after(async () => {
    await smtp.close();
  });

  test("kimlik doğrular, gönderen/alıcı/konu/gövdeyi iletir", async () => {
    const mailer = createMailer({ transport: "smtp", from: FROM, smtpUrl: url(), requireTls: false });
    await mailer.send(MAIL);
    const s = smtp.sessions.at(-1)!;
    assert.deepEqual(s.auth, [`${USER}:${PASS}`]);
    assert.match(s.mailFrom!, /<no-reply@kararver\.test>/);
    assert.deepEqual(s.rcptTo.length, 1);
    assert.match(s.rcptTo[0]!, /<ayse@example\.com>/);
    assert.match(s.data!, /^From: KararVer <no-reply@kararver\.test>$/m);
    assert.match(s.data!, /^To: ayse@example\.com$/m);
    assert.match(s.data!, /^Subject: E-posta adresini dogrula$/m);
    assert.match(s.data!, /#token=abc123/);
  });

  test("requireTls açıkken STARTTLS sunmayan sunucuya gönderim yapılmaz", async () => {
    const before = smtp.sessions.length;
    const mailer = createSmtpMailer({ smtpUrl: url(), from: FROM, requireTls: true });
    await assert.rejects(mailer.send(MAIL));
    const s = smtp.sessions[before]!;
    assert.equal(s.mailFrom, undefined, "MAIL FROM gönderilmedi");
    assert.deepEqual(s.auth, [], "parola şifresiz bağlantıda gönderilmedi");
  });

  test("hata isteği bozmaz; log parolayı ve alıcıyı içermez", async () => {
    const logged: unknown[] = [];
    const log = { error: (...args: unknown[]) => logged.push(args) } as unknown as FastifyBaseLogger;
    const mailer = createSmtpMailer({ smtpUrl: url("yanlis-parola-xyz"), from: FROM, requireTls: false });
    await sendSafely(mailer, MAIL, log);
    assert.equal(logged.length, 1);
    const [[obj]] = logged as [[{ err: Error & Record<string, unknown> }]];
    const text = JSON.stringify({ ...obj, err: { ...obj.err, message: obj.err.message, stack: obj.err.stack } });
    assert.match(text, /535/);
    assert.doesNotMatch(text, /yanlis-parola-xyz/);
    assert.doesNotMatch(text, /ayse@example\.com/);
    assert.equal(smtp.sessions.at(-1)!.mailFrom, undefined);
  });
});

describe("SMTP yapılandırması", () => {
  const base = {
    APP_ENV: "test",
    WEB_URL: "http://localhost:3000",
    API_URL: "http://localhost:4000",
    SESSION_COOKIE_SECURE: "false",
    AUTH_TOKEN_PEPPER: "test-pepper-0123456789-abcdefghijklmnop",
    MAIL_FROM: FROM,
    MEDIA_PUBLIC_BASE_URL: "http://cdn.test/media",
  };
  const s3 = {
    S3_ENDPOINT: "http://s3.test",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
    S3_BUCKET_PRIVATE: "priv",
    S3_BUCKET_PUBLIC: "pub",
  };
  const staging = { ...base, ...s3, APP_ENV: "staging", SESSION_COOKIE_SECURE: "true", MAIL_TRANSPORT: "smtp" };

  test("MAIL_TRANSPORT=smtp iken geçerli SMTP_URL zorunlu; değer hata mesajına yazılmaz", () => {
    assert.throws(() => loadConfig({ ...base, MAIL_TRANSPORT: "smtp" }), /SMTP_URL/);
    for (const bad of ["http://u:gizli-parola@smtp.test", "gizli-parola", "smtp//eksik"]) {
      assert.throws(
        () => loadConfig({ ...base, MAIL_TRANSPORT: "smtp", SMTP_URL: bad }),
        (err: Error) => /SMTP_URL/.test(err.message) && !err.message.includes("gizli-parola"),
      );
    }
    assert.deepEqual(loadConfig({ ...base }).mail, { transport: "console", from: FROM });
  });

  test("staging/production'da TLS zorunlu ve adresle kapatılamaz", () => {
    const mail = loadConfig({ ...staging, SMTP_URL: "smtp://u:p@smtp.test:587" }).mail;
    assert.deepEqual(mail, { transport: "smtp", from: FROM, smtpUrl: "smtp://u:p@smtp.test:587", requireTls: true });
    assert.ok(loadConfig({ ...staging, SMTP_URL: "smtps://u:p@smtp.test:465" }));
    for (const q of ["ignoreTLS=true", "requireTLS=false", "secure=false", "opportunisticTLS=true"]) {
      assert.throws(() => loadConfig({ ...staging, SMTP_URL: `smtp://u:p@smtp.test:587?${q}` }), /SMTP_URL/, q);
    }
    // Local'de (ör. Mailpit) TLS zorunlu değil.
    const local = loadConfig({ ...base, APP_ENV: "local", MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://localhost:1025?ignoreTLS=true" }).mail;
    assert.equal(local.transport === "smtp" && local.requireTls, false);
  });
});

describe("HTTPS Mailpit staging capture", () => {
  test("send API uses separate Basic auth and retains the original verification link", async () => {
    const calls: { path: string | undefined; auth: string | undefined; body: Record<string, unknown> }[] = [];
    const server = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        res.writeHead(200).end('{"ID":"capture"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const mailer = createMailpitApiMailer({ sendUrl: `http://127.0.0.1:${port}`, sendAuth: "capture:secret", from: FROM });
      await mailer.send(MAIL);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.path, "/api/v1/send");
      assert.equal(calls[0]!.auth, "Basic " + Buffer.from("capture:secret").toString("base64"));
      assert.deepEqual(calls[0]!.body, {
        From: { Email: "no-reply@kararver.test", Name: "KararVer" },
        To: [{ Email: "ayse@example.com" }],
        Subject: MAIL.subject,
        Text: MAIL.text,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("non-success Mailpit HTTP response fails closed without logging credentials", async () => {
    const server = createHttpServer((_req, res) => res.writeHead(401).end("secret body"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const mailer = createMailpitApiMailer({ sendUrl: `http://127.0.0.1:${port}`, sendAuth: "send:topsecret", from: FROM });
      await assert.rejects(mailer.send(MAIL), (error: Error) =>
        /401/.test(error.message) && !error.message.includes("topsecret") && !error.message.includes("secret body"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("Mailpit route allowed only in staging with HTTPS and independent send credentials", () => {
    const base = {
      APP_ENV: "staging", WEB_URL: "https://kararver-staging.vercel.app",
      API_URL: "https://api-staging.up.railway.app", SESSION_COOKIE_SECURE: "true",
      AUTH_TOKEN_PEPPER: "test-pepper-0123456789-abcdefghijklmnop",
      MAIL_FROM: FROM, MEDIA_PUBLIC_BASE_URL: "https://cdn.test/media",
      S3_ENDPOINT: "https://s3.test", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET_PRIVATE: "priv", S3_BUCKET_PUBLIC: "pub",
      MAIL_TRANSPORT: "mailpit_api", MAILPIT_SEND_AUTH: "sender:strongrandompassword",
      MAILPIT_SEND_URL: "https://mailpit-staging-f6ae.up.railway.app",
    };
    assert.equal(loadConfig(base).mail.transport, "mailpit_api");
    assert.throws(() => loadConfig({ ...base, APP_ENV: "production" }), /yalnız staging/);
    assert.throws(() => loadConfig({ ...base, MAILPIT_SEND_URL: "http://mailpit-staging-f6ae.up.railway.app" }), /MAILPIT_SEND_URL/);
    assert.throws(() => loadConfig({ ...base, MAILPIT_SEND_URL: "https://evil.example" }), /MAILPIT_SEND_URL/);
    assert.throws(() => loadConfig({ ...base, MAILPIT_SEND_AUTH: "" }), /MAILPIT_SEND_AUTH/);
  });
});
