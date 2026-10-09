// KV-04 (#6) — rol ve yetki sözleşmesi. Bağlayıcı kural bu dosyadadır; gerekçe ve matris
// docs/KV-04_ROLES_EVENTS.md ve docs/FOUNDATION_CONTRACTS.md "Yetki matrisi".
//
// `authorize` saf bir fonksiyondur: aktörü ve kaynağı DB'den okumak çağıranın işidir.
// Rol, durum, kısıt ve topluluk moderatörlüğü request body/header/token claim'inden
// alınmaz; `TrustedActor` yalnızca sunucunun DB'den kurduğu nesnedir.
import type { z } from "zod";
import type { UserStatus } from "./common.ts";
import type { SanctionType } from "./domains/admin.ts";
import type { MediaPurpose } from "./domains/media.ts";
import type { Auth } from "./endpoint.ts";
import type { ErrorCode } from "./errors.ts";
import { canModerate, roles, type Role } from "./helpers.ts";

/** Aktif yaptırımlardan türeyen işlem kısıtları (DATA_MODEL §7.2 RESTRICTED). */
export type Restriction = "COMMENTS" | "POSTING";

/** Kaldırılmamış (`lifted_at IS NULL`) `sanctions` satırı. `endsAt` null ise kalıcıdır. */
export type ActorSanction = { type: z.infer<typeof SanctionType>; endsAt: string | null };

export type TrustedActor = {
  userId: string;
  /** `user_roles` satırları. Boşsa USER kabul edilir. */
  roles: readonly Role[];
  /** `users.status` */
  status: z.infer<typeof UserStatus>;
  emailVerified: boolean;
  /** Kaldırılmamış yaptırımlar; süresi dolanları `authorize` kendisi eler. */
  sanctions: readonly ActorSanction[];
  /** `community_memberships.role = MODERATOR` olan topluluklar (DATA_MODEL §9). */
  moderatedCommunityIds: readonly string[];
};

/** İşlemin hedefi hakkında DB'den okunan bilgiler. Hangi alanın zorunlu olduğu kuralın `requires` listesindedir. */
export type ResourceContext = {
  /** İçeriğin (anket, yorum, medya) sahibi. `votes.put` için anket sahibi. */
  ownerId?: string;
  /** İçeriğin topluluğu; topluluk dışı içerikte null. */
  communityId?: string | null;
  mediaPurpose?: z.infer<typeof MediaPurpose>;
  targetUserId?: string;
  targetRoles?: readonly Role[];
  /** `admin.roles.put` ile atanacak rol. */
  newRole?: Role;
  /** Şu an ACTIVE durumdaki SUPER_ADMIN sayısı. */
  activeSuperAdminCount?: number;
};

export type Decision = { allowed: true } | { allowed: false; code: ErrorCode; reason: string };

type Guard = "selfVote" | "sanctionTarget" | "roleAssignment";

export type ActionRule = {
  /** Endpoint'in `auth` seviyesiyle aynı sözlük; test ikisinin eşit olduğunu doğrular. */
  level: Auth;
  summary: string;
  /** Bu kısıt aktifse işlem 403 ACCOUNT_RESTRICTED. */
  restrictedBy?: Restriction;
  /** true ise hesap amaçlı medya (avatar) `restrictedBy`'dan muaftır. */
  accountMediaExempt?: true;
  /** community: `canModerate` ile kaynağın topluluğu; queue: moderatör en az bir toplulukta atanmış olmalı, liste servis tarafında filtrelenir. */
  scope?: "community" | "queue";
  guard?: Guard;
  /** Çağıranın doldurması zorunlu `ResourceContext` alanları; eksikse programlama hatasıdır (TypeError). */
  requires?: readonly (keyof ResourceContext)[];
};

const rule = (level: Auth, summary: string, extra: Omit<ActionRule, "level" | "summary"> = {}): ActionRule =>
  Object.freeze({ level, summary, ...extra });

const owned = ["ownerId"] as const;

