import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Demo sign-in (D98, spec 5.8, 13.8): opt-in, never on production, and the
 * demo person gets a complete profile with the CURRENT Terms version at
 * every demo sign-in, so the showcase doesn't stop at the profile step
 * (which compares versions). A demo learner gets the organisation its
 * country maps to, as the profile step would give it; demo staff get none
 * (staff organisations are an ADMIN's to set).
 */

vi.mock("server-only", () => ({}));
// Consent can be asked for only once the consent text is final (a draft's
// version starts "draft-", r3-switches.ts): these tests read the rules as
// they are then.
vi.mock("@/messages/en.json", async (importOriginal) => {
  const { default: en } = await importOriginal<{ default: typeof import("@/messages/en.json") }>();
  return { default: { ...en, profile: { ...en.profile, consent: { ...en.profile.consent, version: "2026-11-30" } } } };
});
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Map([["x-forwarded-proto", "https"]]),
}));
const setPersonOrganisation = vi.fn(async () => ({ changed: true }));
vi.mock("@/lib/person-organisation", () => ({ setPersonOrganisation }));

const firstDone = new Date("2026-11-20T09:00:00Z");
const tx = {
  projectProfile: {
    findUnique: vi.fn(async (): Promise<{ profileCompletedAt: Date | null } | null> => null),
    upsert: vi.fn(async (): Promise<{ id: string; organisationId: string | null }> => ({ id: "pp-1", organisationId: null })),
  },
  countryMapping: { findUnique: vi.fn(async (): Promise<unknown> => ({ organisationId: "seq-elevate-proarbeit" })) },
};
const prisma = {
  user: { upsert: vi.fn(async () => ({ id: "demo-user" })) },
  membership: { upsert: vi.fn(async () => ({})) },
  session: { create: vi.fn(async () => ({})) },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
vi.mock("@/lib/prisma", () => ({ prisma }));

const { demoSignIn } = await import("./demo");
const { currentTermsVersion, isProfileComplete, profileRules } = await import("@/lib/profile");

const CODE = "a-private-code-1";

beforeEach(() => {
  vi.stubEnv("DEMO_LOGIN_ENABLED", "true");
  vi.stubEnv("DEMO_ACCESS_CODE", CODE);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PROFILE_CONSENT", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const profileWrite = () =>
  (tx.projectProfile.upsert.mock.calls.at(-1) as unknown[] | undefined)?.[0] as {
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };

describe("demoSignIn", () => {
  it("writes a complete profile with the current Terms version", async () => {
    await expect(demoSignIn("demo-learner", CODE)).resolves.toMatchObject({ ok: true });
    const write = profileWrite();
    expect(write.where).toEqual({ userId_projectId: { userId: "demo-user", projectId: "seq-elevate" } });
    for (const answers of [write.create, write.update]) {
      expect(answers.termsVersion).toBe(currentTermsVersion());
      expect(isProfileComplete({ name: "Demo Learner" }, answers as never, profileRules())).toBe(true);
      // Only setPersonOrganisation writes a person's organisation (D101).
      expect(answers).not.toHaveProperty("organisationId");
    }
  });

  it("marks the profile completed, keeping the time of the first completion", async () => {
    await demoSignIn("demo-learner", CODE);
    expect(profileWrite().create.profileCompletedAt).toBeInstanceOf(Date);
    tx.projectProfile.findUnique.mockResolvedValueOnce({ profileCompletedAt: firstDone });
    await demoSignIn("demo-learner", CODE);
    expect(profileWrite().update.profileCompletedAt).toBe(firstDone);
  });

  it("records consent too where the profile step requires it", async () => {
    vi.stubEnv("PROFILE_CONSENT", "required");
    await demoSignIn("demo-learner", CODE);
    expect(isProfileComplete({ name: "Demo Learner" }, profileWrite().update as never, profileRules())).toBe(true);
  });

  it("gives a demo learner without an organisation the one its country maps to", async () => {
    await demoSignIn("demo-learner", CODE);
    expect(tx.countryMapping.findUnique).toHaveBeenCalledWith({
      where: { projectId_country: { projectId: "seq-elevate", country: "DE" } },
      select: { organisationId: true },
    });
    expect(setPersonOrganisation).toHaveBeenCalledWith(tx, "demo-user", "seq-elevate-proarbeit", {
      actorId: null,
      source: "country",
    });
  });

  it("keeps a demo learner's organisation once it has one", async () => {
    tx.projectProfile.upsert.mockResolvedValueOnce({ id: "pp-1", organisationId: "seq-elevate-uom" });
    await demoSignIn("demo-learner", CODE);
    expect(setPersonOrganisation).not.toHaveBeenCalled();
  });

  it.each(["demo-admin", "demo123", "demo321"])("never gives demo staff (%s) an organisation", async (id) => {
    await demoSignIn(id, CODE);
    expect(profileWrite()).toBeTruthy();
    expect(setPersonOrganisation).not.toHaveBeenCalled();
  });

  it("writes nothing where demo sign-in isn't allowed, or with the wrong code", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(demoSignIn("demo-learner", CODE)).resolves.toEqual({ ok: false, error: "disabled" });
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(demoSignIn("demo-learner", "wrong-code-123")).resolves.toEqual({ ok: false, error: "bad-code" });
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(tx.projectProfile.upsert).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
