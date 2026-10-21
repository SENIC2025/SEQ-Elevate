import { describe, it, expect, afterEach, vi } from "vitest";

// A facilitator's note or validation lands on another person's record, so
// both writes must check who is writing (FACILITATOR, PARTNER_ADMIN or ADMIN
// of the project), whether the person is in the writer's scope (their own
// organisation, or the whole project for an ADMIN: D74), and about whom (a
// learner of the project: LEARNER and no staff role there), and refuse
// anything else, including when any of it can't be checked.
vi.mock("server-only", () => ({}));
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const hasRole = vi.fn();
const getViewer = vi.fn();
const prisma = {
  membership: { findMany: vi.fn(), findFirst: vi.fn() },
  // inScope's one count: is the learner one of the people in the scope?
  user: { count: vi.fn() },
  compCard: { findUnique: vi.fn() },
  observation: { create: vi.fn() },
  validation: { create: vi.fn() },
  auditLog: { create: vi.fn() },
};
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser,
  getProjectMemberships,
  hasRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma }));
// The viewer is stood in for; inScope and the builders are the real ones.
vi.mock("@/lib/scope", async (original) => ({
  ...(await original<typeof import("@/lib/scope")>()),
  getViewer: () => getViewer(),
}));

const { saveObservation, recordValidation } = await import("./facilitator");

const STAFF = { id: "staff-1", email: "fac@example.org" };
const rows = (...roles: string[]) =>
  roles.map((role) => ({ role, projectId: "seq-elevate" }));
const ORG_A = { kind: "organisation", viewerId: STAFF.id, organisationId: "org-a" } as const;
const PROJECT_SCOPE = { kind: "project", viewerId: STAFF.id, viewerOrganisationId: null } as const;

/**
 * The viewer holds `viewer` (with the scope those roles give: an ADMIN the
 * project, anyone else organisation A); the person written about holds
 * `target` and is in that scope.
 */
function given(viewer: string[], target: string[]) {
  getCurrentUser.mockResolvedValue(STAFF);
  getProjectMemberships.mockResolvedValue(rows(...viewer));
  hasRole.mockImplementation(async (_p: string, r: string) => viewer.includes(r));
  getViewer.mockResolvedValue({
    user: STAFF,
    roles: viewer,
    profile: null,
    scope: viewer.includes("ADMIN") ? PROJECT_SCOPE : ORG_A,
  });
  prisma.user.count.mockResolvedValue(1);
  prisma.membership.findMany.mockResolvedValue(rows(...target));
  prisma.membership.findFirst.mockResolvedValue(target.length ? rows(...target)[0] : null);
  prisma.compCard.findUnique.mockResolvedValue(null);
  prisma.observation.create.mockResolvedValue({});
  prisma.validation.create.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});
}

const wroteAnything = () =>
  prisma.observation.create.mock.calls.length +
    prisma.validation.create.mock.calls.length +
    prisma.auditLog.create.mock.calls.length >
  0;

const both = [
  ["saveObservation", () => saveObservation("learner-1", "Listened well")],
  ["recordValidation", () => recordValidation("learner-1", "communicationEi", "Seen")],
] as const;

