// Topluluk yönetim görünümü (#184) web tarafı: eşik/etki metinleri ve istemci çağrıları.
import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { AdminClient } from "../src/features/admin/admin-client.ts";
import type { CommunityOverviewView, CommunityThresholdView } from "../src/features/admin/admin-client.ts";
import { statusImpactText, THRESHOLD_BADGE, thresholdText } from "../src/features/admin/community-model.ts";
import { HttpClient } from "../src/lib/http-client.ts";

const base: CommunityThresholdView = {
  state: "IN_PROGRESS",
  requestId: "01998b9a-0000-7000-8000-000000000950",
  requiredMembers: 10,
  members: 4,
  approvedAt: "2026-09-27T09:00:00.000Z",
  approvalDeadline: "2026-10-04T09:00:00.000Z",
  closedAt: null,
  daysLeft: 3,
};

test("eşik metni: her durum için sayı, tarih ve sonraki adım; elle kapatılmış topluluğun otomatik kapanmayacağı açıkça yazılır", () => {
  assert.equal(Object.keys(THRESHOLD_BADGE).length, 6);
  assert.match(thresholdText({ ...base, state: "NOT_APPLICABLE" }), /uygulanmaz/);
  const progress = thresholdText(base);
  assert.match(progress, /4\/10 üye/);
  assert.match(progress, /3 gün kaldı/);
  assert.match(progress, /04\.10\.2026/);
  assert.match(thresholdText({ ...base, state: "REACHED", members: 12, daysLeft: null }), /Eşik doldu: 12\/10 üye/);
  const overdue = thresholdText({ ...base, state: "OVERDUE", members: 2, daysLeft: null });
  assert.match(overdue, /03:10 UTC/);
  assert.match(overdue, /elle kapatılmışsa otomatik işlem yapılmaz/);
  assert.match(thresholdText({ ...base, state: "AUTO_CLOSED", closedAt: "2026-10-05T03:10:00.000Z", daysLeft: null }), /otomatik kapatıldı/);
  assert.match(thresholdText({ ...base, state: "REOPENED", closedAt: "2026-10-05T03:10:00.000Z", daysLeft: null }), /tekrar otomatik kapanmaz/);
});

test("etki metni: kapatma ve yeniden açma için sayılar; hiçbir şeyin silinmediği belirtilir", () => {
  const impact = { members: 4, moderators: 1, polls: 6, activePolls: 5, openPolls: 3, comments: 12, openReports: 1 };
  const closing = statusImpactText({ status: "ACTIVE", impact } as Pick<CommunityOverviewView, "status" | "impact">);
  assert.match(closing, /4 üye \(1 moderatör\), 6 anket \(3 açık\), 12 yorum ve 1 açık rapor/);
  assert.match(closing, /Hiçbiri silinmez/);
  const opening = statusImpactText({ status: "HIDDEN", impact } as Pick<CommunityOverviewView, "status" | "impact">);
  assert.match(opening, /Yeniden açılırsa/);
});

type Seen = { url: string; method: string };
function client(endpoint: string, name: string) {
  const calls: Seen[] = [];
  const http = new HttpClient("http://api.test", async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const e = structuredClone(examples.find((x) => x.endpoint === endpoint && x.name === name)!);
    return new Response(JSON.stringify(e.body), { status: e.status });
  });
  return { admin: new AdminClient(http), calls };
}

test("istemci: liste süzgeci ve sayfa boyutu sorguda; genel bakış ve üye listesi sözleşmeyle doğrulanır", async () => {
  const id = "01998b9a-0000-7000-8000-000000000940";
  const listing = client("admin.communities.listAll", "ok");
  const page = await listing.admin.communitiesAll({ status: "HIDDEN", q: "kampüs" });
  const url = new URL(listing.calls[0]!.url);
  assert.equal(url.pathname, "/v1/admin/communities");
  assert.deepEqual([url.searchParams.get("status"), url.searchParams.get("q"), url.searchParams.get("limit")], ["HIDDEN", "kampüs", "20"]);
  assert.equal(page.items[0]!.threshold.state, "IN_PROGRESS");
  assert.equal(page.next, null);

  const overview = client("admin.communities.overview", "ok");
  const detail = await overview.admin.communityOverview(id);
  assert.ok(overview.calls[0]!.url.endsWith(`/admin/communities/${id}/overview`));
  assert.equal(detail.impact.openPolls, 3);
  assert.equal(detail.recentChanges[0]!.operation, "update");

  const membersClient = client("admin.communities.members", "ok");
  const members = await membersClient.admin.communityMembers(id, { q: "den", role: "MEMBER" });
  const mUrl = new URL(membersClient.calls[0]!.url);
  assert.equal(mUrl.pathname, `/v1/admin/communities/${id}/members`);
  assert.deepEqual([mUrl.searchParams.get("q"), mUrl.searchParams.get("role")], ["den", "MEMBER"]);
  assert.equal(members.items[0]!.role, "MEMBER");
});
