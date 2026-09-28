// API yapılandırması. Değişkenlerin listesi ve açıklaması: .env.example / .env.staging.example
// Yanlış veya eksik değerle servis açılmaz; hangi değişkenin sorunlu olduğu yazılır (değeri yazılmaz).
import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const Env = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  WEB_URL: z.url(),
  API_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("kv_session"),
  SESSION_COOKIE_DOMAIN: z.string().default(""),
  SESSION_COOKIE_SECURE: bool.default(true),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTH_TOKEN_PEPPER: z.string().min(32, "en az 32 karakter olmalı"),
  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().min(3),
  MEDIA_PUBLIC_BASE_URL: z.url(),
});

export type Config = {
  appEnv: "local" | "test" | "staging" | "production";
  logLevel: string;
  webUrl: string;
  port: number;
  /** CORS ve CSRF (Origin) kontrolünde kabul edilen kaynaklar. */
  allowedOrigins: string[];
  session: { cookieName: string; cookieDomain: string | null; secure: boolean; ttlMs: number };
  authTokenPepper: string;
  mail: { transport: "console" | "smtp"; from: string };
  mediaPublicBaseUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`API yapılandırması geçersiz → ${problems}`);
  }
  const e = parsed.data;
  const deployed = e.APP_ENV === "staging" || e.APP_ENV === "production";
  if (deployed && !e.SESSION_COOKIE_SECURE) {
    throw new Error("API yapılandırması geçersiz → SESSION_COOKIE_SECURE staging/production'da true olmalı");
  }
  if (deployed && e.MAIL_TRANSPORT === "console") {
    // Console mailer doğrulama/sıfırlama bağlantısını loga yazar; sadece local ve test içindir.
    throw new Error("API yapılandırması geçersiz → MAIL_TRANSPORT=console sadece local/test ortamında kullanılabilir");
  }
  return {
    appEnv: e.APP_ENV,
    logLevel: e.LOG_LEVEL,
    webUrl: e.WEB_URL.replace(/\/$/, ""),
    port: e.PORT ?? Number(new URL(e.API_URL).port || 4000),
    allowedOrigins: [new URL(e.WEB_URL).origin],
    session: {
      cookieName: e.SESSION_COOKIE_NAME,
      cookieDomain: e.SESSION_COOKIE_DOMAIN || null,
      secure: e.SESSION_COOKIE_SECURE,
      ttlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    },
    authTokenPepper: e.AUTH_TOKEN_PEPPER,
    mail: { transport: e.MAIL_TRANSPORT, from: e.MAIL_FROM },
    mediaPublicBaseUrl: e.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, ""),
  };
}
