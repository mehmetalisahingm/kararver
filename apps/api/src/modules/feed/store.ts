// "Senin İçin" feed'inin veri erişimi — KV-27 (#29). Üretim uygulaması: prisma-store.ts.
import type { ForYouCandidate } from "./for-you.ts";

export type CandidateQuery = {
  generatedAt: Date;
  categoryId: string | null;
  communityId: string | null;
  /** En yeni kaç anket aday olur (opensAt ≤ generatedAt). */
  limit: number;
};

export interface FeedStore {
  /**
   * generatedAt'e kadar açılmış en yeni `limit` anket; durumdan bağımsız (görünmezler visible=false).
   * Sinyaller generatedAt'e kadarki veriden sayılır; sonraki oy ve yorumlar sırayı değiştirmez.
   */
  candidates(query: CandidateQuery): Promise<ForYouCandidate[]>;
  /** Kullanıcının ilgi kategorileri (user_interests, KV-15). */
  interests(userId: string): Promise<string[]>;
}
