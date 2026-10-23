"use client";

import * as React from "react";
import type { AdminOrg } from "@/lib/admin-queries";
import type { Country } from "@/lib/countries";
import { CountryMappingPanel } from "@/components/role/CountryMappingPanel";
import { OrgCohortManager } from "@/components/role/OrgCohortManager";

/*
 * Organisations & cohorts (spec 6.3): the country mapping (an ADMIN's) and
 * the organisations with their cohorts, on one page. A change on either
 * shows from the change's own answer (each action answers the
 * organisations, and the mapping its mappings), never through a router
 * refresh of the page: one that lands next to the change's server action
 * can be dropped, or come back with what the page held before. Mapping a
 * country can place learners in an organisation, so its answer updates
 * the organisations' counts below; adding an organisation lists it in the
 * mapping. New props (a navigation) replace what was answered before them.
 */
export function OrganisationsScreen({
  orgs,
  mappings,
  admin,
}: {
  orgs: AdminOrg[];
  /** The country mapping, for an ADMIN with project scope; null for anyone else. */
  mappings: { country: Country; organisationId: string }[] | null;
  /** An ADMIN with project scope: organisations and the mapping. */
  admin: boolean;
}) {
  const [answered, setAnswered] = React.useState<{ from: AdminOrg[]; list: AdminOrg[] } | null>(null);
  const shown = answered && answered.from === orgs ? answered.list : orgs;
  const onOrganisations = React.useCallback((list: AdminOrg[]) => setAnswered({ from: orgs, list }), [orgs]);

  return (
    <div className="space-y-5">
      {admin && mappings ? (
        <CountryMappingPanel
          mappings={mappings}
          organisations={shown.map((o) => ({ id: o.id, name: o.name }))}
          onOrganisations={onOrganisations}
        />
      ) : null}
      <OrgCohortManager orgs={shown} canManageOrganisations={admin} onOrganisations={onOrganisations} />
    </div>
  );
}
