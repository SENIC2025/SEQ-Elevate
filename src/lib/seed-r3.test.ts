import { describe, it, expect, vi } from "vitest";
import { isProfileComplete, profileRules } from "@/lib/profile";
import { COUNTRIES } from "@/lib/countries";
import { DEFAULT_COUNTRY_MAPPING, seedCountryMapping, seedStaffProfile } from "../../prisma/seed-r3";

/*
 * The seed's Release 3 rows (spec 2.4 item 3, 5.8). A fresh database runs
 * the migrations before the seed has made the partner organisations, so the
 * migration's default country mapping finds none: the seed inserts it,
 * never over a mapping an ADMIN set. The seeded staff account gets a name
 * and a complete profile, or it would be sent to the profile step on every
 * visit.
 */

function client(existing: string[]) {
  return {
    organisation: { findMany: vi.fn(async () => existing.map((id) => ({ id }))) },
    countryMapping: { upsert: vi.fn(async () => ({})) },
    user: { update: vi.fn(async () => ({})) },
    projectProfile: {
      findUnique: vi.fn(async (): Promise<{ profileCompletedAt: Date | null } | null> => null),
      upsert: vi.fn(async () => ({})),
    },
  };
}

describe("seedCountryMapping", () => {
  it("maps every country to the Q24 default organisation, as the migration does", async () => {
    expect(Object.keys(DEFAULT_COUNTRY_MAPPING).sort()).toEqual([...COUNTRIES].sort());
    expect(DEFAULT_COUNTRY_MAPPING).toEqual({
      DE: "seq-elevate-proarbeit",
      CY: "seq-elevate-synthesis",
      GR: "seq-elevate-uom",
      BE: "seq-elevate-diesis",
      OTHER: "seq-elevate-diesis",
    });
    const db = client(Object.values(DEFAULT_COUNTRY_MAPPING));
    await seedCountryMapping(db as never, "seq-elevate");
    expect(db.countryMapping.upsert).toHaveBeenCalledTimes(5);
    expect(db.countryMapping.upsert).toHaveBeenCalledWith({
      where: { projectId_country: { projectId: "seq-elevate", country: "DE" } },
      create: { projectId: "seq-elevate", country: "DE", organisationId: "seq-elevate-proarbeit" },
      // An ADMIN's mapping is kept.
      update: {},
    });
  });

  it("maps nothing to an organisation that doesn't exist", async () => {
    const db = client(["seq-elevate-diesis"]);
    await seedCountryMapping(db as never, "seq-elevate");
    const countries = db.countryMapping.upsert.mock.calls.map((c) => (c as unknown as [{ create: { country: string } }])[0].create.country);
    expect(countries.sort()).toEqual(["BE", "OTHER"]);
  });
});

describe("seedStaffProfile", () => {
  it("gives the staff account a name when it has none, and a complete profile", async () => {
    const db = client([]);
    await seedStaffProfile(db as never, { id: "staff", name: null }, "seq-elevate", "Staff");
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "staff" }, data: { name: "Staff" } });
    const write = (db.projectProfile.upsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }])[0];
    for (const answers of [write.create, write.update]) {
      expect(isProfileComplete({ name: "Staff" }, answers as never, profileRules())).toBe(true);
      expect(answers.profileCompletedAt).toBeInstanceOf(Date);
      // Only setPersonOrganisation writes a person's organisation (D101).
      expect(answers).not.toHaveProperty("organisationId");
    }
  });

  it("keeps a name the account already has", async () => {
    const db = client([]);
    await seedStaffProfile(db as never, { id: "staff", name: "Maria" }, "seq-elevate", "Staff");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
