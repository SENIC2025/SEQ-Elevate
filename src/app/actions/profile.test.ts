import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Release 3 (spec 18.1 UB2): completeProfile, the profile step's action.
 * The organisation comes from the country mapping only on the first
 * completion and only for someone who holds no staff role and has none; a
 * partner admin's organisation that the country doesn't match is released;
 * a second call changes nothing but the Terms, the consent and a blank
 * name; the learner membership is made only for someone with no role.
 *
 * The database is a small in-memory stand-in: the profile row, the user's
 * name, their roles, the mapping and the log, each written like the table.
 */

const getCurrentUser = vi.fn();
const isBootstrapAdmin = vi.fn((email: string | null) => email === "boot@example.org");
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/admin-bootstrap", () => ({ isBootstrapAdmin }));

/** Every call of the one writer of a person's organisation. */
const setPersonOrganisation = vi.fn(async (_tx: unknown, _userId: string, organisationId: string | null, by: { source: string }) => {
  if (profile) Object.assign(profile, { organisationId, organisationSource: by.source });
  return { changed: true };
});
vi.mock("@/lib/person-organisation", () => ({ setPersonOrganisation }));

type Row = Record<string, unknown>;
let profile: Row | null;
let user: { id: string; email: string; name: string | null };
let roles: string[];
let mapping: Record<string, string>;
const log: Row[] = [];
const sql: string[] = [];

const db = {
  projectProfile: {
    createMany: vi.fn(async () => {
      profile ??= {
        id: "pp-1",
        country: null,
        organisationId: null,
        organisationSource: null,
        profileCompletedAt: null,
        termsVersion: null,
        ageConfirmedAt: null,
        consentVersion: null,
        consentAt: null,
        guardianConsentRecordedAt: null,
      };
      return { count: 1 };
    }),
    findUnique: vi.fn(async () => (profile ? { ...profile } : null)),
    update: vi.fn(async ({ data }: { data: Row }) => {
      Object.assign(profile!, data);
      return profile;
    }),
  },
  user: {
    findUnique: vi.fn(async () => ({ name: user.name, email: user.email })),
    update: vi.fn(async ({ data }: { data: { name: string } }) => {
      user.name = data.name;
      return user;
    }),
  },
  membership: {
    findMany: vi.fn(async () => roles.map((role) => ({ role }))),
    createMany: vi.fn(async ({ data }: { data: { role: string }[] }) => {
      for (const d of data) if (!roles.includes(d.role)) roles.push(d.role);
      return { count: data.length };
    }),
    updateMany: vi.fn(),
  },
  countryMapping: {
    findUnique: vi.fn(async ({ where }: { where: { projectId_country: { country: string } } }) => {
      const organisationId = mapping[where.projectId_country.country];
      return organisationId ? { organisationId } : null;
    }),
  },
  auditLog: { create: vi.fn(async ({ data }: { data: Row }) => log.push(data)) },
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    sql.push(strings.join("?").replace(/\s+/g, " ").trim());
    return [];
  }),
};
// A refusal thrown inside rolls back: the profile as it was before.
const prisma = {
  ...db,
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => {
    const before = profile ? { ...profile } : null;
    const name = user.name;
    try {
      return await fn(db);
    } catch (e) {
      profile = before;
      user.name = name;
      throw e;
    }
  }),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));

const { completeProfile } = await import("./profile");
const { currentTermsVersion } = await import("@/lib/profile");

const TERMS = currentTermsVersion();
const FIRST = { name: "Ana", country: "DE", termsAccepted: true, age: "self" };

/** A profile the step completed before, in `organisationId`. */
const completedProfile = (over: Row = {}): Row => ({
  id: "pp-1",
  country: "DE",
  organisationId: "org-a",
  organisationSource: "country",
  profileCompletedAt: new Date("2026-11-20T10:00:00Z"),
  termsVersion: TERMS,
  ageConfirmedAt: new Date("2026-11-20T10:00:00Z"),
  consentVersion: null,
  consentAt: null,
  guardianConsentRecordedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  profile = null;
  user = { id: "u1", email: "ana@example.org", name: null };
  roles = [];
  mapping = { DE: "org-a", CY: "org-b", BE: "org-d", OTHER: "org-d" };
  log.length = 0;
  sql.length = 0;
  getCurrentUser.mockResolvedValue({ ...user });
  delete process.env.PROFILE_CONSENT;
  delete process.env.AGE_RULE;
});

