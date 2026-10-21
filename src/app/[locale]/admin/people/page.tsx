import { setRequestLocale } from "next-intl/server";
import { getAdminMembers, getAdminOrgs, getCountryMappings, guardianAge } from "@/lib/admin-queries";
import { getViewer } from "@/lib/scope";
import { canManagePeople, grantableRoles, seesWholeProject } from "@/lib/permissions";
import { PeopleManager } from "@/components/role/PeopleManager";
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
  // People managers only (an ADMIN: everyone; a partner admin: their
  // organisation's people), read for their scope (D74).
  const viewer = await getViewer();
  const manager = canManagePeople(viewer.roles);
  const [members, orgs, mappings] = manager
    ? await Promise.all([
        getAdminMembers(viewer.scope),
        getAdminOrgs(viewer.scope),
        // An ADMIN's only (null for anyone else): "Change details" shows the
        // organisation a learner's new country brings.
        getCountryMappings(viewer.scope),
      ])
    : [null, null, null];

  if (!members) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold">{manager ? "No people to show yet" : "Admins only"}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {manager
            ? "Your profile isn't complete, or your account isn't linked to an organisation yet, so no people are shown. Ask DIESIS if this doesn't change."
            : "Sign in with an admin account to manage people."}
        </p>
      </div>
    );
  }

  // An ADMIN (with project scope) picks organisations and changes countries;
  // a partner admin adds everyone to its own organisation.
  const admin = seesWholeProject(viewer.roles) && viewer.scope.kind === "project";
  const organisations = (orgs ?? []).map((o) => ({ id: o.id, name: o.name }));
  const ownId = viewer.scope.kind === "organisation" ? viewer.scope.organisationId : null;
  const ownOrganisation = ownId ? (organisations.find((o) => o.id === ownId) ?? null) : null;
  // The cohorts in scope, each with its organisation: a person only joins one of their own.
  const cohorts = (orgs ?? []).flatMap((o) =>
    o.cohorts.map((c) => ({ id: c.id, label: `${o.shortName} · ${c.name}`, organisationId: o.id }))
  );
  // The age a guardian's permission is recorded under: that of the
  // countries a partner admin's learners come from (every country for an
  // ADMIN), or none when they differ.
  const minAge = guardianAge(ownId ? ((orgs ?? []).find((o) => o.id === ownId)?.countries ?? []) : []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">People</h1>
      <p className="mt-1 mb-5 text-sm text-[var(--muted-foreground)]">
        {ownOrganisation
          ? `Add people to ${ownOrganisation.name}, set what they can do, and put learners in a cohort.`
          : "Add people to the project, set what they can do, and put learners in a cohort."}
      </p>
      <PeopleManager
        members={members}
        cohorts={cohorts}
        selfId={viewer.user?.id ?? null}
        grantable={grantableRoles(viewer.roles)}
        admin={admin}
        organisations={organisations}
        ownOrganisation={ownOrganisation}
        mappings={Object.fromEntries((mappings ?? []).map((m) => [m.country, m.organisationId]))}
        minAge={minAge}
      />
    </div>
  );
}
