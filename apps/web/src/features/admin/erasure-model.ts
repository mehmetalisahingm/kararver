// Hesap anonimleştirme ekranının saf mantığı (#181, KV-33 §10): engel metinleri, etki özeti ve yazılı teyit kontrolü.
// Karar sunucudadır; burası yalnız yönetici dostu metin ve yanlış düğme basışını erken yakalayan istemci kontrolüdür.
import type { ErasurePreviewView } from "./admin-client.ts";

export const BLOCKER_TEXT: Record<ErasurePreviewView["blockers"][number], string> = {
  legal_hold: "Yasal saklama var: kaldırılana kadar anonimleştirilemez.",
  active_sanction: "Süresi dolmamış yaptırım var (ban, askı veya kısıtlama): yaptırım kalkana veya dolana kadar anonimleştirilemez.",
  has_role: "Hesabın yönetici/moderatör rolü var: önce rolü kaldır.",
  export_in_progress: "Veri paketi talebi sürüyor: paket hazırlanıp teslim edilene veya başarısız olana kadar bekle (erişim hakkı önce karşılanır).",
};

/** Silinecek/boşaltılacak kayıtların okunur özeti; sıfır olanlar yazılmaz. */
export function removalLines(will: ErasurePreviewView["willRemove"]): string[] {
  const lines: Array<[number, string]> = [
    [will.sessions, "açık oturum"],
    [will.dataExports, "hazır veri paketi"],
    [will.avatar, "profil görseli"],
    [will.communityMemberships, "topluluk üyeliği"],
    [will.ownedCommunities, "sahip olunan topluluk (yönetici yönetimine döner)"],
    [will.pendingCommunityRequests, "bekleyen topluluk başvurusu (reddedilir)"],
    [will.preferences, "tercih, takip, kayıt ve ilgi alanı kaydı"],
  ];
  return lines.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
}

/** Korunan içerik özeti: yazar adı anonim görünür. */
export function retainedLine(keep: ErasurePreviewView["willRetain"]): string {
  return `${keep.polls} anket, ${keep.comments} yorum, ${keep.votes} oy ve ${keep.reportsFiled} rapor kimliksiz olarak kalır.`;
}

/** Yazılı teyit: sunucudaki kuralla aynı (büyük/küçük harf ve baştaki @ önemsiz). Boş teyit asla geçmez. */
export function confirmationMatches(typed: string, username: string): boolean {
  const clean = typed.trim().replace(/^@/, "").toLowerCase();
  return clean.length > 0 && clean === username.toLowerCase();
}