describe("completeProfile: the first completion", () => {
  it("stores the country, the Terms version and time, the age rule and the time, and the name", async () => {
    await expect(completeProfile(FIRST)).resolves.toEqual({ ok: true });
    expect(profile).toMatchObject({
      country: "DE",
      termsVersion: TERMS,
      ageRule: "SELF_MIN_AGE",
    });
    for (const at of ["termsAcceptedAt", "ageConfirmedAt", "profileCompletedAt"]) expect(profile?.[at]).toBeInstanceOf(Date);
    expect(user.name).toBe("Ana");
  });

  it("locks the person's own profile row (made first if there is none) before reading it", async () => {
    await completeProfile(FIRST);
    expect(db.projectProfile.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", projectId: "seq-elevate" }],
      skipDuplicates: true,
    });
    expect(sql).toEqual(['SELECT 1 FROM "ProjectProfile" WHERE "userId" = ? AND "projectId" = ? FOR UPDATE']);
    expect(db.projectProfile.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.projectProfile.findUnique.mock.invocationCallOrder[0]
    );
  });

  it("gives someone with no organisation the one their country maps to, as the profile step (source country)", async () => {
    await completeProfile({ ...FIRST, country: "CY" });
    expect(setPersonOrganisation).toHaveBeenCalledTimes(1);
    expect(setPersonOrganisation.mock.calls[0].slice(1)).toEqual(["u1", "org-b", { actorId: null, source: "country" }]);
  });

  it("gives none for a country that isn't mapped (only DIESIS and SENIC see them)", async () => {
    delete mapping.GR;
    await completeProfile({ ...FIRST, country: "GR" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(profile?.organisationId).toBeNull();
  });

  it.each([["admin"], ["backfill"]])("keeps an organisation set by %s, whatever the country", async (source) => {
    profile = { ...completedProfile({ organisationId: "org-a", organisationSource: source }), profileCompletedAt: null, country: null, termsVersion: null, ageConfirmedAt: null };
    await completeProfile({ ...FIRST, country: "CY" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(profile?.organisationId).toBe("org-a");
    expect(log.map((l) => l.action)).toEqual(["profile.completed"]);
  });

  it("releases a partner admin's organisation when the country maps elsewhere, and logs it without personal data", async () => {
    profile = { ...completedProfile({ organisationId: "org-a", organisationSource: "partner-admin" }), profileCompletedAt: null, country: null, termsVersion: null, ageConfirmedAt: null };
    await completeProfile({ ...FIRST, country: "CY" });
    expect(setPersonOrganisation.mock.calls.map((c) => c.slice(1))).toEqual([["u1", null, { actorId: null, source: "released" }]]);
    expect(profile).toMatchObject({ organisationId: null, organisationSource: "released" });
    const released = log.find((l) => l.action === "profile.organisation_released");
    expect(released).toEqual({
      projectId: "seq-elevate",
      actorId: "u1",
      action: "profile.organisation_released",
      entity: "ProjectProfile",
      entityId: "pp-1",
    });
  });

  it("releases it too when the country isn't mapped at all", async () => {
    delete mapping.GR;
    profile = { ...completedProfile({ organisationId: "org-a", organisationSource: "partner-admin" }), profileCompletedAt: null, country: null, termsVersion: null, ageConfirmedAt: null };
    await completeProfile({ ...FIRST, country: "GR" });
    expect(profile).toMatchObject({ organisationId: null, organisationSource: "released" });
  });

  it("keeps a partner admin's organisation when the country maps to it", async () => {
    profile = { ...completedProfile({ organisationId: "org-a", organisationSource: "partner-admin" }), profileCompletedAt: null, country: null, termsVersion: null, ageConfirmedAt: null };
    await completeProfile({ ...FIRST, country: "DE" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(profile?.organisationId).toBe("org-a");
  });

  it.each([["FACILITATOR"], ["PARTNER_ADMIN"], ["CONTENT_EDITOR"], ["ADMIN"]])(
    "never sets or releases the organisation of someone holding %s",
    async (role) => {
      roles = [role];
      await completeProfile({ ...FIRST, country: "CY" });
      profile = { ...completedProfile({ organisationId: "org-a", organisationSource: "partner-admin" }), profileCompletedAt: null };
      await completeProfile({ ...FIRST, country: "CY" });
      expect(setPersonOrganisation).not.toHaveBeenCalled();
    }
  );

  it("never sets the organisation of an ADMIN_EMAILS address whose roles are on their way", async () => {
    user.email = "boot@example.org";
    getCurrentUser.mockResolvedValue({ ...user });
    await completeProfile({ ...FIRST, country: "CY" });
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(roles).toEqual([]);
  });

  it("makes someone with no role a learner, once the profile is complete", async () => {
    await completeProfile(FIRST);
    expect(db.membership.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", projectId: "seq-elevate", role: "LEARNER" }],
      skipDuplicates: true,
    });
    expect(roles).toEqual(["LEARNER"]);
  });

  it("never gives staff a learner role, and never writes across their rows", async () => {
    roles = ["FACILITATOR"];
    await completeProfile(FIRST);
    expect(db.membership.createMany).not.toHaveBeenCalled();
    expect(db.membership.updateMany).not.toHaveBeenCalled();
    expect(roles).toEqual(["FACILITATOR"]);
  });

  it("logs the completion by the profile's id, with no metadata", async () => {
    await completeProfile(FIRST);
    expect(log).toEqual([
      { projectId: "seq-elevate", actorId: "u1", action: "profile.completed", entity: "ProjectProfile", entityId: "pp-1" },
    ]);
  });

  it("stores the invited age rule only where an inviter recorded a guardian's permission", async () => {
    await expect(completeProfile({ ...FIRST, age: "invited" })).resolves.toEqual({
      ok: false,
      errors: { age: "not-invited" },
    });
    expect(profile).toBeNull();
    profile = { ...completedProfile({ organisationId: "org-a", organisationSource: "partner-admin", guardianConsentRecordedAt: new Date() }), profileCompletedAt: null, country: null, termsVersion: null, ageConfirmedAt: null };
    await expect(completeProfile({ ...FIRST, age: "invited" })).resolves.toEqual({ ok: true });
    expect(profile?.ageRule).toBe("INVITED_WITH_GUARDIAN_CONSENT");
  });

  it("answers per field, writing nothing, when the Terms, the age or the name are missing", async () => {
    await expect(completeProfile({ country: "DE" })).resolves.toEqual({
      ok: false,
      errors: { name: "empty", terms: "required", age: "required" },
    });
    expect(profile).toBeNull();
    expect(user.name).toBeNull();
    expect(log).toEqual([]);
    expect(db.membership.createMany).not.toHaveBeenCalled();
  });

  it("answers signed-out, without reading anything, when no one is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(completeProfile(FIRST)).resolves.toEqual({ ok: false, error: "signed-out" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("completeProfile: later calls (UB2)", () => {
  beforeEach(() => {
    user.name = "Ana";
    getCurrentUser.mockResolvedValue({ ...user });
    roles = ["LEARNER"];
    profile = completedProfile();
  });

  it("a direct second call with another country, age, organisation or name changes nothing", async () => {
    const before = { ...profile };
    await expect(
      completeProfile({ name: "Someone else", country: "CY", age: "invited", termsAccepted: true, organisationId: "org-b" })
    ).resolves.toEqual({ ok: true });
    expect(profile).toEqual(before);
    expect(user.name).toBe("Ana");
    expect(setPersonOrganisation).not.toHaveBeenCalled();
    expect(db.projectProfile.update).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("a new Terms version is accepted again, and nothing else is written", async () => {
    profile = completedProfile({ termsVersion: "2026-01-01" });
    await expect(completeProfile({ termsAccepted: true, country: "CY", age: "self" })).resolves.toEqual({ ok: true });
    const [{ data }] = db.projectProfile.update.mock.calls[0] as unknown as [{ data: Row }];
    expect(Object.keys(data).sort()).toEqual(["termsAcceptedAt", "termsVersion"]);
    expect(profile).toMatchObject({ termsVersion: TERMS, country: "DE", organisationId: "org-a" });
  });

  it("a new Terms version not ticked is refused", async () => {
    profile = completedProfile({ termsVersion: "2026-01-01" });
    await expect(completeProfile({ termsAccepted: false })).resolves.toEqual({ ok: false, errors: { terms: "required" } });
    expect(profile?.termsVersion).toBe("2026-01-01");
  });

  it("a blank stored name can be set later; a set one can't", async () => {
    user.name = "  ";
    await expect(completeProfile({ name: "Ana B." })).resolves.toEqual({ ok: true });
    expect(user.name).toBe("Ana B.");
    await completeProfile({ name: "Changed" });
    expect(user.name).toBe("Ana B.");
  });

  it("a blank stored name is asked for: without one the call is refused", async () => {
    user.name = null;
    await expect(completeProfile({ termsAccepted: true })).resolves.toEqual({ ok: false, errors: { name: "empty" } });
  });
});
