import { AuthScreen } from "../../features/auth/auth-screen";
import { V1_FREE_NOTE } from "../../lib/v1-business-model";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; email?: string; onboarding?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <AuthScreen
        mode="register"
        onboarding={params.onboarding === "1"}
        target={typeof params.returnTo === "string" ? params.returnTo : undefined}
        initialEmail={typeof params.email === "string" ? params.email : ""}
      />
      <p className="kv-muted" style={{ textAlign: "center", maxWidth: 520, margin: "12px auto 24px", fontSize: 13 }}>{V1_FREE_NOTE}</p>
    </>
  );
}
