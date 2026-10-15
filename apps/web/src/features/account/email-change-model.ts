// E-posta değişimi (#181) web tarafı saf mantığı: bağlantı parametreleri, durum metinleri ve hata metinleri.
//
// Token URL fragment'ındadır (#token=…&step=new|old&action=approve|deny): sunucu loglarına ve Referer başlığına düşmez.
// Sayfa onu bellekte tutar ve adres çubuğundan temizler; sayfa açılışı hiçbir işlem yapmaz, onay açık bir tıklamayla gider.
import { UiError } from "../../lib/model.ts";

export type EmailChangeLink = { token: string; step: "new" | "old" | null; action: "approve" | "deny" | null };

export function parseLink(hash: string): EmailChangeLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token) return null;
  const step = params.get("step");
  const action = params.get("action");
  return {
    token,
    step: step === "new" || step === "old" ? step : null,
    action: action === "approve" || action === "deny" ? action : null,
  };
}

/** Bağlantının ne yapacağını anlatan başlık ve düğme: yeni adres doğrulama, eski adres onayı veya reddet. */
export function describeLink(link: EmailChangeLink): { title: string; body: string; button: string; deny: boolean } {
  if (link.action === "deny") {
    return {
      title: "E-posta değişikliğini reddet",
      body: "Hesabının e-posta adresini değiştirme talebini sen yapmadıysan reddet. Talep iptal edilir ve hesabındaki bütün oturumlar kapatılır.",
      button: "Bu ben değilim, reddet",
      deny: true,
    };
  }
  if (link.step === "old") {
    return {
      title: "E-posta değişikliğini onayla",
      body: "Hesabının e-posta adresini değiştirme talebini sen yaptıysan onayla. Değişiklik, yeni adresin de doğrulanmasından sonra uygulanır.",
      button: "Değişikliği onayla",
      deny: false,
    };
  }
  return {
    title: "Yeni e-posta adresini doğrula",
    body: "Bu adres bir KararVer hesabının yeni e-posta adresi olarak girildi. Doğrularsan değişiklik gereken diğer onaylar tamamlanınca uygulanır.",
    button: "Adresi doğrula",
    deny: false,
  };
}

export function resultMessage(kind: "waiting" | "applied" | "denied", step: "new" | "old" | null): string {
  if (kind === "applied") return "E-posta adresin değiştirildi. Güvenliğin için bütün oturumlar kapatıldı; yeni adresinle yeniden giriş yap.";
  if (kind === "denied") return "Talep reddedildi ve iptal edildi. Hesabındaki bütün oturumlar kapatıldı; şifreni değiştirmeni öneririz.";
  return step === "old"
    ? "Onayın alındı. Değişiklik, yeni adres de doğrulanınca uygulanır."
    : "Adres doğrulandı. Değişiklik, gereken diğer onay da verilince uygulanır.";
}

/** Hata metni: hesap ve talep varlığını ele vermez; yeniden denenebilirlik ayrıdır. */
export function emailChangeError(cause: unknown): { message: string; retryable: boolean } {
  if (cause instanceof UiError) {
    if (cause.code === "TOKEN_INVALID_OR_EXPIRED") {
      return { message: "Bu bağlantı geçersiz veya süresi dolmuş. Gerekiyorsa e-posta değişimini hesap ayarlarından yeniden başlat.", retryable: false };
    }
    if (cause.code === "CONFLICT") return { message: cause.message, retryable: false };
    if (cause.code === "NETWORK_ERROR") return { message: cause.message, retryable: true };
  }
  return { message: "İşlem tamamlanamadı. Biraz sonra tekrar dene.", retryable: true };
}

/** Hesap ayarlarındaki talep durumu satırı. */
export function statusLine(view: { status: string; newEmailMasked: string | null; requiresOld: boolean; newConfirmed: boolean; oldConfirmed: boolean }): string {
  switch (view.status) {
    case "OPEN": {
      const waiting = [
        view.newConfirmed ? null : "yeni adresin doğrulanması",
        view.requiresOld && !view.oldConfirmed ? "eski adresin onayı" : null,
      ].filter(Boolean);
      return `${view.newEmailMasked ?? "Yeni adres"} için değişiklik bekliyor: ${waiting.join(" ve ") || "uygulanıyor"}.`;
    }
    case "COMPLETED": return "Son e-posta değişimi tamamlandı.";
    case "DENIED": return "Son e-posta değişimi talebi reddedildi.";
    case "EXPIRED": return "Son e-posta değişimi talebinin süresi doldu.";
    case "CANCELLED": return "Son e-posta değişimi talebi iptal edildi.";
    default: return "Son e-posta değişimi talebi tamamlanamadı.";
  }
}
