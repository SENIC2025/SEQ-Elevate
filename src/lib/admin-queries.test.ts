import { describe, it, expect, vi } from "vitest";

/*
 * Organisations & cohorts says how many people are in a cohort, on its
 * badge and when its bin asks "Its N members will have no cohort". Someone
 * with two roles (Learner and Facilitator) has two memberships in it: they
 * are one member. The database is stood in for by what it answers for this
 * cohort, which holds Ana (two roles) and Ben (one).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({
  getProjectMemberships: async () => [{ role: "ADMIN" }],
}));

const memberships = [{ userId: "ana" }, { userId: "ana" }, { userId: "ben" }];
const organisationFindMany = vi.fn(async () => [
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
vi.mock("@/lib/prisma", () => ({
  prisma: { organisation: { findMany: organisationFindMany } },
}));

const { getAdminOrgs } = await import("./admin-queries");

describe("getAdminOrgs", () => {
  it("counts the people in a cohort, not their roles", async () => {
    const [org] = (await getAdminOrgs()) ?? [];
    expect(org.cohorts[0].memberCount).toBe(2);
  });
});
