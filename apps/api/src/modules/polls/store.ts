// Anket modülünün veri erişim arayüzü — KV-10 (#12). Üretim uygulaması: prisma-store.ts.
// Çok adımlı yazmalar (anket + seçenekler + etiket + galeri + idempotency kaydı) tek metotta, tek transaction'dadır.

export type ContentStatus = "ACTIVE" | "HIDDEN" | "UNDER_REVIEW" | "LOCKED" | "REMOVED";

/** Sistem ayarları (KV-40, #42). Ayar servisi gelene kadar DEFAULT_POLL_SETTINGS kullanılır. */
export type PollSettings = {
  minDurationHours: number;
  maxDurationHours: number;
  voteChangeAllowed: boolean;
  /** Yayın limitleri (KV-20, #22). Değerler ve kaynakları: contracts settings.ts → polls.* */
  newAccountPeriodDays: number;
  newAccountDailyLimit: number;
  newAccountCooldownMinutes: number;
  dailyLimit: number;
  cooldownMinutes: number;
};

/** Varsayılanlar contracts ayar kayıt defterindeki resmî değerlerdir (voteChangeAllowed hariç: resmî değer yok). */
export const DEFAULT_POLL_SETTINGS: PollSettings = {
  minDurationHours: 1,
  maxDurationHours: 720,
  voteChangeAllowed: true,
  newAccountPeriodDays: 7,
  newAccountDailyLimit: 3,
  newAccountCooldownMinutes: 30,
  dailyLimit: 10,
  cooldownMinutes: 10,
};

/**
 * Yayın limiti aşıldı (KV-20). Kontrol anket oluşturma transaction'ında, yazarın satırı kilitlenerek
 * yapılır; eşzamanlı istekler limiti aşamaz. retryAfterSeconds: tekrar denenebilecek en erken an.
 */
export class PollLimitError extends Error {
  readonly code: "PUBLISH_COOLDOWN" | "DAILY_PUBLISH_LIMIT" | "DUPLICATE_TITLE";
  readonly retryAfterSeconds: number | null;

  constructor(code: PollLimitError["code"], retryAfterSeconds: number | null) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type FeedTab = "new" | "top";

export type FeedQuery = {
  tab: FeedTab;
  categoryId: string | null;
  communityId: string | null;
  /** Keyset: sıralama değerleri + id (http/cursor.ts). */
  after: { keys: (string | number)[]; id: string } | null;
  limit: number;
  viewerId: string | null;
};

export type PollRecord = {
  id: string;
  publicId: string;
  slug: string;
  title: string;
  description: string | null;
  extraInfo: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  status: ContentStatus;
  resultsVisibility: "ALWAYS" | "AFTER_VOTE";
  allowComments: boolean;
  opensAt: Date;
  closesAt: Date;
  closedAt: Date | null;
  firstValidVoteAt: Date | null;
  commentCount: number;
  createdAt: Date;
  author: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  category: { id: string; slug: string; name: string };
  community: { id: string; slug: string; name: string } | null;
  options: { id: string; label: string; position: number; voteCount: number }[];
  tags: string[];
  /** Sadece APPROVED görseller, galeri sırasıyla. */
  media: { id: string; publicKey: string; width: number | null; height: number | null }[];
  addenda: { id: string; body: string; createdAt: Date }[];
  /** İzleyicinin bu anketteki oyu (misafirde null). */
  viewerVote: { optionId: string; invalidated: boolean } | null;
};

export type NewPoll = {
  authorId: string;
  publicId: string;
  slug: string;
  title: string;
  description: string | null;
  categoryId: string;
  communityId: string | null;
  tagSlugs: string[];
  mediaIds: string[];
  priceAmount: string | null;
  priceCurrency: string | null;
  extraInfo: string | null;
  allowComments: boolean;
  resultsVisibility: "ALWAYS" | "AFTER_VOTE";
  opensAt: Date;
  closesAt: Date;
  options: string[];
};

/** Sadece gönderilen alanlar değişir. options: tam liste; id'li olanlar korunur (kilitsiz ankette). */
export type PollPatch = {
  title?: string;
  slug?: string;
  description?: string | null;
  categoryId?: string;
  tagSlugs?: string[];
  priceAmount?: string | null;
  priceCurrency?: string | null;
  extraInfo?: string | null;
  allowComments?: boolean;
  resultsVisibility?: "ALWAYS" | "AFTER_VOTE";
  options?: { id?: string; label: string }[];
};

/** Idempotency-Key kapsamı (API_CONTRACTS.md §4.5). */
export type IdempotencyScope = { userId: string; route: string; key: string; requestHash: string; now: Date; ttlMs: number };

export type IdempotentResult =
  | { kind: "created"; resourceId: string }
  | { kind: "replayed"; resourceId: string; status: number }
  | { kind: "key_reused" };

export type CommunityAccess = "ok" | "not_found" | "not_member";

/**
 * Anketin başvurduğu kategori/topluluk/görsel, oluşturma transaction'ı içinde artık kullanılamıyor.
 * createPoll bunu satırları kilitleyerek (FOR SHARE) kontrol eder; route sözleşme hatasına çevirir.
 */
export class PollReferenceError extends Error {
  readonly field: "categoryId" | "communityId" | "mediaIds";
  readonly reason: "not_found" | "not_member" | "not_usable";