export const actions = Object.freeze({
  // ── public: misafir dahil; yaptırım durumu public okuma ve itiraz kanalını kapatmaz ──
  "account.register": rule("public", "Kayıt"),
  "account.login": rule("public", "Giriş (yaptırımlı hesabın reddi auth modülündedir)"),
  "account.verifyEmail": rule("public", "E-posta doğrulama"),
  "account.recoverPassword": rule("public", "Şifre sıfırlama isteği ve yeni şifre"),
  "content.read": rule("public", "Public içerik okuma; gizli içerik servis tarafında 404"),
  "poll.share": rule("public", "Paylaşım bağlantısı"),

  // ── user: giriş yapmış, BANNED/SUSPENDED olmayan hesap ──
  "session.logout": rule("user", "Çıkış"),
  "account.resendVerification": rule("user", "Doğrulama e-postası"),
  "account.read": rule("user", "Kendi hesabını okuma"),
  "account.update": rule("user", "Kendi hesabını düzenleme"),
  "reaction.set": rule("user", "Beğeni/dislike ekle/kaldır"),
  "bookmark.set": rule("user", "Kaydet/kaldır"),
  "bookmark.read": rule("user", "Kaydedilenler"),
  "follow.set": rule("user", "Takip et/bırak"),
  "interests.read": rule("user", "İlgi alanlarını okuma"),
  "interests.set": rule("user", "İlgi alanlarını ayarlama"),
  "points.read": rule("user", "Puan bakiyesi ve hareketleri"),
  "report.create": rule("user", "Rapor oluşturma"),
  "community.join": rule("user", "Topluluğa katılma"),
  "community.request.create": rule("user", "Topluluk başvurusu oluşturma"),
  "community.request.read": rule("user", "Kendi topluluk başvurularını okuma"),
  "community.leave": rule("user", "Topluluktan ayrılma"),
  "notification.read": rule("user", "Bildirim ve tercih okuma"),
  "notification.update": rule("user", "Okundu, tercih ve sessize alma"),

  // ── verified: user + e-posta doğrulanmış ──
  "poll.create": rule("verified", "Anket/tartışma yayımlama", { restrictedBy: "POSTING" }),
  "vote.cast": rule("verified", "Oy ver/değiştir; anket sahibi kendi anketine oy veremez", {
    guard: "selfVote",
    requires: owned,
  }),
  "comment.create": rule("verified", "Yorum, cevap, alternatif", { restrictedBy: "COMMENTS" }),
  "media.upload": rule("verified", "Görsel yükleme", {
    restrictedBy: "POSTING",
    accountMediaExempt: true,
    requires: ["mediaPurpose"],
  }),

  // ── owner: kaynağın sahibi. Silme hiçbir kısıtla kapanmaz ──
  "poll.update": rule("owner", "Kendi anketini düzenleme", { restrictedBy: "POSTING", requires: owned }),
  "poll.close": rule("owner", "Kendi anketini erken kapatma", { requires: owned }),
  "poll.delete": rule("owner", "Kendi anketini kaldırma", { requires: owned }),
  "poll.addendum.create": rule("owner", "Ek açıklama", { restrictedBy: "POSTING", requires: owned }),
  "comment.update": rule("owner", "Kendi yorumunu düzenleme", { restrictedBy: "COMMENTS", requires: owned }),
  "comment.delete": rule("owner", "Kendi yorumunu kaldırma", { requires: owned }),
  "decision.set": rule("owner", "Kararımı verdim (sahibin public notu)", { restrictedBy: "POSTING", requires: owned }),
  "media.complete": rule("owner", "Yüklemeyi tamamlama", {
    restrictedBy: "POSTING",
    accountMediaExempt: true,
    requires: ["ownerId", "mediaPurpose"],
  }),
  "media.read": rule("owner", "Kendi görselinin durumu", { requires: owned }),

  // ── moderator: MODERATOR sadece atandığı topluluk; ADMIN/SUPER_ADMIN tümü ──
  "report.queue.read": rule("moderator", "Rapor kuyruğu", { scope: "queue" }),
  "report.resolve": rule("moderator", "Raporu sonuçlandırma", { scope: "community", requires: ["communityId"] }),
  "moderation.poll.apply": rule("moderator", "Anket moderasyonu", { scope: "community", requires: ["communityId"] }),
  "moderation.comment.apply": rule("moderator", "Yorum moderasyonu", { scope: "community", requires: ["communityId"] }),
  "moderation.content.search": rule("moderator", "Yönetici anket/yorum arama listesi", { scope: "queue" }),
  "moderation.content.history": rule("moderator", "İçerik rapor ve moderasyon geçmişi", { scope: "community", requires: ["communityId"] }),
  "moderation.poll.move": rule("moderator", "Anket kategori/topluluk değiştirme", { scope: "community", requires: ["communityId"] }),
  "moderation.user.warn": rule("moderator", "Rapor kuyruğundan içerik sahibini uyarma; admin hedef SUPER_ADMIN ister", {
    scope: "community",
    guard: "sanctionTarget",
    requires: ["communityId", "targetUserId", "targetRoles"],
  }),
  "media.queue.read": rule("moderator", "Görsel inceleme kuyruğu", { scope: "queue" }),
  "media.review": rule("moderator", "Görsel onay/red", { scope: "community", requires: ["communityId"] }),

  // ── admin ──
  "revision.read": rule("admin", "İçerik sürüm geçmişi"),
  "vote.invalidate": rule("admin", "Oyu gerekçeyle geçersiz sayma / geri alma (KV-43)"),
  "media.ban.manage": rule("admin", "Yasaklı görsel listesi yönetimi (KV-38)"),
  "community.create": rule("admin", "Topluluk açma"),
  "community.request.queue": rule("admin", "Topluluk başvuru kuyruğu"),
  "community.request.review": rule("admin", "Topluluk başvurusunu gerekçeyle karara bağlama"),
  "community.update": rule("admin", "Topluluk düzenleme/kapatma"),
  "community.moderator.assign": rule("admin", "Topluluk moderatörü atama/kaldırma"),
  "user.read": rule("admin", "Kullanıcı arama ve detay"),
  "user.sanction": rule("admin", "Yaptırım uygulama; admin hedef SUPER_ADMIN ister", {
    guard: "sanctionTarget",
    requires: ["targetUserId", "targetRoles"],
  }),
  "user.sanction.lift": rule("admin", "Yaptırım kaldırma; admin hedef SUPER_ADMIN ister", {
    guard: "sanctionTarget",
    requires: ["targetUserId", "targetRoles"],
  }),
  "settings.read": rule("admin", "Sistem ayarlarını okuma"),
  "audit.read": rule("admin", "Audit okuma (yazma/silme işlemi yoktur)"),
  "points.adjust": rule("admin", "Puan düzeltmesi"),
  "metrics.read": rule("admin", "Dashboard metrikleri"),
  "featured.manage": rule("admin", "Öne çıkarma"),
  "announcement.manage": rule("admin", "Duyuru"),
  "category.manage": rule("admin", "Kategori"),

  // ── super_admin ──
  "user.role.assign": rule("super_admin", "Rol atama; kendi rolü ve son SUPER_ADMIN 409", {
    guard: "roleAssignment",
    requires: ["targetUserId", "targetRoles", "newRole", "activeSuperAdminCount"],
  }),
  "settings.update": rule("super_admin", "Sistem ayarı değiştirme"),
  "user.sessions.manage": rule("super_admin", "Kullanıcı oturumlarını yönetme"),
  "emergency.update": rule("super_admin", "Acil durum anahtarları"),
} satisfies Record<string, ActionRule>);

