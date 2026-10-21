import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminOrg } from "@/lib/admin-queries";

/*
 * Organisations & cohorts (spec 6.2, 6.3): an ADMIN creates and deletes
 * organisations and maps countries to them; a partner admin sees its own
 * organisation and manages its cohorts only. Each cohort can be renamed in
 * place. The server refuses the rest anyway (actions/admin.ts).
 */

vi.mock("@/app/actions/admin", () => ({
  createOrganisation: vi.fn(),
  deleteOrganisation: vi.fn(),
  createCohort: vi.fn(),
  updateCohort: vi.fn(),
  deleteCohort: vi.fn(),
  setCountryMapping: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { OrgCohortManager } = await import("./OrgCohortManager");
const { CountryMappingPanel } = await import("./CountryMappingPanel");

const org: AdminOrg = {
  id: "org-a",
  name: "Org A",
  shortName: "A",
  cohorts: [{ id: "c-1", name: "Autumn", startsAt: null, endsAt: null, memberCount: 2 }],
  people: 3,
  countries: ["DE"],
};

const render = (canManageOrganisations: boolean) =>
  renderToStaticMarkup(createElement(OrgCohortManager, { orgs: [org], canManageOrganisations })).replaceAll("<!-- -->", "");

describe("OrgCohortManager", () => {
  it("offers a partner admin its cohorts only: no new organisation, no organisation bin", () => {
    const html = render(false);
    expect(html).not.toContain("New organisation");
    expect(html).not.toContain('aria-label="Delete Org A"');
    expect(html).toContain('aria-label="Delete Autumn"');
    expect(html).toContain('aria-label="Change Autumn"');
    expect(html).toContain("New cohort");
  });

  it("offers an ADMIN organisations too, and says how many people each has", () => {
    const html = render(true);
    expect(html).toContain("New organisation");
    expect(html).toContain('aria-label="Delete Org A"');
    expect(html).toContain("3 people");
  });
});

describe("CountryMappingPanel", () => {
  const html = renderToStaticMarkup(
    createElement(CountryMappingPanel, {
      mappings: [{ country: "DE", organisationId: "org-b" }],
      organisations: [
        { id: "org-a", name: "Org A" },
        { id: "org-b", name: "Org B" },
      ],
    })
  ).replaceAll("<!-- -->", "");
  const rowOf = (country: string) => html.split("<li").find((r) => r.includes(`>${country}</label>`)) ?? "";

  it("has a row for each of the five countries", () => {
    for (const country of ["Germany", "Cyprus", "Belgium", "Greece", "Other countries"]) {
      expect(rowOf(country), country).toContain("<select");
    }
  });

  it("shows a mapped country's organisation, with placing learners unticked", () => {
    const de = rowOf("Germany");
    expect(de).toMatch(/<option value="org-b" selected="">Org B<\/option>/);
    expect(de).not.toContain("— not mapped —");
    expect(de).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  it("leaves an unmapped country unpicked, with placing its learners ticked for its first mapping", () => {
    const cy = rowOf("Cyprus");
    expect(cy).toMatch(/<option value="" selected="">— not mapped —<\/option>/);
    expect(cy).not.toMatch(/value="org-[ab]" selected=""/);
    expect(cy).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(cy).toContain("Also place learners from Cyprus who have no organisation yet");
  });
});
