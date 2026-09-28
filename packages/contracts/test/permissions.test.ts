// KV-04 yetki sözleşmesi testleri: endpoint ↔ kural eşlemesi, yetki matrisi, özel kurallar,
// RESTRICTED kapsamı ve canModerate paritesi. DB gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  actions,
  allErrors,
  authorize,
  canModerate,
  endpointPermissions,
  endpoints,
  getEndpoint,
  highestRole,
  permissionForEndpoint,
  restrictionsFromSanctions,
  type ActionId,
  type ActorSanction,
  type ResourceContext,
  type TrustedActor,
} from "../src/index.ts";

const NOW = new Date("2026-09-28T12:00:00Z");
const PAST = "2026-09-28T11:59:59Z";
const FUTURE = "2026-10-05T12:00:00Z";
const commentsBan: ActorSanction = { type: "RESTRICT_COMMENTS", endsAt: null };
const postingBan: ActorSanction = { type: "RESTRICT_POSTING", endsAt: null };

const C1 = "community-1";
const C2 = "community-2";

function actor(overrides: Partial<TrustedActor> = {}): TrustedActor {
  return {
    userId: "u-self",
    roles: ["USER"],
    status: "ACTIVE",
    emailVerified: true,
    sanctions: [],
    moderatedCommunityIds: [],
    ...overrides,
  };
}

const user = actor();
const moderator = actor({ userId: "u-mod", roles: ["USER", "MODERATOR"], moderatedCommunityIds: [C1] });
const admin = actor({ userId: "u-admin", roles: ["USER", "ADMIN"] });
const superAdmin = actor({ userId: "u-sa", roles: ["USER", "SUPER_ADMIN"] });

/** Kuralın zorunlu bağlamını dolduran, aktöre ait olmayan varsayılan kaynak. */
function contextFor(action: ActionId, a: TrustedActor | null, overrides: ResourceContext = {}): ResourceContext {
  const base: ResourceContext = {
    ownerId: a?.userId ?? "u-other",
    communityId: C1,
    mediaPurpose: "POLL",
    targetUserId: "u-target",
    targetRoles: ["USER"],
    newRole: "MODERATOR",
    activeSuperAdminCount: 2,
  };
  if (action === "vote.cast") base.ownerId = "u-other";
  return { ...base, ...overrides };
}

const allowed = (a: TrustedActor | null, action: ActionId, overrides: ResourceContext = {}) =>
  authorize(a, action, contextFor(action, a, overrides), NOW).allowed;

function denialCode(a: TrustedActor | null, action: ActionId, overrides: ResourceContext = {}) {
  const d = authorize(a, action, contextFor(action, a, overrides), NOW);
  assert.equal(d.allowed, false, `${action} reddedilmeliydi`);
  return d.allowed ? null : d.code;
}

const actionIds = Object.keys(actions) as ActionId[];

// ─── Endpoint ↔ kural eşlemesi ────────────────────────────────

