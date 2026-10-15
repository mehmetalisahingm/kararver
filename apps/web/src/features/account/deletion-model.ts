// Kullanıcının kendi hesabını silmesi (#181, KV-33 §12) web tarafı saf mantığı: bağlantı ayrıştırma, engel/sonuç/hata metinleri.
//
// Token URL fragment'ındadır (#token=…&action=confirm|cancel): sunucu loglarına ve Referer başlığına düşmez. Sayfa onu bellekte
// tutar ve adres çubuğundan temizler; sayfa açılışı hiçbir şey yapmaz, silme AÇIK bir tıklamayla gider.
import type { SelfDeletionPreview } from "@kararver/contracts";
import { UiError } from "../../lib/model.ts";

export type SelfDeletionPreviewView = ReturnType<typeof SelfDeletionPreview.parse>;
export type DeletionLink = { token: string; action: "confirm" | "cancel" };

export function parseDeletionLink(hash: string): DeletionLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token) return null;
  // Bilinmeyen/eksik aksiyon asla silme sayılmaz: güvenli yön iptaldir.
  return { token, action: params.get("action") === "confirm" ? "confirm" : "cancel" };
}

export const SELF_BLOCKER_TEXT: Record<SelfDeletionPreviewView["blockers"][number], string> = {
  legal_hold: "Hesabının üzerinde bir saklama yükümlülüğü var; şu an silinemez. Destek ile iletişime geç.",
  active_sanction: "Hesabında süresi dolmamış bir yaptırım var; yaptırım bitene kadar silinemez.",
  has_role: "Hesabın yönetici veya moderatör rolü taşıyor; silinmeden önce rolün kaldırılmalı. Destek ile iletişime geç.",
  export_in_progress: "Veri paketi talebin sürüyor; paket hazırlanıp teslim edilene veya başarısız olana kadar bekle.",
};

export function describeDeletionLink(link: DeletionLink): { title: string; body: string; button: string; danger: boolean } {
  if (link.action === "confirm") {
    return {
      title: "Hesabını kalıcı olarak sil",
      body: "Bu işlem geri alınamaz. Kişisel bilgilerin silinir, paylaşım ve yorum metinlerin kaldırılır, oyların hesabınla bağı koparılır ve bütün oturumların kapanır. Devam etmek için aşağıdaki düğmeye bas.",
      button: "Hesabımı kalıcı olarak sil",
      danger: true,
    };
  }
  return {
    title: "Silme talebini iptal et",
    body: "Hesabını silme talebini sen yapmadıysan iptal et. Talep iptal edilir ve hesabındaki bütün oturumlar kapatılır; hesabın silinmez.",
    button: "Bu ben değilim, iptal et",
    danger: false,
  };
}

export function deletionResultMessage(kind: "deleted" | "unchanged" | "cancelled"): string {
  if (kind === "deleted") return "Hesabın kalıcı olarak silindi. Kişisel bilgilerin kaldırıldı ve oturumların kapandı. Bu adrese son bir bildirim gönderdik.";
  if (kind === "unchanged") return "Hesabın zaten silinmiş.";
  return "Talep iptal edildi ve hesabındaki bütün oturumlar kapatıldı; hesabın silinmedi. Şifreni değiştirmeni öneririz.";
}

/** Hata metni: hesap ve talep varlığını ele vermez; yeniden denenebilirlik ayrıdır. */
export function deletionError(cause: unknown): { message: string; retryable: boolean } {
  if (cause instanceof UiError) {
    if (cause.code === "TOKEN_INVALID_OR_EXPIRED") {
      return { message: "Bu bağlantı geçersiz veya süresi dolmuş. Gerekiyorsa silme talebini hesap ayarlarından yeniden başlat.", retryable: false };
    }
    if (cause.code === "CONFLICT") return { message: cause.message, retryable: false };
    if (cause.code === "NETWORK_ERROR") return { message: cause.message, retryable: true };
  }
  return { message: "İşlem tamamlanamadı. Biraz sonra tekrar dene.", retryable: true };
}

/** Hesap ayarlarında açık/son talep durumu. */
export function deletionStatusLine(request: NonNullable<SelfDeletionPreviewView["request"]>): string {
  switch (request.status) {
    case "OPEN": return "Silme talebin açık: hesabının e-postasına gönderilen bağlantıyla onaylamadıkça hesabın silinmez.";
    case "COMPLETED": return "Hesabın silindi.";
    case "CANCELLED": return "Son silme talebin iptal edildi.";
    case "EXPIRED": return "Son silme talebinin süresi doldu; hesabın silinmedi.";
    default: return "Son silme talebi tamamlanamadı; hesabın silinmedi.";
  }
}
