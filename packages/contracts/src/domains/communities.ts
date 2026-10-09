// Topluluklar — sağlayıcı Mert · KV-31 (#33), KV-32 (#34)
import { z } from "zod";
import { Count, CursorQuery, dataOf, Empty, Id, IdParams, pageOf, PublicUser, Timestamp, Url } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

export const CommunityRole = z.enum(["MEMBER", "MODERATOR"]);
export const MembersVisibility = z.enum(["PUBLIC", "MEMBERS", "MODERATORS"]);

export const CommunityCard = z.strictObject({
  id: Id,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: Url.nullable(),
  memberCount: Count,
});

export const CommunityDetail = z.strictObject({
  ...CommunityCard.shape,
  membersVisibility: MembersVisibility,
  createdAt: Timestamp,
  viewer: z.strictObject({ role: CommunityRole.nullable() }).nullable(),
});

/** Üye listesinde e-posta, gerçek kimlik, hesap durumu yok (V1_USER_FLOW). */
export const CommunityMember = z.strictObject({ user: PublicUser, role: CommunityRole, joinedAt: Timestamp });

const communities = { owner: "Mert", module: "communities" } as const;
const requestsProvider = { owner: "Mehmet", module: "community-requests" } as const;
const web = ["Ümit (web)", "Mert (topluluk UI, KV-31)"];
const SlugParams = z.strictObject({ slug: z.string().regex(/^[a-z0-9-]{2,60}$/) });

const CommunityBody = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional(),
  imageMediaId: Id.optional(),
  membersVisibility: MembersVisibility.default("MEMBERS"),
});

export const CommunityRequestView = z.strictObject({
  id: Id,
  requesterId: Id,
  communityId: Id.nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  categoryId: Id.nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CLOSED"]),
  rejectionReason: z.string().nullable(),
  approvedAt: Timestamp.nullable(),
  approvalDeadline: Timestamp.nullable(),
  closedAt: Timestamp.nullable(),
  memberCount: Count,
  createdAt: Timestamp,
});

const CommunityRequestBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  description: z.string().trim().max(1000).optional(),
  categoryId: Id.optional(),
});

