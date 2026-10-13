// Hesap anonimleştirme ve yasal saklama — #181. Kurallar: docs/KV-33_ADMIN_USERS.md §10. Üretim uygulaması: prisma-store.ts.
//
// Her değiştiren işlem tek transaction'dadır: hedef kullanıcı satırı kilitlenir (admin-users ile aynı kilit), yetki taze
// aktörle yeniden verilir, ardından kişisel veri temizliği, kalıcı kayıt (account_erasures) ve audit birlikte yazılır.
import type { Mutation } from "../admin-users/store.ts";

export type ErasureBlocker = "legal_hold" | "active_sanction" | "has_role" | "export_in_progress";

export type LegalHoldRow = { id: string; reason: string; createdAt: Date; placedById: string };

export type RemovalCounts = {
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

export type AnonymizeInput = Mutation & { userId: string; reason: string; confirmUsername: string };
export type AnonymizeRejection = "not_found" | "forbidden" | "confirmation_mismatch" | ErasureBlocker;
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
