// KV-22 (#24) — public profil ve private kaydetme veri erişim sözleşmesi.

export type ProfileRecord = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  joinedAt: Date;
  avatarPublicKey: string | null;
  pollCount: number;
  votesReceived: number;
  commentCount: number;
};

export type ProfilePageCursor = { createdAt: Date; id: string } | null;

export type ProfileCommentRecord = {
  id: string;
  pollId: string;
  parentId: string | null;
  kind: "COMMENT" | "ALTERNATIVE";
  body: string;
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  editedAt: Date | null;
  createdAt: Date;
  author: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  viewerReaction: "LIKE" | "DISLIKE" | null;
};

export type PageId = { id: string; createdAt: Date };

export interface ProfileStore {
  findPublicProfile(username: string): Promise<ProfileRecord | null>;
  listPublicPollIds(userId: string, after: ProfilePageCursor, limit: number): Promise<PageId[]>;
  listPublicComments(userId: string, viewerId: string | null, after: ProfilePageCursor, limit: number): Promise<ProfileCommentRecord[]>;

  /** Görünür bir gönderiyi private listeye ekler. Aynı kayıt tekrarında duplicate oluşmaz. */
  putBookmark(userId: string, pollId: string): Promise<"saved" | "not_found">;
  /** Silme doğal idempotent'tir; kayıt yoksa da saved=false sonucu verilir. */
  deleteBookmark(userId: string, pollId: string): Promise<void>;
  /** Yalnız çağıranın kendi listesi; görünmez/kaldırılmış içerik döndürülmez. */
  listBookmarkPollIds(userId: string, after: ProfilePageCursor, limit: number): Promise<PageId[]>;
}