export const communityEndpoints = [
  defineEndpoint({
    id: "communities.list",
    domain: "communities",
    method: "GET",
    path: "/communities",
    summary: "Açık topluluklar",
    auth: "public",
    provider: communities,
    consumers: web,
    unblocks: ["#33"],
    availability: { status: "ready" },
    request: { query: CursorQuery },
    responses: { 200: pageOf(CommunityCard) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "public",
  }),
  defineEndpoint({
    id: "communities.get",
    domain: "communities",
    method: "GET",
    path: "/communities/:slug",
    summary: "Topluluk sayfası (akışı: GET /feed?communityId=)",
    auth: "public",
    provider: communities,
    consumers: web,
    unblocks: ["#33"],
    availability: { status: "ready" },
    request: { params: SlugParams },
    responses: { 200: dataOf(CommunityDetail) },
    errors: [],
    idempotency: "none",
    cache: "viewer",
  }),
  defineEndpoint({
    id: "communities.members",
    domain: "communities",
    method: "GET",
    path: "/communities/:id/members",
    summary: "Sayfalı üye listesi",
    auth: "public",
    provider: communities,
    consumers: web,
    unblocks: ["#33"],
    availability: { status: "ready" },
    request: { params: IdParams, query: CursorQuery },
    responses: { 200: pageOf(CommunityMember) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
    notes: ["membersVisibility sunucuda uygulanır; yetkisiz izleyici 403 değil 404 alır (liste varlığı sızmaz)."],
  }),
  defineEndpoint({
    id: "communities.join",
    domain: "communities",
    method: "PUT",
    path: "/communities/:id/membership",
    summary: "Topluluğa katıl",
    auth: "user",
    provider: communities,
    consumers: web,
    unblocks: ["#33"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(z.strictObject({ role: CommunityRole })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "communities.leave",
    domain: "communities",
    method: "DELETE",
    path: "/communities/:id/membership",
    summary: "Topluluktan ayrıl",
    auth: "user",
    provider: communities,
    consumers: web,
    unblocks: ["#33"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "admin.communities.create",
    domain: "communities",
    method: "POST",
    path: "/admin/communities",
    summary: "Topluluk aç",
    auth: "admin",
    provider: communities,
    consumers: ["Mert (admin UI, KV-32)"],
    unblocks: ["#34"],
    availability: { status: "ready" },
    request: { body: CommunityBody },
    responses: { 201: dataOf(CommunityDetail) },
    errors: ["CONFLICT"],
    idempotency: "key-optional",
    cache: "private",
    notes: ["slug çakışması 409 CONFLICT (details.field='slug')."],
  }),
  defineEndpoint({
    id: "admin.communities.update",
    domain: "communities",
    method: "PATCH",
    path: "/admin/communities/:id",
    summary: "Topluluğu düzenle / kapat",
    auth: "admin",
    provider: communities,
    consumers: ["Mert (admin UI, KV-32)"],
    unblocks: ["#34"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z
        .strictObject({
          ...CommunityBody.partial().shape,
          // partial() default'u korur: gönderilmeyen alan MEMBERS'a sıfırlanırdı (zod 4).
          membersVisibility: MembersVisibility.optional(),
          status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
          reason: z.string().trim().min(3).max(500),
        })
        .refine((b) => Object.keys(b).length > 1, "Değiştirilecek en az bir alan gönderilmeli"),
    },
    responses: { 200: dataOf(CommunityDetail) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "admin.communities.moderators.put",
    domain: "communities",
    method: "PUT",
    path: "/admin/communities/:id/moderators/:userId",
    summary: "Topluluk moderatörü ata",
    auth: "admin",
    provider: communities,
    consumers: ["Mert (admin UI, KV-32)"],
    unblocks: ["#34"],
    availability: { status: "ready" },
    request: { params: z.strictObject({ id: Id, userId: Id }), body: z.strictObject({ reason: z.string().trim().min(3).max(500) }) },
    responses: { 200: dataOf(z.strictObject({ role: z.literal("MODERATOR") })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "admin.communities.moderators.delete",
    domain: "communities",
    method: "DELETE",
    path: "/admin/communities/:id/moderators/:userId",
    summary: "Topluluk moderatörlüğünü kaldır",
    auth: "admin",
    provider: communities,
    consumers: ["Mert (admin UI, KV-32)"],
    unblocks: ["#34"],
    availability: { status: "ready" },
    request: { params: z.strictObject({ id: Id, userId: Id }) },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),

  // KV-172: kullanıcı başvurusu ve yönetici karar kuyruğu.
  defineEndpoint({
    id: "communities.requests.create", domain: "communities", method: "POST",
    path: "/communities/requests", summary: "Topluluk oluşturma başvurusu",
    auth: "user", provider: requestsProvider, consumers: ["KararVer web"],
    unblocks: ["#172"], availability: { status: "ready" },
    request: { body: CommunityRequestBody },
    responses: { 201: dataOf(CommunityRequestView), 200: dataOf(CommunityRequestView) },
    errors: ["CONFLICT"], idempotency: "natural", cache: "private",
  }),
  defineEndpoint({
    id: "communities.requests.mine", domain: "communities", method: "GET",
    path: "/communities/requests/mine", summary: "Kendi topluluk başvurularım",
    auth: "user", provider: requestsProvider, consumers: ["KararVer web"],
    unblocks: ["#172"], availability: { status: "ready" },
    request: {}, responses: { 200: dataOf(z.array(CommunityRequestView)) },
    errors: [], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.communities.requests.list", domain: "communities", method: "GET",
    path: "/admin/communities/requests", summary: "Topluluk başvuru kuyruğu",
    auth: "admin", provider: requestsProvider, consumers: ["KararVer admin"],
    unblocks: ["#172"], availability: { status: "ready" },
    request: { query: z.strictObject({ status: z.enum(["PENDING","APPROVED","REJECTED","CLOSED"]).optional() }) },
    responses: { 200: dataOf(z.array(CommunityRequestView)) },
    errors: [], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.communities.requests.decide", domain: "communities", method: "PATCH",
    path: "/admin/communities/requests/:id", summary: "Topluluk başvurusu onay / red",
    auth: "admin", provider: requestsProvider, consumers: ["KararVer admin"],
    unblocks: ["#172"], availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({
      decision: z.enum(["APPROVE", "REJECT"]),
      reason: z.string().trim().min(3).max(500),
    }) },
    responses: { 200: dataOf(CommunityRequestView) },
    errors: ["CONFLICT"], idempotency: "natural", cache: "private",
  }),
];
