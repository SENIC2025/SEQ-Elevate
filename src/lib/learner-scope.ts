/**
 * Who counts as a learner of a project, wherever learners are listed,
 * counted, analysed or written about.
 *
 * Before Release 0, every signed-in page gave its visitor a LEARNER
 * membership, staff included. Release 0 stops making new ones
 * (needsLearnerMembership) but, by design, deletes none: removing roles is
 * an admin's call on the People screen, not a silent data change. So an
 * admin, editor or facilitator can still hold that old row, and holding
 * LEARNER alone doesn't make someone a learner. A learner is someone with a
 * LEARNER membership in the project and no staff membership in it.
 *
 * The same rule comes in three shapes: a predicate over the roles someone
 * holds (for checks such as canRecordForLearner) and two Prisma where
 * fragments (for queries that start from memberships or from users). The
 * person's own learner features don't use it: progress, Comp Card and
 * badges work for anyone signed in (requireLearner).
 *
 * Pure (type-only imports), so it can be tested without a database.
 */

import type { Prisma, Role } from "@prisma/client";

/*
 * Every role but LEARNER is a staff role. Spelled out as a record over the
 * Role enum so that adding a role to the schema fails type-checking here
 * until someone decides whether it is staff.
 */
const IS_STAFF: Record<Exclude<Role, "LEARNER">, true> = {
  FACILITATOR: true,
  ADMIN: true,
  CONTENT_EDITOR: true,
};

/** The roles that make someone staff of a project, never a learner of it. */
export const STAFF_ROLES = Object.keys(IS_STAFF) as readonly Exclude<Role, "LEARNER">[];

/**
 * Is someone holding `roles` in a project a learner of it? Only with the
 * LEARNER role and no staff role there. Any role other than LEARNER counts
 * as staff, so a value this code doesn't know refuses rather than lets
 * someone through (it fails closed).
 */
export function isProjectLearner(roles: readonly Role[]): boolean {
  return roles.includes("LEARNER") && roles.every((r) => r === "LEARNER");
}

/** No staff membership in `projectId` (a filter on a user's memberships). */
const noStaffRole = (projectId: string) => ({
  none: { projectId, role: { in: [...STAFF_ROLES] } },
});

/** The learners' LEARNER memberships in `projectId`. */
export function learnerMembershipWhere(
  projectId: string
): Prisma.MembershipWhereInput {
  return {
    projectId,
    role: "LEARNER",
    user: { memberships: noStaffRole(projectId) },
  };
}

/** The users who are learners of `projectId`. */
export function learnerUserWhere(projectId: string): Prisma.UserWhereInput {
  return {
    memberships: {
      some: { projectId, role: "LEARNER" },
      ...noStaffRole(projectId),
    },
  };
}
