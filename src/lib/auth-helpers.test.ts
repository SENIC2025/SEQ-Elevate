import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Release 3 (spec 18.1 UB4): requireCompleteProfile, the profile step's
 * gate in the hub and the five segment layouts. It sends a signed-in
 * person whose profile isn't complete — or can't be read — to /welcome,
 * lets guests and complete profiles through, and does nothing with
 * R3_PROFILE_GATE=off.
 */

/** redirect() ends the render by throwing; the tests read where to. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  // Only Next's own signals are thrown on: a test's database error isn't one.
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Redirected) throw e;
  },
}));
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));
const prisma = {
  user: { findUnique: vi.fn() },
  projectProfile: { findUnique: vi.fn() },
  membership: { findMany: vi.fn(async () => []) },
};
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/role-grants", () => ({ ensureProjectRoles: vi.fn() }));
// React's per-request cache: none in a test.
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const { requireCompleteProfile } = await import("./auth-helpers");
const { currentTermsVersion } = await import("./profile");

const complete = () => ({
  country: "DE",
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date(),
  consentAt: null,
});

/** Where the gate sent the page: the path, or null when it let it through. */
async function gate(locale = "en"): Promise<string | null> {
  try {
    await requireCompleteProfile(locale);
    return null;
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.R3_PROFILE_GATE;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  auth.mockResolvedValue({ user: { id: "u1" } });
  prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "ana@example.org", name: "Ana" });
  prisma.projectProfile.findUnique.mockResolvedValue(complete());
});

describe("requireCompleteProfile (UB4)", () => {
  it("lets a complete profile through", async () => {
    expect(await gate()).toBeNull();
  });

  it("lets a guest through (guests use /learner as before)", async () => {
    auth.mockResolvedValue(null);
    expect(await gate()).toBeNull();
    expect(prisma.projectProfile.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["no profile row", null],
    ["no country", { ...complete(), country: null }],
    ["an older Terms version", { ...complete(), termsVersion: "1999-01-01" }],
    ["no age rule confirmed", { ...complete(), ageConfirmedAt: null }],
  ])("sends %s to /welcome, in the page's language", async (_, profile) => {
    prisma.projectProfile.findUnique.mockResolvedValue(profile);
    expect(await gate("de")).toBe("/de/welcome");
  });

  it("sends a complete profile whose stored name is blank to /welcome (where the name is asked for)", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "ana@example.org", name: " " });
    expect(await gate()).toBe("/en/welcome");
  });

  it("reads the signed-in person's own profile", async () => {
    await gate();
    expect(prisma.projectProfile.findUnique.mock.calls[0][0].where).toEqual({
      userId_projectId: { userId: "u1", projectId: "seq-elevate" },
    });
  });

  it("fails towards the profile step when the profile can't be read", async () => {
    prisma.projectProfile.findUnique.mockRejectedValue(new Error("db down"));
    expect(await gate()).toBe("/en/welcome");
  });

  it("does nothing with R3_PROFILE_GATE=off", async () => {
    process.env.R3_PROFILE_GATE = "off";
    prisma.projectProfile.findUnique.mockResolvedValue(null);
    expect(await gate()).toBeNull();
    expect(prisma.projectProfile.findUnique).not.toHaveBeenCalled();
  });
});
