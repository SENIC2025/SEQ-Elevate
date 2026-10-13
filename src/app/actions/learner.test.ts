import { describe, it, expect, afterEach, vi } from "vitest";

// The learner store calls ensureLearnerMembership on every signed-in page
// load, staff included. These tests pin down who it may turn into a learner:
// only someone who holds no role in the project at all.
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const isBootstrapAdmin = vi.fn();
const membership = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
};
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, getProjectMemberships }));
vi.mock("@/lib/admin-bootstrap", () => ({ isBootstrapAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership } }));
vi.mock("@/lib/cms", () => ({ getCourse: vi.fn() }));

const { ensureLearnerMembership } = await import("./learner");

const USER = { id: "u1", email: "person@example.org" };
const roles = (...r: string[]) =>
  r.map((role) => ({ role, projectId: "seq-elevate" }));

/** Did the action add a membership row, by any route? */
const wroteMembership = () =>
  membership.create.mock.calls.length + membership.upsert.mock.calls.length > 0;

describe("ensureLearnerMembership", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([["ADMIN"], ["CONTENT_EDITOR"], ["FACILITATOR"]])(
    "leaves someone who holds %s without a learner role",
    async (role) => {
      getCurrentUser.mockResolvedValue(USER);
      getProjectMemberships.mockResolvedValue(roles(role));
      isBootstrapAdmin.mockReturnValue(false);
      membership.findFirst.mockResolvedValue(null);
      membership.findMany.mockResolvedValue(roles(role));
      await expect(ensureLearnerMembership()).resolves.toBe(true);
      expect(wroteMembership()).toBe(false);
    }
  );

  it("makes someone with no role in the project a learner", async () => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(false);
    membership.findFirst.mockResolvedValue(null);
    membership.findMany.mockResolvedValue([]);
    membership.upsert.mockResolvedValue({});
    membership.create.mockResolvedValue({});
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    const rows = [
      ...membership.create.mock.calls.map((c) => c[0].data),
      ...membership.upsert.mock.calls.map((c) => c[0].create),
    ];
    expect(rows).toEqual([
      { userId: "u1", projectId: "seq-elevate", role: "LEARNER" },
    ]);
  });

  it("doesn't make an ADMIN_EMAILS address a learner while its roles are still on their way", async () => {
    getCurrentUser.mockResolvedValue({ ...USER, email: "admin@example.org" });
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(true);
    membership.findFirst.mockResolvedValue(null);
    membership.findMany.mockResolvedValue([]);
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    expect(wroteMembership()).toBe(false);
  });

  it("fails, writing nothing, when the roles can't be read", async () => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockRejectedValue(new Error("db down"));
    isBootstrapAdmin.mockReturnValue(false);
    membership.findFirst.mockRejectedValue(new Error("db down"));
    membership.findMany.mockRejectedValue(new Error("db down"));
    await expect(ensureLearnerMembership()).rejects.toThrow();
    expect(wroteMembership()).toBe(false);
  });

  it("fails when no one is signed in (or the session lookup failed)", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(ensureLearnerMembership()).rejects.toThrow();
    expect(wroteMembership()).toBe(false);
  });
});
