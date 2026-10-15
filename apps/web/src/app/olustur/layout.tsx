import type { ReactNode } from "react";
import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata;

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return children;
}
