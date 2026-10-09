import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProductProvider } from "../components/product-provider";
import { SourceAttribution } from "../components/source-attribution";
import "./globals.css";
import "./premium.css";

const webUrl = new URL(process.env.WEB_URL ?? "http://localhost:3000");
const publicIndexing = process.env.APP_ENV === "production";

export const metadata: Metadata = {
  metadataBase: webUrl,
  title: "Kararver · Birlikte karar ver",
  description: "Sorularını topluluğa sor, farklı bakış açılarını gör ve kendi kararını ver.",
  robots: { index: publicIndexing, follow: publicIndexing },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <ProductProvider demo={process.env.NEXT_PUBLIC_KV_DATA_MODE === "demo"}>
          <SourceAttribution />
          {children}
        </ProductProvider>
      </body>
    </html>
  );
}
