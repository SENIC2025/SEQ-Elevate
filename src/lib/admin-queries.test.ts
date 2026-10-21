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
const membershipFindMany = vi.fn(async (): Promise<unknown[]> => []);
const auditFindMany = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organisation: { findMany: organisationFindMany },
    membership: { findMany: membershipFindMany },
    auditLog: { findMany: auditFindMany },
  },
}));

const { getAdminOrgs, getAdminMembers } = await import("./admin-queries");
const { membershipsInScope, organisationsInScope } = await import("./scope");

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

const row = (userId: string, role: string, over: Record<string, unknown> = {}) => ({
  userId,
  role,
  cohortId: null,
  cohort: null,
  createdAt: new Date("2026-11-20T09:00:00Z"),
  user: {
    email: `${userId}@example.test`,
    name: userId,
    emailVerified: new Date(),
    profiles: [{ organisationId: "org-a", country: "DE", organisation: { name: "Org A" } }],
  },
  ...over,
});

describe("getAdminMembers, for the viewer's scope (FD-U11)", () => {
  it("answers null for no scope, without asking the database", async () => {
    expect(await getAdminMembers(NONE)).toBeNull();
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it("reads every membership of the project for an ADMIN", async () => {
    await getAdminMembers(PROJECT_SCOPE);
    expect(argsOf(membershipFindMany).where).toEqual(membershipsInScope(PROJECT_SCOPE));
  });

  it("reads only the people of the partner admin's organisation, never an ADMIN holder or ADMIN_EMAILS", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.test");
    await getAdminMembers(ORG_A);
    const where = argsOf(membershipFindMany).where;
    expect(where).toEqual(membershipsInScope(ORG_A));
    const text = JSON.stringify(where);
    expect(text).toContain('"organisationId":"org-a"');
    expect(text).toContain('"role":"ADMIN"');
    expect(text).toContain("boss@example.test");
  });

  it("gives each person's organisation and country from their profile, not from a membership row", async () => {
    membershipFindMany.mockImplementation(async () => [
      row("ana", "LEARNER", { organisation: { name: "Old row's organisation" } }),
      row("ana", "FACILITATOR"),
    ]);
    const [ana] = (await getAdminMembers(PROJECT_SCOPE)) ?? [];
    expect(ana).toMatchObject({
      id: "ana",
      roles: ["LEARNER", "FACILITATOR"],
      organisationId: "org-a",
      orgName: "Org A",
      country: "DE",
    });
    const select = JSON.stringify(argsOf(membershipFindMany));
    expect(select).toContain('"profiles"');
    expect(select).not.toContain('"organisation":true');
  });

  it("reads profiles of this project only, and no more of the user than the screen shows", async () => {
    await getAdminMembers(PROJECT_SCOPE);
    const args = argsOf(membershipFindMany) as { include?: unknown; select?: { user?: { select?: Record<string, unknown> } } };
    expect(args.include).toBeUndefined();
    const user = args.select?.user?.select ?? {};
    expect(Object.keys(user).sort()).toEqual(["email", "emailVerified", "name", "profiles"]);
    expect(user.profiles).toMatchObject({ where: { projectId: "seq-elevate" } });
  });
});
