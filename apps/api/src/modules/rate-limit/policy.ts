// KV-19 (#21) hız sınırı politikası: hangi endpoint hangi pencerede kaç istek alır.
// Değerler: contracts settings.ts `limits.*` (resmî değer yok, Faruk önerisi; Mehmet geçici limitleri onayladı, #21).
// KV-40 (#42) ayar servisi gelince değerler oradan okunur; o zamana kadar DEFAULT_RATE_LIMIT_SETTINGS.
// Belge: docs/KV-19_RATE_LIMIT.md

export type RateLimitSettings = {
  loginFailuresPerEmail: number;
  loginFailuresPerIp: number;
  registerPerIpHour: number;
  recoveryPerEmailHour: number;
  recoveryPerIpHour: number;
  votesPerMinute: number;
  newAccountVotesPerMinute: number;
  commentsPerMinute: number;
  newAccountCommentsPerMinute: number;
  commentsPerDay: number;
  newAccountCommentsPerDay: number;
  reportsPerHour: number;
  newAccountReportsPerHour: number;
  uploadsPerHour: number;
  newAccountUploadsPerHour: number;
  searchesPerMinute: number;
  writesPerMinute: number;
  newAccountWritesPerMinute: number;
};

/** Anahtarlar contracts `limits.<ad>` ile birebir (test). */
export const DEFAULT_RATE_LIMIT_SETTINGS: Readonly<RateLimitSettings> = Object.freeze({
  loginFailuresPerEmail: 5,
  loginFailuresPerIp: 20,
  registerPerIpHour: 5,
  recoveryPerEmailHour: 3,
  recoveryPerIpHour: 10,
  votesPerMinute: 30,
  newAccountVotesPerMinute: 15,
  commentsPerMinute: 6,
  newAccountCommentsPerMinute: 3,
  commentsPerDay: 200,
  newAccountCommentsPerDay: 30,
  reportsPerHour: 10,
  newAccountReportsPerHour: 5,
  uploadsPerHour: 20,
  newAccountUploadsPerHour: 5,
  searchesPerMinute: 60,
  writesPerMinute: 60,
  newAccountWritesPerMinute: 30,
});

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Başarısız giriş penceresi. */
export const LOGIN_WINDOW_MS = 15 * MINUTE;

/**
 * Kimin sayıldığı: `actor` = oturum varsa kullanıcı, yoksa IP; `ip` = her zaman IP; `email` = gövdedeki e-posta
 * (normalize edilmiş). Sabit pencere: sayaç pencere başında sıfırlanır (epoch'a hizalı; gün = UTC günü).
 */
export type RuleScope = "actor" | "ip" | "email";

export type Rule = {
  /** Sayaç anahtarının ön eki ve logdaki ad. */
  name: string;
  scope: RuleScope;
  windowMs: number;
  limit(s: RateLimitSettings, newAccount: boolean): number;
};

const rule = (name: string, scope: RuleScope, windowMs: number, limit: Rule["limit"]): Rule => ({ name, scope, windowMs, limit });

/** Uç noktaya özel kurallar. Burada olmayan yazma uç noktaları WRITE_RULES'a, GET'ler kuralsız. */
export const ENDPOINT_RULES: Readonly<Record<string, readonly Rule[]>> = Object.freeze({
  "auth.register": [rule("register.ip", "ip", HOUR, (s) => s.registerPerIpHour)],
  "auth.password.forgot": [
    rule("recovery.email", "email", HOUR, (s) => s.recoveryPerEmailHour),
    rule("recovery.ip", "ip", HOUR, (s) => s.recoveryPerIpHour),
  ],
  // Doğrulama e-postası oturumlu istektir; hesap başına sayılır.
  "auth.email.resend": [
    rule("recovery.user", "actor", HOUR, (s) => s.recoveryPerEmailHour),
    rule("recovery.ip", "ip", HOUR, (s) => s.recoveryPerIpHour),
  ],
  "votes.put": [rule("vote.min", "actor", MINUTE, (s, n) => (n ? s.newAccountVotesPerMinute : s.votesPerMinute))],
  "comments.create": [
    rule("comment.min", "actor", MINUTE, (s, n) => (n ? s.newAccountCommentsPerMinute : s.commentsPerMinute)),
    rule("comment.day", "actor", DAY, (s, n) => (n ? s.newAccountCommentsPerDay : s.commentsPerDay)),
  ],
  "reports.create": [rule("report.hour", "actor", HOUR, (s, n) => (n ? s.newAccountReportsPerHour : s.reportsPerHour))],
  "media.uploads.create": [rule("upload.hour", "actor", HOUR, (s, n) => (n ? s.newAccountUploadsPerHour : s.uploadsPerHour))],
  "search.query": [rule("search.min", "actor", MINUTE, (s) => s.searchesPerMinute)],
});

export const WRITE_RULES: readonly Rule[] = [rule("write.min", "actor", MINUTE, (s, n) => (n ? s.newAccountWritesPerMinute : s.writesPerMinute))];

/** Girişin kendi akışı var (yalnız başarısız denemeler sayılır, login-guard). */
export const SELF_MANAGED = new Set(["auth.login"]);

export function rulesFor(endpointId: string, method: string): readonly Rule[] {
  if (SELF_MANAGED.has(endpointId)) return [];
  const own = ENDPOINT_RULES[endpointId];
  if (own) return own;
  return method === "GET" || method === "HEAD" ? [] : WRITE_RULES;
}
