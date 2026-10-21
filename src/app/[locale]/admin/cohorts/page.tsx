import { setRequestLocale } from "next-intl/server";
import { getAdminOrgs, getCountryMappings } from "@/lib/admin-queries";
import { getViewer } from "@/lib/scope";
import { canManagePeople, seesWholeProject } from "@/lib/permissions";
import { OrgCohortManager } from "@/components/role/OrgCohortManager";
import { CountryMappingPanel } from "@/components/role/CountryMappingPanel";
import { Link } from "@/i18n/navigation";
import { ChevronLeft, ShieldAlert } from "lucide-react";

// Reads the viewer's roles + live data — never prerender.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // People managers only, for their scope (a partner admin: their own
  // organisation and its cohorts). Organisations and the country mapping
  // are an ADMIN's (with project scope).
  const viewer = await getViewer();
  const manager = canManagePeople(viewer.roles);
  const admin = seesWholeProject(viewer.roles) && viewer.scope.kind === "project";
  const [orgs, mappings] = manager
    ? await Promise.all([getAdminOrgs(viewer.scope), admin ? getCountryMappings(viewer.scope) : null])
    : [null, null];

  if (!orgs) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold">{manager ? "Nothing to show yet" : "Admins only"}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {manager
            ? "Your profile isn't complete, or your account isn't linked to an organisation yet, so no cohorts are shown. Ask DIESIS if this doesn't change."
            : "Sign in with an admin account to manage organisations and cohorts."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {admin ? <>Organisations &amp; cohorts</> : "Cohorts"}
      </h1>
      <p className="mt-1 mb-5 text-sm text-[var(--muted-foreground)]">
        {admin
          ? "Set up the partner organisations running the programme, which countries each supports, and the cohorts learners belong to."
          : "Set up the cohorts your organisation's learners belong to."}
      </p>
      <div className="space-y-5">
        {admin && mappings ? (
          <CountryMappingPanel
            mappings={mappings}
            organisations={orgs.map((o) => ({ id: o.id, name: o.name }))}
          />
        ) : null}
        <OrgCohortManager orgs={orgs} canManageOrganisations={admin} />
      </div>
    </div>
  );
}
