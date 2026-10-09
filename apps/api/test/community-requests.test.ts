/** #172: real-Postgres integration acceptance for community request lifecycle. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import { expireCommunityRequests } from "../../worker/src/jobs/communities/expire-requests.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("community requests #172", { skip: backend ? false : "TEST_DATABASE_URL gerektirir" }, () => {
  let h: Harness;
  let admin: { id: string; cookie: string };
  let member: { id: string; cookie: string };

  const slug = (prefix: string) => prefix + "-" + randomUUID().slice(0, 8);
  const send = (method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown, cookie?: string) =>
    h.app.inject({ method, url: "/v1" + path, headers: {
      origin: WEB_ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}),
    }, payload: body ? JSON.stringify(body) : undefined });
  const post = (path: string, body: unknown, cookie?: string) => send("POST", path, body, cookie);
  const get = (path: string, cookie?: string) => send("GET", path, undefined, cookie);
  const patch = (path: string, body: unknown, cookie?: string) => send("PATCH", path, body, cookie);
  const apiError = (response: Awaited<ReturnType<typeof send>>, status: number, code: string) => {
    assert.equal(response.statusCode, status, response.body);
    assert.equal(ErrorBody.parse(response.json()).error.code, code);
  };

  async function signUp() {
    const user = slug("t172").replaceAll("-", "").slice(0, 29);
    const password = "test-guclu-sifre-172";
    const email = `${user}@example.test`;
    const before = h.mails.length;
    assert.equal((await post("/auth/register", { email, username: user, displayName: "Test", password })).statusCode, 202);
    const token = tokenFrom(h.mails[before]!);
    assert.equal((await post("/auth/email/verify", { token })).statusCode, 200);
    const result = await post("/auth/login", { email, password });
    assert.equal(result.statusCode, 200, result.body);
    return { id: result.json().data.id as string, cookie: sessionCookie(result.headers["set-cookie"]) };
  }

  before(async () => {
    h = await createHarness(backend!);
    admin = await signUp();
    member = await signUp();
    await h.prisma!.userRole.create({ data: { userId: admin.id, role: "ADMIN" } });
  });
  after(async () => { await h?.close(); });

  test("create + replay, ownership filter and admin queue/authorization", async () => {
    const input = { name: "Samsun Yazılım", slug: slug("samsun-yazilim"), description: "Teknik topluluk" };
    apiError(await post("/communities/requests", input), 401, "UNAUTHENTICATED");
    const first = await post("/communities/requests", input, member.cookie);
    assert.equal(first.statusCode, 201, first.body);
    const request = first.json().data;
    assert.equal(request.status, "PENDING");
    assert.equal(request.memberCount, 0);
    const retry = await post("/communities/requests", input, member.cookie);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().data.id, request.id);
    apiError(await post("/communities/requests", { ...input, name: "Other name" }, member.cookie), 409, "CONFLICT");
    const mine = await get("/communities/requests/mine", member.cookie);
    assert.equal(mine.statusCode, 200);
    assert.ok(mine.json().data.some((r: { id: string }) => r.id === request.id));
    apiError(await get("/admin/communities/requests", member.cookie), 403, "FORBIDDEN");
    const adminList = await get("/admin/communities/requests?status=PENDING", admin.cookie);
    assert.equal(adminList.statusCode, 200, adminList.body);
    assert.ok(adminList.json().data.some((r: { id: string }) => r.id === request.id));
  });

  test("concurrent admin approvals are single-winner: one community, one first membership and one audit", async () => {
    const input = { name: "Etkinlik Analizi", slug: slug("analiz") };
    const res = await post("/communities/requests", input, member.cookie);
    assert.equal(res.statusCode, 201);
    const id = res.json().data.id as string;
    const approval = { decision: "APPROVE", reason: "Topluluk kurallarına uygun" };
    const attempts = await Promise.all([
      patch(`/admin/communities/requests/${id}`, approval, admin.cookie),
      patch(`/admin/communities/requests/${id}`, approval, admin.cookie),
    ]);
    assert.deepEqual(attempts.map((r) => r.statusCode), [200, 200], attempts.map((r) => r.body).join("\n"));
    const req = await h.prisma!.communityRequest.findUniqueOrThrow({ where: { id } });
    assert.equal(req.status, "APPROVED");
    assert.ok(req.communityId);
    assert.equal(req.approvalDeadline!.getTime() - req.approvedAt!.getTime(), 7 * 24 * 60 * 60_000);
    const community = await h.prisma!.community.findUniqueOrThrow({ where: { id: req.communityId! } });
    assert.equal(community.status, "ACTIVE");
    assert.equal(community.memberCount, 1);
    assert.equal(await h.prisma!.communityMembership.count({ where: { communityId: community.id, userId: member.id } }), 1);
    assert.equal(await h.prisma!.auditLog.count({ where: { action: "community.request.review", targetId: community.id } }), 1);
    apiError(await patch(`/admin/communities/requests/${id}`, { decision: "REJECT", reason: "Farklı karar" }, admin.cookie), 409, "CONFLICT");
    const future = new Date(req.approvalDeadline!.getTime() + 24 * 60 * 60_000);
    const worker = await expireCommunityRequests({ prisma: h.prisma!, now: () => future, log: () => {} });
    assert.ok(worker.closed >= 1);
    const hidden = await h.prisma!.community.findUniqueOrThrow({ where: { id: community.id } });
    assert.equal(hidden.status, "HIDDEN");
    const request = await h.prisma!.communityRequest.findUniqueOrThrow({ where: { id } });
    assert.equal(request.status, "CLOSED");
    assert.equal(await h.prisma!.auditLog.count({ where: { action: "community.request.expire", targetId: community.id } }), 1);
    const repeat = await expireCommunityRequests({ prisma: h.prisma!, now: () => future, log: () => {} });
    assert.equal(repeat.closed, 0);
    apiError(await send("PUT", `/communities/${community.id}/membership`, undefined, admin.cookie), 404, "NOT_FOUND");
  });

  test("ten distinct memberships protect from expiration (not denormalized memberCount)", async () => {
    const input = { name: "Test On Uye", slug: slug("ten-members") };
    const created = await post("/communities/requests", input, member.cookie);
    assert.equal(created.statusCode, 201);
    const id = created.json().data.id as string;
    const result = await patch(`/admin/communities/requests/${id}`, { decision: "APPROVE", reason: "Aktif üyeler bulundu" }, admin.cookie);
    assert.equal(result.statusCode, 200, result.body);
    const row = await h.prisma!.communityRequest.findUniqueOrThrow({ where: { id } });
    assert.ok(row.communityId);
    for (let i = 0; i < 9; i++) {
      const joined = await signUp();
      const response = await send("PUT", `/communities/${row.communityId}/membership`, undefined, joined.cookie);
      assert.equal(response.statusCode, 200, response.body);
    }
    const future = new Date(row.approvalDeadline!.getTime() + 86_400_000);
    const run = await expireCommunityRequests({ prisma: h.prisma!, now: () => future, log: () => {} });
    assert.equal(run.failed, 0);
    assert.equal((await h.prisma!.community.findUniqueOrThrow({ where: { id: row.communityId! } })).status, "ACTIVE");
    assert.equal((await h.prisma!.communityRequest.findUniqueOrThrow({ where: { id } })).status, "APPROVED");
  });

  test("rejection requires reason and creates no community", async () => {
    const input = { name: "Öneri", slug: slug("rejected") };
    const res = await post("/communities/requests", input, member.cookie);
    const id = res.json().data.id as string;
    apiError(await patch(`/admin/communities/requests/${id}`, { decision: "REJECT", reason: "x" }, admin.cookie), 400, "VALIDATION_ERROR");
    const response = await patch(`/admin/communities/requests/${id}`, { decision: "REJECT", reason: "İçerik kuralları uygun değil" }, admin.cookie);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.status, "REJECTED");
    assert.equal(await h.prisma!.community.count({ where: { slug: input.slug } }), 0);
  });
});
