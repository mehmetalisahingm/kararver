// security.alerts — #185 kritik güvenlik alarmları. planAlerts saf (DB'siz); job senaryoları gerçek PostgreSQL ister.
// İş bütün audit_logs'u tarar: her koşu rastgele uzak bir zamanda çalışır, böylece önceki koşuların ve diğer dosyaların
// kayıtları pencereye girmez (audit append-only, silinemez).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createEvent, newEventId, securityAlertRule, securityAlertRules } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createNotificationsConsumer } from "../src/jobs/notifications/consumer.ts";
import { planAlerts } from "../src/jobs/security-alerts/evaluate.ts";
import { evaluateSecurityAlerts } from "../src/jobs/security-alerts/job.ts";
import { fixtures, migratedClient, testDatabaseUrl } from "./support/db.ts";

const MIN = 60_000;

describe("planAlerts", () => {
  const rules = securityAlertRules;
  test("eşik aşılınca açılır; eşik altı açılmaz; bilinmeyen kural yok sayılır", () => {
    const plan = planAlerts(rules, [
      { rule: "role.change.burst", scopeKey: "a", count: 3 },
      { rule: "role.change.burst", scopeKey: "b", count: 2 },
      { rule: "yok" as never, scopeKey: "*", count: 99 },
    ], []);
    assert.deepEqual(plan, { open: [{ rule: "role.change.burst", scopeKey: "a", count: 3 }], keep: [], resolve: [] });
  });

  test("açık alarm sürer (yeni açılış yok, en yüksek sayı korunur); eşik altına inen ya da kuralı kalkan kapanır", () => {
    const plan = planAlerts(
      rules,
      [
        { rule: "role.change.burst", scopeKey: "a", count: 4 },
        { rule: "sanction.burst", scopeKey: "b", count: 5 },
      ],
      [
        { id: "1", rule: "role.change.burst", scopeKey: "a", peakCount: 6 },
        { id: "2", rule: "sanction.burst", scopeKey: "b", peakCount: 25 },
        { id: "3", rule: "eski.kural", scopeKey: "*", peakCount: 1 },
      ],
    );
    assert.deepEqual(plan, { open: [], keep: [{ id: "1", peakCount: 6 }], resolve: ["2", "3"] });
  });

  test("aynı kural farklı aktörler ayrı alarm; sıra deterministik", () => {
    const plan = planAlerts(rules, [
      { rule: "anonymize.burst", scopeKey: "z", count: 3 },
      { rule: "anonymize.burst", scopeKey: "a", count: 3 },
    ], [{ id: "9", rule: "anonymize.burst", scopeKey: "z", peakCount: 3 }]);
    assert.deepEqual(plan.open.map((h) => h.scopeKey), ["a"]);
    assert.deepEqual(plan.keep, [{ id: "9", peakCount: 3 }]);
  });
});

const url = testDatabaseUrl();

