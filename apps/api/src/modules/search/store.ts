// Kategori ve arama modülünün veri erişimi — KV-26 (#28). Üretim uygulaması: prisma-store.ts.
// Arama, kv_normalize ile Türkçe karakter ve büyük/küçük harf farkını yok sayar (TECH_DECISIONS §3.9).

export type CategoryRow = { id: string; slug: string; name: string; description: string | null; iconKey: string | null; sortOrder: number };

export type SearchType = "polls" | "users" | "categories" | "communities";

/** Keyset: sıralama değerleri + id (http/cursor.ts). */
export type SearchPage = { after: { keys: (string | number)[]; id: string } | null; limit: number };

/** Sonuç satırı: tür, id ve cursor için sıralama değerleri. Ayrıntı ayrıca yüklenir. */
export type SearchHit = { id: string; keys: (string | number)[] };

export type UserHit = { id: string; username: string; displayName: string; avatarPublicKey: string | null };
export type CommunityHit = { id: string; slug: string; name: string };

export interface SearchStore {
  /** Aktif kategoriler, sıralı. Pasif kategori listelenmez. */
  listActiveCategories(): Promise<CategoryRow[]>;
  search(type: SearchType, q: string, page: SearchPage): Promise<SearchHit[]>;
  usersByIds(ids: string[]): Promise<UserHit[]>;
  categoriesByIds(ids: string[]): Promise<CategoryRow[]>;
  communitiesByIds(ids: string[]): Promise<CommunityHit[]>;
}
