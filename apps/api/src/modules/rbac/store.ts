// Ortak RBAC katmanının veri erişim arayüzü — KV-12 (#14). Üretim uygulaması: prisma-store.ts.
// Rol, yaptırım ve topluluk moderatörlüğü her istekte DB'den okunur; önbellek yoktur. Böylece rol
// verme/alma ve yaptırım uygulama/kaldırma açık oturumda bir sonraki istekte etkilidir.
// Hesap durumu (users.status) ve e-posta doğrulaması oturum çözülürken zaten her istekte okunur (SessionUser).
import type { ActorSanction, TrustedActor } from "@kararver/contracts";

export type ActorGrants = {
  /** user_roles satırı; yoksa boş (USER). */
  roles: TrustedActor["roles"][number][];
  /** Kaldırılmamış ve süresi dolmamış yaptırımlar: lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now). */
  sanctions: ActorSanction[];
};

export interface RbacStore {
  grants(userId: string, now: Date): Promise<ActorGrants>;
  /** community_memberships.role = MODERATOR olan topluluklar. */
  moderatedCommunityIds(userId: string): Promise<string[]>;
}