describe("security.alerts (postgres)", { skip: url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let f: ReturnType<typeof fixtures>;
  // Her koşu için ayrı, uzak bir pencere (bkz. dosya başı).
  const T = new Date(Date.UTC(2034, 0, 1) + Math.floor(Math.random() * 500_000) * 60 * MIN);

  before(async () => {
    db = migratedClient(url!);
    f = fixtures(db);
  });
  after(async () => {
    await db?.$disconnect();
  });

  const audit = (actorId: string | null, action: string, operation: string, at: Date, extra: { targetId?: string; before?: object; after?: object } = {}) =>
    db.auditLog.create({
      data: {
        actorId, source: actorId ? "API" : "CLI", action, operation, targetType: "USER", targetId: extra.targetId ?? randomUUID(),
        reason: "Güvenlik alarmı testi", before: extra.before, after: extra.after, requestId: actorId ? `sa-${randomUUID()}` : null, createdAt: at,
      },
    });
  const run = (at: Date) => evaluateSecurityAlerts({ prisma: db, now: () => at });
  const alertsOf = (rule: string, scopeKey: string) => db.securityAlert.findMany({ where: { rule, scopeKey }, orderBy: { openedAt: "asc" } });
  const eventsOf = (alertId: string) => db.domainEvent.findMany({ where: { type: "security.alert.opened", subjectId: alertId } });

  test("aktör eşiği aşınca tek alarm ve tek olay; tekrar çalışınca yeni alarm yok, sayı güncellenir; pencere geçince kapanır", async () => {
    const [actor] = await f.users(1);
    const start = new Date(T.getTime() + 0 * MIN);
    for (let i = 0; i < 3; i++) await audit(actor!, "user.role.assign", "change", new Date(start.getTime() + i * MIN));
    const t1 = new Date(start.getTime() + 3 * MIN);
    const first = await run(t1);
    assert.ok(first.opened >= 1);
    let [alert] = await alertsOf("role.change.burst", actor!);
    assert.deepEqual([alert!.status, alert!.severity, alert!.peakCount, alert!.openedAt.getTime()], ["OPEN", "CRITICAL", 3, t1.getTime()]);
    const events = await eventsOf(alert!.id);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]!.payload, { rule: "role.change.burst", severity: "CRITICAL", count: 3, windowMinutes: 15 });
    assert.equal(events[0]!.actorId, null);

    // Durum sürüyor: dördüncü değişiklik. Yeni alarm/olay yok; en yüksek sayı ve son görülme güncellenir.
    await audit(actor!, "user.role.assign", "grant", new Date(start.getTime() + 4 * MIN));
    const t2 = new Date(start.getTime() + 5 * MIN);
    await run(t2);
    await run(t2);
    const again = await alertsOf("role.change.burst", actor!);
    assert.equal(again.length, 1);
    assert.deepEqual([again[0]!.status, again[0]!.peakCount, again[0]!.lastSeenAt.getTime()], ["OPEN", 4, t2.getTime()]);
    assert.equal((await eventsOf(alert!.id)).length, 1, "bildirim açılış başına bir kez");

    // Kayıtlar pencereden çıkınca (eşik altı) kapanır.
    const t3 = new Date(start.getTime() + 3 * MIN + 15 * MIN);
    await run(t3);
    [alert] = await alertsOf("role.change.burst", actor!);
    assert.deepEqual([alert!.status, alert!.resolvedAt?.getTime()], ["RESOLVED", t3.getTime()]);

    // Yeniden aşılırsa yeni alarm açılır (eski kapalı kalır).
    const restart = new Date(t3.getTime() + MIN);
    for (let i = 0; i < 3; i++) await audit(actor!, "user.role.assign", "change", new Date(restart.getTime() + i * MIN));
    await run(new Date(restart.getTime() + 3 * MIN));
    assert.deepEqual((await alertsOf("role.change.burst", actor!)).map((a) => a.status), ["RESOLVED", "OPEN"]);
  });

  test("hedef sayan kural aynı hedefi bir kez sayar; aktörsüz kayıt aktör kuralına girmez", async () => {
    const [actor] = await f.users(1);
    const start = new Date(T.getTime() + 300 * MIN);
    const same = randomUUID();
    for (let i = 0; i < 3; i++) await audit(actor!, "user.anonymize", "anonymize", new Date(start.getTime() + i * MIN), { targetId: same });
    for (let i = 0; i < 5; i++) await audit(null, "user.role.assign", "change", new Date(start.getTime() + i * MIN));
    const t = new Date(start.getTime() + 6 * MIN);
    await run(t);
    assert.equal((await alertsOf("anonymize.burst", actor!)).length, 0, "3 kayıt ama tek hedef");
    assert.equal(await db.securityAlert.count({ where: { rule: "role.change.burst", openedAt: t } }), 0, "CLI kaydı aktörsüz");
  });

  test("genel kural: SUPER_ADMIN'e dokunan rol kaydı (istek dahil) tek alarm açar; başka rol açmaz", async () => {
    const [actor] = await f.users(1);
    const start = new Date(T.getTime() + 600 * MIN);
    await audit(actor!, "user.role.assign", "grant", start, { before: { role: "USER" }, after: { role: "MODERATOR" } });
    const quiet = new Date(start.getTime() + MIN);
    await run(quiet);
    assert.equal(await db.securityAlert.count({ where: { rule: "superadmin.change", openedAt: quiet } }), 0);

    await audit(actor!, "user.role.assign", "request", new Date(start.getTime() + 2 * MIN), { before: { role: "ADMIN" }, after: { requestedRole: "SUPER_ADMIN", approvalId: randomUUID() } });
    const t = new Date(start.getTime() + 3 * MIN);
    await run(t);
    const [alert] = await db.securityAlert.findMany({ where: { rule: "superadmin.change", openedAt: t } });
    assert.deepEqual([alert?.scopeKey, alert?.severity, alert?.peakCount], ["*", "CRITICAL", 1]);
    // Pencere sonunda kapanır (tek seferlik olay da kendiliğinden kapanır; bildirim zaten gitti).
    await run(new Date(start.getTime() + 2 * MIN + securityAlertRule("superadmin.change").windowMinutes * MIN));
    assert.equal((await db.securityAlert.findUniqueOrThrow({ where: { id: alert!.id } })).status, "RESOLVED");
  });

  test("MFA kilit dalgası farklı hesapları sayar; tür süzgeci deny'i saymaz", async () => {
    const start = new Date(T.getTime() + 900 * MIN);
    const users = await f.users(5);
    for (const [i, u] of users.entries()) {
      await audit(u, "account.mfa", "deny", new Date(start.getTime() + i * MIN), { targetId: u });
      if (i < 4) await audit(u, "account.mfa", "lock", new Date(start.getTime() + i * MIN), { targetId: u });
    }
    const t1 = new Date(start.getTime() + 5 * MIN);
    await run(t1);
    assert.equal(await db.securityAlert.count({ where: { rule: "mfa.lock.wave", openedAt: t1 } }), 0, "4 kilit < 5");
    await audit(users[4]!, "account.mfa", "lock", new Date(start.getTime() + 5 * MIN), { targetId: users[4]! });
    const t2 = new Date(start.getTime() + 6 * MIN);
    await run(t2);
    const [alert] = await db.securityAlert.findMany({ where: { rule: "mfa.lock.wave", openedAt: t2 } });
    assert.deepEqual([alert?.scopeKey, alert?.peakCount, alert?.severity], ["*", 5, "HIGH"]);
  });

  test("bildirim yalnız SUPER_ADMIN'lere gider (ADMIN almaz), tercihle kapatılamaz, tekrar teslimde çoğalmaz", async () => {
    const [root, admin, user] = (await f.users(3)) as [string, string, string];
    const existing = await db.userRole.findFirst({ where: { role: "SUPER_ADMIN" }, select: { userId: true } });
    await db.userRole.create({ data: { userId: root, role: "SUPER_ADMIN", grantedById: existing?.userId ?? admin } });
    await db.userRole.create({ data: { userId: admin, role: "ADMIN", grantedById: root } });
    // Kapatılamaz: tercih satırı DB'de de yazılamaz (notification_type_opt_outs_mandatory_check).
    await assert.rejects(db.notificationTypeOptOut.create({ data: { userId: root, type: "SECURITY_ALERT" } }));
    const alertId = randomUUID();
    const at = new Date(T.getTime() + 1500 * MIN);
    const event = createEvent({
      id: newEventId(at), type: "security.alert.opened", occurredAt: at.toISOString(), actorId: null,
      subject: { type: "SECURITY_ALERT", id: alertId }, payload: { rule: "anonymize.burst", severity: "CRITICAL", count: 3, windowMinutes: 60 },
    });
    const consumer = createNotificationsConsumer();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await db.$transaction((tx) => consumer.handle(event, { tx, attempt, log: () => {} }), { maxWait: 10_000, timeout: 30_000 });
    }
    const rows = await db.notification.findMany({ where: { subjectId: alertId } });
    const recipients = new Set(rows.map((r) => r.recipientId));
    assert.ok(recipients.has(root), "SUPER_ADMIN alır (tercih kapalı olsa da)");
    assert.ok(!recipients.has(admin) && !recipients.has(user), "ADMIN ve kullanıcı almaz");
    assert.equal(rows.filter((r) => r.recipientId === root).length, 1, "tekrar teslimde tek satır");
    const mine = rows.find((r) => r.recipientId === root)!;
    assert.deepEqual([mine.type, mine.subjectType, mine.actorId, mine.data], ["SECURITY_ALERT", "SECURITY_ALERT", null, { rule: "anonymize.burst", severity: "CRITICAL", count: 3 }]);
  });

  test("eşzamanlı iki çalışma aynı alarmı iki kez açmaz (kısmi UNIQUE)", async () => {
    const [actor] = await f.users(1);
    const start = new Date(T.getTime() + 1200 * MIN);
    for (let i = 0; i < 3; i++) await audit(actor!, "audit.export", "export", new Date(start.getTime() + i * MIN), { targetId: "audit_logs" });
    const t = new Date(start.getTime() + 4 * MIN);
    await Promise.allSettled([run(t), run(t)]);
    const alerts = await alertsOf("audit.export.burst", actor!);
    assert.equal(alerts.length, 1);
    assert.equal((await eventsOf(alerts[0]!.id)).length, 1);
  });
});
