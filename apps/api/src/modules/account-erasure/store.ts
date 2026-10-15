// Hesap anonimleştirme ve yasal saklama — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §10. Üretim uygulaması: prisma-store.ts.
//
// Her değiştiren işlem tek transaction'dadır: hedef kullanıcı satırı kilitlenir (admin-users ile aynı kilit), yetki taze
// aktörle yeniden verilir, ardından kişisel veri temizliği, kalıcı kayıt (account_erasures) ve audit birlikte yazılır.
import type { Prisma } from "@kararver/db";
import type { Mutation } from "../admin-users/store.ts";

export type ErasureBlocker = "legal_hold" | "active_sanction" | "has_role" | "export_in_progress";

export type LegalHoldRow = { id: string; reason: string; createdAt: Date; placedById: string };

export type RemovalCounts = {
  polls: number;
  comments: number;
  media: number;
  sessions: number;
  dataExports: number;
  avatar: number;
  communityMemberships: number;
  ownedCommunities: number;
  pendingCommunityRequests: number;
  preferences: number;
};
export type RetainedCounts = { polls: number; comments: number; votes: number; reportsFiled: number };

export type ErasurePreviewRow = {
  userId: string;
  username: string;
  anonymized: boolean;
  anonymizedAt: Date | null;
  blockers: ErasureBlocker[];
  legalHold: LegalHoldRow | null;
  willRemove: RemovalCounts;
  willRetain: RetainedCounts;
};

/**
 * `self`: kullanıcının kendi silme talebi (account-deletion modülü, KV-33 §12). Yetki yönetici kuralıyla değil "aktör = hedef"
 * ile verilir; yazılı teyit ve MFA talep adımında alınmıştır, burada aranmaz. Engeller, kilitler, kapsam ve idempotency aynıdır.
 */
export type AnonymizeInput = Mutation & {
  userId: string;
  reason: string;
  confirmUsername: string;
  actorSessionId?: string;
  self?: boolean;
  /**
   * Yalnız `self`: hesap satırı kilitliyken, silmeden önce çağrılır; false dönerse hiçbir şey silinmez (`stale`). Silme talebinin
   * hâlâ açık olduğunu kilit altında doğrular: iptal ile onay yarışında iptal kazanır.
   */
  onLocked?: (tx: Prisma.TransactionClient) => Promise<boolean>;
  /** Yalnız `self`: silme (veya zaten silinmiş) sonucu aynı transaction'da talebi kapatır. */
  onDone?: (tx: Prisma.TransactionClient) => Promise<void>;
};
export type AnonymizeRejection = "not_found" | "forbidden" | "confirmation_mismatch" | "mfa_required" | "stale" | ErasureBlocker;
export type AnonymizeResult =
  | { kind: "anonymized" | "unchanged"; at: Date }
  | { kind: "rejected"; reason: AnonymizeRejection };

export type HoldInput = Mutation & { userId: string; reason: string };
export type PlaceHoldResult =
  | { kind: "placed" | "unchanged"; hold: LegalHoldRow }
  | { kind: "rejected"; reason: "not_found" | "forbidden" | "user_deleted" };
export type ReleaseHoldResult =
  | { kind: "released" | "unchanged" }
  | { kind: "rejected"; reason: "not_found" | "forbidden" };

export interface AccountErasureStore {
  /** Salt okuma. Kullanıcı yoksa null. */
  preview(userId: string, now: Date): Promise<ErasurePreviewRow | null>;
  /**
   * Geri alınamaz anonimleştirme. Zaten anonimleştirilmişse `unchanged` (değişiklik ve audit yok). Engeller kilit altında
   * yeniden değerlendirilir; yazılı teyit eşleşmezse hiçbir şey değişmez.
   */
  anonymize(input: AnonymizeInput): Promise<AnonymizeResult>;
  placeHold(input: HoldInput): Promise<PlaceHoldResult>;
  releaseHold(input: HoldInput): Promise<ReleaseHoldResult>;
}

/** Tombstone değerleri: kişisel veri içermez, kimlikten türetilir (benzersizlik kısıtları için). */
export function tombstoneOf(userId: string): { username: string; email: string; displayName: string; passwordHash: string } {
  const hex = userId.replaceAll("-", "").toLowerCase();
  return {
    username: `silinmis_${hex.slice(-12)}`,
    email: `silinmis-${hex}@anonim.invalid`,
    displayName: "Silinmiş hesap",
    // Geçerli bir parola özeti değildir: doğrulama her zaman başarısız olur; giriş zaten deleted_at ile de kapalıdır.
    passwordHash: "!anonymized",
  };
}