  constructor(field: PollReferenceError["field"], reason: PollReferenceError["reason"]) {
    super(`${field}: ${reason}`);
    this.field = field;
    this.reason = reason;
  }
}

export interface PollStore {
  findPoll(by: { id: string } | { publicId: string }, viewerId: string | null): Promise<PollRecord | null>;
  /** Sadece sahiplik ve durum kontrolü için hafif okuma. */
  findPollMeta(id: string): Promise<{ authorId: string; status: ContentStatus; firstValidVoteAt: Date | null; closedAt: Date | null; closesAt: Date } | null>;
  isActiveCategory(categoryId: string): Promise<boolean>;
  communityAccess(communityId: string, userId: string): Promise<CommunityAccess>;
  /** Hepsi yükleyenin kendi, POLL amaçlı ve REJECTED olmayan görselleri mi? */
  areUsablePollMedia(userId: string, mediaIds: string[]): Promise<boolean>;
  publicIdExists(publicId: string): Promise<boolean>;

  /**
   * Bu kapsam için kaydedilmiş sonuç (süresi dolmamış). Route, sonucu değişebilen doğrulamalardan
   * önce bunu sorar: başarılı bir isteğin tekrarı, aradaki ayar/kategori/üyelik değişikliğine
   * takılmadan aynı sonucu alır (API_CONTRACTS §4.5).
   */
  findIdempotentResult(scope: IdempotencyScope): Promise<IdempotentResult | null>;
  /**
   * Kategori aktifliği, topluluk üyeliği ve görsel uygunluğu transaction içinde, satırlar
   * kilitlenerek yeniden kontrol edilir; uygun değilse PollReferenceError fırlatır.
   */
  createPoll(poll: NewPoll, scope: IdempotencyScope, limits: PollSettings): Promise<IdempotentResult>;
  /** Herkese görünen (ACTIVE/LOCKED) anketler; deterministik sıra, id eşitlik kırıcı. */
  listFeed(query: FeedQuery): Promise<(PollRecord & { voteCount: number })[]>;
  /** Verilen id'lerdeki herkese görünen anketler, verilen sırayla (arama sonuçları). */
  listByIds(ids: string[], viewerId: string | null): Promise<PollRecord[]>;
  updatePoll(id: string, patch: PollPatch): Promise<void>;
  /** Etkin kapanış zaten geçmişse değişiklik yapmaz. */
  closePoll(id: string, now: Date): Promise<void>;
  removePoll(id: string, now: Date): Promise<void>;
  createAddendum(pollId: string, body: string, scope: IdempotencyScope | null): Promise<IdempotentResult>;
  findAddendum(id: string): Promise<{ id: string; body: string; createdAt: Date } | null>;
}
