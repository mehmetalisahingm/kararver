// E-posta değişimi bildirimleri — #181. Bağlantılardaki token URL fragment'ındadır: sunucu loglarına ve Referer başlığına düşmez.
// Metinlerde parola, ham token dışında gizli veri yoktur; başka adres yalnız maskeli yazılır.
import type { Mail } from "../../mail/mailer.ts";

const link = (webUrl: string, raw: string, extra: string) => `${webUrl}/hesap/eposta-degisimi#token=${raw}&${extra}`;

/** Yeni adrese: sahipliği kanıtlayan doğrulama bağlantısı. */
export function newAddressMail(webUrl: string, to: string, raw: string): Mail {
  return {
    to,
    subject: "KararVer — yeni e-posta adresini doğrula",
    text: `Merhaba,\n\nBu adres bir KararVer hesabının yeni e-posta adresi olarak girildi. Doğrulamak için bağlantıyı aç (24 saat geçerli):\n${link(webUrl, raw, "step=new")}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; doğrulamazsan hiçbir şey değişmez.`,
  };
}

/** Eski adrese: kullanıcı başlatmasında onay + reddet; destek başlatmasında yalnız bilgi + reddet. */
export function oldAddressMail(webUrl: string, to: string, raw: string, maskedNew: string, origin: "USER" | "ADMIN"): Mail {
  const deny = link(webUrl, raw, "step=old&action=deny");
  if (origin === "ADMIN") {
    return {
      to,
      subject: "KararVer — hesabının e-posta adresi değiştirilmek isteniyor",
      text: `Merhaba,\n\nKararVer destek ekibi, hesabının e-posta adresini ${maskedNew} olarak değiştirmek için bir talep başlattı. Yeni adres doğrulanırsa değişiklik uygulanır.\n\nBu talebi sen istemediysen hemen reddet; hesabındaki bütün oturumlar kapatılır:\n${deny}`,
    };
  }
  return {
    to,
    subject: "KararVer — e-posta değişikliğini onayla",
    text: `Merhaba,\n\nHesabının e-posta adresini ${maskedNew} olarak değiştirme talebi alındı. Değişiklik için hem yeni adresin doğrulanması hem senin bu adresten onayın gerekir.\n\nOnayla (24 saat geçerli):\n${link(webUrl, raw, "step=old&action=approve")}\n\nBu talebi sen yapmadıysan reddet; hesabındaki bütün oturumlar kapatılır ve şifreni değiştirmeni öneririz:\n${deny}`,
  };
}

/** Yeni adres başka hesapta: sahibine bilgi (talep açılmaz, dışarıya fark sızmaz). */
export function takenAddressMail(webUrl: string, to: string): Mail {
  return {
    to,
    subject: "KararVer — bu e-posta adresi zaten bir hesapta kayıtlı",
    text: `Merhaba,\n\nBaşka bir KararVer hesabı, e-posta adresini bu adrese değiştirmeyi denedi. Bu adres zaten senin hesabında kayıtlı olduğu için hiçbir şey değişmedi.\nŞifreni hatırlamıyorsan: ${webUrl}/sifremi-unuttum\n\nBu isteği sen yapmadıysan bir işlem yapmana gerek yok.`,
  };
}

export function appliedOldMail(webUrl: string, to: string, maskedNew: string): Mail {
  return {
    to,
    subject: "KararVer — e-posta adresin değiştirildi",
    text: `Merhaba,\n\nKararVer hesabının e-posta adresi ${maskedNew} olarak değiştirildi. Güvenliğin için hesabındaki bütün oturumlar kapatıldı.\n\nBunu sen yapmadıysan hemen destek ile iletişime geç: ${webUrl}/destek`,
  };
}

export function appliedNewMail(webUrl: string, to: string): Mail {
  return {
    to,
    subject: "KararVer — e-posta adresin güncellendi",
    text: `Merhaba,\n\nBu adres artık KararVer hesabının e-posta adresi ve doğrulanmış durumda. Güvenliğin için bütün oturumlar kapatıldı; yeniden giriş yap:\n${webUrl}/giris`,
  };
}

export function deniedMail(webUrl: string, to: string): Mail {
  return {
    to,
    subject: "KararVer — e-posta değişikliği reddedildi",
    text: `Merhaba,\n\nHesabının e-posta değişikliği talebini reddettin; talep iptal edildi ve hesabındaki bütün oturumlar kapatıldı. Şifreni değiştirmeni öneririz:\n${webUrl}/sifremi-unuttum`,
  };
}
