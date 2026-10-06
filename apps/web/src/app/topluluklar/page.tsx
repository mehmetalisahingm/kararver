import type { Metadata } from "next";
import { CommunitiesScreen } from "../../features/community/screens";

export const metadata: Metadata = { title: "Topluluklar · Kararver" };

export default function Page() {
  return <CommunitiesScreen />;
}
