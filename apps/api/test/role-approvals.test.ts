// SA #182: real PostgreSQL authorization/replay test for two-person critical role changes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { createPrismaAdminUserStore } from "../src/modules/admin-users/prisma-store.ts";
import { createPrismaRoleApprovalStore } from "../src/modules/security/approval-store.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { registerRoleApprovalRoutes } from "../src/modules/security/approval-routes.ts";
import { ApiError } from "../src/http/errors.ts";

const backend = prismaBackend();
const suite = backend ? describe : describe.skip;

suite("SA #182 two distinct approvers and atomic role gate", () => {
  let h: Harness;
  type Account = { id: string; sessionId: string; cookie: string; password: string; email: string };
  let a: Account, b: Account, subject: Account;
  let aSecret: string, bSecret: string;

  const call = (path: string, body: unknown, cookie?: string) => h.app.inject({
    method: "POST", url: "/v1" + path,
    headers: { origin: WEB_ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(body),
  });

  async function register(): Promise<Account> {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
    const email = "approval_" + suffix + "@example.test";
    const password = "guclu-test-parola-2026";
    assert.equal((await call("/auth/register", { email, username: "approval_" + suffix, displayName: "Onay Testi", password })).statusCode, 202);
    const token = tokenFrom(h.mails.at(-1)!);
    assert.equal((await call("/auth/email/verify", { token })).statusCode, 200);
    const login = await call("/auth/login", { email, password });
    assert.equal(login.statusCode, 200, login.body);
    const id = login.json().data.id as string;
    const session = await h.prisma!.session.findFirstOrThrow({ where: { userId: id }, orderBy: { createdAt: "desc" } });
    return { id, sessionId: session.id, cookie: sessionCookie(login.headers["set-cookie"] as string), password, email };
  }

  async function enroll(account: Account): Promise<string> {
    const start = await call("/me/mfa/setup", { password: account.password }, account.cookie);
    assert.equal(start.statusCode, 200, start.body);
    const secret = start.json().data.secret as string;
    const code = totp(secret);
    const confirmation = await call("/me/mfa/confirm", { code }, account.cookie);
    assert.equal(confirmation.statusCode, 200, confirmation.body);
    return secret;
  }
  const totp = (secret: string) => hotp(decodeBase32(secret), Math.floor(h.clock.now.getTime() / 30000));
  async function stepup(account: Account, secret: string) {
    const res = await call("/me/mfa/step-up", { code: totp(secret) }, account.cookie);
    assert.equal(res.statusCode, 200, res.body);
  }

  before(async () => {
    h = await createHarness(backend!);
    a = await register(); b = await register(); subject = await register();
    await h.prisma!.userRole.create({ data: { userId: a.id, role: "SUPER_ADMIN" } });
    await h.prisma!.userRole.create({ data: { userId: b.id, role: "SUPER_ADMIN", grantedById: a.id } });
    // Legacy dual-approver authorization is still exercised by DEMOTING an existing SUPER_ADMIN;
    // new promotions through the normal API are prohibited by the single-owner policy.
    await h.prisma!.userRole.create({ data: { userId: subject.id, role: "SUPER_ADMIN", grantedById: a.id } });
    aSecret = await enroll(a);
    bSecret = await enroll(b);
  });
  after(async () => { await h?.close(); });

  test("requires distinct MFA approvals, fresh session step-up and consumes approval in role transaction", async () => {
    const admin = createPrismaAdminUserStore(h.prisma!, { enforceCriticalApprovals: true });
    const approvals = createPrismaRoleApprovalStore(h.prisma!);
    const reason = "İkinci yönetici ile gözden geçirilen görev devri";
    const opts = { actorId: a.id, actorSessionId: a.sessionId, userId: subject.id,
      role: "ADMIN" as const, reason, requestId: "role_req_12345678", now: h.clock.now };

    assert.deepEqual(await admin.setRole(opts), { kind: "rejected", reason: "approval_required" });
    h.clock.advance(30000);
    await stepup(a, aSecret);
    const created = await approvals.request({ actorId: a.id, sessionId: a.sessionId,
      targetUserId: subject.id, role: "ADMIN", reason, requestId: "role_request_123", now: h.clock.now });
    assert.equal(created.kind, "ok", JSON.stringify(created));
    if (created.kind !== "ok") return;

    const self = await approvals.approve({ actorId: a.id, sessionId: a.sessionId,
      approvalId: created.data.id, reason: "Kendi onayım", requestId: "role_self_1234", now: h.clock.now });
    assert.deepEqual(self, { kind: "rejected", reason: "forbidden" });

    await stepup(b, bSecret);
    const second = await approvals.approve({ actorId: b.id, sessionId: b.sessionId,
      approvalId: created.data.id, reason: "İkinci onay uygun", requestId: "role_approve_1234", now: h.clock.now });
    assert.equal(second.kind, "ok", JSON.stringify(second));

    // Initiator's previous step-up was consumed on request; cannot execute without another fresh OTP.
    assert.deepEqual(await admin.setRole({ ...opts, approvalId: created.data.id }),
      { kind: "rejected", reason: "approval_required" });
    h.clock.advance(30000);
    await stepup(a, aSecret);
    assert.deepEqual(await admin.setRole({ ...opts, approvalId: created.data.id, now: h.clock.now }),
      { kind: "changed", role: "ADMIN" });
    const approval = await h.prisma!.roleChangeApproval.findUniqueOrThrow({ where: { id: created.data.id } });
    assert.equal(approval.status, "CONSUMED");
    assert.equal((await h.prisma!.userRole.findUniqueOrThrow({ where: { userId: subject.id } })).role, "ADMIN");
    const audit = await h.prisma!.auditLog.findMany({ where: { targetType: "USER", targetId: subject.id, action: "user.role.assign" } });
    assert.ok(audit.some(x => x.operation === "request"));
    assert.ok(audit.some(x => x.operation === "approve"));
    assert.ok(audit.some(x => x.operation === "change"));
  });

  test("deleted, changed-role and changed-revision targets reject without spending approval or MFA", async () => {
    const approvals = createPrismaRoleApprovalStore(h.prisma!);
    for (const scenario of ["deleted", "role", "revision"] as const) {
      const target = await register();
      if (scenario === "revision") await h.prisma!.userRole.create({ data: { userId: target.id, role: "ADMIN", grantedById: a.id } });
      h.clock.advance(30000);
      await stepup(a, aSecret);
      const created = await approvals.request({ actorId: a.id, sessionId: a.sessionId, targetUserId: target.id,
        role: "SUPER_ADMIN", reason: "Race acceptance request", requestId: "guard_request_123", now: h.clock.now });
      assert.equal(created.kind, "ok", JSON.stringify(created));
      if (created.kind !== "ok") throw new Error("approval missing");
      await stepup(b, bSecret);
      if (scenario === "deleted") await h.prisma!.user.update({ where: { id: target.id }, data: { deletedAt: h.clock.now } });
      if (scenario === "role") await h.prisma!.userRole.create({ data: { userId: target.id, role: "MODERATOR", grantedById: a.id } });
      if (scenario === "revision") {
        const role = await h.prisma!.userRole.findUniqueOrThrow({ where: { userId: target.id } });
        await h.prisma!.userRole.update({ where: { userId: target.id }, data: { updatedAt: new Date(role.updatedAt.getTime() + 1000) } });
      }
      assert.deepEqual(await approvals.approve({ actorId: b.id, sessionId: b.sessionId, approvalId: created.data.id,
        reason: "Must not commit", requestId: "guard_approve_123", now: h.clock.now }), { kind: "rejected", reason: "stale" });
      assert.equal((await h.prisma!.roleChangeApproval.findUniqueOrThrow({ where: { id: created.data.id } })).status, "PENDING");
      assert.equal((await h.prisma!.sessionMfaStepup.findUniqueOrThrow({ where: { sessionId: b.sessionId } })).consumedAt, null);
      assert.equal(await h.prisma!.auditLog.count({ where: { targetId: target.id, operation: "approve" } }), 0);
    }
  });
});

test("approval route checks resource authorization before any store mutation", async () => {
  const handlers = new Map<string, any>();
  let writes = 0;
  registerRoleApprovalRoutes(((id: string, handler: any) => handlers.set(id, handler)) as any, {
    store: {
      target: async () => ({ targetUserId: "target", requestedRole: "SUPER_ADMIN" }),
      approve: async () => { writes++; throw new Error("must not write"); },
    } as any,
    users: { target: async () => ({ id: "target", role: "USER", status: "ACTIVE", deleted: false }), activeSuperAdminCount: async () => 2 } as any,
    now: () => new Date(),
  });
  await assert.rejects(handlers.get("admin.roleApprovals.approve")({
    params: { id: "approval" }, body: { reason: "Denied scope" }, viewer: { id: "actor", sessionId: "session" },
    request: { id: "req" }, authorize: async () => { throw new ApiError("FORBIDDEN", "denied"); },
  }), (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN");
  assert.equal(writes, 0);
});
