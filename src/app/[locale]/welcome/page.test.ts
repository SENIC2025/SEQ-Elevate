import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Release 3 (spec 18.1 UB5): the profile step's page. Signed out → sign
 * in; complete → the hub; a profile that can't be read → the error page,
 * never a redirect (no loop); otherwise the form, with what the profile
 * holds.
 */

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, getProjectMemberships }));
const prisma = {
  projectProfile: { findUnique: vi.fn() },
  countryMapping: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/safeguarding/SafeguardingBox", () => ({ SafeguardingBox: () => null }));
vi.mock("@/components/profile/ProfileStepForm", () => ({ ProfileStepForm: () => null }));

const { default: Page } = await import("./page");
const { ProfileStepForm } = await import("@/components/profile/ProfileStepForm");
const { AppHeader } = await import("@/components/AppHeader");
const { SafeguardingBox } = await import("@/components/safeguarding/SafeguardingBox");
const { currentTermsVersion } = await import("@/lib/profile");

type El = ReactElement<Record<string, unknown>>;

async function visit(locale = "en"): Promise<El | string> {
  try {
    return (await Page({ params: Promise.resolve({ locale }) })) as El;
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
}

/** Every element of the tree, depth first. */
function elements(node: unknown): El[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as El;
  return [el, ...elements(el.props?.children)];
}
const viewOf = (tree: El) => elements(tree).find((e) => e.type === ProfileStepForm)?.props.view as Record<string, unknown>;

const complete = {
  country: "DE",
  organisationId: "org-a",
  organisationSource: "country",
  profileCompletedAt: new Date(),
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date(),
  consentAt: null,
  guardianConsentRecordedAt: null,
  organisation: { name: "Pro Arbeit" },
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", email: "ana@example.org", name: null });
  getProjectMemberships.mockResolvedValue([]);
  prisma.projectProfile.findUnique.mockResolvedValue(null);
  prisma.countryMapping.findMany.mockResolvedValue([
    { country: "DE", organisationId: "org-a", organisation: { name: "Pro Arbeit" } },
    { country: "CY", organisationId: "org-b", organisation: { name: "Synthesis" } },
  ]);
});

describe("/welcome (UB5)", () => {
  it("sends someone signed out to sign in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await visit("de")).toBe("/de/signin");
  });

  it("sends a complete profile to the hub: no loop", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "ana@example.org", name: "Ana" });
    prisma.projectProfile.findUnique.mockResolvedValue(complete);
    expect(await visit()).toBe("/en");
  });

  it("shows the error page, not a redirect, when the profile can't be read", async () => {
    prisma.projectProfile.findUnique.mockRejectedValue(new Error("db down"));
    await expect(visit()).rejects.toThrow("db down");
  });

  it("shows the form for a new account, with the header's workspace switcher left out and the safeguarding box after main", async () => {
    const tree = (await visit()) as El;
    const all = elements(tree);
    expect(all.find((e) => e.type === AppHeader)?.props.showWorkspaces).toBe(false);
    const order = all.map((e) => (e.type === "main" ? "main" : e.type === SafeguardingBox ? "box" : null)).filter(Boolean);
    expect(order).toEqual(["main", "box"]);
    expect(viewOf(tree)).toMatchObject({
      completed: false,
      termsChanged: false,
      nameRequired: true,
      staff: false,
      organisation: null,
      invited: false,
      mapping: { DE: { id: "org-a", name: "Pro Arbeit" }, CY: { id: "org-b", name: "Synthesis" } },
      minAge: { DE: 16, CY: 16, BE: 16, GR: 16, OTHER: 16 },
      consent: "off",
    });
  });

  it("asks a completed profile with a blank name for the name alone (no loop)", async () => {
    prisma.projectProfile.findUnique.mockResolvedValue(complete);
    expect(viewOf((await visit()) as El)).toMatchObject({ completed: true, nameRequired: true, termsChanged: false });
  });

  it("says the Terms changed for a completed profile under an older version", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "ana@example.org", name: "Ana" });
    prisma.projectProfile.findUnique.mockResolvedValue({ ...complete, termsVersion: "1999-01-01" });
    expect(viewOf((await visit()) as El)).toMatchObject({ completed: true, termsChanged: true, nameRequired: false });
  });

  it("names a partner admin's organisation, and offers the invited statement where a guardian's permission is recorded", async () => {
    prisma.projectProfile.findUnique.mockResolvedValue({
      ...complete,
      country: null,
      profileCompletedAt: null,
      termsVersion: null,
      ageConfirmedAt: null,
      organisationSource: "partner-admin",
      guardianConsentRecordedAt: new Date(),
    });
    expect(viewOf((await visit()) as El)).toMatchObject({
      completed: false,
      invited: true,
      organisation: { id: "org-a", name: "Pro Arbeit", byPartnerAdmin: true },
    });
  });

  it("knows staff, for whom the who-sees statement isn't meant", async () => {
    getProjectMemberships.mockResolvedValue([{ role: "FACILITATOR" }]);
    expect(viewOf((await visit()) as El)).toMatchObject({ staff: true });
  });

  it("reads the person's own profile", async () => {
    await visit();
    expect(prisma.projectProfile.findUnique.mock.calls[0][0].where).toEqual({
      userId_projectId: { userId: "u1", projectId: "seq-elevate" },
    });
  });
});
