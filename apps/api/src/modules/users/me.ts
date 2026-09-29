// Oturum sahibinin kendi görünümü (contracts: Me). Sadece /me ve login cevabında döner;
// e-posta ve hesap durumu başka hiçbir kullanıcı görünümüne konmaz (PublicUser).
import type { UserRecord } from "../auth/store.ts";

export function toMe(user: UserRecord, mediaPublicBaseUrl: string) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    avatarUrl: user.avatarPublicKey ? `${mediaPublicBaseUrl}/${user.avatarPublicKey}` : null,
    bio: user.bio,
    status: user.status,
    // Rol ataması RBAC ile gelir (KV-04 #6, KV-12 #14); o zamana kadar her hesap USER'dır.
    roles: ["USER"],
    createdAt: user.createdAt.toISOString(),
  };
}
