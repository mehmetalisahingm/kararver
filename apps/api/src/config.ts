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
  // #180/#291: MFA sırları için oturum pepper'ından AYRI anahtar. Verilince yeni kayıtlar v2 yazılır, eski v1 kayıtlar
  // doğrulamada ve `mfa:rekey` ile taşınır; sonra AUTH_TOKEN_PEPPER MFA'yı kilitlemeden değiştirilebilir.
  MFA_ENCRYPTION_KEY: z.string().default("").refine((v) => v === "" || v.length >= 32, "en az 32 karakter olmalı"),
  // Pepper değiştirildikten sonra BÜTÜN ESKİ değerler (virgülle, eskiden yeniye): yalnız v1 kayıtları ve eski kurtarma kodu
  // özetlerini doğrular. Liste yalnız büyür; bir değer silinirse o pepper'la özetlenmiş kurtarma kodları geçersiz olur.
  MFA_LEGACY_PEPPERS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .refine((list) => list.every((p) => p.length >= 32), "her değer en az 32 karakter olmalı"),
  EMAIL_VERIFICATION_REQUIRED: bool.default(true),
  /** Enables critical role enforcement only after 2 verified SUPER_ADMIN enrollments. */
  ROLE_APPROVALS_REQUIRED: bool.default(false),
  MAIL_TRANSPORT: z.enum(["console", "smtp", "mailpit_api"]).default("console"),
  MAIL_FROM: z.string().min(3),
  // MAIL_TRANSPORT=smtp iken zorunlu: smtp://kullanici:parola@host:587 (STARTTLS) veya smtps://...:465 (TLS).
  SMTP_URL: z.string().default(""),
  // Staging-only Mailpit HTTPS inbox (does not send to real mailboxes).
  MAILPIT_SEND_URL: z.string().default(""),
  MAILPIT_SEND_AUTH: z.string().default(""),
  MEDIA_PUBLIC_BASE_URL: z.url(),
  // KV-19 (#21): yalnız local/test'te kapatılabilir (ör. KV-47 yük testi); staging/production'da her zaman açık.
  RATE_LIMIT_ENABLED: bool.default(true),
  // Object storage (TECH_DECISIONS §3.6). Local'de verilmezse medya endpoint'leri kapalıdır.
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_PUBLIC_SECRET_ACCESS_KEY: z.string().min(1).optional(),
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
  /** Bucket-scoped providers (Railway) require a separate key for approved copies. */
  publicCredentials?: { accessKeyId: string; secretAccessKey: string };
};

export type MailConfig =
  | { transport: "console"; from: string }
  /** requireTls: staging/production'da smtp:// bağlantısı STARTTLS'siz gönderim yapmaz (parola ve token açıkta gitmez). */
  | { transport: "smtp"; from: string; smtpUrl: string; requireTls: boolean }
  | { transport: "mailpit_api"; from: string; sendUrl: string; sendAuth: string };

export type Config = {
  appEnv: "local" | "test" | "staging" | "production";
  logLevel: string;
  webUrl: string;
  port: number;
  /** CORS ve CSRF (Origin) kontrolünde kabul edilen kaynaklar. */
  allowedOrigins: string[];
  session: { cookieName: string; cookieDomain: string | null; secure: boolean; ttlMs: number };
  authTokenPepper: string;
  /** MFA şifreleme anahtarları (modules/security/encryption.ts MfaKeys). */
  mfa: { current: string | null; legacy: string[] };
  emailVerificationRequired?: boolean;
  roleApprovalsRequired: boolean;
  mail: MailConfig;
  /** KV-19 hız sınırı açık mı (staging/production'da zorunlu). */
  rateLimitEnabled: boolean;
  mediaPublicBaseUrl: string;
  /** null: S3 değişkenleri yok (sadece local/test); medya endpoint'leri kaydedilmez. */
  storage: StorageConfig | null;
};

const STORAGE_KEYS = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_PRIVATE", "S3_BUCKET_PUBLIC"] as const;

