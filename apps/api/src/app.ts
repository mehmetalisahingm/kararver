import { registerDecisionRoutes } from "./modules/decisions/routes.ts";
import type { DecisionStore } from "./modules/decisions/store.ts";
// Fastify uygulaması. Bağımlılıklar dışarıdan verilir; server.ts gerçeklerini, testler kendi
// store/mailer/saatini bağlar. Yeni modül: src/modules/<modül>/routes.ts + aşağıya bir satır.
import { randomUUID } from "node:crypto";
import { headers } from "@kararver/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { createRouter } from "./http/route.ts";
import { registerSecurity } from "./http/security.ts";
import type { Mailer } from "./mail/mailer.ts";
import { registerAdminUserRoutes } from "./modules/admin-users/routes.ts";
import { registerAccountDeletionRoutes } from "./modules/account-deletion/routes.ts";
import type { AccountDeletionStore } from "./modules/account-deletion/store.ts";
import { registerUserTimelineRoutes } from "./modules/admin-users/timeline.ts";
import type { UserTimelineStore } from "./modules/admin-users/timeline.ts";
import { registerEmailChangeRoutes } from "./modules/email-change/routes.ts";
import type { EmailChangeStore } from "./modules/email-change/store.ts";
import { registerAccountErasureRoutes } from "./modules/account-erasure/routes.ts";
import type { AccountErasureStore } from "./modules/account-erasure/store.ts";
import { registerContentJobRoutes } from "./modules/content-jobs/routes.ts";
import type { ContentJobStore } from "./modules/content-jobs/store.ts";
import { registerDataExportRoutes } from "./modules/data-exports/routes.ts";
import type { DataExportStore } from "./modules/data-exports/store.ts";
import type { AdminUserStore } from "./modules/admin-users/store.ts";
import type { PasswordHasher } from "./modules/auth/crypto.ts";
import { registerAuthRoutes } from "./modules/auth/routes.ts";
import { registerCommunityAdminRoutes } from "./modules/communities/admin-routes.ts";
import { registerCommunityOwnerRoutes, type CommunityOwnerStore } from "./modules/communities/owner.ts";
import { registerCommunityAdminReadRoutes, type CommunityAdminReadStore } from "./modules/communities/admin-read.ts";
import { registerCommunityRoutes } from "./modules/communities/routes.ts";
import type { CommunityStore } from "./modules/communities/store.ts";
import { registerCommunityRequestRoutes, type CommunityRequestStore } from "./modules/communities/request-routes.ts";
import type { MediaQueue } from "./modules/media/queue.ts";
import { registerMediaAdminRoutes } from "./modules/media/admin-routes.ts";
import { registerMediaRoutes } from "./modules/media/routes.ts";
import { registerPublicMediaRoutes } from "./modules/media/public-routes.ts";
import type { MediaStorage } from "./modules/media/storage.ts";
import { DEFAULT_MEDIA_SETTINGS, type MediaSettings, type MediaStore } from "./modules/media/store.ts";
import { createAuthenticator, type SessionSettings } from "./modules/auth/session.ts";
import type { AuthStore } from "./modules/auth/store.ts";
import { registerCategoryAdminRoutes } from "./modules/categories/routes.ts";
import type { CategoryAdminStore } from "./modules/categories/store.ts";
import { registerFeaturedAdminRoutes } from "./modules/featured/routes.ts";
import type { FeaturedAdminStore } from "./modules/featured/store.ts";
import { registerCommentRoutes } from "./modules/comments/routes.ts";
import type { CommentStore } from "./modules/comments/store.ts";
import { DEFAULT_FEED_SETTINGS, type FeedSettings } from "./modules/feed/for-you.ts";
import { registerFeedRoutes } from "./modules/feed/routes.ts";
import { registerOnboardingRoutes } from "./modules/onboarding/routes.ts";
import type { OnboardingStore } from "./modules/onboarding/store.ts";
import type { FeedStore } from "./modules/feed/store.ts";
import { registerPointAdminRoutes } from "./modules/points/admin-routes.ts";
import type { PointAdminStore } from "./modules/points/admin-store.ts";
import { registerPollRoutes } from "./modules/polls/routes.ts";
import { registerProfileRoutes } from "./modules/profiles/routes.ts";
import type { ProfileStore } from "./modules/profiles/store.ts";
import { registerBulkModerationRoutes } from "./modules/moderation/bulk-routes.ts";
import type { BulkModerationStore } from "./modules/moderation/bulk.ts";
import type { BulkApprovalStore } from "./modules/moderation/bulk-approval.ts";
import { registerModerationRoutes } from "./modules/moderation/routes.ts";
import type { ModerationStore } from "./modules/moderation/store.ts";
import { registerNotificationRoutes } from "./modules/notifications/routes.ts";
import type { NotificationStore } from "./modules/notifications/store.ts";
import { registerReportRoutes } from "./modules/reports/routes.ts";
import { registerSpamScoreRoutes, type SpamScoreStore } from "./modules/spam-score/routes.ts";
import { registerSettingsRoutes } from "./modules/settings/routes.ts";
import type { SettingsService } from "./modules/settings/service.ts";
import type { ReportStore } from "./modules/reports/store.ts";
import { registerRoleRoutes } from "./modules/rbac/roles-routes.ts";
import { registerMfaRoutes } from "./modules/security/routes.ts";
import { registerRoleApprovalRoutes } from "./modules/security/approval-routes.ts";
import type { RoleApprovalStore } from "./modules/security/approval-store.ts";
import type { MfaStore } from "./modules/security/store.ts";
import type { RbacStore } from "./modules/rbac/store.ts";
import { registerRevisionRoutes } from "./modules/revisions/routes.ts";
import { registerAuditRoutes } from "./modules/audit/routes.ts";
import { registerSecurityAlertRoutes } from "./modules/security-alerts/routes.ts";
import type { SecurityAlertStore } from "./modules/security-alerts/store.ts";
import type { AuditStore } from "./modules/audit/store.ts";
import type { RevisionStore } from "./modules/revisions/store.ts";
import { registerSearchRoutes } from "./modules/search/routes.ts";
import type { SearchStore } from "./modules/search/store.ts";
import { registerShareRoutes } from "./modules/shares/routes.ts";
import type { ShareStore } from "./modules/shares/store.ts";
import { registerTrendRoutes } from "./modules/trends/routes.ts";
import type { TrendStore } from "./modules/trends/store.ts";
import { DEFAULT_POLL_SETTINGS, type PollSettings, type PollStore } from "./modules/polls/store.ts";
import { createRateLimiter } from "./modules/rate-limit/limiter.ts";
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from "./modules/rate-limit/policy.ts";
import type { RateLimitStore } from "./modules/rate-limit/store.ts";
import { registerUserRoutes } from "./modules/users/routes.ts";
import { registerVoteAdminRoutes } from "./modules/votes/admin-routes.ts";
import { registerVoteRoutes } from "./modules/votes/routes.ts";
import type { VoteStore } from "./modules/votes/store.ts";
import { registerMetricsRoutes } from "./modules/metrics/routes.ts";
import type { MetricsStore } from "./modules/metrics/store.ts";
import type { OpsProbe } from "./modules/ops/probe.ts";
import { registerOpsRoutes } from "./modules/ops/routes.ts";
import { buildHealth, cachedDatabaseCheck } from "./modules/ops/health.ts";
import { emergencySwitchesView } from "./modules/ops/switches.ts";
import { createOpsTelemetry, type OpsTelemetry } from "./modules/ops/telemetry.ts";

