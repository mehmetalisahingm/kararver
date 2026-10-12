// SA #182: real PostgreSQL authorization/replay test for two-person critical role changes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { createPrismaAdminUserStore } from "../src/modules/admin-users/prisma-store.ts";
import { createPrismaRoleApprovalStore } from "../src/modules/security/approval-store.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";

const backend = prismaBackend();
const suite = backend ? describe : describe.skip;

suite("SA #182 two distinct approvers and atomic role gate", () => {
  let h: Harness;
  type Account = { id: string; sessionId: string; cookie: string; password: string; email: string };
  let a: Account, b: Account, subject: Account;

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
  });
  after(async () => { await h?.close(); });

  test("requires distinct MFA approvals, fresh session step-up and consumes approval in role transaction", async () => {
    const admin = createPrismaAdminUserStore(h.prisma!, { enforceCriticalApprovals: true });
    const approvals = createPrismaRoleApprovalStore(h.prisma!);
    const reason = "İkinci yönetici ile gözden geçirilen görev devri";
    const opts = { actorId: a.id, actorSessionId: a.sessionId, userId: subject.id,
      role: "SUPER_ADMIN" as const, reason, requestId: "role_req_12345678", now: h.clock.now };

    assert.deepEqual(await admin.setRole(opts), { kind: "rejected", reason: "approval_required" });
    const as = await enroll(a);
    const bs = await enroll(b);
    h.clock.advance(30000);
    await stepup(a, as);
    const created = await approvals.request({ actorId: a.id, sessionId: a.sessionId,
      targetUserId: subject.id, role: "SUPER_ADMIN", reason, requestId: "role_request_123", now: h.clock.now });
    assert.equal(created.kind, "ok", JSON.stringify(created));
    if (created.kind !== "ok") return;

    const self = await approvals.approve({ actorId: a.id, sessionId: a.sessionId,
      approvalId: created.data.id, reason: "Kendi onayım", requestId: "role_self_1234", now: h.clock.now });
    assert.deepEqual(self, { kind: "rejected", reason: "forbidden" });

    await stepup(b, bs);
    const second = await approvals.approve({ actorId: b.id, sessionId: b.sessionId,
      approvalId: created.data.id, reason: "İkinci onay uygun", requestId: "role_approve_1234", now: h.clock.now });
    assert.equal(second.kind, "ok", JSON.stringify(second));

    // Initiator's previous step-up was consumed on request; cannot execute without another fresh OTP.
    assert.deepEqual(await admin.setRole({ ...opts, approvalId: created.data.id }),
      { kind: "rejected", reason: "approval_required" });
    h.clock.advance(30000);
    await stepup(a, as);
    assert.deepEqual(await admin.setRole({ ...opts, approvalId: created.data.id, now: h.clock.now }),
      { kind: "changed", role: "SUPER_ADMIN" });
    const approval = await h.prisma!.roleChangeApproval.findUniqueOrThrow({ where: { id: created.data.id } });
    assert.equal(approval.status, "CONSUMED");
    assert.equal((await h.prisma!.userRole.findUniqueOrThrow({ where: { userId: subject.id } })).role, "SUPER_ADMIN");
    const audit = await h.prisma!.auditLog.findMany({ where: { targetType: "USER", targetId: subject.id, action: "user.role.assign" } });
    assert.ok(audit.some(x => x.operation === "request"));
    assert.ok(audit.some(x => x.operation === "approve"));
    assert.ok(audit.some(x => x.operation === "grant"));
  });
});