describe.each(both)("%s", (_name, call) => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it.each([["FACILITATOR"], ["PARTNER_ADMIN"], ["ADMIN"]])("lets a %s write about a learner in their scope", async (role) => {
    given([role], ["LEARNER"]);
    await expect(call()).resolves.toEqual({ ok: true });
    expect(wroteAnything()).toBe(true);
  });

  it("refuses a person who isn't in the project", async () => {
    given(["FACILITATOR"], []);
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  it("refuses a person who is staff but not a learner", async () => {
    given(["FACILITATOR"], ["CONTENT_EDITOR"]);
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  // Before Release 0 every signed-in page gave its visitor the LEARNER role,
  // and those rows were left in place, so a colleague can still hold one.
  it.each([["FACILITATOR"], ["ADMIN"], ["CONTENT_EDITOR"]])(
    "refuses staff (%s) who still hold an old LEARNER role",
    async (staffRole) => {
      given(["FACILITATOR"], ["LEARNER", staffRole]);
      await expect(call()).resolves.toEqual({ ok: false });
      expect(wroteAnything()).toBe(false);
    }
  );

  it.each([[["LEARNER"]], [["CONTENT_EDITOR"]], [[]]])(
    "refuses a writer holding %j",
    async (viewer) => {
      given(viewer, ["LEARNER"]);
      await expect(call()).resolves.toEqual({ ok: false });
      expect(wroteAnything()).toBe(false);
    }
  );

  it("refuses when no one is signed in", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    getCurrentUser.mockResolvedValue(null);
    getViewer.mockResolvedValue({ user: null, roles: [], profile: null, scope: { kind: "none" } });
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  it("refuses, writing nothing, when the learner's place can't be checked", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.membership.findMany.mockRejectedValue(new Error("db down"));
    prisma.membership.findFirst.mockRejectedValue(new Error("db down"));
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });
});

/*
 * FD-U12 (D74, spec 3.4 SP6, SP7): a note or validation is about a learner
 * in the writer's scope. Partner staff write only about their own
 * organisation's learners, and staff with no organisation (or with the
 * partner switch off, or an incomplete profile of their own: scope none)
 * write about no one.
 */
describe.each(both)("%s, by scope (FD-U12)", (_name, call) => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("refuses a learner of another organisation, writing nothing", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    prisma.user.count.mockResolvedValue(0);
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  it("asks whether the learner is one of the people of the writer's organisation", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    await call();
    const where = JSON.stringify(prisma.user.count.mock.calls[0]?.[0]);
    expect(where).toContain('"id":"learner-1"');
    expect(where).toContain('"organisationId":"org-a"');
  });

  it.each([["FACILITATOR"], ["PARTNER_ADMIN"]])(
    "refuses a %s with no scope (no organisation, partner access off, or an incomplete profile)",
    async (role) => {
      given([role], ["LEARNER"]);
      getViewer.mockResolvedValue({ user: STAFF, roles: [role], profile: null, scope: { kind: "none" } });
      await expect(call()).resolves.toEqual({ ok: false });
      expect(wroteAnything()).toBe(false);
      expect(prisma.user.count).not.toHaveBeenCalled();
    }
  );

  it("refuses an ADMIN without project scope", async () => {
    given(["ADMIN"], ["LEARNER"]);
    getViewer.mockResolvedValue({ user: STAFF, roles: ["ADMIN"], profile: null, scope: { kind: "none" } });
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  it("refuses, writing nothing, when the scope can't be checked", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.user.count.mockRejectedValue(new Error("db down"));
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });

  it("lets an ADMIN write about any learner of the project", async () => {
    given(["ADMIN"], ["LEARNER"]);
    await expect(call()).resolves.toEqual({ ok: true });
    const where = JSON.stringify(prisma.user.count.mock.calls[0]?.[0]);
    expect(where).not.toContain("organisationId");
  });
});

describe("who a note or validation may be about", () => {
  afterEach(() => vi.clearAllMocks());

  // Staff who opened a learner page before Release 0 still hold a LEARNER
  // role, so the learner check alone would let them validate themselves.
  it.each(both)("%s refuses a writer writing about themselves", async (_name, call) => {
    given(["FACILITATOR", "LEARNER"], ["FACILITATOR", "LEARNER"]);
    getCurrentUser.mockResolvedValue({ ...STAFF, id: "learner-1" });
    getViewer.mockResolvedValue({ user: { ...STAFF, id: "learner-1" }, roles: ["FACILITATOR", "LEARNER"], profile: null, scope: ORG_A });
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  });
});

describe("what a note or validation may hold", () => {
  afterEach(() => vi.clearAllMocks());

  const refused = async (call: () => Promise<unknown>) => {
    given(["FACILITATOR"], ["LEARNER"]);
    await expect(call()).resolves.toEqual({ ok: false });
    expect(wroteAnything()).toBe(false);
  };

  it("refuses a note that is too long", () =>
    refused(() => saveObservation("learner-1", "a".repeat(2001))));

  it("refuses a note that isn't text", () =>
    refused(() => saveObservation("learner-1", 5 as unknown as string)));

  it("refuses evidence that isn't text, instead of failing with an error", () =>
    refused(() => recordValidation("learner-1", "communicationEi", 5 as unknown as string)));

  it("refuses evidence that is too long", () =>
    refused(() => recordValidation("learner-1", "communicationEi", "a".repeat(2001))));

  it("refuses a cluster that isn't one of the skill clusters", () =>
    refused(() => recordValidation("learner-1", "<anything>")));

  it("takes a note at the length limit, and a validation with no evidence", async () => {
    given(["FACILITATOR"], ["LEARNER"]);
    await expect(saveObservation("learner-1", "a".repeat(2000))).resolves.toEqual({ ok: true });
    await expect(recordValidation("learner-1", "teamwork")).resolves.toEqual({ ok: true });
    expect(prisma.validation.create.mock.calls[0][0].data).toMatchObject({
      cluster: "teamwork",
      evidence: null,
    });
  });
});
