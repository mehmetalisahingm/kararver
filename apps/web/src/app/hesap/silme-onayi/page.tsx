import type { Metadata } from "next";
import { DeletionScreen } from "../../../features/account/deletion-screen";

// Kişisel bağlantı: arama motorlarına kapalı.
export const metadata: Metadata = { title: "Hesap silme", robots: { index: false, follow: false } };

export default function Page() {
  return <DeletionScreen />;
}
