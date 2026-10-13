import { describe, it, expect, afterEach, vi } from "vitest";

// A facilitator's note or validation lands on another person's record, so
// both writes must check who is writing (FACILITATOR or ADMIN of the
// project) and about whom (a LEARNER of the project), and refuse anything
// else, including when either can't be checked.
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
