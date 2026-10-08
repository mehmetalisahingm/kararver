// Auth endpoint'leri — KV-09 (#11). Sözleşme: packages/contracts/src/domains/auth.ts
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { sendSafely, type Mailer } from "../../mail/mailer.ts";
import type { LoginGuard } from "../rate-limit/limiter.ts";
import { toMe, type RolesOf } from "../users/me.ts";
import { hashToken, newToken, type PasswordHasher } from "./crypto.ts";
import { createSessionCookies, type SessionSettings } from "./session.ts";
import type { AuthStore, NewToken, TokenPurpose } from "./store.ts";

export type AuthDeps = {
  store: AuthStore;
  hasher: PasswordHasher;
  mailer: Mailer;
  now: () => Date;
  session: SessionSettings;
  webUrl: string;
  mediaPublicBaseUrl: string;
  /** Tam uygulamada RBAC store'dan gelir; auth-only test/harness'larda USER varsayılır. */
  rolesOf?: RolesOf;
  /** Sistem ayarı `registration.enabled` (KV-40, #42). Ayar servisi gelene kadar her zaman açık. */
  isRegistrationEnabled: () => Promise<boolean>;
  /** KV-19 (#21) başarısız giriş sınırı; verilmezse sınır yok (auth-only test düzenekleri). */
  loginGuard?: LoginGuard;
};

const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

