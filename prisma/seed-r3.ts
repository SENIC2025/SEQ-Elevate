/**
 * The seed's Release 3 rows (spec 2.4 item 3, 5.8), in a module of their own
 * so they can be unit-tested without running the seed
 * (src/lib/seed-r3.test.ts). Each takes the Prisma client.
 */

import type { Country, PrismaClient } from "@prisma/client";
import { currentTermsVersion, profileRules } from "../src/lib/profile";

/**
 * Which organisation supports learners from each country (Q24's default,
 * D73): the ids the seed gives the partner organisations, as migration
 * 20261120090100 inserts them on a database that already has them.
 */
export const DEFAULT_COUNTRY_MAPPING: Readonly<Record<Country, string>> = {
  DE: "seq-elevate-proarbeit",
  CY: "seq-elevate-synthesis",
  GR: "seq-elevate-uom",
  BE: "seq-elevate-diesis",
  OTHER: "seq-elevate-diesis",
};

/**
 * Inserts the default country mapping for the organisations that exist. A
 * fresh database runs the migrations before the seed has made the
 * organisations, so the migration's own insert finds none there. Never
 * changes a country an ADMIN has mapped.
 */
export async function seedCountryMapping(prisma: PrismaClient, projectId: string) {
  const ids = new Set(
    (
      await prisma.organisation.findMany({
        where: { projectId, id: { in: Object.values(DEFAULT_COUNTRY_MAPPING) } },
        select: { id: true },
      })
    ).map((o) => o.id)
  );
  for (const [country, organisationId] of Object.entries(DEFAULT_COUNTRY_MAPPING) as [Country, string][]) {
    if (!ids.has(organisationId)) continue;
    await prisma.countryMapping.upsert({
      where: { projectId_country: { projectId, country } },
      create: { projectId, country, organisationId },
      update: {},
    });
  }
}

/**
 * The seeded staff account (SEED_STAFF_EMAIL): a name when it has none
 * (SEED_STAFF_NAME), and a complete profile with the current Terms version,
 * so it isn't sent to the profile step on every visit (a complete profile
 * needs a name). Its organisation is an ADMIN's to set; the seed sets none.
 */
export async function seedStaffProfile(
  prisma: PrismaClient,
  staff: { id: string; name: string | null },
  projectId: string,
  name: string
) {
  if (!staff.name?.trim()) {
    await prisma.user.update({ where: { id: staff.id }, data: { name } });
  }
  const now = new Date();
  const where = { userId_projectId: { userId: staff.id, projectId } };
  const stored = await prisma.projectProfile.findUnique({ where, select: { profileCompletedAt: true } });
  const answers = {
    country: "OTHER" as const,
    termsVersion: currentTermsVersion(),
    termsAcceptedAt: now,
    ageRule: "SELF_MIN_AGE" as const,
    ageConfirmedAt: now,
    ...(profileRules().consent !== "off" ? { consentVersion: "seed", consentAt: now } : {}),
    profileCompletedAt: stored?.profileCompletedAt ?? now,
  };
  await prisma.projectProfile.upsert({
    where,
    create: { userId: staff.id, projectId, ...answers },
    update: answers,
  });
}
