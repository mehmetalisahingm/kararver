// Topluluk endpoint'leri — KV-31 (#33). Sözleşme: packages/contracts/src/domains/communities.ts
// Kapsam dışı: admin.communities.* (KV-32, #34) moderator/admin yetki seviyesi gelince (KV-12, #14).
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import type { CommunityRecord, CommunityRole, CommunityStore, MemberRecord, MembersVisibility } from "./store.ts";

export type CommunityDeps = { store: CommunityStore; now: () => Date; mediaPublicBaseUrl: string };

const notFound = () => new ApiError("NOT_FOUND", "Topluluk bulunamadı.");

/** Üye listesini kim görebilir. Yetkisiz izleyici 404 alır; listenin varlığı sızmaz (sözleşme notu). */
export function canSeeMembers(visibility: MembersVisibility, viewerRole: CommunityRole | null): boolean {
  if (visibility === "PUBLIC") return true;
  if (visibility === "MEMBERS") return viewerRole !== null;
  return viewerRole === "MODERATOR";
}

export function registerCommunityRoutes(route: Route, deps: CommunityDeps): void {
  const { store, now } = deps;
  const url = (key: string | null) => (key ? `${deps.mediaPublicBaseUrl}/${key}` : null);

  const card = (c: CommunityRecord) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    imageUrl: url(c.imagePublicKey),
    memberCount: c.memberCount,
  });

  const member = (m: MemberRecord) => ({
    user: { id: m.user.id, username: m.user.username, displayName: m.user.displayName, avatarUrl: url(m.user.avatarPublicKey) },
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
  });

  route("communities.list", async ({ query }) => {
    const key = decodeCursor("communities.list", query.cursor, ["number", "string"]);
    const rows = await store.listActive(key ? { memberCount: key[0] as number, id: key[1] as string } : null, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor("communities.list", [last.memberCount, last.id]) : null;
    return { status: 200, body: { data: page.map(card), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("communities.get", async ({ params, viewer }) => {
    const community = await store.findActiveBySlug(params.slug);
    if (!community) throw notFound();
    const role = viewer ? await store.roleOf(community.id, viewer.id) : null;
    return {
      status: 200,
      body: {
        data: {
          ...card(community),
          membersVisibility: community.membersVisibility,
          createdAt: community.createdAt.toISOString(),
          viewer: viewer ? { role } : null,
        },
      },
    };
  });

  route("communities.members", async ({ params, query, viewer }) => {
    const community = await store.findActiveById(params.id);
    if (!community) throw notFound();
    const role = viewer ? await store.roleOf(community.id, viewer.id) : null;
    if (!canSeeMembers(community.membersVisibility, role)) throw notFound();

    const list = `communities.members:${community.id}`;
    const key = decodeCursor(list, query.cursor, ["string", "string"]);
    const rows = await store.listMembers(
      community.id,
      key ? { joinedAt: new Date(key[0] as string), userId: key[1] as string } : null,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(list, [last.joinedAt.toISOString(), last.user.id]) : null;
    return { status: 200, body: { data: page.map(member), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("communities.join", async ({ params, viewer }) => {
    // Kapatılmış topluluğa yeni üye alınmaz; zaten üye olan için de 404 (topluluk görünmüyor).
    if (!(await store.findActiveById(params.id))) throw notFound();
    const role = await store.join(params.id, viewer!.id, now());
    return { status: 200, body: { data: { role } } };
  });

  route("communities.leave", async ({ params, viewer }) => {
    if (!(await store.exists(params.id))) throw notFound();
    await store.leave(params.id, viewer!.id);
    return { status: 204, body: null };
  });
}
