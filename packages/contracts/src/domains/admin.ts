// Platform ve admin — Utku (ayarlar, kullanıcılar, yaptırım, rol, audit), Mehmet (metrik, öne çıkarma,
// duyuru, puan düzeltmesi), Faruk (kategori yönetimi, KV-26)
// KV-12 (#14), KV-33 (#35), KV-36 (#38), KV-39 (#41), KV-40 (#42), KV-41 (#43), KV-42 (#44), #67
import { z } from "zod";
import { EmailChangeView } from "./auth.ts";
import { Category } from "./discovery.ts";
import { Announcement, AnnouncementAudience, FeaturedSurface, LedgerEntry } from "./growth.ts";
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

/**
 * #183 kullanıcı birleşik geçmişi (KV-33 §13): bir hesabın anket, yorum, medya, rapor, moderasyon ve yaptırım olayları tek zaman
 * çizgisinde. Salt okuma. IP/cihaz BİLEREK yoktur (veri minimizasyonu; oturum ağ bilgisi yalnız admin.users.sessions.list'te maskeli).
 * Raporlayan kimliği gösterilmez. Silinmiş/anonimleştirilmiş hesapta içerik metinleri zaten kaldırılmıştır ("Silinmiş içerik").
 */
export const UserTimelineKind = z.enum(["POLL", "COMMENT", "MEDIA", "REPORT_FILED", "REPORT_AGAINST", "MODERATION", "MODERATION_BY", "SANCTION"]);
export const UserTimelineItem = z.strictObject({
  kind: UserTimelineKind,
  id: Id,
  at: Timestamp,
  /** Anket başlığı veya yorumun ilk 140 karakteri; diğer türlerde null. */
  title: z.string().nullable(),
  /** İçerik/rapor/yaptırım durumu; moderasyonda geçişin sonraki durumu. */
  status: z.string().nullable(),
  /** Rapor nedeni, moderasyon işlemi, medya amacı veya yaptırım türü. */
  detail: z.string().nullable(),
  /** Moderasyon ve yaptırım gerekçesi. */
  reason: z.string().nullable(),
  refs: z.strictObject({ pollId: Id.nullable(), commentId: Id.nullable(), mediaId: Id.nullable(), reportId: Id.nullable(), communityId: Id.nullable() }),
  /** İşlemi yapan yönetici/moderatör (moderasyon, yaptırım); diğerlerinde null. */
  actor: z.strictObject({ id: Id, username: z.string() }).nullable(),
});
export const UserTimelineSummary = z.strictObject({
  counts: z.strictObject({
    POLL: Count,
    COMMENT: Count,
    MEDIA: Count,
    REPORT_FILED: Count,
    REPORT_AGAINST: Count,
    MODERATION: Count,
    MODERATION_BY: Count,
    SANCTION: Count,
  }),
  firstAt: Timestamp.nullable(),
  lastAt: Timestamp.nullable(),
});
/** Virgülle ayrılmış tür listesi (UserTimelineKind). */
export const UserTimelineKinds = z
  .string()
  .max(160)
  .refine((v) => v.split(",").every((k) => UserTimelineKind.safeParse(k).success), "Bilinmeyen tür")
  .refine((v) => new Set(v.split(",")).size === v.split(",").length, "Aynı tür iki kez verilemez");

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
  scopeId: Id.nullable().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  badge: z.string().trim().max(30).nullable().optional(),
  startsAt: Timestamp,
  endsAt: Timestamp,
});
const AnnouncementBody = z.strictObject({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
  level: z.enum(["INFO", "WARNING"]).optional(),
  audience: AnnouncementAudience.optional(),
  startsAt: Timestamp,
  endsAt: Timestamp.nullable().optional(),
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
  totals: z.strictObject({
    users: Count, polls: Count, votes: Count, comments: Count, openReports: Count,
    // Optional for backwards-compatible test fixtures and staggered deployments.
    activeUsers24h: Count.optional(),
    registrations24h: Count.optional(),
    activeCommunities: Count.optional(),
    removedPolls: Count.optional(),
    removedComments: Count.optional(),
    activeAccounts: Count.optional(),
    suspendedAccounts: Count.optional(),
    communityMembers: Count.optional(),
    pendingMedia: Count.optional(),
    quarantinedMedia: Count.optional(),
    moderationActions24h: Count.optional(),
  }),
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

/** KV-186 operasyon merkezi: telemetri yoksa "unknown" (0 değil); kişisel veri, IP ve bağlantı adresi içermez. */
export const OpsHealth = z.enum(["ok", "degraded", "down", "unknown"]);
const Millis = z.number().min(0);
export const OpsStatus = z.strictObject({
  generatedAt: Timestamp,
  release: z.strictObject({ sha: z.string().max(40).nullable(), env: z.string().max(20), startedAt: Timestamp }),
  components: z.strictObject({
    api: z.strictObject({ status: OpsHealth, uptimeSeconds: Count }),
    database: z.strictObject({ status: OpsHealth, latencyMs: Millis.nullable(), version: z.string().max(40).nullable() }),
    worker: z.strictObject({
      status: OpsHealth,
      /** Worker'ın son canlılık izi: heartbeat ya da tamamlanan son iş/cron turu. */
      lastSeenAt: Timestamp.nullable(),
      ageSeconds: Count.nullable(),
    }),
    queue: z.strictObject({
      status: OpsHealth,
      queues: z.array(
        z.strictObject({
          name: z.string().max(80),
          waiting: Count,
          active: Count,
          failed24h: Count,
          completed24h: Count,
          oldestWaitingSeconds: Count.nullable(),
        }),
      ),
    }),
  }),
  /** Bu API sürecinin son `windowMinutes` dakikası; süreç yeniden başlayınca sıfırlanır. */
  http: z.strictObject({
    scope: z.literal("process"),
    windowMinutes: Count,
    requests: Count,
    errors5xx: Count,
    errorRate: z.number().min(0).max(1).nullable(),
    latencyMs: z.strictObject({ p50: Millis, p95: Millis, p99: Millis }).nullable(),
    /** Route kalıbı (ör. /v1/polls/:id); kimlik ve sorgu dizesi yok. */
    slowest: z.array(z.strictObject({ method: z.string().max(10), route: z.string().max(200), count: Count, p95Ms: Millis })),
  }),
  security: z.strictObject({
    scope: z.literal("process"),
    windowMinutes: Count,
    rateLimited: Count,
    loginLockouts: Count,
    byRule: z.array(z.strictObject({ rule: z.string().max(80), count: Count })),
    /** Bütün süreçler (DB): şu an giriş kilidindeki e-posta ve IP anahtarı sayısı (KV-19). Okunamazsa null. */
    lockedLogins: z.strictObject({ emails: Count, ips: Count }).nullable().default(null),
    /** Bütün süreçler (DB): son 24 saatteki kritik yönetici işlemleri (audit). Okunamazsa null. */
    adminActions24h: z.array(z.strictObject({ action: z.string().max(80), operation: z.string().max(40), count: Count })).nullable().default(null),
  }),
  backup: z.strictObject({
    status: OpsHealth,
    lastBackupAt: Timestamp.nullable(),
    restoreDrill: z.strictObject({ at: z.iso.date(), environment: z.string().max(20), rtoSeconds: Count, reference: z.string().max(200) }).nullable(),
  }),
  /**
   * Acil durum anahtarları (KV-40): etkin değer ve son değişiklik zamanı. `propagationSeconds`: ayar önbelleğinin ömrü, yani
   * değişikliğin bütün API süreçlerine en geç yayılma süresi. Kimin değiştirdiği audit'tedir, burada yoktur. Ayar servisi
   * yoksa ya da okunamazsa null.
   */
  switches: z
    .strictObject({
      propagationSeconds: Count,
      items: z.array(
        z.strictObject({
          name: z.enum(["maintenance", "registration", "pollCreation", "comments", "uploads"]),
          key: z.string().max(80),
          enabled: z.boolean(),
          changedAt: Timestamp.nullable(),
        }),
      ),
    })
    .nullable()
    .default(null),
});

export const AdminSession = z.strictObject({
  id: Id, createdAt: Timestamp, expiresAt: Timestamp, lastSeenAt: Timestamp.nullable(),
  // Compatibility names: masked network (/24 or /48) and coarse browser/OS only; never raw identifiers.
  ipAddress: z.string().nullable(), userAgent: z.string().nullable(),
});

/** KVKK veri dışa aktarma talebi (#181). Paketin kendisi hiçbir admin yanıtında yoktur. */
export const DataExportStatus = z.enum(["PENDING", "PROCESSING", "READY", "FAILED", "EXPIRED"]);
export const DataExport = z.strictObject({
  id: Id,
  status: DataExportStatus,
  requestedAt: Timestamp,
  readyAt: Timestamp.nullable(),
  /** Paketin silineceği an (READY iken); sonrasında EXPIRED. */
  expiresAt: Timestamp.nullable(),
  sizeBytes: Count.nullable(),
  /** FAILED iken kısa hata kodu (ör. too_large); ham hata metni yok. */
  failure: z.string().nullable(),
  /** Son bağlantı gönderimi; bağlantı token'ı hiçbir yanıtta yoktur. */
  deliveredAt: Timestamp.nullable(),
  downloadCount: Count,
});
const ExportParams = z.strictObject({ id: Id, exportId: Id });

/** #181 hesap anonimleştirme (KV-33 §10): anonimleştirmeyi engelleyen durumlar. */
export const ErasureBlocker = z.enum(["legal_hold", "active_sanction", "has_role", "export_in_progress"]);
/** Yasal saklama kaydı: açıkken hesap anonimleştirilemez. Gerekçe yöneticiler içindir; kullanıcıya gösterilmez. */
export const LegalHold = z.strictObject({ id: Id, reason: z.string(), placedAt: Timestamp, placedById: Id });
/** Salt okunur etki özeti. Anonimleştirilmiş hesapta `willRemove` sayıları 0, `anonymized` true'dur. */
export const AccountErasurePreview = z.strictObject({
  userId: Id,
  /** Yazılı teyit için: yönetici bu kullanıcı adını yazar. Anonimleştirmeden sonra tombstone adıdır. */
  username: z.string(),
  anonymized: z.boolean(),
  anonymizedAt: Timestamp.nullable(),
  canAnonymize: z.boolean(),
  blockers: z.array(ErasureBlocker),
  legalHold: LegalHold.nullable(),
  /** Silinecek veya boşaltılacak kayıt adetleri. */
  willRemove: z.strictObject({
    polls: Count,
    comments: Count,
    media: Count,
    sessions: Count,
    dataExports: Count,
    avatar: Count,
    communityMemberships: Count,
    ownedCommunities: Count,
    pendingCommunityRequests: Count,
    preferences: Count,
  }),
  /** Korunan (kimliksiz) kayıt adetleri: yazar adı anonim kalır. */
  willRetain: z.strictObject({ polls: Count, comments: Count, votes: Count, reportsFiled: Count }),
});
export const AccountErasureResult = z.strictObject({ status: z.enum(["anonymized", "unchanged"]), anonymizedAt: Timestamp });
/** #181 kullanıcıya ait içeriğin toplu gizlenmesi/kaldırılması: önizleme → gerekçe → ayrı onay → kuyruk; geri alınabilir. */
export const ContentJobKind = z.enum(["HIDE", "REMOVE", "UNDO"]);
export const ContentJobStatus = z.enum(["QUEUED", "PROCESSING", "DONE", "FAILED", "CANCELLED"]);
export const ContentJobScope = z.enum(["all", "polls", "comments"]);
const ContentJobCounts = z.strictObject({ polls: Count, comments: Count });
export const ContentJobPreview = z.strictObject({
  action: z.enum(["HIDE", "REMOVE"]),
  scope: ContentJobScope,
  /** İşlemden etkilenecek anket ve yorum sayıları (şu an uygun olanlar; zaten bu durumda olanlar sayılmaz). */
  affected: ContentJobCounts,
  total: Count,
  /** Önizleme anı: onayda aynen gönderilir; yalnız bu andan önce yazılan içerik işlenir. */
  cutoffAt: Timestamp,
  /** Tek işte işlenebilecek en çok içerik; aşılırsa onay 409 too_many. */
  maxItems: Count,
});
export const ContentJob = z.strictObject({
  id: Id,
  kind: ContentJobKind,
  status: ContentJobStatus,
  scope: ContentJobScope,
  reason: z.string(),
  expected: ContentJobCounts,
  applied: Count,
  unchanged: Count,
  failed: Count,
  skipped: Count,
  /** FAILED iken kısa kod (ör. actor_not_authorized); ham hata metni yok. */
  failure: z.string().nullable(),
  /** UNDO işinin geri aldığı iş. */
  undoOfId: Id.nullable(),
  /** Bu iş şu an geri alınabilir mi (bitmiş, uygulanan öğesi var, açık iş ve önceki geri alma yok). */
  canUndo: z.boolean(),
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
const ContentJobParams = z.strictObject({ id: Id, jobId: Id });
const contentJobs = { owner: "Mert", module: "content-jobs" } as const;

/** Kullanıcının indirdiği paket: sürümlü, koleksiyonlar serbest biçimli satırlar (sözleşme alan alan sabitlenmez). */
export const DataExportPackage = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: Timestamp,
  profile: z.record(z.string(), z.unknown()),
  collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

const settings = { owner: "Utku", module: "settings" } as const;
const adminUsers = { owner: "Utku", module: "admin-users" } as const;
const mehmet = (module: string) => ({ owner: "Mehmet", module }) as const;
const categories = { owner: "Faruk", module: "categories" } as const;
const accountErasure = { owner: "Mert", module: "account-erasure" } as const;
const emailChange = { owner: "Mert", module: "email-change" } as const;
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
    id: "dataExports.download", domain: "admin", method: "POST", path: "/me/data-export/download",
    summary: "Kendi veri paketini indir (e-postadaki bağlantı token'ı + oturum)", auth: "user", provider: { owner: "Mert", module: "data-exports" }, consumers: ["web"], unblocks: ["#181"],
    availability: { status: "ready" }, request: { body: z.strictObject({ token: z.string().min(20).max(200) }) },
    responses: { 200: dataOf(DataExportPackage) }, errors: ["TOKEN_INVALID_OR_EXPIRED"], idempotency: "none", cache: "private",
    notes: [
      "Hem geçerli bağlantı token'ı hem paketin sahibi olan oturum gerekir; başkasının oturumuyla token geçersiz sayılır (TOKEN_INVALID_OR_EXPIRED, hesap varlığı sızmaz).",
      "Paket sunucuda çözülüp JSON olarak döner; her teslimde en çok 3 indirme (sonra bağlantı geçersiz). Her indirme audit'e (privacy.export.download) yazılır.",
    ],
  }),
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
  defineEndpoint({
    id: "admin.users.sessions.list", domain: "admin", method: "GET", path: "/admin/users/:id/sessions",
    summary: "Aktif kullanıcı oturumları", auth: "super_admin", provider: adminUsers, consumers: utkuUi, unblocks: ["#35"],
    availability: { status: "ready" }, request: { params: IdParams, query: CursorQuery },
    responses: { 200: pageOf(AdminSession) }, errors: ["INVALID_CURSOR"], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.users.sessions.revoke", domain: "admin", method: "POST", path: "/admin/users/:id/sessions/revoke",
    summary: "Tek veya tüm aktif oturumları kapat", auth: "super_admin", provider: adminUsers, consumers: utkuUi, unblocks: ["#35"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ sessionId: Id.optional(), reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ revokedCount: Count })) }, errors: [], idempotency: "natural", cache: "private",
  }),
  defineEndpoint({
    id: "admin.users.passwordReset.send", domain: "admin", method: "POST", path: "/admin/users/:id/password-reset",
    summary: "Kullanıcıya şifre sıfırlama bağlantısı e-postası gönder", auth: "admin", provider: adminUsers, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 202: dataOf(z.strictObject({ sent: z.boolean(), expiresAt: Timestamp })) }, errors: ["CONFLICT"],
    idempotency: "none", cache: "private",
    notes: [
      "Bağlantı yalnız kullanıcının kayıtlı e-postasına gider; yanıtta ve audit'te ham token/bağlantı yoktur, admin parolayı veya token'ı hiçbir yerde görmez.",
      "Aynı hesap için ardışık istekler arasında 60 sn bekleme, saatte en çok 5 istek vardır; aşılırsa 429 RATE_LIMITED (çift tıklama yeni token üretmez). Yeni token önceki kullanılmamış sıfırlama token'larını geçersiz kılar.",
      "Admin hedef SUPER_ADMIN gerektirir ve kimse kendi hesabı için kullanamaz (user.sanction ile aynı sanctionTarget kuralı, KV-04); kendi şifresi için normal 'şifremi unuttum' akışı vardır.",
      "409 CONFLICT details[0].code: user_deleted, user_banned (yasaklı hesaba bağlantı gönderilmez; normal 'şifremi unuttum' akışıyla aynı).",
      "sent=false: e-posta servisi cevap vermedi; token oluşmuştur ve audit yazılmıştır, bekleme süresi sonrası tekrar denenir.",
      "Bağlantı 1 saat geçerli ve tek kullanımlıktır; kullanıldığında kullanıcının bütün oturumları kapanır (auth.password.reset).",
    ],
  }),
  defineEndpoint({
    id: "admin.users.dataExports.create", domain: "admin", method: "POST", path: "/admin/users/:id/data-exports",
    summary: "KVKK veri dışa aktarma talebi başlat", auth: "super_admin", provider: { owner: "Mert", module: "data-exports" }, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 202: dataOf(DataExport) }, errors: ["CONFLICT"], idempotency: "natural", cache: "private",
    notes: [
      "Paket asenkron hazırlanır (worker, en geç ~1-2 dk): PENDING → PROCESSING → READY | FAILED. Yönetici veriyi hiçbir aşamada görmez; yanıtlar yalnız durum ve boyut taşır.",
      "Idempotent: hesabın PENDING/PROCESSING/READY (süresi dolmamış) bir talebi varsa yenisi açılmaz, mevcut talep döner (DB'de kısmi unique index); audit yalnız yeni talepte yazılır.",
      "Kapsam ve dışarıda bırakılanlar: docs/KV-33_ADMIN_USERS.md §8. Paket AES-256-GCM ile şifreli saklanır, 7 gün sonra silinir (EXPIRED).",
      "409 CONFLICT details[0].code: user_deleted (hesap anonimleştirilmiş), account_restricted (BANNED/SUSPENDED hesap indirme için giriş yapamaz; açık karar, PR notu).",
    ],
  }),
  defineEndpoint({
    id: "admin.users.dataExports.list", domain: "admin", method: "GET", path: "/admin/users/:id/data-exports",
    summary: "Hesabın veri dışa aktarma talepleri (son 20)", auth: "super_admin", provider: { owner: "Mert", module: "data-exports" }, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(z.array(DataExport)) }, errors: [], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.users.dataExports.deliver", domain: "admin", method: "POST", path: "/admin/users/:id/data-exports/:exportId/deliver",
    summary: "Hazır paketin indirme bağlantısını kullanıcının e-postasına gönder", auth: "super_admin", provider: { owner: "Mert", module: "data-exports" }, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: ExportParams, body: z.strictObject({ reason: Reason }) },
    responses: { 202: dataOf(z.strictObject({ sent: z.boolean(), linkExpiresAt: Timestamp })) }, errors: ["CONFLICT", "NOT_FOUND"], idempotency: "none", cache: "private",
    notes: [
      "Ayrı onay adımı: talep READY olduktan sonra, yönetici kimlik doğrulamasını (destek kanalı vb.) yaptığını gerekçeyle beyan ederek gönderir. Bağlantı yalnız hesabın kayıtlı e-postasına gider; yanıtta ve audit'te token/bağlantı yoktur.",
      "Bağlantı 24 saat (ve paket süresi) geçerli; yeni gönderim önceki bağlantıyı geçersiz kılar. Hesap başına 60 sn bekleme ve saatte 3 gönderim (429 RATE_LIMITED).",
      "409 CONFLICT details[0].code: not_ready (PENDING/PROCESSING/FAILED), expired (paket silinmiş). Talep başka hesaba aitse 404.",
      "sent=false: e-posta servisi cevap vermedi; token oluşmuştur, bekleme süresi sonrası tekrar denenir.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.erasure.preview", domain: "admin", method: "GET", path: "/admin/users/:id/erasure",
    summary: "Hesap anonimleştirme önizlemesi (etki özeti, engeller)", auth: "super_admin", provider: accountErasure, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(AccountErasurePreview) }, errors: ["NOT_FOUND"], idempotency: "none", cache: "private",
    notes: [
      "Salt okuma: hiçbir şey yazmaz. Yetki user.anonymize (SUPER_ADMIN, sanctionTarget: kendi hesabı için kullanılamaz).",
      "blockers: legal_hold (açık yasal saklama), active_sanction (süresi dolmamış, WARNING dışı yaptırım: ban/askı kaçırma riski, meşru menfaat saklaması), has_role (önce rol kaldırılır), export_in_progress (kullanıcının erişim hakkı için bekleyen/işlenen veri paketi talebi). Engel varken canAnonymize=false.",
      "Kapsam, saklama ve silme tablosu: docs/KV-33_ADMIN_USERS.md §10.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.erasure.create", domain: "admin", method: "POST", path: "/admin/users/:id/erasure",
    summary: "Hesabı geri alınamaz biçimde anonimleştir", auth: "super_admin", provider: accountErasure, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason, confirmUsername: z.string().trim().min(1).max(60) }) },
    responses: { 200: dataOf(AccountErasureResult) }, errors: ["CONFLICT", "NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: [
      "GERİ ALINAMAZ. Gövdede gerekçe ve hesabın o anki kullanıcı adı (yazılı teyit) zorunludur; eşleşmezse 409 confirmation_mismatch ve hiçbir şey değişmez.",
      "Tek transaction: kişisel alanlar tombstone değerleriyle değişir (e-posta, kullanıcı adı, görünen ad, biyografi, avatar, parola özeti), oturum ve token'lar silinir, tercihler/bildirim ayarları/kayıt listesi silinir, topluluk üyelikleri çıkarılır ve sahip olunan topluluklar yönetici yönetimine döner, bekleyen topluluk başvuruları reddedilir, hazır veri paketleri geçersiz kılınır. Paylaşım/yorum metinleri ve sürümleri kaldırılır; tüm görseller depo temizliğine alınır. Hesapla bağlı oy/olay satırları kimliksiz istatistiğe dönüştürülür; rapor ve audit saklama kapsamındadır. Mutation mevcut oturuma bağlı tek kullanımlık MFA gerektirir (mfa_required).",
      "Idempotent: hesap zaten anonimleştirilmişse 200 status=unchanged döner; değişiklik ve audit yoktur. Eşzamanlı iki istekten yalnız biri uygular (hedef satır kilidi + hesap başına tek kayıt).",
      "409 CONFLICT details[0].code: confirmation_mismatch, legal_hold, active_sanction, has_role, export_in_progress. Önizleme aynı engelleri listeler.",
      "Tüm yüklenen görseller hemen yayından kalkar; worker 20 kayıtlık gruplar ve 1-15 dakika gecikmeli tekrar denemeyle depodan temizler.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.legalHold.put", domain: "admin", method: "PUT", path: "/admin/users/:id/legal-hold",
    summary: "Hesaba yasal saklama koy (anonimleştirmeyi engeller)", auth: "super_admin", provider: accountErasure, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ legalHold: LegalHold })) }, errors: ["CONFLICT", "NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: [
      "Idempotent: açık kayıt varsa o döner; değişiklik ve audit yoktur (gerekçe değiştirilmez). 409 user_deleted: anonimleştirilmiş hesaba kayıt konmaz.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.legalHold.release", domain: "admin", method: "POST", path: "/admin/users/:id/legal-hold/release",
    summary: "Yasal saklamayı kaldır", auth: "super_admin", provider: accountErasure, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ legalHold: z.null() })) }, errors: ["NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: ["Idempotent: açık kayıt yoksa 200 döner; değişiklik ve audit yoktur. Kayıt silinmez, bırakma alanları dolar."],
  }),
  defineEndpoint({
    id: "admin.users.emailChange.start", domain: "admin", method: "POST", path: "/admin/users/:id/email-change",
    summary: "Destek yoluyla e-posta değişimi başlat (yeni adres doğrulaması zorunlu)", auth: "super_admin", provider: emailChange, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ newEmail: z.email().max(254), reason: Reason }) },
    responses: { 202: dataOf(z.strictObject({ status: z.enum(["VERIFICATION_SENT", "SEND_FAILED"]), expiresAt: Timestamp.nullable() })) },
    errors: ["CONFLICT", "NOT_FOUND", "FEATURE_DISABLED"], idempotency: "none", cache: "private",
    notes: [
      "Eski adrese erişimini kaybeden kullanıcı içindir; destek kanalında kimlik doğrulandığı gerekçede beyan edilir. DOĞRULAMA ATLANMAZ: e-posta yalnız kullanıcı YENİ adresteki bağlantıyı tıklayınca değişir ve o zaman doğrulanmış sayılır. Yönetici adresi doğrulanmış işaretleyemez, parola veya token görmez.",
      "Eski adrese hemen bilgilendirme ve 'bu ben değilim' bağlantısı gider (gerçek sahip talebi durdurabilir; oturumlar kapanır). Kendi hesabı için kullanılamaz (sanctionTarget); kendi adresini değiştirmek için me.emailChange.request vardır.",
      "409 CONFLICT details[0].code: email_taken, same_email, user_deleted, request_open (açık talep var; önce iptal edilir). Ayar account.emailChangeEnabled kapalıyken 503.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.emailChange.list", domain: "admin", method: "GET", path: "/admin/users/:id/email-change",
    summary: "Hesabın son e-posta değişimi talepleri (son 10, maskeli)", auth: "super_admin", provider: emailChange, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(z.array(EmailChangeView)) }, errors: ["NOT_FOUND"], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.users.emailChange.cancel", domain: "admin", method: "POST", path: "/admin/users/:id/email-change/cancel",
    summary: "Açık e-posta değişimi talebini iptal et", auth: "super_admin", provider: emailChange, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ cancelled: z.boolean() })) }, errors: ["NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: ["Idempotent: açık talep yoksa cancelled=false, değişiklik ve audit yok. Özellik kapalıyken de çalışır."],
  }),
  defineEndpoint({
    id: "admin.users.contentJobs.preview", domain: "admin", method: "GET", path: "/admin/users/:id/content-jobs/preview",
    summary: "Toplu içerik işlemi önizlemesi (etki sayacı)", auth: "admin", provider: contentJobs, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" },
    request: { params: IdParams, query: z.strictObject({ action: z.enum(["HIDE", "REMOVE"]), scope: ContentJobScope.default("all") }) },
    responses: { 200: dataOf(ContentJobPreview) }, errors: [], idempotency: "none", cache: "private",
    notes: [
      "Salt okuma: hiçbir şey yazmaz. Sayılar mevcut moderasyon geçiş kurallarına göre uygun içeriktir (HIDE: yalnız ACTIVE; REMOVE: ACTIVE, UNDER_REVIEW, HIDDEN, LOCKED; zaten REMOVED olanlar sayılmaz).",
      "Yetki user.content.bulk: ADMIN+; admin hedef SUPER_ADMIN ister, kendi hesabına uygulanamaz (sanctionTarget).",
    ],
  }),
  defineEndpoint({
    id: "admin.users.contentJobs.create", domain: "admin", method: "POST", path: "/admin/users/:id/content-jobs",
    summary: "Önizlenen toplu içerik işlemini onayla ve kuyruğa al", auth: "admin", provider: contentJobs, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z.strictObject({
        action: z.enum(["HIDE", "REMOVE"]),
        scope: ContentJobScope,
        cutoffAt: Timestamp,
        expected: ContentJobCounts,
        reason: Reason,
      }),
    },
    responses: { 202: dataOf(ContentJob) }, errors: ["CONFLICT"], idempotency: "natural", cache: "private",
    notes: [
      "Ayrı onay adımıdır: sunucu sayıları cutoffAt ile yeniden hesaplar; önizlemedekinden farklıysa 409 preview_stale (önizleme tekrarlanır). cutoffAt 15 dakikadan eskiyse 409 preview_expired.",
      "409 CONFLICT details[0].code: preview_stale, preview_expired, nothing_to_do (uygun içerik yok), too_many (tek işte en çok maxItems), job_open (hesapta açık iş var; DB'de kısmi unique index), user_deleted.",
      "İş DB kuyruğunda işlenir (API sürecindeki çalıştırıcı, en geç birkaç sn); her içerik mevcut moderasyon uygulamasından geçer: durum geçişi, sayaçlar, moderation_actions, audit (moderation.*.apply), olay ve açık raporların kapanması aynı öğe transaction'ında. İş düzeyinde audit user.content.bulk / request.",
      "Çalıştırıcı her turda aktörün yetkisini ve hedefin rolünü yeniden doğrular; aktör yetkisini kaybettiyse iş FAILED (actor_not_authorized) olur ve kalan içeriğe dokunmaz.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.contentJobs.list", domain: "admin", method: "GET", path: "/admin/users/:id/content-jobs",
    summary: "Hesabın toplu içerik işleri (son 20)", auth: "admin", provider: contentJobs, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(z.array(ContentJob)) }, errors: [], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.users.contentJobs.undo", domain: "admin", method: "POST", path: "/admin/users/:id/content-jobs/:jobId/undo",
    summary: "Bitmiş toplu içerik işlemini geri al", auth: "admin", provider: contentJobs, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: ContentJobParams, body: z.strictObject({ reason: Reason }) },
    responses: { 202: dataOf(ContentJob) }, errors: ["CONFLICT", "NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: [
      "Güvenli geri alma: yalnız işin uyguladığı ve önceki durumu ACTIVE olan içerik geri yüklenir (RESTORE); işten sonra durumu başka biri değiştirdiyse (ör. yeniden kaldırma, taşıma sonrası kilit) atlanır (SKIPPED). Önceki durumu ACTIVE olmayanlar (HIDDEN, LOCKED, UNDER_REVIEW) geri yüklenince daha görünür olacağı için geri alınmaz.",
      "409 CONFLICT details[0].code: not_undoable (iş bitmemiş, uygulanan öğe yok veya zaten geri alınmış), job_open, user_deleted. İş başka hesaba aitse 404.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.contentJobs.cancel", domain: "admin", method: "POST", path: "/admin/users/:id/content-jobs/:jobId/cancel",
    summary: "Kuyruktaki veya işlenmekte olan toplu içerik işini durdur", auth: "admin", provider: contentJobs, consumers: utkuUi, unblocks: ["#181"],
    availability: { status: "ready" }, request: { params: ContentJobParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(ContentJob) }, errors: ["CONFLICT", "NOT_FOUND"], idempotency: "natural", cache: "private",
    notes: ["İşlenmiş içerik olduğu gibi kalır (geri almak için undo); kalan içeriğe dokunulmaz. 409 not_cancellable: iş zaten bitmiş."],
  }),
  defineEndpoint({
    id: "admin.users.timeline", domain: "admin", method: "GET", path: "/admin/users/:id/timeline",
    summary: "Kullanıcı birleşik geçmişi: anket, yorum, medya, rapor, moderasyon ve yaptırım tek zaman çizgisinde", auth: "admin", provider: adminUsers, consumers: utkuUi, unblocks: ["#183"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      query: z.strictObject({
        ...CursorQuery.shape,
        kinds: UserTimelineKinds.optional(),
        communityId: Id.optional(),
        contentId: Id.optional(),
        from: Timestamp.optional(),
        to: Timestamp.optional(),
      }),
    },
    responses: { 200: pageOf(UserTimelineItem) }, errors: ["INVALID_CURSOR", "NOT_FOUND"], idempotency: "none", cache: "private",
    notes: [
      "Salt okuma, ADMIN+ (user.read). En yeni önce; keyset (zaman, tür, kimlik). Süzgeçler: kinds (virgülle tür listesi), communityId (olayın topluluğu; medya olayları topluluk taşımaz), contentId (anket, yorum veya medya kimliği: o içerikle ilişkili olaylar), from (dahil) / to (hariç). Süzgeç değişince eski cursor 400 INVALID_CURSOR.",
      "Türler: POLL, COMMENT, MEDIA (yüklenenler), REPORT_FILED (kullanıcının yaptığı), REPORT_AGAINST (kullanıcıya veya içeriğine yapılan; raporlayan gösterilmez), MODERATION (kullanıcının içeriği/hesabı üzerindeki kararlar), MODERATION_BY (kullanıcı moderatörse verdiği kararlar), SANCTION.",
      "IP ve cihaz bilgisi bu uçta YOKTUR (veri minimizasyonu). Silinmiş/anonimleştirilmiş hesapta içerik metinleri kaldırıldığından başlıklar 'Silinmiş içerik' görünür.",
    ],
  }),
  defineEndpoint({
    id: "admin.users.timeline.summary", domain: "admin", method: "GET", path: "/admin/users/:id/timeline/summary",
    summary: "Kullanıcı birleşik geçmişi özeti: tür başına olay sayısı ve ilk/son olay zamanı", auth: "admin", provider: adminUsers, consumers: utkuUi, unblocks: ["#183"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(UserTimelineSummary) }, errors: ["NOT_FOUND"], idempotency: "none", cache: "private",
    notes: ["Salt okuma, ADMIN+ (user.read). Süzgeçsiz tüm olaylar üzerinden sayar; zaman çizgisi süzgeçleriyle karşılaştırma için başlık çipleri içindir."],
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
        .strictObject({ type: SanctionType, reason: Reason, endsAt: Timestamp.nullable().default(null), reportId: Id.optional() })
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
      "reportId (KV-37): moderasyon kuyruğundan uygulanan yaptırımı rapora bağlar. Rapor, hedefin sahibi bu kullanıcı olan bir rapor olmalı (409 report_mismatch; rapor yoksa 404). Aynı transaction'da hedefin açık raporları ACTIONED olur, moderation_actions SANCTION_USER ve audit after.reportId yazılır.",
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
    id: "admin.roleApprovals.get", domain: "admin", method: "GET", path: "/admin/role-approvals/:id",
    summary: "İkinci onay öncesi hedef, rol ve gerekçeyi göster", auth: "super_admin",
    provider: { owner: "Utku", module: "rbac" }, consumers: utkuUi, unblocks: ["#182"],
    availability: { status: "ready" }, request: { params: IdParams },
    responses: { 200: dataOf(z.strictObject({ id: Id, userId: Id, initiatorId: Id, role: Role, expectedRole: Role,
      reason: Reason, status: z.enum(["PENDING", "APPROVED", "EXPIRED", "CONSUMED", "REJECTED"]), expiresAt: Timestamp })) },
    errors: ["CONFLICT"], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.roleApprovals.request", domain: "admin", method: "POST", path: "/admin/role-approvals",
    summary: "Kritik rol değişikliği için MFA doğrulanmış onay talebi", auth: "super_admin",
    provider: { owner: "Utku", module: "rbac" }, consumers: utkuUi, unblocks: ["#182"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ userId: Id, role: Role, reason: Reason }) },
    responses: { 201: dataOf(z.strictObject({ id: Id, userId: Id, role: Role, status: z.literal("PENDING"), expiresAt: Timestamp })) },
    errors: ["FORBIDDEN", "CONFLICT"], idempotency: "none", cache: "private",
  }),
  defineEndpoint({
    id: "admin.roleApprovals.approve", domain: "admin", method: "POST", path: "/admin/role-approvals/:id/approve",
    summary: "Farklı SUPER_ADMIN tarafından MFA doğrulanmış ikinci onay", auth: "super_admin",
    provider: { owner: "Utku", module: "rbac" }, consumers: utkuUi, unblocks: ["#182"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ reason: Reason }) },
    responses: { 200: dataOf(z.strictObject({ id: Id, userId: Id, role: Role, status: z.literal("APPROVED"), expiresAt: Timestamp })) },
    errors: ["FORBIDDEN", "CONFLICT"], idempotency: "none", cache: "private",
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
    request: { params: IdParams, body: z.strictObject({ role: Role, reason: Reason, approvalId: Id.optional() }) },
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
    availability: { status: "ready" },
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
    notes: ["Operasyon sayaçları yönetici/test hesapları dahil veritabanı durumunu gösterir. KV-07 ürün analitiğinin actor_type dışlama kuralı ayrı ölçüm hattına aittir; bu endpoint ürün analitiği değildir."],
  }),
  defineEndpoint({
    id: "admin.ops.status",
    domain: "admin",
    method: "GET",
    path: "/admin/ops",
    summary: "Operasyon durumu: bileşenler, kuyruk, hata/gecikme, hız sınırı, yedek",
    auth: "super_admin",
    provider: { owner: "Faruk", module: "ops" },
    consumers: ["Faruk (operasyon merkezi UI)"],
    unblocks: ["#186"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(OpsStatus) },
    errors: [],
    idempotency: "none",
    cache: "private",
    notes: [
      "Eksik telemetri `unknown` döner, 0 değil. HTTP ve hız sınırı sayaçları süreç içidir (scope=process).",
      "Ham bağlantı adresi, IP, e-posta ve istek gövdesi dönmez; route'lar kalıp olarak (`:id`) verilir.",
    ],
  }),
  ...crud("/admin/featured", "admin.featured", FeaturedPlacement, FeaturedBody, mehmet("featured"), mehmetUi, ["#44"], "Öne çıkarma"),
  ...crud("/admin/announcements", "admin.announcements", Announcement, AnnouncementBody, mehmet("announcements"), mehmetUi, ["#44"], "Duyuru"),
  ...crud("/admin/categories", "admin.categories", AdminCategory, CategoryBody, categories, ["Mehmet (kategori yönetim ekranı, KV-41)"], ["#28", "#43"], "Kategori").filter(
    // Kategori silinmez, pasife alınır (isActive=false).
    (e) => e.method !== "DELETE",
  ),
];
