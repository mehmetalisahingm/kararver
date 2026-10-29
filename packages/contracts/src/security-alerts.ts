// #185 kritik güvenlik alarmları (dilim 1): kurallar. Değerlendirici worker'dadır (apps/worker/src/jobs/security-alerts/).
//
// Kaynak audit_logs'tur (dilim 2'den itibaren ayrıca admin_access_denials: yönetici uçlarındaki 401/403'ler, dakikalık
// sayaç; IP/cihaz yok, ADMIN_DENIAL_RETENTION_DAYS gün saklanır). Her kural bir pencerede (son `windowMinutes` dakika) eşleşen kayıtları sayar ve sayı eşiği
// geçerse alarm açılır. Aynı kural ve kapsam (aktör ya da genel) için en fazla bir açık alarm vardır; durum sürerse
// alarmın son görülme zamanı ve en yüksek sayısı güncellenir, yeni bildirim gitmez. Sayı eşiğin altına inince alarm
// kendiliğinden kapanır. Bildirim yalnız açılışta, SUPER_ADMIN'lere uygulama içi gider (security.alert.opened).
//
// Eşikler ürün kararıdır (Mehmet); değişiklik bu dosyada yapılır ve docs/KV-49_OPERATIONS.md "Güvenlik alarmları"
// tablosu güncellenir. Kurallar kişisel veri taşımaz: alarmda yalnız kural, kapsam (aktör kimliği) ve sayı vardır.
import { z } from "zod";
import { auditOperations, systemAuditActions, type AuditAction } from "./audit.ts";

export const SecurityAlertSeverity = z.enum(["HIGH", "CRITICAL"]);
export type SecurityAlertSeverity = z.infer<typeof SecurityAlertSeverity>;
export const SecurityAlertStatus = z.enum(["OPEN", "RESOLVED"]);

export const SecurityAlertRuleId = z.enum([
  "superadmin.change",
  "role.change.burst",
  "sanction.burst",
  "anonymize.burst",
  "account.takeover.burst",
  "audit.export.burst",
  "emergency.update",
  "mfa.lock.wave",
  // #185 dilim 2: reddedilen yönetici istekleri (admin_access_denials).
  "admin.forbidden.burst",
  "admin.unauthenticated.wave",
]);
export type SecurityAlertRuleId = z.infer<typeof SecurityAlertRuleId>;

/** Audit kayıtları (gerçekleşen işlemler). */
export type AuditMatch = {
  source?: "audit";
  actions: readonly AuditAction[];
  /** Verilmezse işlemin bütün türleri. */
  operations?: readonly string[];
  /** Önce/sonra özetinde bu rol geçen kayıtlar (`before.role`, `after.role`, `after.requestedRole`). */
  touchesRole?: "SUPER_ADMIN";
};
/** Reddedilen yönetici istekleri (`admin.*` uçlarında 401/403). rows = istek sayısı, targets = farklı uç sayısı. */
export type DenialMatch = { source: "denials"; statuses: readonly AdminDenialStatus[] };

export const AdminDenialStatus = z.union([z.literal(401), z.literal(403)]);
export type AdminDenialStatus = z.infer<typeof AdminDenialStatus>;
/** admin_access_denials saklama süresi (gün); worker security.alerts eskiyi siler. */
export const ADMIN_DENIAL_RETENTION_DAYS = 30;

export type SecurityAlertRule = {
  id: SecurityAlertRuleId;
  severity: SecurityAlertSeverity;
  /** Ekranda ve bildirimde gösterilen kısa ad. */
  label: string;
  match: AuditMatch | DenialMatch;
  /** ACTOR: aktör başına ayrı sayılır (ele geçirilmiş yönetici). GLOBAL: herkes birlikte (ör. kaba kuvvet dalgası). */
  scope: "ACTOR" | "GLOBAL";
  /** rows: eşleşen kayıt sayısı · targets: farklı hedef sayısı. */
  count: "rows" | "targets";
  threshold: number;
  windowMinutes: number;
  /** docs/KV-49_OPERATIONS.md "Güvenlik alarmları" bölümündeki ilk adım. */
  firstStep: string;
};

const rule = (r: SecurityAlertRule): SecurityAlertRule => Object.freeze(r);

