// Toplu moderasyon ekranının saf kuralları (#183, KV-37 §bulk): seçim sınırı, etiketler ve sonuç özeti.
// Karar sunucudadır (kapsam, geçiş tablosu, digest); buradakiler yalnız kullanıcıyı yönlendirir.
import type { BulkPreviewView, BulkResultView, UndoPreviewView, UndoResultView } from "./admin-client.ts";

/** Sunucu sınırı (contracts BULK_MAX_ITEMS) ile aynı; aşımı sunucu zaten reddeder. */
export const BULK_MAX = 50;

export type BulkAction = "HIDE" | "REMOVE" | "RESTORE";
export const bulkActionLabels: Record<BulkAction, string> = { HIDE: "Gizle", REMOVE: "Kaldır", RESTORE: "Geri yükle" };

/** Seçimi değiştirir; sınırı aşan ekleme yok sayılır (sessizce değil: `full` döner). */
export function toggleSelection(selected: ReadonlySet<string>, id: string): { next: Set<string>; full: boolean } {
  const next = new Set(selected);
  if (next.delete(id)) return { next, full: false };
  if (next.size >= BULK_MAX) return { next, full: true };
  next.add(id);
  return { next, full: false };
}

export const blockedLabels: Record<string, string> = {
  not_found: "Bulunamadı",
  forbidden: "Kapsam dışı: bu topluluk için yetkin yok",
  invalid_transition: "Bu durumdan bu işleme geçilemez",
  admin_required: "Kaldırılmış içeriği yalnız yönetici geri yükler",
  community_changed: "Önizlemeden sonra başka topluluğa taşındı",
};

export const outcomeLabels = { WILL_CHANGE: "Değişecek", NO_CHANGE: "Zaten bu durumda", BLOCKED: "Uygulanamaz" } as const;

/** Onay düğmesinin açılabilmesi için en az bir kaydın değişmesi gerekir. */
export const canApply = (preview: BulkPreviewView | null): boolean => !!preview && preview.summary.willChange > 0;

export function previewSummary(preview: BulkPreviewView): string {
  const { willChange, noChange, blocked } = preview.summary;
  return `${willChange} kayıt değişecek, ${noChange} zaten bu durumda, ${blocked} uygulanamayacak.`;
}

/** Sonuç özeti: kısmi başarısızlıkta nedenler sayılarıyla yazılır. */
export function resultSummary(result: BulkResultView): string {
  const { applied, unchanged, failed } = result.summary;
  const reasons = new Map<string, number>();
  for (const item of result.items) if (item.result === "FAILED" && item.code) reasons.set(item.code, (reasons.get(item.code) ?? 0) + 1);
  const why = [...reasons].map(([code, n]) => `${n} × ${blockedLabels[code] ?? code}`).join("; ");
  return `${applied} uygulandı, ${unchanged} değişmedi, ${failed} başarısız${why ? ` (${why})` : ""}.`;
}

// ── Güvenli geri alma (#183) ──
export const undoBlockedLabels: Record<string, string> = {
  not_found: "Bulunamadı",
  forbidden: "Kapsam dışı: bu topluluk için yetkin yok",
  admin_required: "Kaldırılmış içeriği yalnız yönetici geri yükler",
  not_reversible: "Bu karar tek işlemle önceki duruma döndürülemez",
  status_changed: "İçeriğin durumu sonradan değişti",
  superseded: "Araya daha yeni bir karar girdi",
  author_erased: "İçerik sahibinin hesabı silinmiş: içerik geri getirilmez",
  community_changed: "İçerik başka topluluğa taşındı",
};
export const undoOutcomeLabels = { WILL_UNDO: "Geri alınacak", BLOCKED: "Geri alınamaz", ALREADY_UNDONE: "Zaten geri alındı" } as const;
export const undoActionLabels: Record<string, string> = { RESTORE: "Geri yükle", HIDE: "Gizle", REMOVE: "Kaldır" };

export const canUndo = (preview: UndoPreviewView | null): boolean => !!preview && preview.summary.willUndo > 0;

export function undoPreviewSummary(preview: UndoPreviewView): string {
  const { willUndo, blocked, alreadyUndone } = preview.summary;
  return `${willUndo} karar geri alınacak, ${blocked} geri alınamayacak, ${alreadyUndone} zaten geri alınmış.`;
}

export function undoResultSummary(result: UndoResultView): string {
  const { applied, unchanged, failed } = result.summary;
  const reasons = new Map<string, number>();
  for (const item of result.items) if (item.result === "FAILED" && item.code) reasons.set(item.code, (reasons.get(item.code) ?? 0) + 1);
  const why = [...reasons].map(([code, n]) => `${n} × ${undoBlockedLabels[code] ?? code}`).join("; ");
  return `${applied} karar geri alındı, ${unchanged} değişmedi, ${failed} geri alınamadı${why ? ` (${why})` : ""}.`;
}
