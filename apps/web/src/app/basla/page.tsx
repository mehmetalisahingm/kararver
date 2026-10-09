import { WelcomeEntry } from "../../features/onboarding/welcome-entry";
import { safeReturnTo } from "../../lib/model";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  return <WelcomeEntry returnTo={safeReturnTo(typeof params.returnTo === "string" ? params.returnTo : "/")} />;
}
