// #187: yönetim menüsünün rol kuralları. Menü gizleme yalnız kullanıcı deneyimidir; yetkinin kendisi backend RBAC'tedir
// (apps/api/test/permission-matrix.test.ts). Burada menünün, bölümün yüklediği endpoint'in seviyesiyle çelişmediği sınanır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEndpoint, type Auth } from "@kararver/contracts";
import { adminNav, adminSections, canEnterAdmin, canSeeAdminItem, type AdminRole, type AdminSectionId } from "../src/features/admin/admin-model.ts";

const visible = (roles: AdminRole[]) => adminNav.filter((item) => canSeeAdminItem(roles, item)).map((item) => item.id);

test("rol başına görünen menü: USER hiçbiri, MODERATOR moderasyon bölümleri, ADMIN ve SUPER_ADMIN tümü", () => {
  assert.equal(canEnterAdmin(["USER"]), false);
  assert.deepEqual(visible(["USER"]), []);
  assert.equal(canEnterAdmin([]), false);
  assert.deepEqual(visible(["MODERATOR"]), ["polls", "comments", "reports", "media", "communities"]);
  for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
    assert.equal(canEnterAdmin([role]), true);
    assert.deepEqual(visible([role]), [...adminSections]);
  }
});

/** Bölümün ilk yüklediği liste endpoint'i (panel bileşenlerindeki ilk istek). */
const primaryEndpoint: Record<AdminSectionId, string> = {
  dashboard: "admin.metrics.get",
  users: "admin.users.list",
  polls: "admin.content.polls",
  comments: "admin.content.comments",
  reports: "admin.reports.list",
  media: "admin.media.list",
  categories: "admin.categories.list",
  // Moderatör toplulukları salt okunur görür (public liste); yönetim düğmeleri ve başvuru kuyruğu ADMIN+.
  communities: "communities.list",
  featured: "admin.featured.list",
  settings: "admin.settings.list",
  audit: "admin.audit.list",
};

const allowedRoles: Record<Auth, AdminRole[]> = {
  public: ["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"],
  user: ["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"],
  verified: ["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"],
  owner: ["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"],
  moderator: ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  admin: ["ADMIN", "SUPER_ADMIN"],
  super_admin: ["SUPER_ADMIN"],
};

test("menü, bölümün endpoint seviyesinin izin vermediği bir role bölüm göstermez", () => {
  assert.deepEqual(Object.keys(primaryEndpoint).sort(), [...adminSections].sort());
  for (const item of adminNav) {
    const endpoint = getEndpoint(primaryEndpoint[item.id]);
    for (const role of item.roles) {
      assert.ok(allowedRoles[endpoint.auth].includes(role), `${item.id}: ${role} menüde ama ${endpoint.id} seviyesi ${endpoint.auth}`);
    }
  }
});
