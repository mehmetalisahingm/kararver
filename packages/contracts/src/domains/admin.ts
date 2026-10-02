// Platform ve admin — Utku (ayarlar, kullanıcılar, yaptırım, rol, audit), Mehmet (metrik, öne çıkarma,
// duyuru, puan düzeltmesi), Faruk (kategori yönetimi, KV-26)
// KV-12 (#14), KV-33 (#35), KV-36 (#38), KV-39 (#41), KV-40 (#42), KV-41 (#43), KV-42 (#44), #67
import { z } from "zod";
import { Category } from "./discovery.ts";
import { Announcement, LedgerEntry } from "./growth.ts";
import { AllowedMimeType } from "./media.ts";
import { ReportReason, ReportStatus, ReportTargetType } from "./moderation.ts";
import {
  ContentStatus,
  Count,
  CursorQuery,
  dataOf,
  Empty,
  Id,
  IdParams,
  pageOf,
  PublicUser,
  Role,
  Timestamp,
  UserStatus,
} from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

const Reason = z.string().trim().min(3).max(500);

/** Herkese açık yapılandırma: istemci doğrulama sınırlarını buradan okur (sunucu yine doğrular). */
export const PublicConfig = z.strictObject({
  polls: z.strictObject({
    minOptions: z.number().int().min(2),
    maxOptions: z.number().int().max(6),
    minDurationHours: z.number().int().min(1),
    maxDurationHours: z.number().int(),
    titleMaxLength: z.number().int(),
    descriptionMaxLength: z.number().int(),
    voteChangeAllowed: z.boolean(),
  }),
  comments: z.strictObject({ bodyMaxLength: z.number().int() }),
  media: z.strictObject({
    maxBytes: z.number().int().positive(),
    maxPerPoll: z.number().int().min(0),
    allowedTypes: z.array(AllowedMimeType),
  }),
  points: z.strictObject({ initialGrant: Count, publishCost: Count }),
  features: z.strictObject({
    registration: z.boolean(),
    pollCreation: z.boolean(),
    comments: z.boolean(),
    uploads: z.boolean(),
  }),
  maintenance: z.boolean(),
});

export const SanctionType = z.enum(["WARNING", "RESTRICT_COMMENTS", "RESTRICT_POSTING", "SUSPEND", "BAN"]);
export const Sanction = z.strictObject({
  id: Id,
  type: SanctionType,
  reason: z.string(),
  startsAt: Timestamp,
  endsAt: Timestamp.nullable(),
  liftedAt: Timestamp.nullable(),
  createdBy: PublicUser,
  /** Kaldıran yönetici ve gerekçesi; kaldırılmamışsa null (KV-33). */
  liftedBy: PublicUser.nullable(),
  liftReason: z.string().nullable(),
});

export const AdminUserSummary = z.strictObject({
  ...PublicUser.shape,
  email: z.email(),
  status: UserStatus,
  roles: z.array(Role),
  createdAt: Timestamp,
  reportCount: Count,
});
export const AdminUserDetail = z.strictObject({
  ...AdminUserSummary.shape,
  emailVerified: z.boolean(),
  lastLoginAt: Timestamp.nullable(),
  stats: z.strictObject({ pollCount: Count, commentCount: Count, voteCount: Count }),
  activeSanctions: z.array(Sanction),
});

/** Kullanıcının hesabına/içeriğine yapılan veya kullanıcının yaptığı rapor (KV-33). Raporlayan kimliği dönmez. */
export const AdminUserReport = z.strictObject({
  id: Id,
  target: z.strictObject({ type: ReportTargetType, id: Id }),
  reason: ReportReason,
  status: ReportStatus,
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});

/** Kullanıcının anket ve yorumları; gizli/kaldırılmış içerik dahil (KV-33). Oylar yalnız sayı olarak (`stats`). */
export const AdminUserActivity = z.strictObject({
  kind: z.enum(["POLL", "COMMENT"]),
  id: Id,
  pollId: Id,
  /** Anket başlığı veya yorumun ilk 140 karakteri. */
  excerpt: z.string(),
  status: ContentStatus,
  createdAt: Timestamp,
});

