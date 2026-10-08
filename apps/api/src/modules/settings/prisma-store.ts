// SettingsStore'un PostgreSQL uygulaması — system_settings (docs/DATA_MODEL.md, KV-40).
import { validateSettings } from "@kararver/contracts";
import { Prisma, type PrismaClient } from "@kararver/db";
import { writeAudit } from "../audit/write.ts";
import type { EmergencyInput, EmergencyOutcome, SettingsStore, StoredSetting, UpdateInput, UpdateOutcome } from "./store.ts";

type Tx = Prisma.TransactionClient;

const editorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarMedia: { select: { status: true, publicObjectKey: true } },
} as const;
const rowSelect = { key: true, value: true, version: true, updatedAt: true, updatedBy: { select: editorSelect } } as const;
type Row = Prisma.SystemSettingGetPayload<{ select: typeof rowSelect }>;

const toStored = (r: Row): StoredSetting => ({
  key: r.key,
  value: r.value,
  version: r.version,
  updatedAt: r.updatedAt,
  updatedBy: r.updatedBy
    ? {
        id: r.updatedBy.id,
        username: r.updatedBy.username,
        displayName: r.updatedBy.displayName,
        avatarPublicKey: r.updatedBy.avatarMedia?.status === "APPROVED" ? r.updatedBy.avatarMedia.publicObjectKey : null,
      }
    : null,
});

/** Bütün ayar yazmaları tek kilitle sıralanır: "min ≤ max" gibi kurallar eşzamanlı iki değişiklikle aşılamaz. */
const LOCK_KEY = "kv40:system_settings";
const lock = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;

/** Etkin değerler: varsayılanlar + satırlar. */
async function effective(tx: Tx, defaults: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const rows = await tx.systemSetting.findMany({ select: { key: true, value: true } });
  return { ...defaults, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createPrismaSettingsStore(prisma: PrismaClient): SettingsStore {
  async function read(tx: Tx, key: string): Promise<StoredSetting | null> {
    const row = await tx.systemSetting.findUnique({ where: { key }, select: rowSelect });
    return row ? toStored(row) : null;
  }

  return {
    async loadStored() {
      return (await prisma.systemSetting.findMany({ select: rowSelect, orderBy: { key: "asc" } })).map(toStored);
    },

    update(input: UpdateInput): Promise<UpdateOutcome> {
      return prisma.$transaction(async (tx) => {
        await lock(tx);
        const current = await read(tx, input.key);
        const currentValue = current ? current.value : input.defaults[input.key];
        const currentVersion = current?.version ?? 1;

        // Aynı değer tekrarı (idempotent): sürüm değişmez, iz bırakmaz.
        if (same(currentValue, input.value)) {
          return {
            kind: "unchanged",
            setting: current ?? { key: input.key, value: currentValue, version: 1, updatedAt: new Date(0), updatedBy: null },
          } satisfies UpdateOutcome;
        }
        if (input.version !== currentVersion) {
          return {
            kind: "conflict",
            current: current ?? { key: input.key, value: currentValue, version: 1, updatedAt: new Date(0), updatedBy: null },
          } satisfies UpdateOutcome;
        }

        // Alanlar arası kurallar bütün etkin değer kümesiyle birlikte denetlenir.
        const merged = { ...(await effective(tx, input.defaults)), [input.key]: input.value };
        const checked = validateSettings(merged);
        if (!checked.ok) return { kind: "invalid", message: checked.message };

        const next = currentVersion + 1;
        const row = await tx.systemSetting.upsert({
          where: { key: input.key },
          create: { key: input.key, value: input.value as Prisma.InputJsonValue, version: next, updatedById: input.actorId, updatedAt: input.now },
          update: { value: input.value as Prisma.InputJsonValue, version: next, updatedById: input.actorId, updatedAt: input.now },
          select: rowSelect,
        });
        await writeAudit(tx, {
          source: "API",
          actorId: input.actorId,
          action: "settings.update",
          operation: "update",
          target: { type: "SETTING", id: input.key },
          reason: input.reason,
          before: { value: currentValue as never, version: currentVersion },
          after: { value: input.value as never, version: next },
          requestId: input.requestId,
          at: input.now,
        });
        return { kind: "updated", setting: toStored(row) } satisfies UpdateOutcome;
      });
    },

    putEmergency(input: EmergencyInput): Promise<EmergencyOutcome> {
      return prisma.$transaction(async (tx) => {
        await lock(tx);
        const before: Record<string, boolean> = {};
        const after: Record<string, boolean> = {};
        let changed = 0;
        const values = await effective(tx, input.defaults);
        for (const [key, want] of Object.entries(input.changes) as [string, boolean][]) {
          const was = values[key] as boolean;
          before[key] = was;
          after[key] = want;
          if (was === want) continue;
          const existing = await tx.systemSetting.findUnique({ where: { key }, select: { version: true } });
          const next = (existing?.version ?? 1) + 1;
          await tx.systemSetting.upsert({
            where: { key },
            create: { key, value: want, version: next, updatedById: input.actorId, updatedAt: input.now },
            update: { value: want, version: next, updatedById: input.actorId, updatedAt: input.now },
          });
          changed++;
        }
        // Değişen yoksa (tekrar istek) iz bırakılmaz.
        if (changed > 0) {
          await writeAudit(tx, {
            source: "API",
            actorId: input.actorId,
            action: "emergency.update",
            operation: "update",
            target: { type: "SETTING", id: "emergency" },
            reason: input.reason,
            before,
            after,
            requestId: input.requestId,
            at: input.now,
          });
        }
        const rows = await tx.systemSetting.findMany({ where: { key: { in: Object.keys(input.changes) } }, select: rowSelect });
        return { kind: "applied", changed, settings: rows.map(toStored) };
      });
    },
  };
}
