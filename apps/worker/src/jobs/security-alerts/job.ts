// security.alerts — #185 kritik güvenlik alarmları (dilim 1). 5 dakikada bir audit_logs'u kurallara göre sayar
// (contracts security-alerts.ts), kararı planAlerts verir (evaluate.ts). Runbook: docs/KV-49_OPERATIONS.md "Güvenlik alarmları".
//
// Tek transaction: açık alarmlar okunur, sayılar alınır, alarm satırları ve açılış olayı (security.alert.opened → SECURITY_ALERT
// bildirimi, outbox) birlikte yazılır. Kısmi UNIQUE (rule, scope_key) WHERE status = 'OPEN' ve ON CONFLICT DO NOTHING sayesinde
// iki çalışma aynı alarmı iki kez açamaz; olay yalnız satır gerçekten eklendiyse yazılır, yani bildirim açılış başına bir kez gider.
// Sayım (action, operation, created_at) index'inden okunur; pencere en çok 24 saattir. Dilim 2: reddedilen yönetici istekleri
// admin_access_denials'dan (dakikalık sayaç, bucket index'i) sayılır; aynı transaction 30 günden eski sayaçları siler.
import { ADMIN_DENIAL_RETENTION_DAYS, createEvent, newEventId, securityAlertRule, securityAlertRules, type SecurityAlertRule } from "@kararver/contracts";
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeWorkerEvent } from "../events/write.ts";
import { planAlerts, type AlertHit } from "./evaluate.ts";

export const SECURITY_ALERTS_QUEUE = "security.alerts";
export const SECURITY_ALERTS_CRON = "*/5 * * * *";

export type SecurityAlertDeps = {
  prisma: PrismaClient;
  now: () => Date;
  log?: (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;
  /** Testler için; varsayılan contracts securityAlertRules. */
  rules?: readonly SecurityAlertRule[];
};

export type SecurityAlertResult = { opened: number; kept: number; resolved: number; deniedPurged: number };

type Tx = Prisma.TransactionClient;

/** Reddedilen yönetici istekleri (dakikalık sayaç). Pencere dakika kovalarıyla: (now - pencere, now] aralığına düşen kovalar. */
async function countDenials(tx: Tx, rule: SecurityAlertRule & { match: { source: "denials" } }, now: Date): Promise<AlertHit[]> {
  const since = new Date(now.getTime() - rule.windowMinutes * 60_000);
  const global = rule.scope === "GLOBAL";
  const rows = await tx.$queryRaw<{ scope: string; rows: bigint; targets: bigint }[]>`
    SELECT CASE WHEN ${global}::boolean THEN '*' ELSE actor_key END AS scope,
           sum(count) AS rows, count(DISTINCT endpoint) AS targets
      FROM admin_access_denials
     WHERE status = ANY(${[...rule.match.statuses]}::smallint[])
       AND bucket > ${since}::timestamptz AND bucket <= ${now}::timestamptz
       AND (${global}::boolean OR actor_key <> '*')
     GROUP BY 1`;
  return rows.map((r) => ({ rule: rule.id, scopeKey: r.scope, count: Number(rule.count === "rows" ? r.rows : r.targets) }));
}

/** Kuralın penceresindeki (now - pencere, now] kayıtları kapsam başına sayar. Aktörsüz (CLI/worker) kayıt aktör kuralında sayılmaz. */
export async function countRule(tx: Tx, rule: SecurityAlertRule, now: Date): Promise<AlertHit[]> {
  if (rule.match.source === "denials") return countDenials(tx, rule as SecurityAlertRule & { match: { source: "denials" } }, now);
  const match = rule.match;
  const since = new Date(now.getTime() - rule.windowMinutes * 60_000);
  const global = rule.scope === "GLOBAL";
  const operations = match.operations ? [...match.operations] : null;
  const role = match.touchesRole ?? null;
  const rows = await tx.$queryRaw<{ scope: string | null; rows: bigint; targets: bigint }[]>`
    SELECT CASE WHEN ${global}::boolean THEN '*' ELSE actor_id::text END AS scope,
           count(*) AS rows, count(DISTINCT target_type || ':' || target_id) AS targets
      FROM audit_logs
     WHERE action = ANY(${[...match.actions]}::text[])
       AND (${operations}::text[] IS NULL OR operation = ANY(${operations}::text[]))
       AND (${role}::text IS NULL OR before ->> 'role' = ${role}::text OR after ->> 'role' = ${role}::text OR after ->> 'requestedRole' = ${role}::text)
       AND created_at > ${since}::timestamptz AND created_at <= ${now}::timestamptz
     GROUP BY 1`;
  return rows
    .filter((r) => r.scope !== null)
    .map((r) => ({ rule: rule.id, scopeKey: r.scope!, count: Number(rule.count === "rows" ? r.rows : r.targets) }));
}

export async function evaluateSecurityAlerts(deps: SecurityAlertDeps): Promise<SecurityAlertResult> {
  const now = deps.now();
  const rules = deps.rules ?? securityAlertRules;
  const result = await deps.prisma.$transaction(
    async (tx) => {
      const open = await tx.securityAlert.findMany({ where: { status: "OPEN" }, select: { id: true, rule: true, scopeKey: true, peakCount: true } });
      const hits: AlertHit[] = [];
      for (const rule of rules) hits.push(...(await countRule(tx, rule, now)));
      const plan = planAlerts(rules, hits, open);

      let opened = 0;
      for (const hit of plan.open) {
        const rule = securityAlertRule(hit.rule);
        const id = newEventId(now);
        const inserted = await tx.$executeRaw`
          INSERT INTO security_alerts (id, rule, severity, scope_key, status, peak_count, opened_at, last_seen_at)
          VALUES (${id}::uuid, ${rule.id}, ${rule.severity}, ${hit.scopeKey}, 'OPEN', ${hit.count}, ${now}::timestamptz, ${now}::timestamptz)
          ON CONFLICT (rule, scope_key) WHERE status = 'OPEN' DO NOTHING`;
        if (inserted !== 1) continue;
        opened++;
        await writeWorkerEvent(
          tx,
          createEvent({
            id: newEventId(now),
            type: "security.alert.opened",
            occurredAt: now.toISOString(),
            actorId: null,
            subject: { type: "SECURITY_ALERT", id },
            payload: { rule: rule.id, severity: rule.severity, count: hit.count, windowMinutes: rule.windowMinutes },
          }),
        );
      }
      for (const k of plan.keep) {
        await tx.securityAlert.updateMany({ where: { id: k.id, status: "OPEN" }, data: { lastSeenAt: now, peakCount: k.peakCount } });
      }
      const resolved = plan.resolve.length
        ? (await tx.securityAlert.updateMany({ where: { id: { in: plan.resolve }, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: now } })).count
        : 0;
      // Saklama: reddedilen istek sayaçları ADMIN_DENIAL_RETENTION_DAYS gün (kişisel veri minimizasyonu, KV-49).
      const purgeBefore = new Date(now.getTime() - ADMIN_DENIAL_RETENTION_DAYS * 86_400_000);
      const deniedPurged = await tx.$executeRaw`DELETE FROM admin_access_denials WHERE bucket < ${purgeBefore}::timestamptz`;
      return { opened, kept: plan.keep.length, resolved, deniedPurged };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  if (result.opened || result.resolved || result.deniedPurged) deps.log?.(result.opened ? "warn" : "info", "security.alerts", result);
  return result;
}
