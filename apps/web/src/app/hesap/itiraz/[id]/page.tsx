import { AppealScreen } from "../../../../features/moderation/appeal-screen";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppealScreen id={id} />;
}
