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

  const profile = await tx.projectProfile.upsert({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    create: { userId, projectId: PROJECT, organisationId, organisationSource: by.source },
    update: { organisationId, organisationSource: by.source },
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
