// İçerik sürüm geçmişi okuma (#66). Üretim uygulaması: prisma-store.ts. Yazım: write.ts.
import type { RevisionTarget } from "./write.ts";

export type RevisionRecord = {
  version: number;
  editor: { id: string; username: string; displayName: string; avatarPublicKey: string | null };
  editedAt: Date;
  snapshot: Record<string, unknown>;
};

export interface RevisionStore {
  /** İçerik var mı (kaldırılmış dahil; geçmiş yöneticiye kaldırılan içerik için de açıktır). */
  exists(target: RevisionTarget, id: string): Promise<boolean>;
  /** En yeni sürüm önce; `beforeVersion` verilirse ondan küçükler. */
  list(target: RevisionTarget, id: string, beforeVersion: number | null, limit: number): Promise<RevisionRecord[]>;
}