export type ActionId = keyof typeof actions;

/** Her endpoint tam olarak bir işleme bağlıdır. Eksik/fazla eşleme testte kırılır. */
export const endpointPermissions: Readonly<Record<string, ActionId>> = Object.freeze({
  "auth.register": "account.register",
  "auth.login": "account.login",
  "auth.logout": "session.logout",
  "auth.email.verify": "account.verifyEmail",
  "auth.email.resend": "account.resendVerification",
  "auth.password.forgot": "account.recoverPassword",
  "auth.password.reset": "account.recoverPassword",
  "me.get": "account.read",
  "me.update": "account.update",

  "polls.create": "poll.create",
  "polls.get": "content.read",
  "polls.lookup": "content.read",
  "polls.update": "poll.update",
  "polls.close": "poll.close",
  "polls.delete": "poll.delete",
  "polls.addenda.create": "poll.addendum.create",
  "votes.put": "vote.cast",
  "reactions.poll.put": "reaction.set",
  "reactions.poll.delete": "reaction.set",
  "polls.history": "content.read",

  "comments.list": "content.read",
  "comments.replies": "content.read",
  "comments.create": "comment.create",
  "comments.update": "comment.update",
  "comments.delete": "comment.delete",
  "reactions.comment.put": "reaction.set",
  "reactions.comment.delete": "reaction.set",

  "feed.list": "content.read",
  "search.query": "content.read",
  "categories.list": "content.read",
  "trends.list": "content.read",

  "profiles.get": "content.read",
  "profiles.polls": "content.read",
  "profiles.comments": "content.read",
  "bookmarks.put": "bookmark.set",
  "bookmarks.delete": "bookmark.set",
  "bookmarks.list": "bookmark.read",
  "follows.put": "follow.set",
  "follows.delete": "follow.set",
  "decisions.get": "content.read",
  "decisions.put": "decision.set",
  "interests.get": "interests.read",
  "interests.put": "interests.set",
  "shares.create": "poll.share",
  "featured.active": "content.read",
  "announcements.active": "content.read",
  "points.get": "points.read",
  "points.ledger": "points.read",

  "media.uploads.create": "media.upload",
  "media.complete": "media.complete",
  "media.get": "media.read",

  "reports.create": "report.create",
  "admin.reports.list": "report.queue.read",
  "admin.reports.resolve": "report.resolve",
  "admin.moderation.polls": "moderation.poll.apply",
  "admin.moderation.comments": "moderation.comment.apply",
  "admin.content.polls": "moderation.content.search",
  "admin.content.comments": "moderation.content.search",
  "admin.moderation.history.polls": "moderation.content.history",
  "admin.moderation.history.comments": "moderation.content.history",
  "admin.moderation.polls.move": "moderation.poll.move",
  "admin.reports.warn": "moderation.user.warn",
  "admin.media.list": "media.queue.read",
  "admin.media.decide": "media.review",
  "admin.media.bans.list": "media.ban.manage",
  "admin.media.bans.create": "media.ban.manage",
  "admin.media.bans.delete": "media.ban.manage",
  "admin.revisions.polls": "revision.read",
  "admin.revisions.comments": "revision.read",
  "admin.votes.invalidate": "vote.invalidate",
  "admin.votes.restore": "vote.invalidate",

  "communities.list": "content.read",
  "communities.get": "content.read",
  "communities.members": "content.read",
  "communities.join": "community.join",
  "communities.leave": "community.leave",
  "communities.requests.create": "community.request.create",
  "communities.requests.mine": "community.request.read",
  "admin.communities.requests.list": "community.request.queue",
  "admin.communities.requests.decide": "community.request.review",
  "admin.communities.create": "community.create",
  "admin.communities.update": "community.update",
  "admin.communities.moderators.put": "community.moderator.assign",
  "admin.communities.moderators.delete": "community.moderator.assign",

  "notifications.list": "notification.read",
  "notifications.unreadCount": "notification.read",
  "notifications.markRead": "notification.update",
  "notifications.preferences.get": "notification.read",
  "notifications.preferences.update": "notification.update",
  "notifications.mutes.put": "notification.update",
  "notifications.mutes.delete": "notification.update",

  "config.get": "content.read",
  "admin.users.list": "user.read",
  "admin.users.get": "user.read",
  "admin.users.sanctions": "user.read",
  "admin.users.reports": "user.read",
  "admin.users.activity": "user.read",
  "admin.sanctions.create": "user.sanction",
  "admin.sanctions.lift": "user.sanction.lift",
  "admin.roles.put": "user.role.assign",
  "admin.users.sessions.list": "user.sessions.manage",
  "admin.users.sessions.revoke": "user.sessions.manage",
  "admin.settings.list": "settings.read",
  "admin.settings.update": "settings.update",
  "admin.emergency.put": "emergency.update",
  "admin.audit.list": "audit.read",
  "admin.points.adjust": "points.adjust",
  "admin.metrics.get": "metrics.read",
  "admin.featured.list": "featured.manage",
  "admin.featured.create": "featured.manage",
  "admin.featured.update": "featured.manage",
  "admin.featured.delete": "featured.manage",
  "admin.announcements.list": "announcement.manage",
  "admin.announcements.create": "announcement.manage",
  "admin.announcements.update": "announcement.manage",
  "admin.announcements.delete": "announcement.manage",
  "admin.categories.list": "category.manage",
  "admin.categories.create": "category.manage",
  "admin.categories.update": "category.manage",
});