describe("endpoint yetki eşlemesi", () => {
  test("her endpoint bir yetki kuralına bağlı", () => {
    const missing = endpoints.filter((e) => !Object.hasOwn(endpointPermissions, e.id)).map((e) => e.id);
    assert.deepEqual(missing, [], `yetki kuralı olmayan endpointler: ${missing.join(", ")}`);
  });

  test("her admin/moderatör endpoint'i yönetici seviyesinde bir kurala bağlı", () => {
    for (const e of endpoints.filter((x) => ["moderator", "admin", "super_admin"].includes(x.auth))) {
      const rule = actions[permissionForEndpoint(e.id)];
      assert.ok(["moderator", "admin", "super_admin"].includes(rule.level), `${e.id} → ${rule.level}`);
    }
  });

  test("kural seviyesi endpoint auth seviyesiyle aynı", () => {
    for (const e of endpoints) {
      const action = permissionForEndpoint(e.id);
      assert.equal(actions[action].level, e.auth, `${e.id} (${e.auth}) → ${action} (${actions[action].level})`);
    }
  });

  test("registry'de olmayan endpoint eşlemesi ve kullanılmayan işlem yok", () => {
    const ids = new Set(endpoints.map((e) => e.id));
    const stale = Object.keys(endpointPermissions).filter((id) => !ids.has(id));
    assert.deepEqual(stale, [], `registry'de olmayan eşlemeler: ${stale.join(", ")}`);
    const used = new Set(Object.values(endpointPermissions));
    const unused = actionIds.filter((a) => !used.has(a));
    assert.deepEqual(unused, [], `hiçbir endpoint'e bağlı olmayan işlemler: ${unused.join(", ")}`);
  });

  test("bilinmeyen endpoint için kural istemek hata verir", () => {
    assert.throws(() => permissionForEndpoint("admin.unknown"), /Yetki kuralı olmayan endpoint/);
  });

  test("ret kodları endpoint'in sözleşmedeki hata kodlarının içinde", () => {
    const actors: (TrustedActor | null)[] = [
      null,
      user,
      moderator,
      admin,
      superAdmin,
      actor({ emailVerified: false }),
      actor({ status: "BANNED" }),
      actor({ status: "SUSPENDED" }),
      actor({ status: "RESTRICTED", sanctions: [commentsBan, postingBan] }),
      actor({ ...admin, status: "RESTRICTED" }),
    ];
    const variants: ResourceContext[] = [
      {},
      { ownerId: "u-other" },
      { communityId: C2 },
      { communityId: null },
      { targetRoles: ["ADMIN"] },
      { targetRoles: ["SUPER_ADMIN"], newRole: "USER", activeSuperAdminCount: 1 },
    ];
    for (const e of endpoints) {
      const action = permissionForEndpoint(e.id);
      const codes = allErrors(e);
      for (const a of actors) {
        for (const v of variants) {
          const d = authorize(a, action, contextFor(action, a, v), NOW);
          if (!d.allowed) assert.ok(codes.includes(d.code), `${e.id}: ${d.code} sözleşmede yok`);
        }
        const self = authorize(a, action, contextFor(action, a, { targetUserId: a?.userId ?? "x" }), NOW);
        if (!self.allowed) assert.ok(codes.includes(self.code), `${e.id}: ${self.code} sözleşmede yok`);
      }
    }
  });

  test("audit için yazma/silme işlemi yok", () => {
    assert.deepEqual(
      actionIds.filter((a) => a.startsWith("audit.")),
      ["audit.read"],
    );
  });
});

// ─── Yetki matrisi (FOUNDATION_CONTRACTS) ─────────────────────

