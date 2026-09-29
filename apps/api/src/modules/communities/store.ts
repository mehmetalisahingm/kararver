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
}
