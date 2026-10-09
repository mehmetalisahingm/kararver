// Admin kategori yönetiminin veri erişimi — KV-26 (#28). Üretim uygulaması: prisma-store.ts.
// Kategori silinmez, pasife alınır (isActive=false); pasif kategori public listede ve aramada görünmez,
// yeni ankette seçilemez, mevcut anketler kategorisini korur.
import type { IdempotencyScope, IdempotentResult } from "../../http/idempotency.ts";
import type { CategoryRow } from "../search/store.ts";

export type AdminCategoryRow = CategoryRow & { isActive: boolean; pollCount: number };

export type CategoryInput = {
  slug: string;
  name: string;
  description?: string | null;
  iconKey?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

/** Keyset: sortOrder + id. */
export type CategoryPage = { after: { keys: (string | number)[]; id: string } | null; limit: number };

export type CategoryCreateResult = IdempotentResult | { kind: "rejected"; reason: "SLUG_TAKEN" };

/** Yönetici kategori mutasyonunun değiştirilemez audit izi. */
export type CategoryAdminTrail = { actorId: string; requestId: string | null; now: Date; reason: string };

export interface CategoryAdminStore {
  /** Pasifler dahil, sortOrder + id sıralı. */
  list(page: CategoryPage): Promise<AdminCategoryRow[]>;
  get(id: string): Promise<AdminCategoryRow | null>;
  create(scope: IdempotencyScope | null, input: CategoryInput, trail: CategoryAdminTrail): Promise<CategoryCreateResult>;
  update(id: string, patch: Partial<CategoryInput>, trail: CategoryAdminTrail): Promise<"OK" | "NOT_FOUND" | "SLUG_TAKEN">;
}