export const Setting = z.strictObject({
  key: z.string().regex(/^[a-z]+(\.[a-zA-Z]+)+$/),
  value: z.unknown(),
  version: z.number().int().min(1),
  updatedAt: Timestamp,
  updatedBy: PublicUser.nullable(),
});

/** Audit kaydını kim üretti: API isteği (aktör dolu), CLI veya worker (aktör null). KV-39 */
export const AuditSource = z.enum(["API", "CLI", "WORKER"]);
export const AuditEntry = z.strictObject({
  id: Id,
  actor: PublicUser.nullable(),
  source: AuditSource,
  /** KV-04 işlem kimliği (`actions`) veya sistem işlemi (`systemAuditActions`). */
  action: z.string(),
  /** İşlemin türü (ör. vote.invalidate → invalidate | restore); izinli değerler `auditOperations`. */
  operation: z.string(),
  target: z.strictObject({ type: z.string(), id: z.string() }),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: Timestamp,
});

export const FeaturedSurface = z.enum([
  "HOME_SPOTLIGHT",
  "FEED_TOP",
  "DAILY_PICK",
  "CATEGORY",
  "COMMUNITY",
  "EDITORS_CHOICE",
]);
export const FeaturedPlacement = z.strictObject({
  id: Id,
  pollId: Id,
  surface: FeaturedSurface,
  scopeId: Id.nullable(),
  priority: z.number().int(),
  badge: z.string().max(30).nullable(),
  startsAt: Timestamp,
  endsAt: Timestamp,
});
const FeaturedBody = z.strictObject({
  pollId: Id,
  surface: FeaturedSurface,
  scopeId: Id.nullable().default(null),
  priority: z.number().int().min(0).max(1000).default(0),
  badge: z.string().trim().max(30).nullable().default(null),
  startsAt: Timestamp,
  endsAt: Timestamp,
});
const AnnouncementBody = z.strictObject({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
  level: z.enum(["INFO", "WARNING"]).default("INFO"),
  startsAt: Timestamp,
  endsAt: Timestamp.nullable().default(null),
});

export const AdminCategory = z.strictObject({ ...Category.shape, isActive: z.boolean(), pollCount: Count });
const CategoryBody = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  iconKey: z.string().max(60).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const Metrics = z.strictObject({
  range: z.enum(["7d", "30d"]),
  generatedAt: Timestamp,
  totals: z.strictObject({ users: Count, polls: Count, votes: Count, comments: Count, openReports: Count }),
  series: z.array(
    z.strictObject({
      localDate: z.iso.date(),
      activeUsers: Count,
      registrations: Count,
      polls: Count,
      votes: Count,
      comments: Count,
    }),
  ),
});

const settings = { owner: "Utku", module: "settings" } as const;
const adminUsers = { owner: "Utku", module: "admin-users" } as const;
const mehmet = (module: string) => ({ owner: "Mehmet", module }) as const;
const categories = { owner: "Faruk", module: "categories" } as const;
const utkuUi = ["Utku (admin UI)"];
const mehmetUi = ["Mehmet (admin UI)"];

