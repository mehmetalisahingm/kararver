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

/** #184 yönetici görünümü: kapalı topluluklar dahil; hassas alan yok (üye listesinde yalnız PublicUser). */
export const AdminCommunityStatus = z.enum(["ACTIVE", "HIDDEN"]);

/** #172 başvuruyla açılan topluluğun 7 gün / 10 üye eşiği. NOT_APPLICABLE: yönetici açtı, eşik uygulanmaz. */
export const CommunityThresholdState = z.enum(["NOT_APPLICABLE", "IN_PROGRESS", "REACHED", "OVERDUE", "AUTO_CLOSED", "REOPENED"]);
export const CommunityThreshold = z.strictObject({
  state: CommunityThresholdState,
  requestId: Id.nullable(),
  requiredMembers: Count,
  /** Canlı üye sayısı (önbellek sütunu değil, üyelik satırları). */
  members: Count,
  approvedAt: Timestamp.nullable(),
  approvalDeadline: Timestamp.nullable(),
  closedAt: Timestamp.nullable(),
  /** IN_PROGRESS iken kalan gün (yukarı yuvarlanmış); diğer durumlarda null. */
  daysLeft: Count.nullable(),
});

/** Topluluk sahibi (#184 / KV-54 S1): yalnız kimlik ve görünen ad; e-posta yok. null = sahipsiz (yönetici yönetimi, V1 davranışı). */
export const CommunityOwnerRef = z.strictObject({ id: Id, username: z.string(), displayName: z.string() });

export const AdminCommunityRow = z.strictObject({
  id: Id,
  slug: z.string(),
  name: z.string(),
  status: AdminCommunityStatus,
  membersVisibility: MembersVisibility,
  members: Count,
  moderators: Count,
  polls: Count,
  createdAt: Timestamp,
  owner: CommunityOwnerRef.nullable().default(null),
  threshold: CommunityThreshold,
});

export const AdminCommunityOverview = z.strictObject({
  ...AdminCommunityRow.shape,
  description: z.string().nullable(),
  createdBy: z.strictObject({ id: Id, username: z.string(), displayName: z.string() }),
  /** Kapatma/açma ve silinen içerik dışındaki etkiyi önizlemek için sayılar (hepsi şu anki durum). */
  impact: z.strictObject({
    members: Count,
    moderators: Count,
    /** Silinmemiş (REMOVED olmayan) anketler. */
    polls: Count,
    activePolls: Count,
    /** Hâlâ oy alan (ACTIVE ve süresi dolmamış) anketler. */
    openPolls: Count,
    /** ACTIVE anketlerdeki ACTIVE yorum toplamı. */
    comments: Count,
    openReports: Count,
  }),
  /** Son 10 yönetim izi (audit): kim, ne zaman, ne yaptı, gerekçe. Önce/sonra özeti dönmez. */
  recentChanges: z.array(
    z.strictObject({
      at: Timestamp,
      action: z.string(),
      operation: z.string(),
      reason: z.string().nullable(),
      /** null: sistem (worker) işlemi. */
      actor: z.strictObject({ id: Id, username: z.string(), displayName: z.string() }).nullable(),
    }),
  ),
});

