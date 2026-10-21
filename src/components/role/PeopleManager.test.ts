import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { AdminMember } from "@/lib/admin-queries";
import type { PeopleManagerProps } from "./PeopleManager";

/*
 * Your own row on the People screen: your Admin role stays on and the bin
 * can't remove you (the server refuses both, setMemberRoles and
 * removeMember). Both controls stay focusable and point to the line that
 * says why; another admin's row is unchanged.
 */

// The actions run on the server; these tests only render.
vi.mock("@/app/actions/admin", () => ({
  addMember: vi.fn(),
  setMemberRoles: vi.fn(),
  assignCohort: vi.fn(),
  removeMember: vi.fn(),
  resendInvitation: vi.fn(),
  updatePersonProfile: vi.fn(),
  setGuardianSharing: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { PeopleManager, detailChanges, draftWithCountry, removeNote } = await import("./PeopleManager");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

const member = (id: string, roles: AdminMember["roles"], over: Partial<AdminMember> = {}): AdminMember => ({
  id,
  email: `${id}@example.org`,
  name: null,
  roles,
  cohortId: null,
  cohortName: null,
  organisationId: null,
  orgName: null,
  organisationSource: null,
  country: null,
  profileComplete: true,
  testAccount: false,
  formerStaff: false,
  guardianConsent: false,
  guardianSharing: false,
  countryMismatch: false,
  joinedAt: "2026-10-20",
  status: "joined",
  invitedAt: null,
  ...over,
});

const ALL_ROLES: AdminMember["roles"] = ["LEARNER", "FACILITATOR", "CONTENT_EDITOR", "PARTNER_ADMIN", "ADMIN"];

/** The screen as an ADMIN ("me") sees it. */
const asAdmin = (members: AdminMember[], over: Partial<PeopleManagerProps> = {}): PeopleManagerProps => ({
  members,
  cohorts: [],
  selfId: "me",
  grantable: ALL_ROLES,
  admin: true,
  organisations: [
    { id: "org-a", name: "Org A" },
    { id: "org-b", name: "Org B" },
  ],
  ownOrganisation: null,
  minAge: 16,
  ...over,
});

/** The screen as a partner admin of Org A ("me") sees it. */
const asPartnerAdmin = (members: AdminMember[], over: Partial<PeopleManagerProps> = {}): PeopleManagerProps => ({
  ...asAdmin(members),
  grantable: ["LEARNER", "FACILITATOR"],
  admin: false,
  organisations: [{ id: "org-a", name: "Org A" }],
  ownOrganisation: { id: "org-a", name: "Org A" },
  ...over,
});

/** The whole screen, as markup. */
const render = (props: PeopleManagerProps) =>
  renderToStaticMarkup(
    createElement(IntlProvider, { locale: "en", messages: en, timeZone: "UTC" }, createElement(PeopleManager, props))
  ).replaceAll("<!-- -->", "");

/** The table row of `email`, as markup. */
const rowOf = (html: string, email: string) => html.split("<tr").find((r) => r.includes(email)) ?? "";

/** The table row of `email`, as markup, with "me" signed in as an ADMIN. */
function row(email: string) {
  return rowOf(render(asAdmin([member("me", ["ADMIN"]), member("colleague", ["ADMIN", "FACILITATOR"])])), email);
}

/** The button in `markup` whose text or label matches `name`. */
const button = (markup: string, name: RegExp) =>
  markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((b) => name.test(b)) ?? "";

describe("PeopleManager on your own row", () => {
  it("keeps your own Admin role on, and says why", () => {
    const own = row("me@example.org");
    const chip = button(own, />Admin<\/button>/);
    expect(chip).toContain('aria-pressed="true"');
    expect(chip).toContain('aria-disabled="true"');
    const hint = /aria-describedby="([^"]+)"/.exec(chip)?.[1];
    expect(own).toContain(`id="${hint}"`);
    expect(own).toMatch(/can&#x27;t switch off your own Admin\s+role/);
  });

  it("can't remove yourself, and says why", () => {
    const own = row("me@example.org");
    const bin = button(own, /Remove me@example.org from the project/);
    expect(bin).toContain('aria-disabled="true"');
    const hint = /aria-describedby="([^"]+)"/.exec(bin)?.[1];
    expect(own).toContain(`id="${hint}"`);
  });

  it("leaves another admin's row as it was", () => {
    const other = row("colleague@example.org");
    expect(button(other, />Admin<\/button>/)).not.toContain("aria-disabled");
    expect(button(other, /Remove colleague@example.org/)).not.toContain("aria-disabled");
    expect(other).not.toMatch(/This is you/);
  });
});

/*
 * Release 3 (spec 6.3): what the screen offers follows what the server
 * allows (actions/admin.ts refuses the rest anyway). A partner admin is
 * offered the roles it may grant only, adds everyone to its own
 * organisation, and can't change or remove a partner admin or an editor.
 */
