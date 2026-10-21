import { describe, it, expect, vi, afterEach } from "vitest";
import type { Scope } from "@/lib/scope";

/*
 * Organisations & cohorts says how many people are in a cohort, on its
 * badge and when its bin asks "Its N members will have no cohort". Someone
 * with two roles (Learner and Facilitator) has two memberships in it: they
 * are one member. The database is stood in for by what it answers for this
 * cohort, which holds Ana (two roles) and Ben (one).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => null,
  getProjectMemberships: async () => [{ role: "ADMIN" }],
}));

const memberships = [{ userId: "ana" }, { userId: "ana" }, { userId: "ben" }];
const organisationFindMany = vi.fn(async (): Promise<unknown[]> => [
  {
    id: "org",
    name: "Org",
    shortName: "O",
    cohorts: [
      {
        id: "cohort",
        name: "Autumn",
        startsAt: null,
        endsAt: null,
        // Its membership rows, and what counting them gives.
        memberships,
        _count: { memberships: memberships.length },
      },
    ],
  },
]);
const userFindMany = vi.fn(async (): Promise<unknown[]> => []);
const mappingFindMany = vi.fn(async (): Promise<unknown[]> => []);
const auditFindMany = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organisation: { findMany: organisationFindMany },
    user: { findMany: userFindMany },
    countryMapping: { findMany: mappingFindMany },
    auditLog: { findMany: auditFindMany },
  },
}));

const { getAdminOrgs, getAdminMembers, getCountryMappings } = await import("./admin-queries");
const { organisationsInScope, peopleInScope } = await import("./scope");

const PROJECT_SCOPE: Scope = { kind: "project", viewerId: "admin", viewerOrganisationId: null };
const ORG_A: Scope = { kind: "organisation", viewerId: "paa", organisationId: "org-a" };
const NONE: Scope = { kind: "none" };

const argsOf = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)?.[0] as Record<string, unknown>;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("getAdminOrgs", () => {
  it("counts the people in a cohort, not their roles", async () => {
    const [org] = (await getAdminOrgs(PROJECT_SCOPE)) ?? [];
    expect(org.cohorts[0].memberCount).toBe(2);
  });
});

/*
 * FD-U11 (D74, spec 3.4 SP13, SP14): the people and organisation screens
 * read for the viewer's scope. An ADMIN sees every organisation and
 * everyone; a partner admin its own organisation and its people, never an
 * ADMIN holder or an ADMIN_EMAILS address; no scope, nothing.
 */
describe("getAdminOrgs, for the viewer's scope (FD-U11)", () => {
  it("answers null for no scope, without asking the database", async () => {
    expect(await getAdminOrgs(NONE)).toBeNull();
    expect(organisationFindMany).not.toHaveBeenCalled();
  });

  it("reads every organisation of the project for an ADMIN", async () => {
    await getAdminOrgs(PROJECT_SCOPE);
    expect(argsOf(organisationFindMany).where).toEqual(organisationsInScope(PROJECT_SCOPE));
  });

  it("reads only the partner admin's own organisation", async () => {
    await getAdminOrgs(ORG_A);
    expect(argsOf(organisationFindMany).where).toEqual(organisationsInScope(ORG_A));
    expect(argsOf(organisationFindMany).where).toEqual({ AND: [{ projectId: "seq-elevate" }, { id: "org-a" }] });
  });
});

/** A person as the people query reads them: their roles, profile and staff history in the project. */
const person = (
  id: string,
  roles: string[],
  profile: Record<string, unknown> | null = {},
  over: Record<string, unknown> = {}
) => ({
  id,
  email: `${id}@example.test`,
  name: id,
  emailVerified: new Date(),
  createdAt: new Date("2026-11-20T09:00:00Z"),
  memberships: roles.map((role) => ({ role, cohortId: null, cohort: null, createdAt: new Date("2026-11-20T09:00:00Z") })),
  profiles: profile
    ? [
        {
          organisationId: "org-a",
          organisationSource: "admin",
          country: "DE",
          profileCompletedAt: new Date(),
          testAccountAt: null,
          guardianConsentRecordedAt: null,
          guardianSharingConsentAt: null,
          createdAt: new Date("2026-11-20T09:00:00Z"),
          organisation: { name: "Org A" },
          ...profile,
        },
      ]
    : [],
  staffHistory: [],
  ...over,
});

describe("getAdminMembers, for the viewer's scope (FD-U11)", () => {
  it("answers null for no scope, without asking the database", async () => {
    expect(await getAdminMembers(NONE)).toBeNull();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it("reads everyone of the project for an ADMIN, people with a profile and no role included", async () => {
    await getAdminMembers(PROJECT_SCOPE);
    expect(argsOf(userFindMany).where).toEqual(peopleInScope(PROJECT_SCOPE));
  });

  it("reads only the people of the partner admin's organisation who hold a role, never an ADMIN holder or ADMIN_EMAILS", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.test");
    await getAdminMembers(ORG_A);
    const where = argsOf(userFindMany).where;
    expect(where).toEqual({ AND: [peopleInScope(ORG_A), { memberships: { some: { projectId: "seq-elevate" } } }] });
    const text = JSON.stringify(where);
    expect(text).toContain('"organisationId":"org-a"');
    expect(text).toContain('"role":"ADMIN"');
    expect(text).toContain("boss@example.test");
  });

  it("gives each person's organisation and country from their profile, not from a membership row", async () => {
    userFindMany.mockImplementation(async () => [person("ana", ["LEARNER", "FACILITATOR"])]);
    const [ana] = (await getAdminMembers(PROJECT_SCOPE)) ?? [];
    expect(ana).toMatchObject({
      id: "ana",
      roles: ["LEARNER", "FACILITATOR"],
      organisationId: "org-a",
      orgName: "Org A",
      country: "DE",
    });
    const select = JSON.stringify(argsOf(userFindMany));
    expect(select).toContain('"profiles"');
    expect(select).not.toContain('"organisationId":true,"cohortId"');
  });

  it("reads profiles, roles and staff history of this project only, and no more of the user than the screen shows", async () => {
    await getAdminMembers(PROJECT_SCOPE);
    const args = argsOf(userFindMany) as { include?: unknown; select?: Record<string, { where?: unknown }> };
    expect(args.include).toBeUndefined();
    const select = args.select ?? {};
    expect(Object.keys(select).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "memberships",
      "name",
      "profiles",
      "staffHistory",
    ]);
    for (const relation of ["memberships", "profiles", "staffHistory"]) {
      expect(select[relation], relation).toMatchObject({ where: { projectId: "seq-elevate" } });
    }
  });
});

