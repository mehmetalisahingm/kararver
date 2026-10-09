import type { Metadata } from "next";
import { CommunitiesScreen } from "../../features/community/screens";
import { CommunityRequestPanel } from "../../features/community/request-panel";

export const metadata: Metadata = { title: "Topluluklar · Kararver" };

export default function Page() {
  return <><CommunitiesScreen /><CommunityRequestPanel /></>;
}
