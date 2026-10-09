// Oturum sahibinin kendi görünümü (contracts: Me). Sadece /me ve login cevabında döner;
// e-posta ve hesap durumu başka hiçbir kullanıcı görünümüne konmaz (PublicUser).
import type { UserRecord } from "../auth/store.ts";
import type { ActorGrants } from "../rbac/store.ts";

type Role = ActorGrants["roles"][number];

/** Hesabın rolleri `user_roles`'tan (RBAC, KV-12) okunur; rol satırı yoksa USER. */
export type RolesOf = (userId: string) => Promise<Role[]>;

export function toMe(user: UserRecord, mediaPublicBaseUrl: string, roles: readonly Role[], emailVerificationRequired = true) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailVerified: !emailVerificationRequired || user.emailVerifiedAt !== null,
    avatarUrl: user.avatarPublicKey ? `${mediaPublicBaseUrl}/${user.avatarPublicKey}` : null,
    bio: user.bio,
    status: user.status,
    // Yönetim ekranları (menü ve düğme gizleme) bunu okur; yetkinin kendisi her istekte sunucuda DB'den verilir.
    roles: [...roles],
    createdAt: user.createdAt.toISOString(),
  };
}
