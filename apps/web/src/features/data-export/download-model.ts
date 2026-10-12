// KVKK veri paketi indirme sayfası modeli (#181). Saf fonksiyonlar: token'ın nereden okunacağı, dosya adı ve hata metni.
//
// Bağlantı token'ı URL fragment'ındadır (sunucu loglarına ve Referer başlığına düşmez). Kullanıcı giriş yapmamışsa giriş
// sayfasına gidip döneceği için token önce oturum (sekme) depolamasına alınır; fragment adres çubuğundan temizlenir.
import { UiError } from "../../lib/model.ts";

export const TOKEN_STORAGE_KEY = "kv-data-export-token";

type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Fragment'ta token varsa onu alır ve saklar; yoksa saklanmış olanı döner. Depolama yoksa/erişilemezse yalnız fragment. */
export function resolveToken(hash: string, store: TokenStore | null): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  try {
    if (fromHash) {
      store?.setItem(TOKEN_STORAGE_KEY, fromHash);
      return fromHash;
    }
    return store?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return fromHash;
  }
}

export function forgetToken(store: TokenStore | null): void {
  try {
    store?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // depolama erişilemez: saklanan bir şey de yok
  }
}

export const packageFileName = (now: Date) => `kararver-verilerim-${now.toISOString().slice(0, 10)}.json`;

/** Kullanıcıya gösterilen hata: hesap/paket varlığını ele vermeyen tek bir metin ve yeniden denenebilirlik. */
export function downloadErrorMessage(cause: unknown): { message: string; retryable: boolean } {
  if (cause instanceof UiError && cause.code === "TOKEN_INVALID_OR_EXPIRED") {
    return {
      message: "Bu bağlantı geçersiz, süresi dolmuş, indirme hakkı bitmiş veya bu hesaba ait değil. Doğru hesapla giriş yaptığından emin ol; gerekiyorsa destekten yeni bağlantı iste.",
      retryable: false,
    };
  }
  if (cause instanceof UiError && cause.code === "UNAUTHENTICATED") {
    return { message: "Oturumun sona ermiş. Yeniden giriş yapıp bağlantıyı tekrar aç.", retryable: false };
  }
  return { message: "Veri paketi şu an indirilemedi. Biraz sonra tekrar dene.", retryable: true };
}
