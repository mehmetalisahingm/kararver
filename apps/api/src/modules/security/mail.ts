// #373 (Utku) P2: doğrulayıcı değişikliği kullanıcıya bildirilir. Bildirim hesabın KAYITLI e-postasına gider;
// sır, kurtarma kodu veya bağlantı tokeni içermez. Ele geçirilmiş bir oturumla yapılan yenileme sessiz kalmasın.
import type { Mail } from "../../mail/mailer.ts";

export function authenticatorChangedMail(webUrl: string, to: string): Mail {
  return {
    to,
    subject: "KararVer — iki adımlı doğrulayıcın değiştirildi",
    text: `Merhaba,\n\nKararVer hesabının iki adımlı doğrulayıcısı yenilendi: eski doğrulayıcı uygulaması ve eski kurtarma kodların artık geçmiyor.\n\nBunu sen yaptıysan bir şey yapmana gerek yok.\n\nSen yapmadıysan hemen şifreni değiştir ve destek ile iletişime geç:\n${webUrl}/sifremi-unuttum`,
  };
}
