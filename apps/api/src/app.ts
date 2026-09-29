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
import type { PasswordHasher } from "./modules/auth/crypto.ts";
import { registerAuthRoutes } from "./modules/auth/routes.ts";
import { registerCommunityRoutes } from "./modules/communities/routes.ts";
import type { CommunityStore } from "./modules/communities/store.ts";
import type { MediaQueue } from "./modules/media/queue.ts";
import { registerMediaRoutes } from "./modules/media/routes.ts";
import type { MediaStorage } from "./modules/media/storage.ts";
import { DEFAULT_MEDIA_SETTINGS, type MediaSettings, type MediaStore } from "./modules/media/store.ts";
import { createAuthenticator, type SessionSettings } from "./modules/auth/session.ts";
import type { AuthStore } from "./modules/auth/store.ts";
import { registerCategoryAdminRoutes } from "./modules/categories/routes.ts";
import type { CategoryAdminStore } from "./modules/categories/store.ts";
import { registerCommentRoutes } from "./modules/comments/routes.ts";
import type { CommentStore } from "./modules/comments/store.ts";
import { registerFeedRoutes } from "./modules/feed/routes.ts";
import { registerPollRoutes } from "./modules/polls/routes.ts";
import { registerReportRoutes } from "./modules/reports/routes.ts";
import type { ReportStore } from "./modules/reports/store.ts";
import type { RbacStore } from "./modules/rbac/store.ts";
import { registerSearchRoutes } from "./modules/search/routes.ts";
import type { SearchStore } from "./modules/search/store.ts";
import { DEFAULT_POLL_SETTINGS, type PollSettings, type PollStore } from "./modules/polls/store.ts";
import { registerUserRoutes } from "./modules/users/routes.ts";
import { registerVoteRoutes } from "./modules/votes/routes.ts";
import type { VoteStore } from "./modules/votes/store.ts";

export type AppDeps = {
  config: Config;
  authStore: AuthStore;
  /** Rol, yaptırım ve topluluk moderatörlüğü (KV-12); her istekte okunur. */
  rbacStore: RbacStore;
  hasher: PasswordHasher;
  mailer: Mailer;
  now?: () => Date;
  isRegistrationEnabled?: () => Promise<boolean>;
  /** Verilmezse anket route'ları kaydedilmez (ör. sadece auth'u test eden düzenek). */
  pollStore?: PollStore;
  /** Sistem ayarları (KV-40, #42); ayar servisi gelene kadar DEFAULT_POLL_SETTINGS. */
  pollSettings?: () => Promise<PollSettings>;
  /** pollStore ile birlikte verilirse kategori ve arama route'ları kaydedilir. */
  searchStore?: SearchStore;
  /** Verilmezse admin kategori route'ları (admin.categories.*) kaydedilmez. */
  categoryAdminStore?: CategoryAdminStore;
  /** Verilmezse oy route'u kaydedilmez. */
  voteStore?: VoteStore;
  /** Verilmezse topluluk route'ları kaydedilmez. */
  communityStore?: CommunityStore;
  /** Verilmezse rapor route'u kaydedilmez. */
  reportStore?: ReportStore;
  /** Verilmezse yorum route'ları kaydedilmez. */
  commentStore?: CommentStore;
  /** Acil durum anahtarı features.comments (KV-40, #42); verilmezse açık. */
  isCommentsEnabled?: () => Promise<boolean>;
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
            // Varsayılan serializer header/gövde loglamaz; yine de cookie ve parola alanları maskelenir.
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.token"],
          },
    bodyLimit: 64 * 1024,
    trustProxy: config.appEnv === "staging" || config.appEnv === "production",
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers[headers.requestId.toLowerCase()];
      return typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  // Gövdesiz POST (logout, resend) Content-Type: application/json ile gelse de geçerli sayılır.
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

  registerErrorHandling(app);
  registerSecurity(app, config.allowedOrigins);

  const session: SessionSettings = { ...config.session, pepper: config.authTokenPepper };
  const route = createRouter(app, {
    validateResponses: config.appEnv !== "production",
    enforceResourceChecks: config.appEnv !== "production",
    authenticator: createAuthenticator(deps.authStore, session, now),
    rbac: deps.rbacStore,
    now,
  });

  registerAuthRoutes(route, {
    store: deps.authStore,
    hasher: deps.hasher,
    mailer: deps.mailer,
    now,
    session,
    webUrl: config.webUrl,
    mediaPublicBaseUrl: config.mediaPublicBaseUrl,
    isRegistrationEnabled: deps.isRegistrationEnabled ?? (async () => true),
  });
  registerUserRoutes(route, { store: deps.authStore, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  if (deps.pollStore) {
    registerPollRoutes(route, {
      store: deps.pollStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: deps.pollSettings ?? (async () => DEFAULT_POLL_SETTINGS),
    });
    registerFeedRoutes(route, {
      store: deps.pollStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: deps.pollSettings ?? (async () => DEFAULT_POLL_SETTINGS),
    });
    if (deps.searchStore) {
      registerSearchRoutes(route, {
        store: deps.searchStore,
        polls: deps.pollStore,
        now,
        mediaPublicBaseUrl: config.mediaPublicBaseUrl,
        settings: deps.pollSettings ?? (async () => DEFAULT_POLL_SETTINGS),
      });
    }
  }
  if (deps.categoryAdminStore) {
    registerCategoryAdminRoutes(route, { store: deps.categoryAdminStore, now });
  }
  if (deps.voteStore) {
    registerVoteRoutes(route, { store: deps.voteStore, now, settings: deps.pollSettings ?? (async () => DEFAULT_POLL_SETTINGS) });
  }
  if (deps.communityStore) {
    registerCommunityRoutes(route, { store: deps.communityStore, now, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
  }
  if (deps.reportStore) {
    registerReportRoutes(route, { store: deps.reportStore });
  }
  if (deps.commentStore) {
    registerCommentRoutes(route, {
      store: deps.commentStore,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      commentsEnabled: deps.isCommentsEnabled ?? (async () => true),
    });
  }
  if (deps.media) {
    registerMediaRoutes(route, {
      store: deps.media.store,
      storage: deps.media.storage,
      queue: deps.media.queue,
      now,
      mediaPublicBaseUrl: config.mediaPublicBaseUrl,
      settings: deps.media.settings ?? (async () => DEFAULT_MEDIA_SETTINGS),
    });
  }

  app.get("/health", async (_request, reply) => reply.header("Cache-Control", "no-store").send({ status: "ok" }));

  return app;
}
