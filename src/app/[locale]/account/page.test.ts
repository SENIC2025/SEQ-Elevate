import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Release 3 (spec 5.7, 12.2): the account page says which Terms of use the
 * person accepted. A version is named only for counsel's texts: one
 * accepted before any version existed ("unversioned"), or one written
 * before counsel's ("pre-counsel", what the profile step records for it),
 * ends the line at the date, as the legal page calls that text an interim
 * version in words, never by the stored value.
 */

vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
const requireUser = vi.fn();
const getMemberships = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({ requireUser, getMemberships }));
const prisma = {
  courseEnrollment: { count: vi.fn(async () => 0) },
  userBadge: { count: vi.fn(async () => 0) },
  compCard: { findUnique: vi.fn(async () => null) },
  projectProfile: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/components/account/AccountView", () => ({ AccountView: () => null }));

const { default: Page } = await import("./page");
const { LEGACY_VERSION } = await import("@/data/legal");
const { UNVERSIONED_TERMS } = await import("@/lib/profile");

interface ShownProfile {
  termsVersion: string | null;
  termsAcceptedAt: string | null;
}

async function shownProfile(termsVersion: string): Promise<ShownProfile> {
  prisma.projectProfile.findUnique.mockResolvedValue({
    country: "DE",
    termsVersion,
    termsAcceptedAt: new Date("2026-11-21T09:00:00Z"),
    ageRule: "SELF_MIN_AGE",
    ageConfirmedAt: new Date("2026-11-21T09:00:00Z"),
    organisation: { name: "Pro Arbeit" },
  });
  const element = (await Page({ params: Promise.resolve({ locale: "de" }) })) as ReactElement<{
    profile: ShownProfile;
  }>;
  return element.props.profile;
}

describe("account page: the Terms version it names", () => {
  beforeEach(() => {
    requireUser.mockResolvedValue({ id: "u1", email: "a@example.org", name: "Ana", createdAt: new Date() });
    getMemberships.mockResolvedValue([]);
  });

  it("names counsel's version", async () => {
    await expect(shownProfile("2026-11-06")).resolves.toMatchObject({
      termsVersion: "2026-11-06",
      termsAcceptedAt: "2026-11-21T09:00:00.000Z",
    });
  });

  it("names none for a text written before counsel's, nor for one without a version", async () => {
    expect(LEGACY_VERSION).toBe("pre-counsel");
    for (const stored of [LEGACY_VERSION, UNVERSIONED_TERMS]) {
      await expect(shownProfile(stored), stored).resolves.toMatchObject({
        termsVersion: null,
        termsAcceptedAt: "2026-11-21T09:00:00.000Z",
      });
    }
  });
});
