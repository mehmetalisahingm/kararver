// Hata kodu → HTTP status eşlemesi. Bu liste v1 sözleşmesinin parçasıdır:
// kod silmek/yeniden adlandırmak veya status değiştirmek kırıcı değişikliktir
// (docs/API_CONTRACTS.md → "Versiyonlama"). Yeni kod eklemek kırıcı değildir;
// istemci bilinmeyen kodu HTTP status'una göre genel hata olarak göstermelidir.
//
// #64'teki ilk 9 kod ve status'ları aynen korunur.
export const errorStatuses = Object.freeze({
  // 400
  VALIDATION_ERROR: 400,
  INVALID_CURSOR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  TOKEN_INVALID_OR_EXPIRED: 400,
  COMMENT_DEPTH_EXCEEDED: 400,
  // 401
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  // 403
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  SELF_VOTE_FORBIDDEN: 403,
  ACCOUNT_RESTRICTED: 403,
  // 404
  NOT_FOUND: 404,
  // 409
  CONFLICT: 409,
  POLL_CLOSED: 409,
  CONTENT_LOCKED: 409,
  POLL_CONTENT_LOCKED: 409,
  NOT_A_POLL: 409,
  VOTE_CHANGE_DISABLED: 409,
  VOTE_INVALIDATED: 409,
  COMMENTS_DISABLED: 409,
  USERNAME_TAKEN: 409,
  DUPLICATE_TITLE: 409,
  INSUFFICIENT_POINTS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  VERSION_CONFLICT: 409,
  MEDIA_NOT_USABLE: 409,
  // 413 / 415
  MEDIA_TOO_LARGE: 413,
  MEDIA_TYPE_NOT_ALLOWED: 415,
  // 429
  RATE_LIMITED: 429,
  PUBLISH_COOLDOWN: 429,
  DAILY_PUBLISH_LIMIT: 429,
  // 500 / 503
  INTERNAL_ERROR: 500,
  FEATURE_DISABLED: 503,
  MAINTENANCE: 503,
});

export type ErrorCode = keyof typeof errorStatuses;
export const errorCodes = Object.freeze(Object.keys(errorStatuses) as ErrorCode[]);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(errorStatuses, value);
}

/** `Retry-After` başlığı zorunlu olan kodlar. */
export const retryAfterCodes: readonly ErrorCode[] = Object.freeze([
  "RATE_LIMITED",
  "PUBLISH_COOLDOWN",
  "DAILY_PUBLISH_LIMIT",
  "MAINTENANCE",
]);

/**
 * DB'nin ürettiği hatalar → API hata kodu (DATA_MODEL.md).
 * Sağlayıcı modül bu eşlemeyi kullanır; ham DB mesajı istemciye gönderilmez.
 */
export const dbErrorMap = Object.freeze({
  KV_POLL_CONTENT_LOCKED: "POLL_CONTENT_LOCKED",
  KV_COMMENT_DEPTH: "COMMENT_DEPTH_EXCEEDED",
  KV_SELF_VOTE: "SELF_VOTE_FORBIDDEN",
  // Bunlar istemci hatası değil, kod hatasıdır: loglanır, 500 döner.
  KV_VOTE_EVENTS_APPEND_ONLY: "INTERNAL_ERROR",
  KV_VOTE_IDENTITY_IMMUTABLE: "INTERNAL_ERROR",
  KV_SANCTIONS_IMMUTABLE: "INTERNAL_ERROR",
} as const satisfies Record<string, ErrorCode>);
