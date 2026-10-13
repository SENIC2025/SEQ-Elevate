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
const badge = { findUnique: vi.fn() };
const userBadge = { upsert: vi.fn() };
vi.mock("@/lib/prisma", () => ({ prisma: { membership, badge, userBadge } }));
vi.mock("@/lib/cms", () => ({ getCourse: vi.fn() }));

const { ensureLearnerMembership, awardBadgeAction } = await import("./learner");

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

describe("awardBadgeAction", () => {
  afterEach(() => vi.clearAllMocks());

  // Not thrown: the store and the guest migration try a thrown award again
  // for 15 s, as if the connection had dropped, and this one can't succeed.
  it("answers no-badge, rather than as if saved or with an error worth retrying, when the badge doesn't exist", async () => {
    getCurrentUser.mockResolvedValue(USER);
    badge.findUnique.mockResolvedValue(null);
    await expect(awardBadgeAction("no-such-badge", "u1")).resolves.toEqual({
      ok: false,
      reason: "no-badge",
    });
    expect(userBadge.upsert).not.toHaveBeenCalled();
  });

  it("saves the badge for the learner", async () => {
    getCurrentUser.mockResolvedValue(USER);
    badge.findUnique.mockResolvedValue({ id: "b1", slug: "x-complete" });
    userBadge.upsert.mockResolvedValue({});
    await expect(awardBadgeAction("x-complete", "u1")).resolves.toEqual({ ok: true });
    expect(userBadge.upsert).toHaveBeenCalledWith({
      where: { userId_badgeId: { userId: "u1", badgeId: "b1" } },
      create: { userId: "u1", badgeId: "b1" },
      update: {},
    });
  });

  it("refuses an award meant for another account, without throwing", async () => {
    getCurrentUser.mockResolvedValue(USER);
    await expect(awardBadgeAction("x-complete", "someone-else")).resolves.toEqual({
      ok: false,
      reason: "other-account",
    });
    expect(badge.findUnique).not.toHaveBeenCalled();
    expect(userBadge.upsert).not.toHaveBeenCalled();
  });
});
