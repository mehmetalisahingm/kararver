import { AuthScreen } from "../../features/auth/auth-screen";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; email?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthScreen
      mode="login"
      target={typeof params.returnTo === "string" ? params.returnTo : undefined}
      initialEmail={typeof params.email === "string" ? params.email : ""}
    />
  );
}