export function permissionForEndpoint(endpointId: string): ActionId {
  const action = endpointPermissions[endpointId];
  if (!action) throw new Error(`Yetki kuralı olmayan endpoint: ${endpointId}`);
  return action;
}

/** Hesap amaçlı medya; içerik kısıtından (POSTING) muaftır. */
export const accountMediaPurposes: readonly z.infer<typeof MediaPurpose>[] = Object.freeze(["AVATAR"]);

const sanctionRestrictions: Partial<Record<z.infer<typeof SanctionType>, Restriction>> = {
  RESTRICT_COMMENTS: "COMMENTS",
  RESTRICT_POSTING: "POSTING",
};

function instant(value: Date | string, label: string): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`Geçersiz zaman: ${label}`);
  return ms;
}

/**
 * `now` anında yürürlükteki kısıtlar. `endsAt <= now` olan yaptırım etkisizdir, `endsAt` null kalıcıdır.
 * WARNING hiçbir yetkiyi etkilemez; SUSPEND/BAN `users.status`'tan okunur.
 */
export function restrictionsFromSanctions(sanctions: readonly ActorSanction[], now: Date): Restriction[] {
  const at = instant(now, "now");
  return [
    ...new Set(
      sanctions.flatMap((s) =>
        s.endsAt !== null && instant(s.endsAt, "sanction.endsAt") <= at ? [] : (sanctionRestrictions[s.type] ?? []),
      ),
    ),
  ];
}