const TLS_OVERRIDES = ["requireTLS", "ignoreTLS", "opportunisticTLS", "secure", "tls"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`API yapılandırması geçersiz → ${problems}`);
  }
  const e = parsed.data;
  const deployed = e.APP_ENV === "staging" || e.APP_ENV === "production";
  if (e.MFA_ENCRYPTION_KEY && e.MFA_ENCRYPTION_KEY === e.AUTH_TOKEN_PEPPER) {
    throw new Error("API yapılandırması geçersiz → MFA_ENCRYPTION_KEY, AUTH_TOKEN_PEPPER ile aynı olamaz (ayrı anahtar olmalı)");
  }
  if (e.MFA_LEGACY_PEPPERS.length > 0 && !e.MFA_ENCRYPTION_KEY) {
    // Pepper değişmişse eski kayıtlar yalnız okunur; yeni kayıt ayrı anahtarla yazılmalı.
    throw new Error("API yapılandırması geçersiz → MFA_LEGACY_PEPPERS yalnız MFA_ENCRYPTION_KEY ile birlikte kullanılır");
  }
  if (e.MFA_ENCRYPTION_KEY && e.MFA_LEGACY_PEPPERS.includes(e.MFA_ENCRYPTION_KEY)) {
    throw new Error("API yapılandırması geçersiz → MFA_ENCRYPTION_KEY eski pepper listesinde olamaz");
  }
  if (deployed && !e.SESSION_COOKIE_SECURE) {
    throw new Error("API yapılandırması geçersiz → SESSION_COOKIE_SECURE staging/production'da true olmalı");
  }
  if (deployed && !e.RATE_LIMIT_ENABLED) {
    throw new Error("API yapılandırması geçersiz → RATE_LIMIT_ENABLED staging/production'da kapatılamaz");
  }
  if (deployed && e.MAIL_TRANSPORT === "console") {
    // Console mailer doğrulama/sıfırlama bağlantısını loga yazar; sadece local ve test içindir.
    throw new Error("API yapılandırması geçersiz → MAIL_TRANSPORT=console sadece local/test ortamında kullanılabilir");
  }
  if (deployed && env.NEXT_PUBLIC_KV_DATA_MODE === "demo") {
    // #187: demo yalnız web'in izole önizlemesidir; staging/production ortamında demo işareti dağıtım hatasıdır.
    throw new Error("API yapılandırması geçersiz → NEXT_PUBLIC_KV_DATA_MODE=demo staging/production'da kullanılamaz (#187)");
  }
  if (e.MAIL_TRANSPORT === "smtp") {
    // Değer yazılmaz: parola içerir.
    let url: URL | null = null;
    try {
      url = new URL(e.SMTP_URL);
    } catch {}
    if (!url || (url.protocol !== "smtp:" && url.protocol !== "smtps:")) {
      throw new Error("API yapılandırması geçersiz → SMTP_URL: MAIL_TRANSPORT=smtp iken smtp:// veya smtps:// adresi olmalı");
    }
    // Adresteki sorgu parametreleri nodemailer seçeneklerini ezer; staging/production'da TLS zorunluluğu kapatılamaz.
    if (deployed && TLS_OVERRIDES.some((k) => url.searchParams.has(k))) {
      throw new Error(`API yapılandırması geçersiz → SMTP_URL: staging/production'da ${TLS_OVERRIDES.join(", ")} parametreleri kullanılamaz`);
    }
  }
  if (e.MAIL_TRANSPORT === "mailpit_api") {
    if (e.APP_ENV !== "staging") {
      throw new Error("API yapılandırması geçersiz → MAIL_TRANSPORT=mailpit_api yalnız staging ortamında kullanılabilir");
    }
    let url: URL | null = null;
    try { url = new URL(e.MAILPIT_SEND_URL); } catch {}
    const hostedTestInbox = url && (url.hostname.endsWith(".up.railway.app") || url.hostname.endsWith(".onrender.com"));
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !hostedTestInbox) {
      throw new Error("API yapılandırması geçersiz → MAILPIT_SEND_URL: Railway veya Render HTTPS test kutusu adresi gerekli");
    }
    if (!/^[^:\s]+:[^\s]+$/.test(e.MAILPIT_SEND_AUTH)) {
      throw new Error("API yapılandırması geçersiz → MAILPIT_SEND_AUTH: kimlik bilgisi gerekli");
    }
  }
  const missingStorage = STORAGE_KEYS.filter((k) => !e[k]);
  if (Boolean(e.S3_PUBLIC_ACCESS_KEY_ID) !== Boolean(e.S3_PUBLIC_SECRET_ACCESS_KEY) ||
      ((e.S3_PUBLIC_ACCESS_KEY_ID || e.S3_PUBLIC_SECRET_ACCESS_KEY) && missingStorage.length > 0)) {
    throw new Error("API yapılandırması geçersiz → S3_PUBLIC_ACCESS_KEY_ID ve S3_PUBLIC_SECRET_ACCESS_KEY birlikte ve tam S3 ayarıyla verilmeli");
  }
  if (missingStorage.length > 0 && (deployed || missingStorage.length < STORAGE_KEYS.length)) {
    // Yarım S3 ayarı her ortamda hatadır; staging/production'da hiç olmaması da hatadır.
    throw new Error(`API yapılandırması geçersiz → eksik: ${missingStorage.join(", ")}`);
  }
  if (e.APP_ENV === "production" && !e.MFA_ENCRYPTION_KEY) {
    // Yeni ortam ilk günden ayrı anahtarla açılır; pepper değişimi MFA'yı kilitlemez (docs/SA180_MFA_KEY_ROTATION.md).
    throw new Error("API yapılandırması geçersiz → production'da MFA_ENCRYPTION_KEY zorunlu");
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
    mfa: { current: e.MFA_ENCRYPTION_KEY || null, legacy: [...new Set([e.AUTH_TOKEN_PEPPER, ...e.MFA_LEGACY_PEPPERS])] },
    emailVerificationRequired: e.EMAIL_VERIFICATION_REQUIRED,
    roleApprovalsRequired: e.ROLE_APPROVALS_REQUIRED,
    mail:
      e.MAIL_TRANSPORT === "smtp"
        ? { transport: "smtp", from: e.MAIL_FROM, smtpUrl: e.SMTP_URL, requireTls: deployed }
        : e.MAIL_TRANSPORT === "mailpit_api"
          ? { transport: "mailpit_api", from: e.MAIL_FROM, sendUrl: e.MAILPIT_SEND_URL, sendAuth: e.MAILPIT_SEND_AUTH }
          : { transport: "console", from: e.MAIL_FROM },
    mediaPublicBaseUrl: e.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, ""),
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
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
            ...(e.S3_PUBLIC_ACCESS_KEY_ID ? { publicCredentials: { accessKeyId: e.S3_PUBLIC_ACCESS_KEY_ID, secretAccessKey: e.S3_PUBLIC_SECRET_ACCESS_KEY! } } : {}),
          },
  };
}
