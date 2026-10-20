import { describe, it, expect, afterEach, vi } from "vitest";

/*
 * Roles on the People screen. An admin who switched off their own Admin
 * role would lose the screen at once, and only another admin could give it
 * back, so the server refuses that, as it refuses removing oneself. Other
 * roles on one's own row, and another admin's Admin role, can still change.
 */

const ME = { id: "admin-1", email: "admin@example.org" };
const getCurrentUser = vi.fn();
const hasRole = vi.fn();
const prisma = {
  membership: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, hasRole }));
vi.mock("@/lib/admin-queries", () => ({
  getAdminMembers: vi.fn(async () => []),
  getAdminOrgs: vi.fn(async () => []),
}));
vi.mock("@/lib/invitations", () => ({ sendInvitation: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma }));

const { setMemberRoles, removeMember } = await import("./admin");

/** Signed in as ME, an admin; `userId` holds `roles` in the project. */
function given(roles: string[]) {
  getCurrentUser.mockResolvedValue(ME);
  hasRole.mockImplementation(async (_p: string, r: string) => r === "ADMIN");
  prisma.membership.findMany.mockResolvedValue(
    roles.map((role, i) => ({
      id: `m-${i}`,
      role,
      organisationId: null,
      cohortId: null,
    }))
  );
  prisma.membership.create.mockResolvedValue({});
  prisma.membership.delete.mockResolvedValue({});
  prisma.membership.deleteMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({});
}

const changedAnything = () =>
  prisma.membership.create.mock.calls.length +
    prisma.membership.delete.mock.calls.length +
    prisma.membership.deleteMany.mock.calls.length +
    prisma.auditLog.create.mock.calls.length >
  0;

describe("setMemberRoles on your own row", () => {
  afterEach(() => vi.clearAllMocks());

  it("refuses switching off your own Admin role, and changes nothing", async () => {
    given(["ADMIN", "FACILITATOR"]);
    await expect(setMemberRoles(ME.id, ["FACILITATOR"])).resolves.toEqual({
      ok: false,
      error: "own-admin",
    });
    expect(changedAnything()).toBe(false);
  });

  it("refuses it when Admin goes and another role comes", async () => {
    given(["ADMIN"]);
    await expect(setMemberRoles(ME.id, ["CONTENT_EDITOR"])).resolves.toEqual({
      ok: false,
      error: "own-admin",
    });
    expect(changedAnything()).toBe(false);
  });

  it("lets you switch your other roles on and off, keeping Admin", async () => {
    given(["ADMIN"]);
    const res = await setMemberRoles(ME.id, ["ADMIN", "FACILITATOR"]);
    expect(res.ok).toBe(true);
    expect(prisma.membership.create).toHaveBeenCalledTimes(1);
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });
});

describe("setMemberRoles on someone else's row", () => {
  afterEach(() => vi.clearAllMocks());

  it("lets an admin switch off another admin's Admin role", async () => {
    given(["ADMIN", "CONTENT_EDITOR"]);
    const res = await setMemberRoles("admin-2", ["CONTENT_EDITOR"]);
    expect(res.ok).toBe(true);
    expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: "m-0" } });
  });

  it("is for admins only", async () => {
    given(["ADMIN"]);
    hasRole.mockResolvedValue(false);
    await expect(setMemberRoles("admin-2", ["LEARNER"])).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(changedAnything()).toBe(false);
  });
});

describe("removeMember", () => {
  afterEach(() => vi.clearAllMocks());

  it("still refuses removing yourself", async () => {
    given(["ADMIN"]);
    await expect(removeMember(ME.id)).resolves.toEqual({ ok: false, error: "self" });
    expect(changedAnything()).toBe(false);
  });

  it("removes someone else's roles and cohort, and nothing more", async () => {
    given(["LEARNER"]);
    const res = await removeMember("learner-1");
    expect(res.ok).toBe(true);
    expect(prisma.membership.deleteMany).toHaveBeenCalledWith({
      where: { userId: "learner-1", projectId: "seq-elevate" },
    });
  });
});
