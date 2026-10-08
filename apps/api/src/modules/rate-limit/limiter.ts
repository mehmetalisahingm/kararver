// KV-19 (#21) hız sınırlayıcı: router her istekte `enforce` çağırır, giriş akışı `login` korumasını kullanır.
// Aşılınca 429 RATE_LIMITED + Retry-After (saniye). Sayaç anahtarı ve log ham IP/e-posta içermez: pepper'lı sha256.
// Belge: docs/KV-19_RATE_LIMIT.md
import { createHash } from "node:crypto";
import { headers } from "@kararver/contracts";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { ApiError } from "../../http/errors.ts";
import { normalizeEmail } from "../auth/routes.ts";
import type { SessionUser } from "../auth/session.ts";
import { DAY, LOGIN_WINDOW_MS, rulesFor, type RateLimitSettings, type Rule } from "./policy.ts";
import type { CounterState, RateLimitStore } from "./store.ts";

export type RateLimiterDeps = {
  store: RateLimitStore;
  settings: () => Promise<RateLimitSettings>;
  /** Yeni hesap süresi (gün): `polls.newAccountPeriodDays` (Mehmet kararı: hesap açılışından sonraki ilk 7 gün). */
  newAccountDays: () => Promise<number>;
  pepper: string;
  now: () => Date;
};

export type LoginGuard = {
  /** Sınır doluysa 429; parola doğrulamasından önce çağrılır (doğru parola da beklemek zorunda). */
  check(email: string, ip: string, log: FastifyBaseLogger): Promise<void>;
  fail(email: string, ip: string): Promise<void>;
  /** Başarılı giriş e-postanın başarısız deneme sayacını sıfırlar; IP sayacı kalır. */
  succeed(email: string): Promise<void>;
};

export type RateLimiter = {
  enforce(input: { endpointId: string; method: string; viewer: SessionUser | null; request: FastifyRequest }): Promise<void>;
  login: LoginGuard;
};

/** Hesap açılışından itibaren `days` gün geçmediyse yeni hesap. */
export function isNewAccount(createdAt: Date, days: number, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < days * DAY;
}

export function rateLimitError(retryAfterSeconds: number): ApiError {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new ApiError(
    "RATE_LIMITED",
    "Çok fazla istek gönderdiniz. Lütfen biraz sonra tekrar deneyin.",
    [{ code: "retry_after_seconds", message: String(seconds) }],
    { [headers.retryAfter]: String(seconds) },
  );
}

export function createRateLimiter(deps: RateLimiterDeps): RateLimiter {
  const { store, pepper } = deps;
  /** "<kural>:<özet>": özet, kapsam türünü de içerir (aynı değerli IP ve kullanıcı çakışmaz). */
  const keyOf = (name: string, subject: string) =>
    `${name}:${createHash("sha256").update(`${pepper}\0${subject}`).digest("hex").slice(0, 32)}`;
  const retryAfter = (states: CounterState[], now: Date) => Math.max(...states.map((s) => (s.resetAt.getTime() - now.getTime()) / 1000));

  function subjectOf(rule: Rule, viewer: SessionUser | null, request: FastifyRequest): string | null {
    switch (rule.scope) {
      case "ip":
        return `ip:${request.ip}`;
      case "actor":
        return viewer ? `u:${viewer.id}` : `ip:${request.ip}`;
      case "email": {
        const email = (request.body as { email?: unknown } | undefined)?.email;
        // Geçersiz gövde şema doğrulamasında 400 olur; sayılacak e-posta yok.
        return typeof email === "string" && email.length > 0 ? `e:${normalizeEmail(email)}` : null;
      }
    }
  }

  async function enforce({ endpointId, method, viewer, request }: Parameters<RateLimiter["enforce"]>[0]) {
    const rules = rulesFor(endpointId, method);
    if (rules.length === 0) return;
    const now = deps.now();
    const [settings, days] = await Promise.all([deps.settings(), deps.newAccountDays()]);
    const fresh = viewer ? isNewAccount(viewer.user.createdAt, days, now) : false;
    const counters: { rule: Rule; key: string; limit: number }[] = [];
    for (const rule of rules) {
      const subject = subjectOf(rule, viewer, request);
      if (subject) counters.push({ rule, key: keyOf(rule.name, subject), limit: rule.limit(settings, fresh) });
    }
    if (counters.length === 0) return;
    const states = await store.consume(
      counters.map((c) => ({ key: c.key, windowMs: c.rule.windowMs })),
      now,
    );
    const over = states.filter((s, i) => s.count > counters[i]!.limit);
    if (over.length === 0) return;
    const hit = counters.filter((_, i) => states[i]!.count > counters[i]!.limit);
    // Şüpheli işlem logu: kural ve anahtar özeti; IP, e-posta ve kullanıcı adı yazılmaz.
    request.log.warn(
      { rateLimit: { endpoint: endpointId, rules: hit.map((c) => c.rule.name), keys: hit.map((c) => c.key), newAccount: fresh } },
      "hız sınırı aşıldı",
    );
    throw rateLimitError(retryAfter(over, now));
  }

  const loginKeys = (email: string, ip: string) => ({
    email: keyOf("login.email", `e:${normalizeEmail(email)}`),
    ip: keyOf("login.ip", `ip:${ip}`),
  });

  const login: LoginGuard = {
    async check(email, ip, log) {
      const now = deps.now();
      const settings = await deps.settings();
      const k = loginKeys(email, ip);
      const [e, i] = await store.peek(
        [
          { key: k.email, windowMs: LOGIN_WINDOW_MS },
          { key: k.ip, windowMs: LOGIN_WINDOW_MS },
        ],
        now,
      );
      const over = [
        ...(e!.count >= settings.loginFailuresPerEmail ? [{ name: "login.email", key: k.email, state: e! }] : []),
        ...(i!.count >= settings.loginFailuresPerIp ? [{ name: "login.ip", key: k.ip, state: i! }] : []),
      ];
      if (over.length === 0) return;
      log.warn({ rateLimit: { endpoint: "auth.login", rules: over.map((o) => o.name), keys: over.map((o) => o.key) } }, "giriş denemesi sınırı");
      throw rateLimitError(retryAfter(over.map((o) => o.state), now));
    },
    async fail(email, ip) {
      const k = loginKeys(email, ip);
      await store.consume(
        [
          { key: k.email, windowMs: LOGIN_WINDOW_MS },
          { key: k.ip, windowMs: LOGIN_WINDOW_MS },
        ],
        deps.now(),
      );
    },
    async succeed(email) {
      await store.clear([loginKeys(email, "").email]);
    },
  };

  return { enforce, login };
}
