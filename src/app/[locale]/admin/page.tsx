import { setRequestLocale } from "next-intl/server";
import { getAdminCounts } from "@/lib/server-queries";
import { isAdmin } from "@/lib/admin-queries";
import { AdminDashboard } from "@/components/role/AdminDashboard";
import { AccessNotice } from "@/components/AccessNotice";

// Real-time DB counts — never prerender at build (no DB there).
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The project overview is for admins only — decide before counting anything.
  if (!(await isAdmin())) {
    return (
      <AccessNotice title="Admins only">
        Sign in with an admin account to see the project overview.
      </AccessNotice>
    );
  }
  const counts = await getAdminCounts();
  return <AdminDashboard counts={counts} />;
}
