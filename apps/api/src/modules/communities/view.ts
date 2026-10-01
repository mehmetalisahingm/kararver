// CommunityCard / CommunityDetail (packages/contracts/src/domains/communities.ts). Kullanıcı ve admin
// endpoint'leri aynı görünümü kullanır; görsel yalnız APPROVED ise public URL taşır.
import type { CommunityRecord, CommunityRole } from "./store.ts";

export const publicUrl = (base: string, key: string | null) => (key ? `${base}/${key}` : null);

export const toCard = (c: CommunityRecord, mediaPublicBaseUrl: string) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  imageUrl: publicUrl(mediaPublicBaseUrl, c.imagePublicKey),
  memberCount: c.memberCount,
});

export const toDetail = (c: CommunityRecord, viewer: { role: CommunityRole | null } | null, mediaPublicBaseUrl: string) => ({
  ...toCard(c, mediaPublicBaseUrl),
  membersVisibility: c.membersVisibility,
  createdAt: c.createdAt.toISOString(),
  viewer,
});
