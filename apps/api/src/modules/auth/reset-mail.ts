// Şifre sıfırlama e-postası — kullanıcının kendi isteği (auth.password.forgot) ve yönetici başlatması
// (admin.users.passwordReset.send) aynı bağlantı biçimini kullanır. Token URL fragment'ında taşınır: sunucu
// loglarına ve Referer başlığına düşmez.
import type { Mail } from "../../mail/mailer.ts";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export const resetLink = (webUrl: string, raw: string) => `${webUrl}/sifre-yenile#token=${raw}`;

export function passwordResetMail(webUrl: string, to: string, raw: string, origin: "self" | "admin"): Mail {
  const lead =
    origin === "admin"
      ? "Bir KararVer yöneticisi hesabın için şifre sıfırlama başlattı. Şifreni belirlemek için bağlantıyı aç (1 saat geçerli):"
      : "Şifreni sıfırlamak için bağlantıyı aç (1 saat geçerli):";
  const tail =
    origin === "admin"
      ? "Bu isteği beklemiyorsan bağlantıyı açma; şifren değişmez. Bağlantı kullanılana kadar mevcut şifren geçerlidir."
      : "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.";
  return {
    to,
    subject: "KararVer — şifre sıfırlama",
    text: `Merhaba,\n\n${lead}\n${resetLink(webUrl, raw)}\n\nŞifre değişince bütün cihazlardaki oturumların kapanır.\n${tail}`,
  };
}
