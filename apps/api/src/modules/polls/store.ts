// Anket modülünün veri erişim arayüzü — KV-10 (#12). Üretim uygulaması: prisma-store.ts.
// Çok adımlı yazmalar (anket + seçenekler + etiket + galeri + idempotency kaydı) tek metotta, tek transaction'dadır.

export type ContentStatus = "ACTIVE" | "HIDDEN" | "UNDER_REVIEW" | "LOCKED" | "REMOVED";

/** Sistem ayarları (KV-40, #42). Ayar servisi gelene kadar DEFAULT_POLL_SETTINGS kullanılır. */
export type PollSettings = {
  minDurationHours: number;
  maxDurationHours: number;
  voteChangeAllowed: boolean;
};

export const DEFAULT_POLL_SETTINGS: PollSettings = { minDurationHours: 1, maxDurationHours: 720, voteChangeAllowed: true };

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

export interface PollStore {
  findPoll(by: { id: string } | { publicId: string }, viewerId: string | null): Promise<PollRecord | null>;
  /** Sadece sahiplik ve durum kontrolü için hafif okuma. */
  findPollMeta(id: string): Promise<{ authorId: string; status: ContentStatus; firstValidVoteAt: Date | null; closedAt: Date | null; closesAt: Date } | null>;
  isActiveCategory(categoryId: string): Promise<boolean>;
  communityAccess(communityId: string, userId: string): Promise<CommunityAccess>;
  /** Hepsi yükleyenin kendi, POLL amaçlı ve REJECTED olmayan görselleri mi? */
  areUsablePollMedia(userId: string, mediaIds: string[]): Promise<boolean>;
  publicIdExists(publicId: string): Promise<boolean>;

  createPoll(poll: NewPoll, scope: IdempotencyScope): Promise<IdempotentResult>;
  updatePoll(id: string, patch: PollPatch): Promise<void>;
  /** Etkin kapanış zaten geçmişse değişiklik yapmaz. */
  closePoll(id: string, now: Date): Promise<void>;
  removePoll(id: string, now: Date): Promise<void>;
  createAddendum(pollId: string, body: string, scope: IdempotencyScope | null): Promise<IdempotentResult>;
  findAddendum(id: string): Promise<{ id: string; body: string; createdAt: Date } | null>;
}