describe("PeopleManager for a partner admin", () => {
  const people = [
    member("me", ["PARTNER_ADMIN"], { organisationId: "org-a", orgName: "Org A" }),
    member("learner", ["LEARNER"], { organisationId: "org-a", orgName: "Org A", country: "DE" }),
    member("colleague", ["PARTNER_ADMIN"], { organisationId: "org-a", orgName: "Org A" }),
    member("editor", ["CONTENT_EDITOR"], { organisationId: "org-a", orgName: "Org A" }),
  ];
  const html = render(asPartnerAdmin(people));
  const roleSelect = /<select[^>]*aria-label="Role"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";

  it("offers only Learner and Facilitator, and adds to its own organisation", () => {
    expect([...roleSelect.matchAll(/<option value="(\w+)"/g)].map((m) => m[1])).toEqual(["LEARNER", "FACILITATOR"]);
    expect(html).toContain("Add someone to Org A");
    expect(html).not.toContain('aria-label="Organisation"');
  });

  it("can't change or remove another partner admin or an editor, and says why", () => {
    for (const email of ["colleague@example.org", "editor@example.org"]) {
      const r = rowOf(html, email);
      expect(r).toContain("Only an admin changes partner admins, editors and admins.");
      expect(r).not.toMatch(/Remove [^"]+ from the project/);
      expect(r).not.toContain("Change details");
      const chips = r.match(/<button[^>]*aria-pressed[^>]*>/g) ?? [];
      expect(chips.length).toBeGreaterThan(0);
      // Each is switched off, or shown as included with a role it holds.
      for (const chip of chips) expect(chip).toMatch(/aria-disabled="true"|disabled=""/);
    }
  });

  it("changes and removes one of its learners", () => {
    const r = rowOf(html, "learner@example.org");
    expect(button(r, /Remove learner@example.org/)).not.toContain("aria-disabled");
    expect(button(r, /Change details of learner@example.org/)).toBeTruthy();
    expect(button(r, />Facilitator<\/button>/)).not.toContain("aria-disabled");
    // Never the roles it can't grant.
    expect(r).not.toContain(">Admin</button>");
    expect(r).not.toContain(">Editor</button>");
  });

  it("can't change its own roles", () => {
    const own = rowOf(html, "me@example.org");
    expect(own).toContain("Only an admin changes your roles or removes you.");
    expect(button(own, /Remove me@example.org/)).toContain('aria-disabled="true"');
  });
});

describe("PeopleManager for an ADMIN", () => {
  it("offers every role, the partner admin's included, and an organisation to pick", () => {
    const html = render(asAdmin([member("me", ["ADMIN"])]));
    const roleSelect = /<select[^>]*aria-label="Role"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
    expect(roleSelect).toContain(">Partner admin (includes Facilitator, Editor)</option>");
    expect(html).toMatch(/<select[^>]*aria-label="Organisation"/);
    // DIESIS's staff belong to DIESIS (they see its learners, D74, D81);
    // only SENIC's support staff have none.
    const none = /<select[^>]*aria-label="Organisation"[^>]*>\s*<option value=""[^>]*>([^<]*)<\/option>/.exec(html)?.[1];
    expect(none).toBe("— none (SENIC staff) —");
  });

  it("asks about a guardian's permission when adding a learner", () => {
    const html = render(asAdmin([member("me", ["ADMIN"])], { minAge: 16 }));
    expect(html).toContain("Under 16: our organisation holds a parent&#x27;s or guardian&#x27;s permission");
  });

  it("names no single age when the learners' countries have different ones (AGE_RULE=digital-consent)", () => {
    const html = render(
      asAdmin([member("me", ["ADMIN"]), member("ana", ["LEARNER"], { guardianConsent: true })], { minAge: null })
    );
    expect(html).toContain(
      "Under the minimum age in their country: our organisation holds a parent&#x27;s or guardian&#x27;s permission"
    );
    expect(rowOf(html, "ana@example.org")).toContain("Under the minimum age, guardian&#x27;s permission recorded");
    expect(html).not.toMatch(/Under \d+/);
  });

  it("says each person's organisation and country, and what their profile says", () => {
    const html = render(
      asAdmin([
        member("me", ["ADMIN"]),
        member("ana", ["LEARNER"], {
          organisationId: "org-a",
          orgName: "Org A",
          country: "CY",
          countryMismatch: true,
          profileComplete: false,
          testAccount: true,
          formerStaff: true,
          guardianConsent: true,
        }),
        member("ben", ["LEARNER"]),
      ])
    );
    const ana = rowOf(html, "ana@example.org");
    for (const text of [
      "Org A",
      "Cyprus",
      "Country doesn&#x27;t match organisation",
      "Profile not completed",
      "Test account",
      "Former staff",
      "Under 16, guardian&#x27;s permission recorded",
      "The guardian&#x27;s permission also covers sharing their Comp Card with our facilitators",
    ]) {
      expect(ana, text).toContain(text);
    }
    // The tick's name says whose permission, read on its own.
    const tick = /<label[^>]*>\s*<input[^>]*type="checkbox"[^>]*>\s*<span>([\s\S]*?)<\/span><\/label>/.exec(ana)?.[1] ?? "";
    expect(tick.trim()).toMatch(/^The guardian&#x27;s permission/);
    const ben = rowOf(html, "ben@example.org");
    expect(ben).toContain("No organisation");
    expect(ben).toContain("Country not given");
  });

  it("offers a person only the cohorts of their own organisation", () => {
    const html = render(
      asAdmin([member("me", ["ADMIN"]), member("ana", ["LEARNER"], { organisationId: "org-a", orgName: "Org A" })], {
        cohorts: [
          { id: "c-a", label: "A · Autumn", organisationId: "org-a" },
          { id: "c-b", label: "B · Autumn", organisationId: "org-b" },
        ],
      })
    );
    const ana = rowOf(html, "ana@example.org");
    expect(ana).toContain(">A · Autumn</option>");
    expect(ana).not.toContain("B · Autumn");
  });

  it("lists the people with a role, and offers the review lists", () => {
    const html = render(asAdmin([member("me", ["ADMIN"]), member("gone", [])]));
    expect(html).toContain("me@example.org");
    // Someone with no role is on their own list, not among the project's people.
    expect(html).not.toContain("gone@example.org");
    for (const list of [
      "No role: removed, or never finished signing up",
      "No organisation",
      "Country doesn&#x27;t match organisation",
      "Added by a partner admin, never signed in",
    ]) {
      expect(html).toContain(`>${list}</option>`);
    }
  });

  it("offers a partner admin no review lists", () => {
    const html = render(asPartnerAdmin([member("me", ["PARTNER_ADMIN"])]));
    expect(html).not.toContain("Added by a partner admin, never signed in");
  });
});

/*
 * "Change details" (spec 6.3, Q24): what the form shows is what is saved.
 * A learner's organisation follows a new country, and the form shows the
 * organisation it brings as soon as the country is picked; an organisation
 * picked after that (their own, say) is the one saved, so "new country,
 * same organisation" can be said. A staff member's organisation never
 * follows a country.
 */
describe("Change details: a new country and the organisation", () => {
  const mappings = { DE: "org-a", CY: "org-b" } as const;
  const ana = member("ana", ["LEARNER"], { name: "Ana", organisationId: "org-a", orgName: "Org A", country: "DE" });
  const draft = { name: "Ana", country: "DE", organisationId: "org-a" };
  const asAdminEdit = { admin: true, self: false };

  it("shows the organisation a learner's new country brings, and their own when it is put back", () => {
    expect(draftWithCountry(ana, draft, "CY", mappings)).toEqual({ name: "Ana", country: "CY", organisationId: "org-b" });
    // A country mapped to no organisation: none.
    expect(draftWithCountry(ana, draft, "GR", mappings).organisationId).toBe("");
    const moved = draftWithCountry(ana, draft, "CY", mappings);
    expect(draftWithCountry(ana, moved, "DE", mappings).organisationId).toBe("org-a");
  });

  it("never moves a staff member's organisation with the country", () => {
    const fa = member("fa", ["FACILITATOR"], { organisationId: "org-a", country: "DE" });
    expect(draftWithCountry(fa, draft, "CY", mappings)).toEqual({ ...draft, country: "CY" });
  });

  it("saves a new country with the organisation the form shows, the person's own included", () => {
    expect(detailChanges(ana, { ...draft, country: "CY", organisationId: "org-a" }, asAdminEdit)).toEqual({
      country: "CY",
      organisationId: "org-a",
    });
    expect(detailChanges(ana, { ...draft, country: "CY", organisationId: "org-b" }, asAdminEdit)).toEqual({
      country: "CY",
      organisationId: "org-b",
    });
    expect(detailChanges(ana, { ...draft, organisationId: "" }, asAdminEdit)).toEqual({ organisationId: null });
    expect(detailChanges(ana, draft, asAdminEdit)).toEqual({});
  });

  it("sends a partner admin's or your own change as a name only", () => {
    const changed = { name: "Anna", country: "CY", organisationId: "org-b" };
    expect(detailChanges(ana, changed, { admin: false, self: false })).toEqual({ name: "Anna" });
    expect(detailChanges(ana, changed, { admin: true, self: true })).toEqual({ name: "Anna" });
  });
});

describe("Remove: what the question says", () => {
  it("tells a partner admin what happens without the server setting, which never applies to its people", () => {
    expect(removeNote(false)).not.toContain("server setting");
    expect(removeNote(false)).toContain("back on this list as a learner");
  });

  it("tells an ADMIN about the admins named in the server setting", () => {
    expect(removeNote(true)).toContain("named in the server setting");
  });
});
