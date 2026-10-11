import type { Metadata } from "next";
import { DataExportDownloadScreen } from "../../features/data-export/download-screen";

// Kişisel veri bağlantısı: arama motorlarına kapalı.
export const metadata: Metadata = { title: "Verilerini indir", robots: { index: false, follow: false } };

export default function Page() {
  return <DataExportDownloadScreen />;
}