describe("yetki matrisi", () => {
  test("public okuma misafir ve yaptırımlı hesap dahil herkese açık", () => {
    for (const a of [null, user, actor({ status: "BANNED" }), actor({ status: "SUSPENDED" })]) {
      assert.ok(allowed(a, "content.read"));
    }
  });

  test("BANNED/SUSPENDED oturumlu kullanıcı bütün public endpointleri kullanabilir", () => {
    const publicEndpoints = endpoints.filter((e) => e.auth === "public");
    assert.ok(publicEndpoints.some((e) => e.id === "feed.list"));
    for (const status of ["BANNED", "SUSPENDED", "RESTRICTED"] as const) {
      const a = actor({ status, emailVerified: false, sanctions: [commentsBan, postingBan] });
      for (const e of publicEndpoints) assert.ok(allowed(a, permissionForEndpoint(e.id)), `${status} ${e.id}`);
    }
  });

  test("misafir oturum gerektiren işlemde 401", () => {
    for (const action of actionIds.filter((a) => actions[a].level !== "public")) {
      assert.equal(denialCode(null, action), "UNAUTHENTICATED", action);
    }
  });

  test("oy/yorum/oluşturma aktif ve doğrulanmış hesap ister; roller aynı kurala tabi", () => {
    for (const a of [user, moderator, admin, superAdmin]) {
      for (const action of ["poll.create", "vote.cast", "comment.create"] as const) assert.ok(allowed(a, action));
    }
    assert.equal(denialCode(actor({ emailVerified: false }), "vote.cast"), "EMAIL_NOT_VERIFIED");
    assert.equal(denialCode(actor({ roles: ["SUPER_ADMIN"], emailVerified: false }), "poll.create"), "EMAIL_NOT_VERIFIED");
  });

  test("kendi içeriği sahiplik ister; admin sahip yerine geçmez", () => {
    for (const a of [user, admin, superAdmin]) {
      assert.ok(allowed(a, "poll.update"));
      assert.equal(denialCode(a, "poll.update", { ownerId: "u-other" }), "FORBIDDEN");
      assert.equal(denialCode(a, "comment.delete", { ownerId: "u-other" }), "FORBIDDEN");
    }
  });

  test("anket sahibi kendi anketine oy veremez (rol istisnası yok)", () => {
    for (const a of [user, superAdmin]) {
      assert.equal(denialCode(a, "vote.cast", { ownerId: a.userId }), "SELF_VOTE_FORBIDDEN");
    }
  });

  test("içerik/rapor moderasyonu: USER hayır, MODERATOR atandığı topluluk, ADMIN/SA tümü", () => {
    for (const action of ["moderation.poll.apply", "moderation.comment.apply", "report.resolve", "media.review"] as const) {
      assert.equal(denialCode(user, action), "FORBIDDEN");
      assert.ok(allowed(moderator, action, { communityId: C1 }));
      assert.equal(denialCode(moderator, action, { communityId: C2 }), "FORBIDDEN");
      assert.equal(denialCode(moderator, action, { communityId: null }), "FORBIDDEN");
      for (const a of [admin, superAdmin]) {
        assert.ok(allowed(a, action, { communityId: C2 }));
        assert.ok(allowed(a, action, { communityId: null }));
      }
    }
  });

  test("moderasyon kuyruğu: atanmamış moderatör göremez", () => {
    for (const action of ["report.queue.read", "media.queue.read"] as const) {
      assert.ok(allowed(moderator, action));
      assert.equal(denialCode(actor({ roles: ["MODERATOR"] }), action), "FORBIDDEN");
      assert.equal(denialCode(user, action), "FORBIDDEN");
      assert.ok(allowed(admin, action));
    }
  });

  test("global MODERATOR rolü alınmış ama üyeliği MODERATOR kalan kullanıcı moderasyon yapamaz", () => {
    const demoted = actor({ userId: "u-demoted", roles: ["USER"], moderatedCommunityIds: [C1] });
    for (const action of [
      "moderation.poll.apply",
      "moderation.comment.apply",
      "report.resolve",
      "media.review",
      "report.queue.read",
      "media.queue.read",
    ] as const) {
      assert.equal(denialCode(demoted, action, { communityId: C1 }), "FORBIDDEN", action);
    }
    assert.equal(canModerate({ role: "USER", status: "ACTIVE", communityIds: [C1] }, { communityId: C1 }), false);
  });

  test("topluluk rolü DB'deki atamadan gelir; kaynağın topluluğu yetki vermez", () => {
    // Moderatör olmayan kullanıcı, kaynak kendi topluluğunu gösterse de moderasyon yapamaz.
    assert.equal(denialCode(actor({ moderatedCommunityIds: [C1] }), "moderation.poll.apply", { communityId: C1 }), "FORBIDDEN");
  });

  test("global kullanıcı yaptırımı: ADMIN normal/moderatör hesaplar, SUPER_ADMIN tümü", () => {
    for (const action of ["user.sanction", "user.sanction.lift"] as const) {
      assert.equal(denialCode(user, action), "FORBIDDEN");
      assert.equal(denialCode(moderator, action), "FORBIDDEN");
      assert.ok(allowed(admin, action, { targetRoles: ["USER"] }));
      assert.ok(allowed(admin, action, { targetRoles: ["USER", "MODERATOR"] }));
      assert.equal(denialCode(admin, action, { targetRoles: ["USER", "ADMIN"] }), "FORBIDDEN");
      assert.equal(denialCode(admin, action, { targetRoles: ["SUPER_ADMIN"] }), "FORBIDDEN");
      assert.ok(allowed(superAdmin, action, { targetRoles: ["ADMIN"] }));
      assert.ok(allowed(superAdmin, action, { targetRoles: ["SUPER_ADMIN"] }));
    }
  });

  test("kimse kendine yaptırım uygulayamaz veya kendi yaptırımını kaldıramaz", () => {
    for (const a of [admin, superAdmin]) {
      assert.equal(denialCode(a, "user.sanction", { targetUserId: a.userId }), "FORBIDDEN");
      assert.equal(denialCode(a, "user.sanction.lift", { targetUserId: a.userId }), "FORBIDDEN");
    }
  });

  test("kategori/featured/duyuru ADMIN ve SUPER_ADMIN", () => {
    for (const action of ["category.manage", "featured.manage", "announcement.manage"] as const) {
      assert.equal(denialCode(user, action), "FORBIDDEN");
      assert.equal(denialCode(moderator, action), "FORBIDDEN");
      assert.ok(allowed(admin, action));
      assert.ok(allowed(superAdmin, action));
    }
  });

  test("sistem ayarı / acil anahtar / rol atama sadece SUPER_ADMIN", () => {
    for (const action of ["settings.update", "emergency.update", "user.role.assign"] as const) {
      for (const a of [user, moderator, admin]) assert.equal(denialCode(a, action), "FORBIDDEN", `${action} ${a.userId}`);
      assert.ok(allowed(superAdmin, action));
    }
    assert.ok(allowed(admin, "settings.read"));
  });

  test("audit okuma ADMIN ve SUPER_ADMIN", () => {
    assert.equal(denialCode(user, "audit.read"), "FORBIDDEN");
    assert.equal(denialCode(moderator, "audit.read"), "FORBIDDEN");
    assert.ok(allowed(admin, "audit.read"));
    assert.ok(allowed(superAdmin, "audit.read"));
  });

  test("topluluk yönetimi ADMIN; topluluğa katılma/ayrılma kullanıcı", () => {
    for (const action of ["community.create", "community.update", "community.moderator.assign"] as const) {
      assert.equal(denialCode(moderator, action), "FORBIDDEN");
      assert.ok(allowed(admin, action));
    }
    assert.ok(allowed(user, "community.join"));
    assert.ok(allowed(user, "community.leave"));
  });

  test("en yüksek rol geçerli; bilinmeyen rol yok sayılır", () => {
    assert.equal(highestRole([]), "USER");
    assert.equal(highestRole(["USER", "ADMIN", "MODERATOR"]), "ADMIN");
    assert.equal(highestRole(["ROOT", "USER"]), "USER");
    assert.equal(denialCode(actor({ roles: ["ROOT" as never] }), "audit.read"), "FORBIDDEN");
  });
});

