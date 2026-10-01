import { DiscoveryScreen } from "../../../features/discovery/screens";
import { parseQuery } from "../../../features/discovery/model";
import type { Params } from "../../../features/discovery/model";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Params>;
}) {
  const { slug } = await params;
  return (
    <DiscoveryScreen
      categorySlug={slug}
      query={parseQuery(await searchParams)}
    />
  );
}