const communities = { owner: "Mert", module: "communities" } as const;
const OwnerReason = z.string().trim().min(3).max(500);
const OwnerResult = z.strictObject({ owner: CommunityOwnerRef.nullable() });
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
    id: "admin.communities.owner.put", domain: "communities", method: "PUT", path: "/admin/communities/:id/owner",
    summary: "Topluluğa sahip ata veya sahibi değiştir (yönetici zorunlu atama)", auth: "super_admin", provider: communities, consumers: ["KararVer admin"],
    unblocks: ["#184"], availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ userId: Id, reason: OwnerReason }) },
    responses: { 200: dataOf(OwnerResult) }, errors: ["CONFLICT", "NOT_FOUND", "FEATURE_DISABLED"], idempotency: "natural", cache: "private",
    notes: [
      "communities.ownershipEnabled kapalıyken 503 FEATURE_DISABLED (varsayılan kapalı; V1 davranışı). Aynı kullanıcı zaten sahipse değişiklik ve audit yoktur (idempotent).",
      "Sahip uygun olmalı: hesap ACTIVE, silinmemiş ve e-postası gerçekten doğrulanmış (geçici doğrulama gevşetmesi yok sayılır); aynı anda en çok 3 topluluğa sahip olabilir. 409 CONFLICT details[0].code: user_not_eligible, owner_limit. Kullanıcı yoksa 404.",
      "Sahip aynı zamanda üyedir: üyeliği yoksa MEMBER olarak eklenir (sayaç aynı transaction'da). Mevcut moderatör rolü korunur. DB tetikleyicisi sahip olan kullanıcının üyeliğinin silinmesini engeller.",
      "Sahiplik şu an ek yetki vermez (düzenleme, moderatör atama, devir sonraki dilimler: KV-54 S2–S3); yalnız kayıttır. Kritik işlemdir: ikinci onay/MFA (#182) gelene kadar gerekçe + audit (community.owner.assign / assign).",
    ],
  }),
  defineEndpoint({
    id: "admin.communities.owner.release", domain: "communities", method: "POST", path: "/admin/communities/:id/owner/release",
    summary: "Topluluğun sahibini kaldır (topluluk yönetici yönetimine döner)", auth: "super_admin", provider: communities, consumers: ["KararVer admin"],
    unblocks: ["#184"], availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: OwnerReason }) },
    responses: { 200: dataOf(OwnerResult) }, errors: [], idempotency: "natural", cache: "private",
    notes: ["Sahip yoksa değişiklik ve audit yoktur. Bayrak kapalıyken de çalışır (güvenli yön). Üyelik ve içerik etkilenmez. Audit community.owner.assign / release."],
  }),
  defineEndpoint({
    id: "communities.owner.release", domain: "communities", method: "POST", path: "/communities/:id/owner/release",
    summary: "Sahip kendi sahipliğini bırakır", auth: "owner", provider: communities, consumers: web, unblocks: ["#184"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(OwnerResult) }, errors: [], idempotency: "natural", cache: "private",
    notes: [
      "Yalnız o topluluğun sahibi (başkası 403; sahip yoksa da 403). Topluluk yönetici yönetimine döner; üyelik ve içerik etkilenmez. Audit community.owner.release / release.",
      "Sahip topluluktan ayrılamaz: communities.leave 409 owner_must_release (önce sahipliği bırakır).",
    ],
  }),
  defineEndpoint({
    id: "admin.communities.listAll", domain: "communities", method: "GET", path: "/admin/communities",
    summary: "Yönetici topluluk listesi (kapalı olanlar dahil)", auth: "admin", provider: communities, consumers: ["KararVer admin"],
    unblocks: ["#184"], availability: { status: "ready" },
    request: { query: z.strictObject({ ...CursorQuery.shape, status: AdminCommunityStatus.optional(), q: z.string().trim().min(2).max(60).optional() }) },
    responses: { 200: pageOf(AdminCommunityRow) }, errors: ["INVALID_CURSOR"], idempotency: "none", cache: "private",
    notes: [
      "En yeni önce (createdAt, id). q ad veya slug içinde arar (en az 2 karakter). Cursor status ve q'ya bağlıdır; filtre değişince eski cursor 400 INVALID_CURSOR.",
      "threshold her satırda özetlenir: yönetici açtıysa NOT_APPLICABLE, #172 başvurusuyla açıldıysa 7 gün / 10 üye eşiğinin durumu.",
    ],
  }),
  defineEndpoint({
    id: "admin.communities.overview", domain: "communities", method: "GET", path: "/admin/communities/:id/overview",
    summary: "Topluluk genel bakış: durum, etki sayıları, eşik ve son yönetim izi", auth: "admin", provider: communities, consumers: ["KararVer admin"],
    unblocks: ["#184"], availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(AdminCommunityOverview) }, errors: [], idempotency: "none", cache: "private",
    notes: [
      "Kapatma/açma kararından önce etkiyi önizlemek içindir (salt okuma). Kapatılan topluluk public liste/sayfadan, katılımdan ve yeni anket açmaktan çıkar; üyelikler, anketler ve moderatör rolleri silinmez (KV-32).",
      "threshold.state: IN_PROGRESS (süre sürüyor), REACHED (süre doldu, 10+ üye), OVERDUE (süre doldu, eşik altı: günlük worker kapanışı bekleniyor; elle HIDDEN yapılmış topluluğu worker kapatmaz), AUTO_CLOSED (worker kapattı), REOPENED (otomatik kapanıştan sonra yönetici yeniden açtı; yeniden otomatik kapanmaz).",
    ],
  }),
  defineEndpoint({
    id: "admin.communities.members", domain: "communities", method: "GET", path: "/admin/communities/:id/members",
    summary: "Yönetici üye listesi (arama ve rol süzgeçli)", auth: "admin", provider: communities, consumers: ["KararVer admin"],
    unblocks: ["#184"], availability: { status: "ready" },
    request: { params: IdParams, query: z.strictObject({ ...CursorQuery.shape, q: z.string().trim().min(2).max(60).optional(), role: CommunityRole.optional() }) },
    responses: { 200: pageOf(CommunityMember) }, errors: ["INVALID_CURSOR"], idempotency: "none", cache: "private",
    notes: [
      "membersVisibility yöneticiye uygulanmaz (kapalı topluluk dahil); ama yanıt public listeyle aynı şemadır: e-posta, gerçek kimlik ve hesap durumu yok.",
      "q kullanıcı adı veya görünen adda arar (en az 2 karakter). Silinmiş hesaplar listelenmez. Katılım zamanına göre yeniden eskiye.",
    ],
  }),
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
    errors: ["CONFLICT"],
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
