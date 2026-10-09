// KV-39 (#41) — audit kaydı sözleşmesi. Tablo: audit_logs (packages/db/prisma/schema/admin.prisma, DATA_MODEL §9.2).
//
// Audit bir olay tüketicisi değildir: kayıt mutation ile aynı transaction'da yazılır (KV-04 §4.4). Yazan taraf
// (API `modules/audit/write.ts`, worker) kaydı yazmadan önce `assertAuditEntry` ile doğrular; kural burada tek yerdedir.
//
// - `action`: KV-04 işlem kataloğundaki ad (`actions`) veya aktörsüz sistem işlemi (`systemAuditActions`).
//   Katalog ve `authorize` audit için değişmez.
// - `operation`: aynı işlemin türü, ayrı sütunda sorgulanır (ör. vote.invalidate → invalidate | restore).
//   Birden çok türü olan işlemde zorunludur; tek türlüde verilmezse varsayılan yazılır.
// - Gerekçe `reasonRequiredActions` için zorunludur. before/after kısa bir özettir; hassas alan içermez.
import type { z } from "zod";
import { Id } from "./common.ts";
import { AuditSource } from "./domains/admin.ts";
import { ModerationAction } from "./domains/moderation.ts";
import { actions, type ActionId } from "./permissions.ts";

/** Polimorfik hedef tipi (`audit_logs.target_type`). `target_id` UUID veya SETTING için ayar anahtarı. */
export const auditTargetTypes = Object.freeze([
  "USER",
  "POLL",
  "COMMENT",
  "MEDIA",
  "COMMUNITY",
  "CATEGORY",
  "REPORT",
  "VOTE",
  "SETTING",
  "ANNOUNCEMENT",
  "FEATURED",
] as const);
export type AuditTargetType = (typeof auditTargetTypes)[number];

/** KV-04 kataloğunda olmayan, aktörsüz (CLI/worker) işlemler. API isteği bunları yazamaz. */
export const systemAuditActions = Object.freeze(["user.status.sync", "community.request.expire"] as const);
export type SystemAuditAction = (typeof systemAuditActions)[number];
export type AuditAction = ActionId | SystemAuditAction;

const moderationOps = ModerationAction.options.map((o) => o.toLowerCase());
const commentOnlyExcluded = (o: string) => o.endsWith("_trends") || o.endsWith("_comments");

/**
 * Audit'li KV-04 işlemleri ve izinli türleri. Audit yazan her katalog işlemi burada açıkça bulunur; listede
 * olmayan katalog işlemi audit'e yazılamaz (`allowedAuditOperations` TypeError). Test: gerekçe zorunlu her işlem ve
 * bütün değiştiren yönetici endpoint'lerinin işlemleri haritada (test/audit.test.ts).
 * Tek türlü işlemde `operation` verilmezse o tür yazılır; birden çok türlüde her zaman açıkça verilir.
 */
export const auditOperations: Readonly<Partial<Record<ActionId, readonly string[]>>> = Object.freeze({
  "user.sanction": ["apply"],
  "user.sanction.lift": ["lift"],
  // admin.roles.put: grant = USER'a rol verme, revoke = rolü kaldırıp USER'a düşürme, change = rolden role geçiş.
  "user.role.assign": ["grant", "revoke", "change"],
  "vote.invalidate": ["invalidate", "restore"],
  "community.moderator.assign": ["assign", "remove"],
  "category.manage": ["create", "update"],
  "featured.manage": ["create", "update", "delete"],
  "announcement.manage": ["create", "update", "delete"],
  "media.review": ["approve", "reject"],
  // KV-38 yasaklı görsel listesi: ekleme gerekçeli, kaldırma (DELETE) gövdesiz.
  "media.ban.manage": ["create", "delete"],
  "report.resolve": ["actioned", "dismissed"],
  "moderation.poll.apply": moderationOps,
  "moderation.comment.apply": moderationOps.filter((o) => !commentOnlyExcluded(o)),
  // KV-37: kategori/topluluk taşıma ve rapor kuyruğundan uyarı.
  "moderation.poll.move": ["move"],
  "moderation.user.warn": ["warn"],
  "community.create": ["create"],
  "community.update": ["update"],
  "community.request.review": ["approve", "reject"],
  "settings.update": ["update"],
  "emergency.update": ["update"],
  "points.adjust": ["adjust"],
  // Okuma erişiminin izi: içerik sürüm geçmişi (V1_USER_FLOW "log erişimi"), karantinadaki görselin önizlemesi (KV-08 §7).
  "revision.read": ["read"],
  "media.queue.read": ["preview"],
});

