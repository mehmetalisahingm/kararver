import { notFound } from "next/navigation";
import { AdminSection } from "../../../features/admin/admin-shell";
import { isAdminSection } from "../../../features/admin/admin-model";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isAdminSection(section) || section === "dashboard") notFound();
  return <AdminSection section={section} />;
}
