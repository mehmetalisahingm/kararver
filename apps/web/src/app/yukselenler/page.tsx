import { TrendsScreen } from "../../features/discovery/screens";
import { parseQuery } from "../../features/discovery/model";
import type { Params } from "../../features/discovery/model";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  return <TrendsScreen query={parseQuery(await searchParams)} />;
}