const RESTRICTED = new Set(["BANNED", "SUSPENDED"]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function registerAuthRoutes(route: Route, deps: AuthDeps): void {
  const { store, hasher, mailer, now, session } = deps;
  const cookies = createSessionCookies(session);
  const rolesOf: RolesOf = deps.rolesOf ?? (async () => ["USER"]);

  // Bilinmeyen e-postada da parola doğrulaması yapılır; cevap süresi hesabın varlığını ele vermez.
  const dummyHash = hasher.hash(newToken());

  function token(purpose: TokenPurpose): { raw: string; record: NewToken } {
    const raw = newToken();
    return {
      raw,
      record: { purpose, tokenHash: hashToken(raw, session.pepper), expiresAt: new Date(now().getTime() + TOKEN_TTL_MS[purpose]) },
    };
  }

  // Token URL fragment'ında taşınır: sunucu loglarına ve Referer başlığına düşmez.
  const verifyLink = (raw: string) => `${deps.webUrl}/dogrula#token=${raw}`;
  const resetLink = (raw: string) => `${deps.webUrl}/sifre-yenile#token=${raw}`;

  function verificationMail(to: string, raw: string) {
    return {
      to,
      subject: "KararVer — e-posta adresini doğrula",
      text: `Merhaba,\n\nKararVer hesabını doğrulamak için bağlantıyı aç (24 saat geçerli):\n${verifyLink(raw)}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.`,
    };
  }

  route("auth.register", async ({ body, request }) => {
    if (!(await deps.isRegistrationEnabled())) {
      throw new ApiError("FEATURE_DISABLED", "Yeni kayıtlar şu an kapalı.");
    }
    const emailNormalized = normalizeEmail(body.email);
    const passwordHash = await hasher.hash(body.password);
    const accepted = { status: 202, body: { data: { status: "VERIFICATION_SENT" } } };

    const existingAccountMail = (to: string) => ({
      to,
      subject: "KararVer — bu e-postayla zaten bir hesabın var",
      text: `Merhaba,\n\nBu e-posta adresiyle yeni bir kayıt denendi ama zaten bir KararVer hesabın var.\nŞifreni hatırlamıyorsan: ${deps.webUrl}/sifremi-unuttum\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.`,
    });

    // E-posta kayıtlıysa da aynı 202 döner; hesap sahibine bilgilendirme gider.
    const existing = await store.findUserByEmail(emailNormalized);
    if (existing) {
      await sendSafely(mailer, existingAccountMail(existing.email), request.log);
      return accepted;
    }
    if (await store.usernameExists(body.username)) {
      throw new ApiError("USERNAME_TAKEN", "Bu kullanıcı adı alınmış.", [{ field: "username", code: "taken" }]);
    }

    const verification = token("EMAIL_VERIFICATION");
    const result = await store.createUser(
      {
        email: body.email.trim(),
        emailNormalized,
        username: body.username,
        usernameNormalized: body.username,
        displayName: body.displayName,
        passwordHash,
      },
      verification.record,
    );
    if (!result.ok) {
      // Paralel kayıt yarışı: unique kısıt kazananı belirledi.
      if (result.conflict === "username") {
        throw new ApiError("USERNAME_TAKEN", "Bu kullanıcı adı alınmış.", [{ field: "username", code: "taken" }]);
      }
      await sendSafely(mailer, existingAccountMail(body.email.trim()), request.log);
      return accepted;
    }
    await sendSafely(mailer, verificationMail(result.user.email, verification.raw), request.log);
    return accepted;
  });

  route("auth.login", async ({ body, request, reply }) => {
    // KV-19: sınır doluysa parola hiç doğrulanmaz (doğru parola da beklemek zorunda; argon2 yükü de olmaz).
    await deps.loginGuard?.check(body.email, request.ip, request.log);
    const user = await store.findUserByEmail(normalizeEmail(body.email));
    const passwordOk = await hasher.verify(user?.passwordHash ?? (await dummyHash), body.password);
    if (!user || !passwordOk || user.deletedAt) {
      // Var olmayan hesap da sayılır: hesap varlığı sınırın davranışından anlaşılmaz.
      await deps.loginGuard?.fail(body.email, request.ip);
      throw new ApiError("INVALID_CREDENTIALS", "E-posta veya şifre hatalı.");
    }
    await deps.loginGuard?.succeed(body.email);
    if (RESTRICTED.has(user.status)) {
      throw new ApiError("ACCOUNT_RESTRICTED", "Hesabınız askıya alınmış.", [{ code: "login" }]);
    }
    const raw = newToken();
    const at = now();
    await store.createSession(
      {
        userId: user.id,
        tokenHash: hashToken(raw, session.pepper),
        expiresAt: new Date(at.getTime() + session.ttlMs),
        ipAddress: request.ip ? request.ip.slice(0, 45) : null,
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
      at,
    );
    cookies.set(reply, raw);
    // İlk giriş puanı (#67, 20 puan) puan defteriyle birlikte gelecek; tablo henüz yok.
    return { status: 200, body: { data: toMe(user, deps.mediaPublicBaseUrl, await rolesOf(user.id)) } };
  });

  route("auth.logout", async ({ viewer, reply }) => {
    await store.revokeSession(viewer!.sessionId, now());
    cookies.clear(reply);
    return { status: 204, body: null };
  });

  route("auth.email.verify", async ({ body }) => {
    if (!(await store.verifyEmail(hashToken(body.token, session.pepper), now()))) {
      throw new ApiError("TOKEN_INVALID_OR_EXPIRED", "Bağlantı geçersiz veya süresi dolmuş.");
    }
    return { status: 200, body: { data: { verified: true } } };
  });

  route("auth.email.resend", async ({ viewer, request }) => {
    if (!viewer!.emailVerified) {
      const verification = token("EMAIL_VERIFICATION");
      await store.issueToken(viewer!.id, verification.record, now());
      await sendSafely(mailer, verificationMail(viewer!.user.email, verification.raw), request.log);
    }
    return { status: 202, body: null };
  });

  route("auth.password.forgot", async ({ body, request }) => {
    const user = await store.findUserByEmail(normalizeEmail(body.email));
    // Hesap olsun olmasın 202; yasaklı veya silinmiş hesaba sıfırlama bağlantısı gönderilmez.
    if (user && !user.deletedAt && user.status !== "BANNED") {
      const reset = token("PASSWORD_RESET");
      await store.issueToken(user.id, reset.record, now());
      await sendSafely(
        mailer,
        {
          to: user.email,
          subject: "KararVer — şifre sıfırlama",
          text: `Merhaba,\n\nŞifreni sıfırlamak için bağlantıyı aç (1 saat geçerli):\n${resetLink(reset.raw)}\n\nŞifre değişince bütün cihazlardaki oturumların kapanır.\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.`,
        },
        request.log,
      );
    }
    return { status: 202, body: null };
  });

  route("auth.password.reset", async ({ body, reply }) => {
    const passwordHash = await hasher.hash(body.password);
    if (!(await store.resetPassword(hashToken(body.token, session.pepper), passwordHash, now()))) {
      throw new ApiError("TOKEN_INVALID_OR_EXPIRED", "Bağlantı geçersiz veya süresi dolmuş.");
    }
    cookies.clear(reply);
    return { status: 204, body: null };
  });
}
