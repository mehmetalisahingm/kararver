// Audit ekranı süzgeç yardımcıları (KV-39, #185). Saf fonksiyonlar: ekran ve testler kullanır. Asıl doğrulama
// sunucudadır (admin.audit.list sözleşmesi); buradaki kontrol yalnız gereksiz 400'ü önler ve kullanıcıya yol gösterir.
import { AUDIT_REASON_SEARCH_MAX_DAYS, type AuditOutcomeValue } from "@kararver/contracts";

/**
 * #185 zaman dilimi: gün sınırları ve gösterilen saatler bu dilimlerden birine göre. Varsayılan Europe/Istanbul
 * (DATA_MODEL: İstanbul'a çevirme yalnız gösterimde ve takvim gününde). Tarayıcının kendi saat dilimi kullanılmaz;
 * yöneticinin bilgisayarı başka dilimde olsa da aynı gün aynı aralığı verir. Sunucuya her zaman UTC ISO gider.
 */
export const AUDIT_TIME_ZONES = [
  { id: "Europe/Istanbul", label: "Türkiye (Europe/Istanbul)", short: "TR" },
  { id: "UTC", label: "UTC", short: "UTC" },
] as const;
export type AuditTimeZone = (typeof AUDIT_TIME_ZONES)[number]["id"];
export const DEFAULT_AUDIT_TIME_ZONE: AuditTimeZone = "Europe/Istanbul";

/** `at` anında dilimin UTC'den farkı (ms). Ofset elle yazılmaz; Intl'den okunur (yaz saati dahil). */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
}

/** Gün seçimi (yyyy-mm-dd) → o dilimde gün başının UTC ISO'su; "bitiş" günü dahil olsun diye `plus` = 1 ile ertesi gün başı. */
export const dayStart = (day: string, plus = 0, timeZone: AuditTimeZone = DEFAULT_AUDIT_TIME_ZONE) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d + plus);
  // İkinci tur: ofset gün başında değişiyorsa (yaz saati geçişi) gerçek anın ofsetiyle düzeltir.
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone)).toISOString();
};

/** Kayıt zamanı seçilen dilimde, dilim kısaltmasıyla (ör. "24 Eki 2026 15:00 TR"). */
export function formatAuditTime(iso: string, timeZone: AuditTimeZone = DEFAULT_AUDIT_TIME_ZONE): string {
  const zone = AUDIT_TIME_ZONES.find((z) => z.id === timeZone)!;
  return `${new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone })} ${zone.short}`;
}

/** #185 sonuç süzgecinin etiketleri; değerler sözleşmedeki AuditOutcome ile aynı. */
export const auditOutcomeLabels: Record<AuditOutcomeValue, string> = {
  APPLIED: "Uygulandı",
  DENIED: "Engellendi",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal / süresi doldu",
};

/** "Gerekçede ara" doluysa gün aralığı zorunlu ve en çok 31 gün (bitiş günü dahil). Sorun yoksa null. */
export function reasonSearchProblem(draft: { reasonContains: string; from: string; to: string; timeZone?: AuditTimeZone }): string | null {
  const text = draft.reasonContains.trim();
  if (!text) return null;
  if (text.length < 3) return "Gerekçede aramak için en az 3 karakter yazın.";
  if (!draft.from || !draft.to) return `Gerekçede aramak için başlangıç ve bitiş tarihi seçin (en çok ${AUDIT_REASON_SEARCH_MAX_DAYS} gün).`;
  const span = Date.parse(dayStart(draft.to, 1, draft.timeZone)) - Date.parse(dayStart(draft.from, 0, draft.timeZone));
  if (span <= 0) return "Bitiş tarihi başlangıçtan önce olamaz.";
  if (span > AUDIT_REASON_SEARCH_MAX_DAYS * 86_400_000) return `Gerekçe araması en çok ${AUDIT_REASON_SEARCH_MAX_DAYS} günlük aralıkta yapılır; aralığı daraltın.`;
  return null;
}
