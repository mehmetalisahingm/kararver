// Topluluk yönetim görünümü metinleri (#184): eşik durumu ve kapatma etkisi. Saf fonksiyonlar (test: test/community-model.test.ts).
import type { CommunityOverviewView, CommunityThresholdView } from "./admin-client.ts";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

export const THRESHOLD_BADGE: Record<CommunityThresholdView["state"], string> = {
  NOT_APPLICABLE: "Eşik yok",
  IN_PROGRESS: "Eşik sürüyor",
  REACHED: "Eşik doldu",
  OVERDUE: "Kapanış bekliyor",
  AUTO_CLOSED: "Otomatik kapandı",
  REOPENED: "Yeniden açıldı",
};

/** 7 gün / 10 üye eşiğinin durumu, yöneticinin okuyacağı biçimde (#172 kuralı; uygulayan günlük worker). */
export function thresholdText(t: CommunityThresholdView): string {
  const ratio = `${t.members}/${t.requiredMembers} üye`;
  switch (t.state) {
    case "NOT_APPLICABLE":
      return "Yönetici tarafından açıldı; 7 gün / 10 üye eşiği uygulanmaz.";
    case "IN_PROGRESS":
      return `${ratio} · ${t.daysLeft} gün kaldı (son tarih ${date(t.approvalDeadline)}). Süre bitince ${t.requiredMembers}'dan az üye varsa topluluk otomatik kapanır.`;
    case "REACHED":
      return `Eşik doldu: ${ratio}. Süre bitti (${date(t.approvalDeadline)}); topluluk açık kalır.`;
    case "OVERDUE":
      return `Süre doldu (${date(t.approvalDeadline)}) ve ${ratio}: topluluk günlük kapanış işleminde (her gün 03:10 UTC) otomatik kapatılır. Topluluk elle kapatılmışsa otomatik işlem yapılmaz.`;
    case "AUTO_CLOSED":
      return `7 gün / ${t.requiredMembers} üye eşiği nedeniyle ${date(t.closedAt)} tarihinde otomatik kapatıldı (${ratio}). Yeniden açılabilir.`;
    case "REOPENED":
      return `Otomatik kapanıştan (${date(t.closedAt)}) sonra yönetici yeniden açtı; başvuru kapalı olduğundan tekrar otomatik kapanmaz.`;
  }
}

/** Kapatma/açma kararından önce etkiyi gösteren cümle (mevcut KV-32 davranışı: üyelik, anket ve moderatörler silinmez). */
export function statusImpactText(overview: Pick<CommunityOverviewView, "status" | "impact">): string {
  const { impact } = overview;
  const counts = `${impact.members} üye (${impact.moderators} moderatör), ${impact.polls} anket (${impact.openPolls} açık), ${impact.comments} yorum ve ${impact.openReports} açık rapor`;
  return overview.status === "ACTIVE"
    ? `Kapatılırsa topluluk listeden, sayfadan ve katılımdan kalkar; yeni anket açılamaz. Etkilenen: ${counts}. Hiçbiri silinmez; yeniden açılınca olduğu gibi geri gelir.`
    : `Yeniden açılırsa topluluk listeye, sayfaya ve katılıma döner. Geri gelen: ${counts}.`;
}

/** Sahip satırı: sahipsiz topluluk V1'deki gibi yönetici yönetimindedir. */
export const ownerText = (owner: { displayName: string; username: string } | null) =>
  owner ? `Sahip: ${owner.displayName} (@${owner.username})` : "Sahip yok: topluluk yönetici yönetiminde.";

export const OPERATION_LABEL: Record<string, string> = {
  update: "Güncelleme",
  create: "Açılış",
  assign: "Moderatör / sahip atama",
  remove: "Moderatör kaldırma",
  approve: "Başvuru onayı",
  reject: "Başvuru reddi",
  expire: "Otomatik kapanış",
  release: "Sahipliği bırakma",
  auto_release: "Sahipliğin otomatik kalkması (yasak)",
};
