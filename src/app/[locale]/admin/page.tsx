import { setRequestLocale } from "next-intl/server";
import { getAdminCounts } from "@/lib/server-queries";
import { AdminDashboard } from "@/components/role/AdminDashboard";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const counts = await getAdminCounts();
  return <AdminDashboard counts={counts} />;
}