/** Sistem işlemlerinin tek türü kimliğin son parçasıdır (user.status.sync → sync). */
const systemOperation = (action: SystemAuditAction): string => action.slice(action.lastIndexOf(".") + 1);

/** İşlemin izinli türleri. Bilinmeyen işlemde ve haritada olmayan (audit'li olmayan) katalog işleminde TypeError. */
export function allowedAuditOperations(action: AuditAction): readonly string[] {
  if (!isAuditAction(action)) throw new TypeError(`Audit: bilinmeyen işlem ${String(action)}`);
  if ((systemAuditActions as readonly string[]).includes(action)) return [systemOperation(action as SystemAuditAction)];
  const ops = auditOperations[action as ActionId];
  if (!ops) throw new TypeError(`Audit: ${action} audit'li değil (auditOperations'a eklenmeli)`);
  return ops;
}

/**
 * Gerekçesi zorunlu işlemler: sözleşmede bütün değiştiren endpoint'leri gövdede `reason` (rapor sonuçlandırmada
 * `note`) isteyenler. Test, listeyi endpoint gövdeleriyle karşılaştırır (test/audit.test.ts).
 * Dışarıda kalanlar gerekçesi olmayan endpoint'leri yüzünden: community.create, community.moderator.assign (DELETE),
 * featured.manage ve announcement.manage (DELETE), media.ban.manage (DELETE). Gövdeye gerekçe eklenirse listeye alınır
 * (sözleşme sahipleri: Mert, Mehmet).
 */
export const reasonRequiredActions: ReadonlySet<AuditAction> = new Set<AuditAction>([
  "user.sanction",
  "user.sanction.lift",
  "user.role.assign",
  "settings.update",
  "emergency.update",
  "vote.invalidate",
  "points.adjust",
  "category.manage",
  "moderation.poll.apply",
  "moderation.comment.apply",
  "moderation.poll.move",
  "moderation.user.warn",
  "media.review",
  "report.resolve",
  "community.update",
  "community.request.review",
]);

/** before/after'da bulunamayacak anahtarlar (büyük/küçük harf ve `_` yok sayılır; iç içe nesnelere de bakılır). */
const SENSITIVE_PARTS = ["password", "token", "secret", "email", "cookie"];
const SENSITIVE_EXACT = new Set(["ip", "ipaddress", "useragent", "sessionid"]);
/** Oy seçimi KV-04'te hassastır (events.ts `sensitive`): oy ve seçenek kimlikleri özete yazılmaz, sayılar yazılır. */
const SENSITIVE_SUFFIX = "optionid";

export const AUDIT_SUMMARY_MAX_CHARS = 4096;
const REASON_MIN = 3;
const REASON_MAX = 500;

export type AuditSummary = Record<string, unknown>;

export type AuditEntryInput = {
  source: z.infer<typeof AuditSource>;
  /** API'de işlemi yapan kullanıcı; CLI/worker'da null. */
  actorId: string | null;
  action: AuditAction;
  /** Birden çok türü olan işlemde zorunlu; tek türlüde verilmezse varsayılan. */
  operation?: string;
  target: { type: AuditTargetType; id: string };
  reason?: string | null;
  before?: AuditSummary | null;
  after?: AuditSummary | null;
  /** API'de X-Request-Id (request.id); CLI/worker'da null. */
  requestId?: string | null;
};

