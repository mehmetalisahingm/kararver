// Topluluk modülünün veri erişim arayüzü — KV-31 (#33). Üretim uygulaması: prisma-store.ts.
// Topluluk rolü istemci iddiasından değil, community_memberships satırından okunur (FOUNDATION_CONTRACTS).

export type CommunityRole = "MEMBER" | "MODERATOR";
export type MembersVisibility = "PUBLIC" | "MEMBERS" | "MODERATORS";

export type CommunityRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Sadece APPROVED görselin public anahtarı; aksi halde null. */
  imagePublicKey: string | null;
  memberCount: number;
  membersVisibility: MembersVisibility;
  createdAt: Date;
};

export type MemberRecord = {
  user: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  role: CommunityRole;
  joinedAt: Date;
};

/** Üye sayısına göre azalan, eşitlikte id'ye göre artan sıra. */
export type CommunityPageKey = { memberCount: number; id: string };
/** Katılım zamanına göre yeniden eskiye, eşitlikte kullanıcı id'si. */
export type MemberPageKey = { joinedAt: Date; userId: string };

export interface CommunityStore {
  listActive(after: CommunityPageKey | null, limit: number): Promise<CommunityRecord[]>;
  /** Sadece ACTIVE topluluk (kapatılmış/kaldırılmış olan bulunamaz). */
  findActiveBySlug(slug: string): Promise<CommunityRecord | null>;
  findActiveById(id: string): Promise<CommunityRecord | null>;
  /** Durumdan bağımsız varlık kontrolü (kapatılan topluluktan ayrılmak mümkün olsun). */
  exists(id: string): Promise<boolean>;
  roleOf(communityId: string, userId: string): Promise<CommunityRole | null>;
  listMembers(communityId: string, after: MemberPageKey | null, limit: number): Promise<MemberRecord[]>;
  /** Satır eklendiyse sayaç aynı transaction'da artar; zaten üyeyse mevcut rol döner. */
  join(communityId: string, userId: string, now: Date): Promise<CommunityRole>;
  /** Satır silindiyse sayaç aynı transaction'da azalır; üye değilse hiçbir şey yapmaz. */
  leave(communityId: string, userId: string): Promise<void>;

  // ── Admin (KV-32, #34) ──
  /** Durumdan bağımsız; yönetici kapatılmış topluluğu da görür. */
  findAnyById(id: string): Promise<CommunityRecord | null>;
  createCommunity(
    scope: IdempotencyScope | null,
    input: CommunityInput,
    createdById: string,
  ): Promise<
    | { kind: "created" | "replayed"; id: string }
    | { kind: "key_reused" }
    | { kind: "rejected"; reason: CommunityRejection }
  >;
  updateCommunity(id: string, patch: CommunityPatch): Promise<"OK" | "NOT_FOUND" | CommunityRejection>;
  /**
   * Üyelik yoksa oluşturur (sayaç aynı transaction'da artar), varsa rolü MODERATOR yapar. Askıdaki hesap da
   * atanabilir: yetkili işlem ACTIVE hesap ister (KV-04), rol hesap açılınca geçerli olur.
   */
  assignModerator(communityId: string, userId: string): Promise<"OK" | "COMMUNITY_NOT_FOUND" | "USER_NOT_FOUND">;
  /** MODERATOR → MEMBER; üyelik ve sayaç korunur. Moderatör değilse hiçbir şey yapmaz. */
  removeModerator(communityId: string, userId: string): Promise<"OK" | "COMMUNITY_NOT_FOUND">;
}

export type CommunityRejection = "slug_taken" | "image_unusable";
export type CommunityInput = {
  slug: string;
  name: string;
  description: string | null;
  imageMediaId: string | null;
  membersVisibility: MembersVisibility;
};
/** ACTIVE ↔ HIDDEN: kapatma topluluğu public listeden ve katılımdan çıkarır; üyelikler silinmez. */
export type CommunityPatch = Partial<CommunityInput> & { status?: "ACTIVE" | "HIDDEN" };
export type IdempotencyScope = import("../../http/idempotency.ts").IdempotencyScope;
