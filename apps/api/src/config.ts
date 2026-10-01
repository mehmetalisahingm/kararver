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
  // Object storage (TECH_DECISIONS §3.6). Local'de verilmezse medya endpoint'leri kapalıdır.
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET_PRIVATE: z.string().min(3).optional(),
  S3_BUCKET_PUBLIC: z.string().min(3).optional(),
});

export type StorageConfig = {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  /** admin.media.decide onayda kopyalar, red/kaldırmada siler; otomatik onayı worker yapar. */
  publicBucket: string;
};

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
  /** null: S3 değişkenleri yok (sadece local/test); medya endpoint'leri kaydedilmez. */
  storage: StorageConfig | null;
};

const STORAGE_KEYS = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_PRIVATE", "S3_BUCKET_PUBLIC"] as const;

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
  const missingStorage = STORAGE_KEYS.filter((k) => !e[k]);
  if (missingStorage.length > 0 && (deployed || missingStorage.length < STORAGE_KEYS.length)) {
    // Yarım S3 ayarı her ortamda hatadır; staging/production'da hiç olmaması da hatadır.
    throw new Error(`API yapılandırması geçersiz → eksik: ${missingStorage.join(", ")}`);
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
    storage:
      missingStorage.length > 0
        ? null
        : {
            endpoint: e.S3_ENDPOINT!,
            region: e.S3_REGION,
            forcePathStyle: e.S3_FORCE_PATH_STYLE,
            accessKeyId: e.S3_ACCESS_KEY_ID!,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
            privateBucket: e.S3_BUCKET_PRIVATE!,
            publicBucket: e.S3_BUCKET_PUBLIC!,
          },
  };
}