/**
 * `users.status`'un yaptırımlardan türetilen değeri (DATA_MODEL §9.1): BAN > SUSPEND > RESTRICT_* → RESTRICTED > ACTIVE.
 * WARNING durumu değiştirmez; `endsAt <= now` olan yaptırım sayılmaz. Yaptırım ekleme/kaldırma aynı transaction'da
 * ve süre dolumu job'ı (KV-33 PR-C) bunu yazar; `sanctions` kaldırılmamış satırlardır.
 */
export function statusFromSanctions(sanctions: readonly ActorSanction[], now: Date): z.infer<typeof UserStatus> {
  const at = instant(now, "now");
  const active = new Set(
    sanctions.filter((s) => s.endsAt === null || instant(s.endsAt, "sanction.endsAt") > at).map((s) => s.type),
  );
  if (active.has("BAN")) return "BANNED";
  if (active.has("SUSPEND")) return "SUSPENDED";
  if (active.has("RESTRICT_COMMENTS") || active.has("RESTRICT_POSTING")) return "RESTRICTED";
  return "ACTIVE";
}

const rank: Record<Role, number> = { USER: 0, MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
const levelRank: Partial<Record<Auth, number>> = { moderator: 1, admin: 2, super_admin: 3 };

/** Bilinmeyen rol değerleri yok sayılır; rol yoksa USER. */
export function highestRole(actorRoles: readonly string[]): Role {
  return actorRoles.reduce<Role>(
    (best, r) => ((roles as readonly string[]).includes(r) && rank[r as Role] > rank[best] ? (r as Role) : best),
    "USER",
  );
}

const allow: Decision = Object.freeze({ allowed: true });
const deny = (code: ErrorCode, reason: string): Decision => ({ allowed: false, code, reason });

/**
 * Sunucu yetki kararı. `actor` null ise misafir. `now` açık verilir (yaptırım süresi buna göre
 * değerlendirilir). Eksik zorunlu bağlam (ör. `ownerId`) çağıranın hatasıdır ve TypeError
 * fırlatır; sessizce izin veya ret üretilmez.
 */
export function authorize(actor: TrustedActor | null, action: ActionId, resource: ResourceContext, now: Date): Decision {
  const r = ruleOf(action);
  for (const key of r.requires ?? []) {
    if (resource[key] === undefined) throw new TypeError(`authorize(${action}): resource.${key} zorunlu`);
  }
  return decide(actor, r, resource, now);
}

/**
 * `authorize`'ın kaynaktan bağımsız kısmı: istek kapısı (API router'ı, handler'dan önce).
 * Seviye, hesap durumu, e-posta, yönetici rolü, kuyruk kapsamı ve kaynaktan bağımsız kısıt.
 * `requires`'ı ve topluluk kapsamı olmayan kuralda `authorize` ile aynı kararı verir; diğerlerinde
 * ret `authorize`'ın da reddettiği anlamına gelir, izin ise tam kararı handler'a bırakır.
 * Tek fark sıra: sahiplik ve kısıt birlikte eksikse kapı ACCOUNT_RESTRICTED döner (ikisi de 403).
 */
export function preauthorize(actor: TrustedActor | null, action: ActionId, now: Date): Decision {
  return decide(actor, ruleOf(action), null, now);
}

function ruleOf(action: ActionId): ActionRule {
  const r: ActionRule | undefined = actions[action];
  if (!r) throw new TypeError(`Bilinmeyen işlem: ${String(action)}`);
  return r;
}

/** `resource` null ise kaynağa bağlı kontroller (sahiplik, topluluk, guard, medya muafiyeti) atlanır. */
function decide(actor: TrustedActor | null, r: ActionRule, resource: ResourceContext | null, now: Date): Decision {
  instant(now, "now");

  // Misafire açık işlem hesap durumuna bakmaz: public okuma yaptırımdan ayrıdır.
  if (r.level === "public") return allow;
  if (!actor) return deny("UNAUTHENTICATED", "Oturum gerekli");

  const staffRank = levelRank[r.level];
  if (staffRank !== undefined) return authorizeStaff(actor, r, staffRank, resource);

  if (actor.status === "BANNED" || actor.status === "SUSPENDED") {
    return deny("ACCOUNT_RESTRICTED", "Hesap askıda veya yasaklı");
  }
  if (r.level === "verified" && !actor.emailVerified) return deny("EMAIL_NOT_VERIFIED", "E-posta doğrulanmamış");
  if (resource) {
    if (r.level === "owner" && resource.ownerId !== actor.userId) return deny("FORBIDDEN", "Kaynağın sahibi değil");
    if (r.guard === "selfVote" && resource.ownerId === actor.userId) {
      return deny("SELF_VOTE_FORBIDDEN", "Anket sahibi kendi anketine oy veremez");
    }
  }
  if (r.restrictedBy && restrictionsFromSanctions(actor.sanctions, now).includes(r.restrictedBy)) {
    // Muafiyet kaynağın amacına bağlıdır; kapıda bilinmez, karar tam authorize'a kalır.
    if (r.accountMediaExempt && !resource) return allow;
    const exempt = r.accountMediaExempt && accountMediaPurposes.includes(resource!.mediaPurpose!);
    if (!exempt) return deny("ACCOUNT_RESTRICTED", `Hesapta ${r.restrictedBy} kısıtı var`);
  }
  return allow;
}

function authorizeStaff(
  actor: TrustedActor,
  r: ActionRule,
  required: number,
  resource: ResourceContext | null,
): Decision {
  // Yetkili işlem yalnızca ACTIVE hesapla yapılır (canModerate ile aynı).
  if (actor.status !== "ACTIVE") return deny("FORBIDDEN", "Yetkili işlem için hesap ACTIVE olmalı");
  const role = highestRole(actor.roles);
  if (rank[role] < required) return deny("FORBIDDEN", `${r.level} yetkisi gerekli`);

  if (r.scope === "queue" && role === "MODERATOR" && actor.moderatedCommunityIds.length === 0) {
    return deny("FORBIDDEN", "Moderatör hiçbir topluluğa atanmamış");
  }
  if (!resource) return allow;

  if (r.scope === "community") {
    const ok = canModerate(
      { role, status: actor.status, communityIds: [...actor.moderatedCommunityIds] },
      { communityId: resource.communityId },
    );
    if (!ok) return deny("FORBIDDEN", "Moderatör bu topluluğa atanmamış");
  }

  if (r.guard === "sanctionTarget") {
    if (resource.targetUserId === actor.userId) return deny("FORBIDDEN", "Kendine yaptırım uygulanamaz");
    if (rank[highestRole(resource.targetRoles!)] >= rank.ADMIN && role !== "SUPER_ADMIN") {
      return deny("FORBIDDEN", "Admin hedefe yaptırım SUPER_ADMIN gerektirir");
    }
  }
  if (r.guard === "roleAssignment") {
    if (resource.targetUserId === actor.userId) return deny("CONFLICT", "Kendi rolünü değiştiremezsin");
    const demotesSuperAdmin = resource.targetRoles!.includes("SUPER_ADMIN") && resource.newRole !== "SUPER_ADMIN";
    if (demotesSuperAdmin && resource.activeSuperAdminCount! <= 1) {
      return deny("CONFLICT", "Son aktif SUPER_ADMIN düşürülemez");
    }
  }
  return allow;
}
