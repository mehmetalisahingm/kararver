// Audit ekranı süzgeç yardımcıları (KV-39, #185). Saf fonksiyonlar: ekran ve testler kullanır. Asıl doğrulama
// sunucudadır (admin.audit.list sözleşmesi); buradaki kontrol yalnız gereksiz 400'ü önler ve kullanıcıya yol gösterir.
import { AUDIT_REASON_SEARCH_MAX_DAYS } from "@kararver/contracts";

/** Gün seçimi (yyyy-mm-dd) → yerel gün başı ISO; "bitiş" günü dahil olsun diye ertesi gün başı. */
export const dayStart = (day: string, plus = 0) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + plus);
  return d.toISOString();
};

/** "Gerekçede ara" doluysa gün aralığı zorunlu ve en çok 31 gün (bitiş günü dahil). Sorun yoksa null. */
export function reasonSearchProblem(draft: { reasonContains: string; from: string; to: string }): string | null {
  const text = draft.reasonContains.trim();
  if (!text) return null;
  if (text.length < 3) return "Gerekçede aramak için en az 3 karakter yazın.";
  if (!draft.from || !draft.to) return `Gerekçede aramak için başlangıç ve bitiş tarihi seçin (en çok ${AUDIT_REASON_SEARCH_MAX_DAYS} gün).`;
  const span = Date.parse(dayStart(draft.to, 1)) - Date.parse(dayStart(draft.from));
  if (span <= 0) return "Bitiş tarihi başlangıçtan önce olamaz.";
  if (span > AUDIT_REASON_SEARCH_MAX_DAYS * 86_400_000) return `Gerekçe araması en çok ${AUDIT_REASON_SEARCH_MAX_DAYS} günlük aralıkta yapılır; aralığı daraltın.`;
  return null;
}
