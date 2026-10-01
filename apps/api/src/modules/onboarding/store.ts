// KV-15 (#17) — kullanıcı ilgi alanları. Üretim uygulaması prisma-store.ts.

export type ReplaceInterestsResult =
  | { ok: true; categoryIds: string[] }
  | { ok: false; reason: "INVALID_CATEGORY" };

export interface OnboardingStore {
  /** Kullanıcının seçili kategori kimlikleri. */
  list(userId: string): Promise<string[]>;
  /** Tam listeyi atomik olarak değiştirir. Boş liste, onboarding'i atlama/tercihleri temizleme anlamına gelir. */
  replace(userId: string, categoryIds: string[]): Promise<ReplaceInterestsResult>;
}
