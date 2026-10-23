import "server-only";

/**
 * Release 3 (D101, spec 3.2): the ONLY writer of a person's organisation
 * (ProjectProfile.organisationId). Called inside the caller's transaction by
 * the people actions and the profile step; nothing else writes the column
 * (scope-guard.test.ts checks the sources).
 *
 * When the organisation changes, in the same transaction:
 * - the person's Comp Card goes back to "Only me" (a card shared with one
 *   organisation never wakes up for it after a move away and back; the
 *   database trigger on ProjectProfile does the same for any other writer);
 * - their cohort is cleared on every membership whose cohort belongs to
 *   another organisation;
 * - a guardian's permission recorded while they were in another
 *   organisation is cleared, with what it covered (spec 5.6: the inviter
 *   records that "our organisation" holds it, so it is that organisation's
 *   record; the new one records its own);
 * - who set it is recorded (organisationSource) and the change is audited
 *   (person.organisation_changed, no personal data).
 * No change writes nothing. No one sets their own organisation as an admin.
 */

import type { Prisma } from "@prisma/client";

const PROJECT = "seq-elevate";

export type OrganisationSource = "admin" | "partner-admin" | "country" | "released";

export interface OrganisationChangeBy {
  /** Who made the change; null for the person's own profile step. */
  actorId: string | null;
  source: OrganisationSource;
  /** The actor's scope, for the audit row: "project" or their organisation's id. */
  scope?: string;
}

/**
 * Sets the organisation of `userId` in the project (null: none), creating
 * their profile if they have none. Throws when an admin sets their own, or
 * when the organisation isn't one of the project's; the caller's
 * transaction then rolls back.
 */
export async function setPersonOrganisation(
  tx: Prisma.TransactionClient,
  userId: string,
  organisationId: string | null,
  by: OrganisationChangeBy
): Promise<{ changed: boolean }> {
  if (by.source === "admin" && by.actorId !== null && by.actorId === userId) {
    throw new Error("setPersonOrganisation: no one sets their own organisation");
  }
  if (organisationId !== null) {
    const known = await tx.organisation.count({ where: { id: organisationId, projectId: PROJECT } });
    if (known !== 1) throw new Error("setPersonOrganisation: not an organisation of the project");
  }

  // The profile row is locked for the rest of the transaction, so two changes
  // at once are decided one after the other.
  await tx.$queryRaw`SELECT 1 FROM "ProjectProfile" WHERE "userId" = ${userId} AND "projectId" = ${PROJECT} FOR UPDATE`;
  const current = await tx.projectProfile.findUnique({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    select: { id: true, organisationId: true },
  });
  if ((current?.organisationId ?? null) === organisationId) return { changed: false };

  // Moving away from an organisation takes that organisation's record of a
  // guardian's permission with it; a first organisation (from none) keeps a
  // record an ADMIN made while the person had none.
  const leaves = (current?.organisationId ?? null) !== null;
  const profile = await tx.projectProfile.upsert({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    create: { userId, projectId: PROJECT, organisationId, organisationSource: by.source },
    update: {
      organisationId,
      organisationSource: by.source,
      ...(leaves ? { guardianConsentRecordedAt: null, guardianSharingConsentAt: null } : {}),
    },
    select: { id: true },
  });

  await tx.compCard.updateMany({
    where: { userId, projectId: PROJECT },
    data: { privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null },
  });

  await tx.membership.updateMany({
    where: {
      userId,
      projectId: PROJECT,
      cohortId: { not: null },
      ...(organisationId === null ? {} : { cohort: { is: { organisationId: { not: organisationId } } } }),
    },
    data: { cohortId: null },
  });

  await tx.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: by.actorId,
      action: "person.organisation_changed",
      entity: "ProjectProfile",
      entityId: profile.id,
      ...(by.scope ? { metadata: { scope: by.scope } } : {}),
    },
  });
  return { changed: true };
}

/**
 * The profile step's organisation rule (spec 5.4 (c), D101) for someone who
 * becomes a learner after the profile step: their staff roles changed to
 * LEARNER only, or LEARNER given back after "Remove" (Q29). The profile
 * step applies the rule at the first completion to people who hold no
 * staff role; this applies it to the others when they become learners, so
 * holding a staff role at the profile step never keeps a learner in a
 * partner admin's organisation.
 *
 * An organisation a partner admin set is released (none, source
 * "released", for an ADMIN to confirm or move) when the completed profile
 * names a country the mapping gives to another organisation, or to none.
 * An organisation set by an ADMIN, by the country or by the backfill stays.
 * Audited `profile.organisation_released` (entity ProjectProfile; no
 * personal data). Inside the caller's transaction; answers whether it
 * released.
 */
export async function releaseIfCountryElsewhere(
  tx: Prisma.TransactionClient,
  userId: string,
  by: { actorId: string | null; scope?: string }
): Promise<{ released: boolean }> {
  await tx.$queryRaw`SELECT 1 FROM "ProjectProfile" WHERE "userId" = ${userId} AND "projectId" = ${PROJECT} FOR UPDATE`;
  const profile = await tx.projectProfile.findUnique({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    select: { id: true, country: true, organisationId: true, organisationSource: true, profileCompletedAt: true },
  });
  if (
    !profile?.profileCompletedAt ||
    profile.organisationSource !== "partner-admin" ||
    profile.organisationId === null ||
    profile.country === null
  ) {
    return { released: false };
  }
  const mapped = await tx.countryMapping.findUnique({
    where: { projectId_country: { projectId: PROJECT, country: profile.country } },
    select: { organisationId: true },
  });
  if ((mapped?.organisationId ?? null) === profile.organisationId) return { released: false };

  await setPersonOrganisation(tx, userId, null, { actorId: by.actorId, source: "released", scope: by.scope });
  await tx.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: by.actorId,
      action: "profile.organisation_released",
      entity: "ProjectProfile",
      entityId: profile.id,
      ...(by.scope ? { metadata: { scope: by.scope } } : {}),
    },
  });
  return { released: true };
}
