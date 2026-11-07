// #185 kritik güvenlik alarmı: değerlendirme kararı (saf fonksiyon). Sayımlar job.ts'te SQL ile alınır; burada yalnız
// "hangi alarm açılır, hangisi güncellenir, hangisi kapanır" kararı verilir. Kurallar: contracts security-alerts.ts.
import type { SecurityAlertRule, SecurityAlertRuleId } from "@kararver/contracts";

/** Bir kuralın bir kapsamdaki sayısı (pencere içinde). scopeKey: aktör UUID'si ya da genel kural için '*'. */
export type AlertHit = { rule: SecurityAlertRuleId; scopeKey: string; count: number };
export type OpenAlert = { id: string; rule: string; scopeKey: string; peakCount: number };

export type AlertPlan = {
  open: AlertHit[];
  /** Eşik hâlâ aşılıyor: last_seen_at = now, peak_count = max(peak, count). */
  keep: { id: string; peakCount: number }[];
  resolve: string[];
};

const key = (rule: string, scopeKey: string) => `${rule}\u0000${scopeKey}`;

/**
 * Eşiği aşan her (kural, kapsam) için açık alarm yoksa açılır, varsa sürdürülür. Eşiği aşmayan açık alarmlar kapanır:
 * sayım kayan pencerede yapıldığı için alarm, son eşleşen kayıt pencereden çıkana kadar açık kalır (ek bekleme yok).
 * Kuralı artık tanımlı olmayan açık alarm da kapanır.
 */
export function planAlerts(rules: readonly SecurityAlertRule[], hits: readonly AlertHit[], open: readonly OpenAlert[]): AlertPlan {
  const threshold = new Map(rules.map((r) => [r.id as string, r.threshold]));
  const breached = new Map<string, AlertHit>();
  for (const h of hits) {
    const t = threshold.get(h.rule);
    if (t !== undefined && h.count >= t) breached.set(key(h.rule, h.scopeKey), h);
  }
  const openByKey = new Map(open.map((a) => [key(a.rule, a.scopeKey), a]));
  const plan: AlertPlan = { open: [], keep: [], resolve: [] };
  for (const [k, hit] of breached) {
    const existing = openByKey.get(k);
    if (existing) plan.keep.push({ id: existing.id, peakCount: Math.max(existing.peakCount, hit.count) });
    else plan.open.push(hit);
  }
  for (const [k, a] of openByKey) if (!breached.has(k)) plan.resolve.push(a.id);
  // Deterministik sıra (log ve testler için).
  plan.open.sort((a, b) => key(a.rule, a.scopeKey).localeCompare(key(b.rule, b.scopeKey)));
  plan.keep.sort((a, b) => a.id.localeCompare(b.id));
  plan.resolve.sort();
  return plan;
}
