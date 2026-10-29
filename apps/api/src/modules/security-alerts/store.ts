// #185 kritik güvenlik alarmları (API tarafı). Alarmları worker yazar (apps/worker/src/jobs/security-alerts/); API okur
// (ops paneli), onaylar (admin.securityAlerts.ack) ve yönetici uçlarında reddedilen istekleri sayar (admin_access_denials).
// Kurallar: contracts security-alerts.ts. Runbook: docs/KV-49_OPERATIONS.md "Güvenlik alarmları".
import type { AdminDenialStatus } from "@kararver/contracts";
import type { Prisma, PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";

type UserRef = { id: string; username: string; displayName: string };

export type SecurityAlertRecord = {
  id: string;
  rule: string;
  severity: string;
  status: string;
  actor: UserRef | null;
  peakCount: number;
  openedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: UserRef | null;
};

export type DenialInput = { endpointId: string; status: AdminDenialStatus; actorId: string | null; at: Date };

export type AckResult = { kind: "ok"; alert: SecurityAlertRecord } | { kind: "not_found" } | { kind: "already_acknowledged" };

export interface SecurityAlertStore {
  acknowledge(input: { id: string; actorId: string; reason: string; requestId: string; at: Date }): Promise<AckResult>;
  /** Reddedilen yönetici isteğini sayar. Asla fırlatmaz: kayıt hatası isteğin cevabını değiştirmez (yalnız loglanır). */
  recordDenial(input: DenialInput): Promise<void>;
}

type Row = Omit<SecurityAlertRecord, "actor" | "acknowledgedBy"> & {
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  ackId: string | null;
  ackUsername: string | null;
  ackDisplayName: string | null;
};

const user = (id: string | null, username: string | null, displayName: string | null): UserRef | null =>
  id && username && displayName ? { id, username, displayName } : null;

/**
 * Alarm görünümü. `id` verilirse yalnız o alarm; yoksa açıklar ve son 24 saatte kapananlar, en yeni önce.
 * scope_key aktör kapsamlı kuralda kullanıcı UUID'si, genel kuralda '*'. Silinmiş hesap da gösterilir (audit gibi).
 */
export async function readSecurityAlerts(db: Pick<PrismaClient, "$queryRaw">, opts: { id?: string; limit: number }): Promise<SecurityAlertRecord[]> {
  const id = opts.id ?? null;
  const rows = await db.$queryRaw<Row[]>`
    SELECT a.id::text AS id, a.rule, a.severity, a.status, a.peak_count AS "peakCount", a.opened_at AS "openedAt",
           a.last_seen_at AS "lastSeenAt", a.resolved_at AS "resolvedAt", a.acknowledged_at AS "acknowledgedAt",
           u.id::text AS "actorId", u.username AS "actorUsername", u.display_name AS "actorDisplayName",
           k.id::text AS "ackId", k.username AS "ackUsername", k.display_name AS "ackDisplayName"
      FROM security_alerts a
      LEFT JOIN users u ON a.scope_key <> '*' AND u.id::text = a.scope_key
      LEFT JOIN users k ON k.id = a.acknowledged_by_id
     WHERE CASE WHEN ${id}::uuid IS NULL THEN (a.status = 'OPEN' OR a.resolved_at > now() - interval '24 hours') ELSE a.id = ${id}::uuid END
     ORDER BY a.opened_at DESC, a.id DESC
     LIMIT ${opts.limit}`;
  return rows.map(({ actorId, actorUsername, actorDisplayName, ackId, ackUsername, ackDisplayName, ...r }) => ({
    ...r,
    actor: user(actorId, actorUsername, actorDisplayName),
    acknowledgedBy: user(ackId, ackUsername, ackDisplayName),
  }));
}

const minute = (at: Date) => new Date(Math.floor(at.getTime() / 60_000) * 60_000);

export function createPrismaSecurityAlertStore(
  prisma: PrismaClient,
  log: (message: string, fields: Record<string, unknown>) => void = () => {},
): SecurityAlertStore {
  return {
    async acknowledge(input) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const [row] = await tx.$queryRaw<{ rule: string; status: string; acknowledgedAt: Date | null }[]>`
          SELECT rule, status, acknowledged_at AS "acknowledgedAt" FROM security_alerts WHERE id = ${input.id}::uuid FOR UPDATE`;
        if (!row) return { kind: "not_found" as const };
        if (row.acknowledgedAt) return { kind: "already_acknowledged" as const };
        await tx.securityAlert.update({ where: { id: input.id }, data: { acknowledgedAt: input.at, acknowledgedById: input.actorId } });
        await writeAudit(tx, {
          source: "API",
          actorId: input.actorId,
          action: "security.alert.ack",
          operation: "ack",
          target: { type: "SECURITY_ALERT", id: input.id },
          reason: input.reason,
          before: { acknowledged: false },
          after: { acknowledged: true, rule: row.rule, status: row.status },
          requestId: input.requestId,
          at: input.at,
        });
        const [alert] = await readSecurityAlerts(tx, { id: input.id, limit: 1 });
        return { kind: "ok" as const, alert: alert! };
      });
    },

    async recordDenial(input) {
      // Aynı dakika + uç + durum + hesap tek satır: istek seli tabloyu büyütmez. 401'de hesap bilinmez ('*').
      const actorKey = input.status === 403 && input.actorId ? input.actorId : "*";
      try {
        await prisma.$executeRaw`
          INSERT INTO admin_access_denials (bucket, endpoint, status, actor_key, count)
          VALUES (${minute(input.at)}::timestamptz, ${input.endpointId}, ${input.status}::smallint, ${actorKey}, 1)
          ON CONFLICT (bucket, endpoint, status, actor_key) DO UPDATE SET count = admin_access_denials.count + 1`;
      } catch (err) {
        log("admin erişim reddi sayılamadı", { endpoint: input.endpointId, status: input.status, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