// ─── Rol atama ────────────────────────────────────────────────

describe("rol atama", () => {
  test("kendi rolünü değiştirmek (yükseltme dahil) 409", () => {
    assert.equal(denialCode(superAdmin, "user.role.assign", { targetUserId: superAdmin.userId, targetRoles: ["SUPER_ADMIN"], newRole: "ADMIN" }), "CONFLICT");
    // Admin kendini yükseltemez: seviye zaten SUPER_ADMIN ister.
    assert.equal(denialCode(admin, "user.role.assign", { targetUserId: admin.userId, targetRoles: ["ADMIN"], newRole: "SUPER_ADMIN" }), "FORBIDDEN");
  });

  test("son aktif SUPER_ADMIN düşürülemez", () => {
    const target = { targetRoles: ["SUPER_ADMIN"] as const, newRole: "ADMIN" as const };
    assert.equal(denialCode(superAdmin, "user.role.assign", { ...target, activeSuperAdminCount: 1 }), "CONFLICT");
    assert.equal(denialCode(superAdmin, "user.role.assign", { ...target, activeSuperAdminCount: 0 }), "CONFLICT");
    assert.ok(allowed(superAdmin, "user.role.assign", { ...target, activeSuperAdminCount: 2 }));
    // SUPER_ADMIN'i yine SUPER_ADMIN yapmak düşürme değildir.
    assert.ok(allowed(superAdmin, "user.role.assign", { targetRoles: ["SUPER_ADMIN"], newRole: "SUPER_ADMIN", activeSuperAdminCount: 1 }));
  });

  test("SUPER_ADMIN başka kullanıcıyı SUPER_ADMIN yapabilir", () => {
    assert.ok(allowed(superAdmin, "user.role.assign", { targetRoles: ["ADMIN"], newRole: "SUPER_ADMIN" }));
  });
});

// ─── Hesap durumu ve kısıtlar ─────────────────────────────────

