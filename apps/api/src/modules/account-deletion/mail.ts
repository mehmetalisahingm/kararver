// Hesap silme bildirimleri — #181, KV-33 §12. Bağlantılardaki token URL fragment'ındadır (sunucu loglarına ve Referer'a düşmez).
// Bildirimler hesabın KAYITLI e-postasına gider; başka adres yoktur.
import type { Mail } from "../../mail/mailer.ts";

const link = (webUrl: string, raw: string, extra: string) => `${webUrl}/hesap/silme-onayi#token=${raw}&${extra}`;

/** Talep açıldı: silmeyi onaylamak ve "ben değilim" için iki bağlantı. Hesap bu e-postayla HENÜZ silinmedi. */
export function confirmMail(webUrl: string, to: string, raw: string): Mail {
  return {
    to,
    subject: "KararVer — hesabını silme talebini onayla",
    text: `Merhaba,\n\nKararVer hesabını kalıcı olarak silme talebi aldık. Hesabın bu e-postaya bağlı ve henüz silinmedi.\n\nKalıcı silmeyi onaylamak için bağlantıyı aç (24 saat geçerli). Bu işlem geri alınamaz: kişisel bilgilerin, paylaşım ve yorum metinlerin kaldırılır, oturumların kapanır:\n${link(webUrl, raw, "action=confirm")}\n\nBu talebi sen yapmadıysan bağlantıya tıklama; aşağıdaki bağlantı talebi iptal eder ve hesabındaki bütün oturumları kapatır:\n${link(webUrl, raw, "action=cancel")}`,
  };
}

/** DB'deki erişim/tombstone uygulandı; object storage, cache ve yedek temizliği henüz teyit edilmemiş olabilir. */
export function deletedMail(to: string): Mail {
  return {
    to,
    subject: "KararVer — hesap silme talebin işlendi",
    text: "Merhaba,\n\nKararVer hesabına erişim kapatıldı, hesap bilgilerin temizlendi, paylaşımların ve yorumların yayından kaldırıldı. Oturumların sonlandırıldı. Depolanan dosyaların temizliği arka planda devam edebilir; yedekler ve hukuken saklanması gereken sınırlı kayıtlar ayrıca ele alınır. Tamamının anında yok edildiği anlamına gelmez.\n\nBu e-posta adresi artık hesabında iletişim adresi olarak kullanılmıyor. Bunu sen yapmadıysan destek kanalı üzerinden başvur.",
  };
}

/** "Ben değilim" bağlantısı kullanıldı: talep iptal edildi, oturumlar kapandı. */
export function cancelledMail(webUrl: string, to: string): Mail {
  return {
    to,
    subject: "KararVer — hesap silme talebi iptal edildi",
    text: `Merhaba,\n\nHesabını silme talebi iptal edildi ve hesabındaki bütün oturumlar kapatıldı; hesabın silinmedi. Şifreni değiştirmeni öneririz:\n${webUrl}/sifremi-unuttum`,
  };
}