const crud = (
  base: string,
  domainId: string,
  item: z.ZodType,
  body: z.ZodObject,
  provider: { owner: "Mehmet" | "Faruk" | "Utku" | "Mert" | "Ümit"; module: string },
  consumers: string[],
  unblocks: string[],
  label: string,
) => [
  defineEndpoint({
    id: `${domainId}.list`,
    domain: "admin",
    method: "GET",
    path: base,
    summary: `${label} listesi`,
    auth: "admin",
    provider,
    consumers,
    unblocks,
    availability: { status: "ready" },
    request: { query: CursorQuery },
    responses: { 200: pageOf(item) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
  }),
  defineEndpoint({
    id: `${domainId}.create`,
    domain: "admin",
    method: "POST",
    path: base,
    summary: `${label} oluştur`,
    auth: "admin",
    provider,
    consumers,
    unblocks,
    availability: { status: "ready" },
    request: { body: body.extend({ reason: Reason }) },
    responses: { 201: dataOf(item) },
    errors: ["CONFLICT"],
    idempotency: "key-optional",
    cache: "private",
  }),
  defineEndpoint({
    id: `${domainId}.update`,
    domain: "admin",
    method: "PATCH",
    path: `${base}/:id`,
    summary: `${label} düzenle`,
    auth: "admin",
    provider,
    consumers,
    unblocks,
    availability: { status: "ready" },
    request: { params: IdParams, body: body.partial().extend({ reason: Reason }) },
    responses: { 200: dataOf(item) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: `${domainId}.delete`,
    domain: "admin",
    method: "DELETE",
    path: `${base}/:id`,
    summary: `${label} kaldır`,
    auth: "admin",
    provider,
    consumers,
    unblocks,
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
];

export const adminEndpoints = [
  defineEndpoint({
    id: "config.get",
    domain: "admin",
    method: "GET",
    path: "/config",
    summary: "Public limitler, puan maliyeti, özellik anahtarları",
    auth: "public",
    provider: settings,
    consumers: ["Ümit (web)", "herkes"],
    unblocks: ["#42", "#15", "#18"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(PublicConfig) },
    errors: [],
    idempotency: "none",
    cache: "public",
    notes: ["Kısa süreli cache (≤60 sn); ayar değişince invalidation (KV-40)."],
  }),
  defineEndpoint({
    id: "admin.users.list",
    domain: "admin",
    method: "GET",
    path: "/admin/users",
    summary: "Kullanıcı arama",
    auth: "admin",
    provider: adminUsers,
    consumers: utkuUi,
    unblocks: ["#35"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        // En az 3 karakter: kullanıcı adı/görünen ad araması trigram index'i kullanır (KV-26).
        q: z.string().trim().min(3).max(100).optional(),
        status: UserStatus.optional(),
      }),
    },
    responses: { 200: pageOf(AdminUserSummary) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: [
      "q: kullanıcı adı ve görünen adda içerir araması; '@' içeriyorsa e-postada tam eşleşme. Silinmiş hesaplar durumlarıyla listelenir.",
      "roles tek elemanlıdır (kullanıcı başına tek global rol); rol satırı yoksa [\"USER\"].",
    ],
  }),
  defineEndpoint({
    id: "admin.users.get",
    domain: "admin",
    method: "GET",
    path: "/admin/users/:id",
    summary: "Kullanıcı detayı, aktivite ve yaptırımlar",
    auth: "admin",
    provider: adminUsers,
    consumers: utkuUi,
    unblocks: ["#35"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(AdminUserDetail) },
    errors: [],
    idempotency: "none",
    cache: "private",
  }),
  ...(["sanctions", "reports", "activity"] as const).map((sub) =>
    defineEndpoint({
      id: `admin.users.${sub}`,
      domain: "admin",
      method: "GET",
      path: `/admin/users/:id/${sub}`,
      summary: {
        sanctions: "Kullanıcının bütün yaptırım geçmişi (kaldırılan ve süresi dolanlar dahil)",
        reports: "Kullanıcıya (hesap veya içerik) yapılan ya da kullanıcının yaptığı raporlar",
        activity: "Kullanıcının anket ve yorumları (gizli/kaldırılmış dahil)",
      }[sub],
      auth: "admin",
      provider: adminUsers,
      consumers: utkuUi,
      unblocks: ["#35"],
      availability: { status: "ready" },
      request: {
        params: IdParams,
        query:
          sub === "reports"
            ? z.strictObject({ ...CursorQuery.shape, side: z.enum(["against", "filed"]).default("against") })
            : CursorQuery,
      },
      responses: { 200: pageOf({ sanctions: Sanction, reports: AdminUserReport, activity: AdminUserActivity }[sub]) },
      errors: ["INVALID_CURSOR"],
      idempotency: "none",
      cache: "private",
    }),
  ),
  defineEndpoint({
    id: "admin.sanctions.create",
    domain: "admin",
    method: "POST",
    path: "/admin/users/:id/sanctions",
    summary: "Uyarı / kısıt / suspend / ban",
    auth: "admin",
    provider: adminUsers,
    consumers: utkuUi,
    unblocks: ["#35"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z
        .strictObject({ type: SanctionType, reason: Reason, endsAt: Timestamp.nullable().default(null) })
        .refine((b) => b.type !== "SUSPEND" || b.endsAt !== null, { message: "SUSPEND için endsAt zorunlu", path: ["endsAt"] })
        // BAN kalıcıdır; DB de reddeder (sanctions_ban_permanent_check, DATA_MODEL §9.1).
        .refine((b) => b.type !== "BAN" || b.endsAt === null, { message: "BAN için endsAt null olmalı", path: ["endsAt"] })
        // WARNING bir kayıttır, süresi yoktur (KV-33).
        .refine((b) => b.type !== "WARNING" || b.endsAt === null, { message: "WARNING için endsAt null olmalı", path: ["endsAt"] }),
    },
    responses: { 201: dataOf(Sanction) },
    errors: ["CONFLICT"],
    idempotency: "key-optional",
    cache: "private",
    notes: [
      "SUSPEND/BAN açık oturumları aynı transaction'da iptal eder.",
      "Admin sadece USER/MODERATOR hesaplara yaptırım uygular; admin hedefler SUPER_ADMIN gerektirir (KV-04).",
      "users.status aynı transaction'da aktif yaptırımlardan yeniden hesaplanır (statusFromSanctions).",
      "409 CONFLICT details[0].code: already_active (aynı tipte aktif yaptırım; WARNING hariç), user_deleted, last_super_admin. Farklı tipe geçiş (ör. SUSPEND aktifken BAN) serbesttir.",
      "endsAt geçmişte ise 400 VALIDATION_ERROR.",
    ],
  }),
  defineEndpoint({
    id: "admin.sanctions.lift",
    domain: "admin",
    method: "POST",
    path: "/admin/users/:id/sanctions/:sanctionId/lift",
    summary: "Yaptırımı kaldır",
    auth: "admin",
    provider: adminUsers,
    consumers: utkuUi,
    unblocks: ["#35"],
    availability: { status: "ready" },
    request: { params: z.strictObject({ id: Id, sanctionId: Id }), body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(Sanction) },
    errors: ["CONFLICT"],
    idempotency: "none",
    cache: "private",
    notes: [
      "409 CONFLICT details[0].code: already_lifted (zaten kaldırılmış), expired (süresi dolmuş). İkisi de audit yazmaz.",
      "Silinmiş hesabın yaptırımı kaldırılabilir. users.status kalan aktif yaptırımlardan yeniden hesaplanır.",
    ],
  }),
  defineEndpoint({
    id: "admin.roles.put",
    domain: "admin",
    method: "PUT",
    path: "/admin/users/:id/role",
    summary: "Rol ata",
    auth: "super_admin",
    provider: { owner: "Utku", module: "rbac" },
    consumers: utkuUi,
    unblocks: ["#14", "#35"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ role: Role, reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ userId: Id, roles: z.array(Role) })) },
    errors: ["CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Kendi rolünü değiştirme ve son aktif SUPER_ADMIN'i düşürme 409 CONFLICT.",
      "role: USER rol satırını kaldırır (revoke). Mevcut rolle aynı rol 200, değişiklik ve audit yok.",
      "roles tek elemanlıdır (kullanıcı başına tek global rol). Audit: user.role.assign / grant | revoke | change.",
    ],
  }),
  defineEndpoint({
    id: "admin.settings.list",
    domain: "admin",
    method: "GET",
    path: "/admin/settings",
    summary: "Bütün sistem ayarları (sürümlü)",
    auth: "admin",
    provider: settings,
    consumers: utkuUi,
    unblocks: ["#42"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(z.array(Setting)) },
    errors: [],
    idempotency: "none",
    cache: "private",
  }),
  defineEndpoint({
    id: "admin.settings.update",
    domain: "admin",
    method: "PATCH",
    path: "/admin/settings/:key",
    summary: "Tek ayarı değiştir (iyimser kilit)",
    auth: "super_admin",
    provider: settings,
    consumers: utkuUi,
    unblocks: ["#42"],
    availability: { status: "ready" },
    request: {
      params: z.strictObject({ key: Setting.shape.key }),
      body: z.strictObject({ value: z.unknown(), version: z.number().int().min(1), reason: Reason }),
    },
    responses: { 200: dataOf(Setting) },
    errors: ["VERSION_CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: ["Bilinmeyen anahtar 404; tip/aralık dışı değer 400. version eski ise 409 VERSION_CONFLICT."],
  }),
  defineEndpoint({
    id: "admin.emergency.put",
    domain: "admin",
    method: "PUT",
    path: "/admin/emergency",
    summary: "Acil durum anahtarları (tek işlemle kapat/aç)",
    auth: "super_admin",
    provider: settings,
    consumers: utkuUi,
    unblocks: ["#42"],
    availability: { status: "ready" },
    request: {
      body: z.strictObject({
        switches: z
          .strictObject({
            registration: z.boolean().optional(),
            pollCreation: z.boolean().optional(),
            comments: z.boolean().optional(),
            uploads: z.boolean().optional(),
            maintenance: z.boolean().optional(),
          })
          .refine((s) => Object.keys(s).length > 0),
        reason: Reason,
      }),
    },
    responses: { 200: dataOf(PublicConfig.shape.features.extend({ maintenance: z.boolean() })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "admin.audit.list",
    domain: "admin",
    method: "GET",
    path: "/admin/audit",
    summary: "Değiştirilemez audit kayıtları",
    auth: "admin",
    provider: { owner: "Utku", module: "audit" },
    consumers: utkuUi,
    unblocks: ["#41"],
    availability: { status: "ready" },
    request: {
      query: z.strictObject({
        ...CursorQuery.shape,
        actorId: Id.optional(),
        targetType: z.string().max(40).optional(),
        targetId: z.string().max(64).optional(),
        action: z.string().max(80).optional(),
        operation: z.string().max(40).optional(),
        source: AuditSource.optional(),
        from: Timestamp.optional(),
        to: Timestamp.optional(),
      }),
    },
    responses: { 200: pageOf(AuditEntry) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "private",
    notes: ["Audit için yazma/silme endpoint'i yoktur."],
  }),
  defineEndpoint({
    id: "admin.points.adjust",
    domain: "admin",
    method: "POST",
    path: "/admin/users/:id/point-adjustments",
    summary: "Gerekçeli puan düzeltmesi",
    auth: "admin",
    provider: mehmet("points"),
    consumers: utkuUi,
    unblocks: ["#67"],
    availability: { status: "planned", tableIn: "#67" },
    request: {
      params: IdParams,
      body: z.strictObject({ delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0), reason: Reason }),
    },
    responses: { 201: dataOf(LedgerEntry) },
    errors: ["INSUFFICIENT_POINTS"],
    idempotency: "key-required",
    cache: "private",
    notes: ["Bakiye negatife düşemez (409 INSUFFICIENT_POINTS). Audit'e önce/sonra bakiyesiyle yazılır."],
  }),
  defineEndpoint({
    id: "admin.metrics.get",
    domain: "admin",
    method: "GET",
    path: "/admin/metrics",
    summary: "Dashboard metrikleri",
    auth: "admin",
    provider: mehmet("analytics"),
    consumers: mehmetUi,
    unblocks: ["#38"],
    availability: { status: "ready" },
    request: { query: z.strictObject({ range: z.enum(["7d", "30d"]).default("7d") }) },
    responses: { 200: dataOf(Metrics) },
    errors: [],
    idempotency: "none",
    cache: "private",
    notes: ["actor_type=test/seed/admin hesaplar metriklerden hariçtir (KV-07)."],
  }),
  ...crud("/admin/featured", "admin.featured", FeaturedPlacement, FeaturedBody, mehmet("featured"), mehmetUi, ["#44"], "Öne çıkarma"),
  ...crud("/admin/announcements", "admin.announcements", Announcement, AnnouncementBody, mehmet("announcements"), mehmetUi, ["#44"], "Duyuru"),
  ...crud("/admin/categories", "admin.categories", AdminCategory, CategoryBody, categories, ["Mehmet (kategori yönetim ekranı, KV-41)"], ["#28", "#43"], "Kategori").filter(
    // Kategori silinmez, pasife alınır (isActive=false).
    (e) => e.method !== "DELETE",
  ),
];