describe("hesap durumu", () => {
  const mutationEndpoints = endpoints.filter((e) => e.method !== "GET" && e.auth !== "public");

  test("BANNED/SUSPENDED hiçbir oturumlu mutation yapamaz", () => {
    for (const status of ["BANNED", "SUSPENDED"] as const) {
      for (const roles of [["USER"], ["SUPER_ADMIN"]] as const) {
        const a = actor({ status, roles });
        for (const e of mutationEndpoints) {
          const action = permissionForEndpoint(e.id);
          const code = denialCode(a, action);
          assert.ok(code === "ACCOUNT_RESTRICTED" || code === "FORBIDDEN", `${status} ${e.id}: ${code}`);
        }
      }
    }
  });

  test("RESTRICTED/SUSPENDED/BANNED yönetici yetkili işlem yapamaz (canModerate ile aynı)", () => {
    for (const status of ["RESTRICTED", "SUSPENDED", "BANNED"] as const) {
      const a = actor({ ...superAdmin, status });
      for (const action of actionIds.filter((x) => ["moderator", "admin", "super_admin"].includes(actions[x].level))) {
        assert.equal(denialCode(a, action), "FORBIDDEN", `${status} ${action}`);
      }
    }
  });

  test("yaptırım tipinden kısıt türetme; WARNING kısıt üretmez", () => {
    assert.deepEqual(restrictionsFromSanctions([{ type: "WARNING", endsAt: null }], NOW), []);
    assert.deepEqual(restrictionsFromSanctions([commentsBan], NOW), ["COMMENTS"]);
    assert.deepEqual(
      restrictionsFromSanctions([postingBan, { type: "WARNING", endsAt: FUTURE }, { ...postingBan, endsAt: FUTURE }], NOW),
      ["POSTING"],
    );
  });

  test("WARNING hiçbir endpoint'in yetkisini değiştirmez", () => {
    const warned = actor({ sanctions: [{ type: "WARNING", endsAt: null }] });
    for (const e of endpoints) {
      const action = permissionForEndpoint(e.id);
      for (const v of [{}, { ownerId: "u-other" }, { mediaPurpose: "AVATAR" as const }]) {
        assert.deepEqual(
          authorize(warned, action, contextFor(action, warned, v), NOW),
          authorize(user, action, contextFor(action, user, v), NOW),
          e.id,
        );
      }
    }
  });
});

describe("RESTRICTED işlem bazlı", () => {
  const noComments = actor({ status: "RESTRICTED", sanctions: [commentsBan] });
  const noPosting = actor({ status: "RESTRICTED", sanctions: [postingBan] });

  test("RESTRICT_COMMENTS yorum ve alternatif oluşturma/düzenlemeyi kapatır", () => {
    assert.equal(denialCode(noComments, "comment.create"), "ACCOUNT_RESTRICTED");
    assert.equal(denialCode(noComments, "comment.update"), "ACCOUNT_RESTRICTED");
    assert.ok(allowed(noComments, "poll.create"));
    assert.ok(allowed(noComments, "decision.set"));
  });

  test("RESTRICT_POSTING anket, düzenleme, ek açıklama, karar notu ve içerik görselini kapatır", () => {
    for (const action of ["poll.create", "poll.update", "poll.addendum.create", "decision.set"] as const) {
      assert.equal(denialCode(noPosting, action), "ACCOUNT_RESTRICTED", action);
    }
    for (const mediaPurpose of ["POLL", "COMMUNITY"] as const) {
      assert.equal(denialCode(noPosting, "media.upload", { mediaPurpose }), "ACCOUNT_RESTRICTED");
      assert.equal(denialCode(noPosting, "media.complete", { mediaPurpose }), "ACCOUNT_RESTRICTED");
    }
    assert.ok(allowed(noPosting, "comment.create"));
  });

  test("RESTRICT_POSTING avatar yüklemesini kapatmaz", () => {
    assert.ok(allowed(noPosting, "media.upload", { mediaPurpose: "AVATAR" }));
    assert.ok(allowed(noPosting, "media.complete", { mediaPurpose: "AVATAR" }));
  });

  test("oy, tepki, kaydetme, takip, rapor ve kendi içeriğini silme her kısıtta açık", () => {
    const both = actor({ status: "RESTRICTED", sanctions: [commentsBan, postingBan] });
    for (const a of [noComments, noPosting, both]) {
      for (const action of [
        "vote.cast",
        "reaction.set",
        "bookmark.set",
        "follow.set",
        "report.create",
        "poll.delete",
        "comment.delete",
        "poll.close",
        "account.update",
      ] as const) {
        assert.ok(allowed(a, action), `${a.sanctions.map((x) => x.type).join("+")} ${action}`);
      }
    }
  });

  test("süresi dolmuş RESTRICT_COMMENTS yorumu engellemez", () => {
    const expired = actor({ status: "RESTRICTED", sanctions: [{ ...commentsBan, endsAt: PAST }] });
    assert.ok(allowed(expired, "comment.create"));
    assert.ok(allowed(expired, "comment.update"));
    // Bitiş anının kendisi dolmuş sayılır.
    assert.ok(allowed(actor({ sanctions: [{ ...commentsBan, endsAt: NOW.toISOString() }] }), "comment.create"));
  });

  test("süresi dolmamış yaptırım uygulanır; endsAt null kalıcıdır", () => {
    assert.equal(denialCode(actor({ sanctions: [{ ...commentsBan, endsAt: FUTURE }] }), "comment.create"), "ACCOUNT_RESTRICTED");
    const permanent = actor({ sanctions: [commentsBan] });
    for (const now of [NOW, new Date("2099-01-01T00:00:00Z")]) {
      assert.equal(authorize(permanent, "comment.create", {}, now).allowed, false);
    }
  });

  test("aynı kısıtın biri dolmuş biri aktifse aktif olan geçerli", () => {
    const a = actor({ sanctions: [{ ...postingBan, endsAt: PAST }, { ...postingBan, endsAt: FUTURE }] });
    assert.equal(denialCode(a, "poll.create"), "ACCOUNT_RESTRICTED");
  });

  test("kısıt, status özetinden bağımsız olarak uygulanır", () => {
    assert.equal(denialCode(actor({ sanctions: [commentsBan] }), "comment.create"), "ACCOUNT_RESTRICTED");
  });
});