export const securityAlertRules: readonly SecurityAlertRule[] = Object.freeze([
  rule({
    id: "superadmin.change",
    severity: "CRITICAL",
    label: "SUPER_ADMIN rolü değişti veya istendi",
    match: { actions: ["user.role.assign"], touchesRole: "SUPER_ADMIN" },
    scope: "GLOBAL",
    count: "rows",
    threshold: 1,
    windowMinutes: 15,
    firstStep: "Değişikliği yapanı ve hedefi audit'te bul; beklenmiyorsa Mehmet'e haber ver, aktörün oturumlarını kapat.",
  }),
  rule({
    id: "role.change.burst",
    severity: "CRITICAL",
    label: "Kısa sürede çok rol değişikliği",
    match: { actions: ["user.role.assign"] },
    scope: "ACTOR",
    count: "rows",
    threshold: 3,
    windowMinutes: 15,
    firstStep: "Aktörün son işlemlerini audit'te süz; ele geçirilmiş olabilir, oturumlarını kapatıp rolleri geri al.",
  }),
  rule({
    id: "sanction.burst",
    severity: "HIGH",
    label: "Kısa sürede çok yaptırım",
    match: { actions: ["user.sanction"] },
    scope: "ACTOR",
    count: "targets",
    threshold: 20,
    windowMinutes: 15,
    firstStep: "Yaptırımların gerekçelerini audit'te oku; toplu spam temizliği değilse aktörü durdur ve yaptırımları kaldır.",
  }),
  rule({
    id: "anonymize.burst",
    severity: "CRITICAL",
    label: "Art arda hesap anonimleştirme (geri alınamaz)",
    match: { actions: ["user.anonymize"] },
    scope: "ACTOR",
    count: "targets",
    threshold: 3,
    windowMinutes: 60,
    firstStep: "Geri alınamaz. Aktörü hemen durdur (oturum kapat, rol al), etkilenen hesapları ve yedeği (KV-48) belirle.",
  }),
  rule({
    id: "account.takeover.burst",
    severity: "HIGH",
    label: "Kısa sürede çok oturum kapatma, parola sıfırlama veya e-posta değişimi",
    match: { actions: ["user.sessions.manage", "user.password.reset", "user.emailChange.manage"] },
    scope: "ACTOR",
    count: "targets",
    threshold: 10,
    windowMinutes: 15,
    firstStep: "Hedef hesapları audit'te listele; destek talebi yoksa aktörü durdur, e-posta değişimlerini iptal et.",
  }),
  rule({
    id: "audit.export.burst",
    severity: "HIGH",
    label: "Kısa sürede çok audit export'u",
    match: { actions: ["audit.export"] },
    scope: "ACTOR",
    count: "rows",
    threshold: 3,
    windowMinutes: 60,
    firstStep: "Export gerekçelerini ve aralıklarını audit'te oku; beklenmiyorsa aktörün oturumlarını kapat.",
  }),
  rule({
    id: "emergency.update",
    severity: "HIGH",
    label: "Acil durum anahtarı değişti",
    match: { actions: ["emergency.update"] },
    scope: "GLOBAL",
    count: "rows",
    threshold: 1,
    windowMinutes: 15,
    firstStep: "Ops panelinde anahtarın yeni değerine ve audit'teki gerekçeye bak; olay kaydıyla eşleşmiyorsa geri al.",
  }),
  rule({
    id: "mfa.lock.wave",
    severity: "HIGH",
    label: "Çok hesapta MFA kilitlenmesi",
    match: { actions: ["account.mfa"], operations: ["lock"] },
    scope: "GLOBAL",
    count: "targets",
    threshold: 5,
    windowMinutes: 15,
    firstStep: "Kaba kuvvet dalgası olabilir: ops panelinde kilitli girişlere ve hız sınırlarına bak, IP engelini değerlendir.",
  }),
  rule({
    id: "admin.forbidden.burst",
    severity: "HIGH",
    label: "Bir hesap yetkisi olmayan yönetici uçlarını deniyor",
    match: { source: "denials", statuses: [403] },
    scope: "ACTOR",
    count: "rows",
    threshold: 10,
    windowMinutes: 15,
    firstStep: "Hesabın rolünü ve son oturumlarını kontrol et; yetki yükseltme denemesiyse oturumlarını kapat ve hesabı askıya al.",
  }),
  rule({
    id: "admin.unauthenticated.wave",
    severity: "HIGH",
    label: "Oturumsuz yönetici isteği dalgası",
    match: { source: "denials", statuses: [401] },
    scope: "GLOBAL",
    count: "rows",
    threshold: 100,
    windowMinutes: 15,
    firstStep: "Tarama olabilir: ops panelinde hız sınırı reddine ve 5xx'e bak; sürerse yönetici yolunu kenar katmanda (Vercel/Railway) sınırla.",
  }),
]);

export const securityAlertRule = (id: SecurityAlertRuleId): SecurityAlertRule => {
  const found = securityAlertRules.find((r) => r.id === id);
  if (!found) throw new TypeError(`Güvenlik alarmı: bilinmeyen kural ${id}`);
  return found;
};

/** Kuralların audit kataloğuyla tutarlılığı (test): bilinen işlem ve tür, pozitif eşik ve pencere. */
export function securityAlertRuleProblems(r: SecurityAlertRule): string[] {
  const problems: string[] = [];
  if (r.match.source === "denials") {
    if (r.match.statuses.length === 0) problems.push("en az bir durum kodu");
    if (r.count !== "rows" && r.count !== "targets") problems.push("sayım rows ya da targets");
  }
  for (const action of r.match.source === "denials" ? [] : r.match.actions) {
    const ops = (systemAuditActions as readonly string[]).includes(action) ? [action.slice(action.lastIndexOf(".") + 1)] : auditOperations[action as keyof typeof auditOperations];
    if (!ops) {
      problems.push(`${action} audit'li değil`);
      continue;
    }
    for (const op of (r.match as AuditMatch).operations ?? []) if (!ops.includes(op)) problems.push(`${action}/${op} izinli tür değil`);
  }
  if (!Number.isInteger(r.threshold) || r.threshold < 1) problems.push("eşik pozitif tam sayı olmalı");
  if (!Number.isInteger(r.windowMinutes) || r.windowMinutes < 5 || r.windowMinutes > 24 * 60) problems.push("pencere 5 dk – 24 sa");
  return problems;
}
