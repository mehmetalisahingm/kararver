import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { SiteShell } from "../components/site-shell";
import { LegalFooter } from "../features/legal/views";
import { legalLinks } from "../features/legal/model";
import { publishedLegalBundle } from "../features/legal/published";
import { SourceAttribution } from "../components/source-attribution";
import { PrivacyPreferences } from "../components/privacy-preferences";
import "./globals.css";
import "./premium.css";
import "./legal.css";
import "./privacy-preferences.css";
import "./immersive.css";
import "./space.css";
import "./gravity.css";
import "./orbital-journey.css";
import "./mission.css";
import "./studio.css";
import "./refinements.css";
import "./decision-orbit.css";

const webUrl = new URL(process.env.WEB_URL ?? "http://localhost:3000");
const publicIndexing = process.env.APP_ENV === "production";

const siteTitle = "Kararver · Birlikte karar ver";
const siteDescription = "Sorularını topluluğa sor, farklı bakış açılarını gör ve kendi kararını ver.";

export const metadata: Metadata = {
  metadataBase: webUrl,
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    type: "website",
    url: webUrl.toString(),
    siteName: "Kararver",
    locale: "tr_TR",
    title: siteTitle,
    description: siteDescription,
  },
  twitter: { card: "summary", title: siteTitle, description: siteDescription },
  robots: { index: publicIndexing, follow: publicIndexing },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const links = legalLinks(publishedLegalBundle());
  return (
    <html lang="tr">
      <body>
        <Suspense fallback={null}><SourceAttribution /></Suspense>
        <div className="site-content">
          <SiteShell legalLinks={links}>
            {children}
          </SiteShell>
        </div>
        <LegalFooter links={links} />
        <PrivacyPreferences />
      </body>
    </html>
  );
}
