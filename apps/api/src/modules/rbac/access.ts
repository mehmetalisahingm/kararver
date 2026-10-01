// Ortak yetki katmanı — KV-12 (#14). Kurallar contracts'taki KV-04 sözleşmesindedir (permissions.ts,
// docs/KV-04_ROLES_EVENTS.md); burası yalnız TrustedActor'ı DB'den kurar ve kararı API hatasına çevirir.
//
// İki adım: router her istekte handler'dan önce `gate` ile kaynaktan bağımsız kararı (preauthorize) verir;
// kaynağa bağlı kısmı (sahip, topluluk, hedef kullanıcı) handler kaydı DB'den okuduktan sonra
// `ctx.authorize(resource)` ile tamamlar. Aktör istek başına bir kez kurulur, istekler arasında tutulmaz.
import {
  actions,
  authorize,
  highestRole,
  preauthorize,
  type ActionId,
  type Decision,
  type ErrorCode,
  type ResourceContext,
  type TrustedActor,
} from "@kararver/contracts";
import { ApiError } from "../../http/errors.ts";
import type { SessionUser } from "../auth/session.ts";
import type { ActorGrants, RbacStore } from "./store.ts";

export type ModerationScope = { all: true } | { all: false; communityIds: string[] };

const STAFF_LEVELS = new Set(["moderator", "admin", "super_admin"]);

/** Kaynak bağlamı olmadan tam karar verilemeyen işlem: handler `ctx.authorize(resource)` çağırmalıdır. */
export function needsResource(action: ActionId): boolean {
  const r = actions[action];
  return (r.requires?.length ?? 0) > 0 || r.scope === "community";
}

/**
 * KV-12 öncesi yazılmış, sahiplik/self-vote kontrolünü kendisi yapan handler'lar.
 * `ctx.authorize`'a geçen endpoint listeden çıkar; yeni endpoint buraya eklenmez.
 */
export const LEGACY_RESOURCE_CHECKS: ReadonlySet<string> = new Set([
  "polls.update",
  "polls.close",
  "polls.delete",
  "polls.addenda.create",
  "votes.put",
  "comments.update",
  "comments.delete",
  "media.get",
]);

const messages: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Giriş yapmanız gerekiyor.",
  ACCOUNT_RESTRICTED: "Hesabınız bu işlem için kısıtlı.",
  EMAIL_NOT_VERIFIED: "Önce e-postanızı doğrulayın.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  SELF_VOTE_FORBIDDEN: "Kendi anketinize oy veremezsiniz.",
};

function rejection(decision: Extract<Decision, { allowed: false }>, action: ActionId): ApiError {
  // API_CONTRACTS §4.6: ACCOUNT_RESTRICTED'da details[0].code kısıtlanan KV-04 işlemidir (mock-api ile aynı).
  const details = decision.code === "ACCOUNT_RESTRICTED" ? [{ code: action }] : [];
  return new ApiError(decision.code, messages[decision.code] ?? decision.reason, details);
}

export type Access = {
  /** Kaynaktan bağımsız karar; router handler'dan önce çağırır. */
  gate(): Promise<void>;
  /** Tam KV-04 kararı; `action` verilmezse endpoint'in işlemi. Ret ApiError fırlatır. */
  authorize(resource: ResourceContext, action?: ActionId): Promise<void>;
  /** Kuyruk filtresi: ADMIN+ tümü, MODERATOR atandığı topluluklar. Liste filtresi yetki değildir (KV-04 §4.2). */
  moderationScope(): Promise<ModerationScope>;
  /** Endpoint'in kendi işlemi için `authorize` çağrıldı mı (unutulan kontrolü router yakalar). */
  readonly resourceChecked: boolean;
};

export function createAccess(store: RbacStore, viewer: SessionUser | null, endpointAction: ActionId, now: Date): Access {
  let grants: Promise<ActorGrants> | undefined;
  let communities: Promise<string[]> | undefined;
  let resourceChecked = false;

  const loadGrants = (userId: string) => (grants ??= store.grants(userId, now));
  const loadCommunities = (userId: string) => (communities ??= store.moderatedCommunityIds(userId));

  async function actorFor(action: ActionId): Promise<TrustedActor | null> {
    if (!viewer) return null;
    const r = actions[action];
    const staff = STAFF_LEVELS.has(r.level);
    // Kısıtsız user/verified/owner kuralı yalnız hesap durumu ve e-postaya bakar; rol ve yaptırım okunmaz.
    const g: ActorGrants = staff || r.restrictedBy ? await loadGrants(viewer.id) : { roles: [], sanctions: [] };
    // Topluluk ataması yalnız MODERATOR'da karar verir; ADMIN/SUPER_ADMIN için okunmaz.
    const moderated = staff && r.scope && highestRole(g.roles) === "MODERATOR" ? await loadCommunities(viewer.id) : [];
    return {
      userId: viewer.id,
      roles: g.roles,
      status: viewer.status,
      emailVerified: viewer.emailVerified,
      sanctions: g.sanctions,
      moderatedCommunityIds: moderated,
    };
  }

  return {
    async gate() {
      if (actions[endpointAction].level === "public") return;
      const decision = preauthorize(await actorFor(endpointAction), endpointAction, now);
      if (!decision.allowed) throw rejection(decision, endpointAction);
    },

    async authorize(resource, action = endpointAction) {
      const decision = authorize(await actorFor(action), action, resource, now);
      if (action === endpointAction) resourceChecked = true;
      if (!decision.allowed) throw rejection(decision, action);
    },

    async moderationScope() {
      if (!viewer || viewer.status !== "ACTIVE") return { all: false, communityIds: [] };
      const role = highestRole((await loadGrants(viewer.id)).roles);
      if (role === "ADMIN" || role === "SUPER_ADMIN") return { all: true };
      if (role === "MODERATOR") return { all: false, communityIds: await loadCommunities(viewer.id) };
      return { all: false, communityIds: [] };
    },

    get resourceChecked() {
      return resourceChecked;
    },
  };
}
