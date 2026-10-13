import { describe, it, expect, afterEach, vi } from "vitest";

// A facilitator's note or validation lands on another person's record, so
// both writes must check who is writing (FACILITATOR or ADMIN of the
// project) and about whom (a learner of the project: LEARNER and no staff
// role there), and refuse anything else, including when either can't be
// checked.
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const hasRole = vi.fn();
const prisma = {
  membership: { findMany: vi.fn(), findFirst: vi.fn() },
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

const { saveObservation, recordValidation } = await import("./facilitator");

const STAFF = { id: "staff-1", email: "fac@example.org" };
const rows = (...roles: string[]) =>
  roles.map((role) => ({ role, projectId: "seq-elevate" }));

/** The viewer holds `viewer`; the person written about holds `target`. */
function given(viewer: string[], target: string[]) {
  getCurrentUser.mockResolvedValue(STAFF);
  getProjectMemberships.mockResolvedValue(rows(...viewer));
  hasRole.mockImplementation(async (_p: string, r: string) => viewer.includes(r));
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

  it.each([["FACILITATOR"], ["ADMIN"]])("lets a %s write about a learner of the project", async (role) => {
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

describe("who a note or validation may be about", () => {
  afterEach(() => vi.clearAllMocks());

  // Staff who opened a learner page before Release 0 still hold a LEARNER
  // role, so the learner check alone would let them validate themselves.
  it.each(both)("%s refuses a writer writing about themselves", async (_name, call) => {
    given(["FACILITATOR", "LEARNER"], ["FACILITATOR", "LEARNER"]);
    getCurrentUser.mockResolvedValue({ ...STAFF, id: "learner-1" });
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