export type CheckedAuditEntry = {
  source: z.infer<typeof AuditSource>;
  actorId: string | null;
  action: AuditAction;
  operation: string;
  target: { type: AuditTargetType; id: string };
  reason: string | null;
  before: AuditSummary | null;
  after: AuditSummary | null;
  requestId: string | null;
};

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (Object.hasOwn(actions, value) || (systemAuditActions as readonly string[]).includes(value));
}

function fail(message: string): never {
  throw new TypeError(`Audit: ${message}`);
}

function sensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replaceAll("_", "");
  return SENSITIVE_EXACT.has(k) || k.endsWith(SENSITIVE_SUFFIX) || SENSITIVE_PARTS.some((p) => k.includes(p));
}

function findSensitive(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findSensitive(v, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (sensitiveKey(k)) return `${path}.${k}`;
      const hit = findSensitive(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

function summary(value: AuditSummary | null | undefined, label: "before" | "after"): AuditSummary | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) fail(`${label} bir nesne olmalı`);
  const hit = findSensitive(value, label);
  if (hit) fail(`${hit} hassas alan; özete yazılmaz`);
  const json = JSON.stringify(value);
  if (json === undefined || json.length > AUDIT_SUMMARY_MAX_CHARS) fail(`${label} özeti en fazla ${AUDIT_SUMMARY_MAX_CHARS} karakter`);
  return JSON.parse(json) as AuditSummary;
}

/**
 * Yazmadan önce kaydı doğrular ve normalleştirir (türün varsayılanı, gerekçe trim, özetin JSON kopyası).
 * Kural ihlali programlama hatasıdır: TypeError fırlatır; çağıranın transaction'ı geri alınır.
 */
export function assertAuditEntry(input: AuditEntryInput): CheckedAuditEntry {
  const source = AuditSource.safeParse(input.source);
  if (!source.success) fail(`geçersiz kaynak ${String(input.source)}`);
  if (!isAuditAction(input.action)) fail(`bilinmeyen işlem ${String(input.action)}`);
  const system = (systemAuditActions as readonly string[]).includes(input.action);

  const requestId = input.requestId ?? null;
  if (source.data === "API") {
    if (system) fail(`${input.action} sistem işlemidir; API isteğinden yazılamaz`);
    if (input.actorId === null || !Id.safeParse(input.actorId).success) fail("API kaydında actorId (UUID) zorunlu");
    if (!requestId) fail("API kaydında requestId zorunlu");
  } else if (input.actorId !== null) {
    fail(`${source.data} kaydında actorId null olmalı`);
  }
  if (requestId !== null && (requestId.length === 0 || requestId.length > 128)) fail("requestId 1–128 karakter");

  const allowed = allowedAuditOperations(input.action);
  let operation = input.operation;
  if (operation === undefined) {
    if (allowed.length !== 1) fail(`${input.action} için operation zorunlu (${allowed.join(" | ")})`);
    operation = allowed[0]!;
  } else if (!allowed.includes(operation)) {
    fail(`${input.action} için geçersiz operation ${operation} (${allowed.join(" | ")})`);
  }

  if (!(auditTargetTypes as readonly string[]).includes(input.target?.type)) fail(`geçersiz hedef tipi ${String(input.target?.type)}`);
  if (typeof input.target.id !== "string" || input.target.id.length === 0 || input.target.id.length > 64) {
    fail("hedef id 1–64 karakter");
  }

  const reason = input.reason?.trim() || null;
  if (reason === null) {
    if (reasonRequiredActions.has(input.action)) fail(`${input.action} gerekçe ister`);
  } else if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    fail(`gerekçe ${REASON_MIN}–${REASON_MAX} karakter`);
  }

  return {
    source: source.data,
    actorId: input.actorId,
    action: input.action,
    operation,
    target: { type: input.target.type, id: input.target.id },
    reason,
    before: summary(input.before, "before"),
    after: summary(input.after, "after"),
    requestId,
  };
}
