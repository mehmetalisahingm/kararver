"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProductProvider } from "./product-provider";
import type { LegalLink } from "../features/legal/model";
import { PublicLegalShell, RegistrationLegalNotice } from "../features/legal/views";
import { OpeningScreen } from "./opening-screen";

export function SiteShell({ children, legalLinks }: { children: ReactNode; legalLinks: readonly LegalLink[] }) {
  const pathname = usePathname();
  // Public information must remain readable if session or product API is down.
  if (pathname === "/yasal" || pathname.startsWith("/yasal/"))
    return <PublicLegalShell>{children}</PublicLegalShell>;
  return <ProductProvider>
    {pathname === "/" && <OpeningScreen />}
    {pathname === "/kayit" && <RegistrationLegalNotice links={legalLinks} />}
    {children}
  </ProductProvider>;
}
