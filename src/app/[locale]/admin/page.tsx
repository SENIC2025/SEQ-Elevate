import { setRequestLocale } from "next-intl/server";
import { getAdminCounts, scopeOrganisationName } from "@/lib/server-queries";
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
  // An ADMIN's counts are the project's; a partner admin's its
  // organisation's, and the labels name it.
  const [counts, organisationName] = await Promise.all([
    getAdminCounts(viewer.scope),
    viewer.scope.kind === "organisation" ? scopeOrganisationName(viewer.scope) : null,
  ]);
  return (
    <AdminDashboard
      counts={counts}
      organisationName={viewer.scope.kind === "organisation" ? (organisationName ?? "your organisation") : null}
    />
  );
}
