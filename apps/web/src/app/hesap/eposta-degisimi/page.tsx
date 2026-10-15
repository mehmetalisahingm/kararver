import type { Metadata } from "next";
import { EmailChangeScreen } from "../../../features/account/email-change-screen";

// Kişisel bağlantı: arama motorlarına kapalı.
export const metadata: Metadata = { title: "E-posta değişimi", robots: { index: false, follow: false } };

export default function Page() {
  return <EmailChangeScreen />;
}
