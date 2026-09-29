import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProductProvider } from "../components/product-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "Kararver · Birlikte karar ver",
  description: "Kararver kullanıcı arayüzü geliştirme ortamı.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <ProductProvider demo={process.env.NEXT_PUBLIC_KV_DATA_MODE === "demo"}>
          {children}
        </ProductProvider>
      </body>
    </html>
  );
}