/*
 * What Manage people says about each person (spec 6.3): the profile step
 * done or not, a test account, a former staff member, a guardian's
 * permission recorded, and, for ADMINs, a learner whose country is another
 * organisation's than theirs.
 */
describe("getAdminMembers: what it says about each person", () => {
  const one = async (scope: Scope, p: ReturnType<typeof person>, mappings: unknown[] = []) => {
    userFindMany.mockImplementation(async () => [p]);
    mappingFindMany.mockImplementation(async () => mappings);
    const [m] = (await getAdminMembers(scope)) ?? [];
    return m;
  };

  it("says when someone hasn't completed the profile step, or is a test account", async () => {
    expect(await one(PROJECT_SCOPE, person("a", ["LEARNER"], { profileCompletedAt: null }))).toMatchObject({
      profileComplete: false,
      testAccount: false,
    });
    expect(await one(PROJECT_SCOPE, person("b", ["LEARNER"], { testAccountAt: new Date() }))).toMatchObject({
      profileComplete: true,
      testAccount: true,
    });
  });

  it("calls someone former staff who held a staff role once and holds none now", async () => {
    const was = { staffHistory: [{ firstAt: new Date() }] };
    expect((await one(PROJECT_SCOPE, person("a", ["LEARNER"], {}, was))).formerStaff).toBe(true);
    expect((await one(PROJECT_SCOPE, person("b", ["FACILITATOR"], {}, was))).formerStaff).toBe(false);
    expect((await one(PROJECT_SCOPE, person("c", ["LEARNER"]))).formerStaff).toBe(false);
  });

  it("says when a guardian's permission was recorded, and whether it covers sharing", async () => {
    expect(
      await one(ORG_A, person("a", ["LEARNER"], { guardianConsentRecordedAt: new Date(), guardianSharingConsentAt: null }))
    ).toMatchObject({ guardianConsent: true, guardianSharing: false });
  });

  it("lists, for an ADMIN, someone with a profile and no role", async () => {
    const m = await one(PROJECT_SCOPE, person("gone", []));
    expect(m).toMatchObject({ id: "gone", roles: [] });
  });

  it("tells an ADMIN when a learner's country is mapped to another organisation, or was released", async () => {
    const mapped = [{ country: "DE", organisationId: "org-b" }];
    expect((await one(PROJECT_SCOPE, person("a", ["LEARNER"]), mapped)).countryMismatch).toBe(true);
    expect((await one(PROJECT_SCOPE, person("b", ["LEARNER"]), [{ country: "DE", organisationId: "org-a" }])).countryMismatch).toBe(false);
    expect(
      (await one(PROJECT_SCOPE, person("c", ["LEARNER"], { organisationId: null, organisationSource: "released", country: "CY" })))
        .countryMismatch
    ).toBe(true);
    // Staff organisations never follow a country.
    expect((await one(PROJECT_SCOPE, person("d", ["FACILITATOR"]), mapped)).countryMismatch).toBe(false);
  });

  it("never tells a partner admin, and reads no mapping for one", async () => {
    const m = await one(ORG_A, person("a", ["LEARNER"], { organisationSource: "released" }), [{ country: "DE", organisationId: "org-b" }]);
    expect(m.countryMismatch).toBe(false);
    expect(mappingFindMany).not.toHaveBeenCalled();
  });
});

describe("getAdminOrgs: what keeps an organisation from being deleted", () => {
  it("counts the people whose profile names it, and the countries mapped to it", async () => {
    organisationFindMany.mockImplementationOnce(async () => [
      { id: "org", name: "Org", shortName: "O", cohorts: [], countryMappings: [{ country: "DE" }], _count: { profiles: 3 } },
    ]);
    const [org] = (await getAdminOrgs(PROJECT_SCOPE)) ?? [];
    expect(org).toMatchObject({ people: 3, countries: ["DE"] });
  });
});

describe("getCountryMappings", () => {
  it("is an ADMIN's: no mapping for a partner admin or no scope, without asking the database", async () => {
    expect(await getCountryMappings(ORG_A)).toBeNull();
    expect(await getCountryMappings(NONE)).toBeNull();
    expect(mappingFindMany).not.toHaveBeenCalled();
  });

  it("reads the project's mapping for an ADMIN", async () => {
    mappingFindMany.mockImplementationOnce(async () => [{ country: "DE", organisationId: "org-a" }]);
    expect(await getCountryMappings(PROJECT_SCOPE)).toEqual([{ country: "DE", organisationId: "org-a" }]);
    expect(argsOf(mappingFindMany).where).toEqual({ projectId: "seq-elevate" });
  });
});
