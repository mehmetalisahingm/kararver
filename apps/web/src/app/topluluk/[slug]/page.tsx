import { CommunityScreen } from "../../../features/community/screens";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunityScreen slug={slug} />;
}