export type AppDeps = {
 decisionStore?: DecisionStore;
  config: Config;
  authStore: AuthStore;
  /** MFA endpoints only when a persistent store is available. */
  mfaStore?: MfaStore;
  roleApprovalStore?: RoleApprovalStore;
  /** Rol, yaptırım ve topluluk moderatörlüğü (KV-12); her istekte okunur. */
  rbacStore: RbacStore;
  hasher: PasswordHasher;
  mailer: Mailer;
  now?: () => Date;
  /** Sistem ayarları servisi (KV-40, #42). Verilirse ayar kancaları (aşağıdaki `is*`/`*Settings`) ondan türetilir; açıkça verilen kanca önceliklidir (testler). */
  settingsService?: SettingsService;
  isRegistrationEnabled?: () => Promise<boolean>;
  /** Verilmezse anket route'ları kaydedilmez (ör. sadece auth'u test eden düzenek). */
  pollStore?: PollStore;
  /** KV-22 public profil/private bookmark store'u; pollStore ile birlikte route'ları açar. */
  profileStore?: ProfileStore;
  /** KV-25 kaynak ölçümlü paylaşım linkleri; public route olduğu için oturum gerekmez. */
  shareStore?: ShareStore;
  /** V1 #67 gerekçeli admin puan düzeltmesi; verilmezse admin.points.adjust kaydedilmez. */
  pointAdminStore?: PointAdminStore;
  /** Sistem ayarları (KV-40, #42); ayar servisi gelene kadar DEFAULT_POLL_SETTINGS. */
  pollSettings?: () => Promise<PollSettings>;
  /** KV-19 (#21) hız sınırı sayaçları; verilmezse hız sınırı yok (ör. auth-only web test sunucusu). */
  rateLimitStore?: RateLimitStore;
  /** `limits.*` (KV-40, #42); ayar servisi gelene kadar DEFAULT_RATE_LIMIT_SETTINGS. */
  rateLimitSettings?: () => Promise<RateLimitSettings>;
  /** pollStore ile birlikte verilirse kategori ve arama route'ları kaydedilir. */
  searchStore?: SearchStore;
  /** Verilmezse içerik sürüm geçmişi (admin.revisions.*, #66) kaydedilmez. */
  revisionStore?: RevisionStore;
  /** Verilmezse audit okuma (admin.audit.list, KV-39) kaydedilmez. */
  auditStore?: AuditStore;
  /** Verilmezse admin kategori route'ları (admin.categories.*) kaydedilmez. */
  categoryAdminStore?: CategoryAdminStore;
  /** Verilmezse KV-42 öne çıkarma/duyuru admin route'ları kaydedilmez. */
  featuredAdminStore?: FeaturedAdminStore;
  /** pollStore ile birlikte verilirse "Senin İçin" sıralaması (KV-27) açılır; yoksa for_you "new" sırasıdır. */
  feedStore?: FeedStore;
  /** Keşif payı ve tekrar sınırları (KV-40, #42); ayar servisi gelene kadar DEFAULT_FEED_SETTINGS. */
  feedSettings?: () => Promise<FeedSettings>;
  /** pollStore ile birlikte verilirse trend listeleri (trends.list, KV-28) kaydedilir. */
  trendStore?: TrendStore;
  /** Verilmezse oy route'u kaydedilmez. */
  voteStore?: VoteStore;
  /** Verilmezse topluluk route'ları kaydedilmez. */
  communityStore?: CommunityStore;
  communityRequestStore?: CommunityRequestStore;
  /** #184 yönetici topluluk görünümü (salt okuma): kapalı topluluklar, etki/eşik genel bakışı, üye arama. */
  communityAdminReadStore?: CommunityAdminReadStore;
  /** Verilmezse onboarding/ilgi route'ları kaydedilmez. */
  onboardingStore?: OnboardingStore;
  /** Verilmezse rapor route'u kaydedilmez. */
  reportStore?: ReportStore;
  /** Verilmezse admin kullanıcı, yaptırım ve rol route'ları (admin.users.*, admin.sanctions.*, admin.roles.put; KV-33) kaydedilmez. */
  adminUserStore?: AdminUserStore;
  /** #181 KVKK veri dışa aktarma; paket okuma için media.storage da gerekir. */
  dataExportStore?: DataExportStore;
  /** #181 hesap anonimleştirme ve yasal saklama; adminUserStore ile birlikte kaydedilir (hedef rolü okunur). */
  accountErasureStore?: AccountErasureStore;
  /** #181 kullanıcı içeriğinin toplu gizlenmesi; adminUserStore ile birlikte verilirse route'lar kaydedilir (işi runner.ts işler). */
  contentJobStore?: ContentJobStore;
  metricsStore?: MetricsStore;
  /** KV-186 operasyon yoklaması (DB, worker izi, pg-boss kuyrukları); verilmezse bu bileşenler `unknown`. */
  opsProbe?: OpsProbe;
  /** #185 güvenlik alarmı onayı ve yönetici uçlarında reddedilen istek sayacı; verilmezse ikisi de yok. */
  securityAlertStore?: SecurityAlertStore;
  /** Süreç içi istek/hız sınırı telemetrisi; verilmezse uygulama kendi örneğini oluşturur (testler dışarıdan verir). */
  opsTelemetry?: OpsTelemetry;
  /** Verilmezse admin içerik moderasyonu (anket/yorum) route'ları kaydedilmez. */
  moderationStore?: ModerationStore;
  /** #183 toplu moderasyon parti kaydı; moderationStore ile birlikte kaydedilir. */
  bulkModerationStore?: BulkModerationStore;
  bulkApprovalStore?: BulkApprovalStore;
  /** Verilmezse bildirim okuma route'ları (notifications.*; KV-21) kaydedilmez. */
  notificationStore?: NotificationStore;
  /** Verilmezse yorum route'u kaydedilmez. */
  commentStore?: CommentStore;
  /** Acil durum anahtarı features.comments (KV-40, #42); verilmezse açık. */
  isCommentsEnabled?: () => Promise<boolean>;
  /** communities.ownershipEnabled (#184); verilmezse ayar servisinden, o da yoksa kapalı. */
  isOwnershipEnabled?: () => Promise<boolean>;
  /** account.emailChangeEnabled (#181); verilmezse ayar servisinden, o da yoksa kapalı. */
  isEmailChangeEnabled?: () => Promise<boolean>;
  /** account.selfDeletionEnabled (#181); verilmezse ayar servisinden, o da yoksa kapalı. */
  isSelfDeletionEnabled?: () => Promise<boolean>;
  /** #183 spam puanı gölge modu (salt okuma, yalnız ADMIN+); ayar kapalıyken liste boştur. */
  spamScoreStore?: SpamScoreStore;
  /** spam.shadowScoring.enabled (#183); verilmezse ayar servisinden, o da yoksa kapalı. */
  isSpamShadowEnabled?: () => Promise<boolean>;
  /** #181 kullanıcının kendi hesabını silme talebi; accountErasureStore ile birlikte kaydedilir (silmeyi o yapar). */
  accountDeletionStore?: AccountDeletionStore;
  /** #181 e-posta değişimi; adminUserStore ile birlikte kaydedilir (destek yolunda hedef rolü okunur). */
  emailChangeStore?: EmailChangeStore;
  /** #183 kullanıcı birleşik geçmişi (salt okuma); adminUserStore ile birlikte kaydedilir. */
  userTimelineStore?: UserTimelineStore;
  /** #184 / KV-54 S1 topluluk sahibi atama/bırakma. */
  communityOwnerStore?: CommunityOwnerStore;
  /** Üçü birlikte verilirse medya route'ları kaydedilir (config.storage yoksa server vermez). */
  media?: { store: MediaStore; storage: MediaStorage; queue: MediaQueue; settings?: () => Promise<MediaSettings> };
  /** Log seviyesi/hedefi; verilmezse config.logLevel ile stdout. Testler log akışını yakalar. */
  logger?: false | { level: string; stream: NodeJS.WritableStream };
};

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());

  const app = Fastify({
    logger:
      deps.logger === false
        ? false
        : {
            level: deps.logger?.level ?? config.logLevel,
            ...(deps.logger?.stream ? { stream: deps.logger.stream } : {}),
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.token"],
            // KV-49 (#51): istek logu IP, port ve başlık içermez (IP kişisel veridir). İstek kimliği, yöntem, yol ve
            // süre yeterli; kötüye kullanım izi hız sınırı logundaki anahtar özetindedir (KV-19).
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                // Raw req.url includes query strings (e.g. ?token=...); never log them.
                url: req.url.split(/[?#]/, 1)[0] || "/",
              }),
            },
          },
    bodyLimit: 64 * 1024,
    trustProxy: config.appEnv === "staging" || config.appEnv === "production",
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers[headers.requestId.toLowerCase()];
      return typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = Object.assign(new Error("Geçersiz JSON"), { statusCode: 400, code: "invalid_json" });
      done(err, undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(headers.requestId, request.id);
  });

  // KV-186: istek telemetrisi yalnız route kalıbı, yöntem, durum ve süre tutar; ham yol (kimlik, sorgu dizesi) tutulmaz.
  const startedAt = now();
  const telemetry = deps.opsTelemetry ?? createOpsTelemetry();
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url;
    if (route === "/health" || request.method === "OPTIONS") return;
    telemetry.recordRequest({ method: request.method, route: route ?? "(eşleşmeyen)", status: reply.statusCode, ms: reply.elapsedTime });
  });

  registerErrorHandling(app);
  registerSecurity(app, config.allowedOrigins, { hsts: config.session.secure });

  const session: SessionSettings = { ...config.session, pepper: config.authTokenPepper, emailVerificationRequired: config.emailVerificationRequired };
  // Ayar kancaları: açık kanca > ayar servisi > güvenli varsayılan.
  const settings = deps.settingsService;
  const pollSettings = deps.pollSettings ?? (settings ? () => settings.pollSettings() : async () => DEFAULT_POLL_SETTINGS);
  const feedSettings = deps.feedSettings ?? (settings ? () => settings.feedSettings() : async () => DEFAULT_FEED_SETTINGS);
  const mediaSettings = deps.media?.settings ?? (settings ? () => settings.mediaSettings() : async () => DEFAULT_MEDIA_SETTINGS);
  const isRegistrationEnabled = deps.isRegistrationEnabled ?? (settings ? () => settings.isRegistrationEnabled() : async () => true);
  const isOwnershipEnabled = deps.isOwnershipEnabled ?? (settings ? () => settings.isOwnershipEnabled() : async () => false);
  const isEmailChangeEnabled = deps.isEmailChangeEnabled ?? (settings ? () => settings.isEmailChangeEnabled() : async () => false);
  const isSelfDeletionEnabled = deps.isSelfDeletionEnabled ?? (settings ? () => settings.isSelfDeletionEnabled() : async () => false);
  const isSpamShadowEnabled = deps.isSpamShadowEnabled ?? (settings ? () => settings.isSpamShadowEnabled() : async () => false);
  const isCommentsEnabled = deps.isCommentsEnabled ?? (settings ? () => settings.isCommentsEnabled() : async () => true);

  const rateLimitSettings =
    deps.rateLimitSettings ?? (deps.settingsService ? () => deps.settingsService!.rateLimitSettings() : async () => DEFAULT_RATE_LIMIT_SETTINGS);
  const limiter = deps.rateLimitStore
    ? createRateLimiter({
        store: deps.rateLimitStore,
        settings: rateLimitSettings,
        newAccountDays: async () => (await pollSettings()).newAccountPeriodDays,
        pepper: config.authTokenPepper,
        now,
        onDeny: (rules, login) => telemetry.recordRateLimit(rules, login),
      })
    : null;
  const route = createRouter(app, {
    validateResponses: config.appEnv !== "production",
    enforceResourceChecks: config.appEnv !== "production",
    authenticator: createAuthenticator(deps.authStore, session, now),
    rbac: deps.rbacStore,
    now,
    maintenance: deps.settingsService ? () => deps.settingsService!.isMaintenance() : undefined,
    rateLimit: limiter?.enforce,
    recordDenial: deps.securityAlertStore ? (input) => deps.securityAlertStore!.recordDenial(input) : undefined,
  });

  const rolesOf = async (userId: string) => {
    const { roles } = await deps.rbacStore.grants(userId, now());
    return roles.length > 0 ? roles : ["USER" as const];
  };

  if (deps.mfaStore) registerMfaRoutes(route, { store: deps.mfaStore, hasher: deps.hasher, now });
  registerAuthRoutes(route, {
    rolesOf,
    store: deps.authStore,
    hasher: deps.hasher,
    mailer: deps.mailer,
    now,
    session,
    webUrl: config.webUrl,
    mediaPublicBaseUrl: config.mediaPublicBaseUrl,
    isRegistrationEnabled,
    loginGuard: limiter?.login,
    initialGrant: settings ? async () => (await settings.pointSettings()).initialGrant : undefined,
  });
  registerUserRoutes(route, {
    emailVerificationRequired: config.emailVerificationRequired,
    store: deps.authStore,
    mediaPublicBaseUrl: config.mediaPublicBaseUrl,
    rolesOf,
    publishCost: settings ? async () => (await settings.pointSettings()).publishCost : undefined,
  });
  if (deps.pointAdminStore) registerPointAdminRoutes(route, { store: deps.pointAdminStore, now });
  if (deps.pollStore) {
    registerPollRoutes(route, {
      store: deps.pollStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: pollSettings,
    });
    registerFeedRoutes(route, {
      store: deps.pollStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: pollSettings,
      feed: deps.feedStore
        ? { store: deps.feedStore, settings: feedSettings }
        : undefined,
    });
    if (deps.profileStore) {
      registerProfileRoutes(route, {
        store: deps.profileStore,
        polls: deps.pollStore,
        now,
        mediaPublicBaseUrl: config.mediaPublicBaseUrl,
        settings: pollSettings,
      });
    }
    if (deps.trendStore) {
      registerTrendRoutes(route, {
        store: deps.trendStore,
        polls: deps.pollStore,
        now,
        mediaPublicBaseUrl: config.mediaPublicBaseUrl,
        settings: pollSettings,
      });
    }
    if (deps.searchStore) {
      registerSearchRoutes(route, {
        store: deps.searchStore,
        polls: deps.pollStore,
        now,
        mediaPublicBaseUrl: config.mediaPublicBaseUrl,
        settings: pollSettings,
      });
    }
  }
  if (deps.decisionStore) registerDecisionRoutes(route, { store: deps.decisionStore, now });
  if (deps.shareStore) registerShareRoutes(route, { store: deps.shareStore, webUrl: config.webUrl });
  if (deps.categoryAdminStore) registerCategoryAdminRoutes(route, { store: deps.categoryAdminStore, now });
  if (deps.featuredAdminStore) {
    registerFeaturedAdminRoutes(route, {
      store: deps.featuredAdminStore,
      now,
      polls: deps.pollStore
        ? {
            store: deps.pollStore,
            settings: pollSettings,
            mediaPublicBaseUrl: config.mediaPublicBaseUrl,
          }
        : undefined,
    });
  }
  if (deps.revisionStore) registerRevisionRoutes(route, { store: deps.revisionStore, mediaPublicBaseUrl: config.mediaPublicBaseUrl, now });
  if (deps.auditStore) registerAuditRoutes(route, { store: deps.auditStore, mediaPublicBaseUrl: config.mediaPublicBaseUrl, now });
  if (deps.securityAlertStore) registerSecurityAlertRoutes(route, { store: deps.securityAlertStore, now });
  if (deps.voteStore) {
    registerVoteRoutes(route, { store: deps.voteStore, now, settings: pollSettings });
    registerVoteAdminRoutes(route, { store: deps.voteStore, now });
  }
  if (deps.communityStore) {
    registerCommunityRoutes(route, { store: deps.communityStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
    registerCommunityAdminRoutes(route, { store: deps.communityStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  }
  if (deps.communityRequestStore) registerCommunityRequestRoutes(route, deps.communityRequestStore, now, { isOwnershipEnabled });
  if (deps.communityOwnerStore) registerCommunityOwnerRoutes(route, { store: deps.communityOwnerStore, now, isOwnershipEnabled });
  if (deps.communityAdminReadStore) registerCommunityAdminReadRoutes(route, { store: deps.communityAdminReadStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  if (deps.onboardingStore) registerOnboardingRoutes(route, deps.onboardingStore);
  if (deps.reportStore) registerReportRoutes(route, { store: deps.reportStore, now });
  if (deps.moderationStore) registerModerationRoutes(route, { store: deps.moderationStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  if (deps.moderationStore && deps.bulkModerationStore && deps.bulkApprovalStore) {
    registerBulkModerationRoutes(route, { store: deps.moderationStore, batches: deps.bulkModerationStore, approvals: deps.bulkApprovalStore, rbac: deps.rbacStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  }
  if (deps.spamScoreStore) registerSpamScoreRoutes(route, { store: deps.spamScoreStore, isEnabled: isSpamShadowEnabled, now });
  if (deps.notificationStore) {
    registerNotificationRoutes(route, { store: deps.notificationStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  }
  if (deps.adminUserStore) {
    registerAdminUserRoutes(route, {
      store: deps.adminUserStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      mailer: deps.mailer,
      tokenPepper: config.authTokenPepper,
      webUrl: config.webUrl,
    });
    registerRoleRoutes(route, { store: deps.adminUserStore, now });
    if (deps.roleApprovalStore) registerRoleApprovalRoutes(route, { store: deps.roleApprovalStore, users: deps.adminUserStore, now });
    if (deps.contentJobStore) registerContentJobRoutes(route, { store: deps.contentJobStore, users: deps.adminUserStore, now });
  }
  if (deps.dataExportStore && deps.media) {
    registerDataExportRoutes(route, {
      store: deps.dataExportStore,
      storage: deps.media.storage,
      mailer: deps.mailer,
      now,
      tokenPepper: config.authTokenPepper,
      webUrl: config.webUrl,
    });
  }
  if (deps.userTimelineStore && deps.adminUserStore) registerUserTimelineRoutes(route, { store: deps.userTimelineStore, now });
  if (deps.emailChangeStore && deps.adminUserStore) {
    registerEmailChangeRoutes(route, {
      store: deps.emailChangeStore,
      users: deps.adminUserStore,
      hasher: deps.hasher,
      mailer: deps.mailer,
      loginGuard: limiter?.login,
      isEnabled: isEmailChangeEnabled,
      now,
      tokenPepper: config.authTokenPepper,
      webUrl: config.webUrl,
    });
  }
  if (deps.accountDeletionStore && deps.accountErasureStore) {
    registerAccountDeletionRoutes(route, {
      store: deps.accountDeletionStore,
      erasure: deps.accountErasureStore,
      mfa: deps.mfaStore,
      hasher: deps.hasher,
      mailer: deps.mailer,
      loginGuard: limiter?.login,
      isEnabled: isSelfDeletionEnabled,
      now,
      tokenPepper: config.authTokenPepper,
      webUrl: config.webUrl,
    });
  }
  if (deps.accountErasureStore && deps.adminUserStore) {
    registerAccountErasureRoutes(route, { store: deps.accountErasureStore, users: deps.adminUserStore, now });
  }
  if (deps.metricsStore) registerMetricsRoutes(route, { store: deps.metricsStore });
  registerOpsRoutes(route, {
    probe: deps.opsProbe,
    telemetry,
    env: config.appEnv,
    startedAt,
    now,
    loginLimits: async () => {
      const s = await rateLimitSettings();
      return { email: s.loginFailuresPerEmail, ip: s.loginFailuresPerIp };
    },
    switches: settings ? () => emergencySwitchesView(settings) : undefined,
  });
  if (deps.commentStore) {
    registerCommentRoutes(route, {
      store: deps.commentStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      commentsEnabled: isCommentsEnabled,
      commentMaxLength: settings ? () => settings.commentMaxLength() : undefined,
    });
  }
  if (deps.media) {
    registerPublicMediaRoutes(app, deps.media);
    registerMediaRoutes(route, {
      store: deps.media.store,
      storage: deps.media.storage,
      queue: deps.media.queue,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: mediaSettings,
    });
    registerMediaAdminRoutes(route, { store: deps.media.store, storage: deps.media.storage, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  }

  if (settings) registerSettingsRoutes(route, { service: settings, mediaPublicBaseUrl: config.mediaPublicBaseUrl });

  // KV-49 (#51): DB ve worker gerçekten sağlıklı mı (#262); 503 yalnız "down"da. Kurallar: modules/ops/health.ts.
  // Sürüm (deploy SHA): Railway GitHub entegrasyonu RAILWAY_GIT_COMMIT_SHA verir. Saat gerçek zamandır (uptime izleme).
  const healthStartedAt = new Date();
  const healthDatabase = cachedDatabaseCheck(deps.opsProbe);
  app.get("/health", async (_request, reply) => {
    const { httpStatus, body } = await buildHealth({
      probe: deps.opsProbe,
      databaseCheck: healthDatabase,
      now: () => new Date(),
      startedAt: healthStartedAt,
      env: config.appEnv,
      sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
      workerExpected: process.env.WORKER_HEARTBEAT_EXPECTED === "true",
    });
    return reply.code(httpStatus).header("Cache-Control", "no-store").send(body);
  });
  return app;
}