// ─── canModerate ve bağlam ────────────────────────────────────

describe("canModerate paritesi", () => {
  test("topluluk kapsamlı işlemler canModerate ile aynı karar verir", () => {
    const statuses = ["ACTIVE", "RESTRICTED", "SUSPENDED", "BANNED"] as const;
    const roleSets = [["USER"], ["MODERATOR"], ["ADMIN"], ["SUPER_ADMIN"]] as const;
    const communitySets = [[], [C1], [C1, C2]];
    const scoped = actionIds.filter((a) => actions[a].scope === "community");
    assert.ok(scoped.length >= 4);
    for (const status of statuses) {
      for (const roles of roleSets) {
        for (const communityIds of communitySets) {
          for (const communityId of [C1, C2, null]) {
            const expected = canModerate({ role: roles[0], status, communityIds }, { communityId });
            const a = actor({ status, roles, moderatedCommunityIds: communityIds });
            for (const action of scoped) {
              assert.equal(authorize(a, action, { communityId }, NOW).allowed, expected, `${status} ${roles[0]} ${action}`);
            }
          }
        }
      }
    }
  });

  test("canModerate davranışı değişmedi (#64)", () => {
    assert.equal(canModerate({ role: "MODERATOR", status: "ACTIVE", communityIds: [C1] }, { communityId: C1 }), true);
    assert.equal(canModerate({ role: "MODERATOR", status: "ACTIVE", communityIds: [C1] }, { communityId: C2 }), false);
    assert.equal(canModerate({ role: "MODERATOR", status: "ACTIVE", communityIds: [C1] }, null), false);
    assert.equal(canModerate({ role: "ADMIN", status: "ACTIVE" }, null), true);
    assert.equal(canModerate({ role: "ADMIN", status: "SUSPENDED" }, null), false);
    assert.equal(canModerate({ role: "ROOT", status: "ACTIVE" }, null), false);
  });
});

describe("zorunlu bağlam", () => {
  test("eksik zorunlu alan sessiz karar yerine TypeError", () => {
    assert.throws(() => authorize(user, "poll.update", {}, NOW), /resource\.ownerId zorunlu/);
    assert.throws(() => authorize(user, "vote.cast", {}, NOW), /resource\.ownerId zorunlu/);
    assert.throws(() => authorize(moderator, "moderation.poll.apply", {}, NOW), /resource\.communityId zorunlu/);
    assert.throws(() => authorize(superAdmin, "user.role.assign", { targetUserId: "x", targetRoles: [] }, NOW), /zorunlu/);
    assert.throws(() => authorize(user, "media.upload", {}, NOW), /resource\.mediaPurpose zorunlu/);
    assert.throws(() => authorize(user, "content.read", {}, new Date("x")), /Geçersiz zaman: now/);
    assert.throws(
      () => authorize(actor({ sanctions: [{ type: "RESTRICT_COMMENTS", endsAt: "yarın" }] }), "comment.create", {}, NOW),
      /Geçersiz zaman: sanction\.endsAt/,
    );
  });

  test("bilinmeyen işlem hata verir", () => {
    assert.throws(() => authorize(user, "admin.everything" as ActionId, {}, NOW), /Bilinmeyen işlem/);
  });

  test("admin.roles.put endpoint'i SUPER_ADMIN kuralına bağlı", () => {
    assert.equal(actions[permissionForEndpoint(getEndpoint("admin.roles.put").id)].level, "super_admin");
  });
});
