import { setRequestLocale } from "next-intl/server";
import { getAdminCounts } from "@/lib/server-queries";
import { getViewer } from "@/lib/scope";
import { canManagePeople } from "@/lib/permissions";
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
  // The overview is for people managers (an ADMIN: the project; a partner
  // admin: their organisation) with a scope — decide before counting anything.
  const viewer = await getViewer();
  if (!canManagePeople(viewer.roles) || viewer.scope.kind === "none") {
    return (
      <AccessNotice title="Admins only">
        Sign in with an admin account to see the project overview.
      </AccessNotice>
    );
  }
  const counts = await getAdminCounts(viewer.scope);
  return <AdminDashboard counts={counts} />;
}
