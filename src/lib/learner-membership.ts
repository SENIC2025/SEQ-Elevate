/**
 * Who the learner store may make a learner of the project (C11).
 *
 * Every signed-in page load asks the server to make sure the person has a
 * place in the project (ensureLearnerMembership), so a brand-new person who
 * signed in by themselves becomes a learner without anyone adding them.
 * Staff must not: a LEARNER membership puts an admin, editor or facilitator
 * on the facilitator roster, in the admin's learner count and, once they
 * play a course, in the statistics. And a role an admin removed must stay
 * removed. So only someone with no role at all in the project is given one;
 * existing memberships are never touched.
 *
 * Every learner feature (progress, Comp Card, badges, reading help) works
 * for any signed-in person, with or without the LEARNER role, so staff lose
 * nothing by not holding it.
 *
 * Pure (type-only imports), so it can be tested without a database.
 */

import type { Role } from "@prisma/client";

/**
 * Should a LEARNER membership be created for someone who holds `roles` in
 * the project? Only when they hold none. An ADMIN_EMAILS address
 * (`bootstrapAdmin`) never is: its roles are granted on sign-in and on the
 * next page load, and a learner role made while that grant was failing
 * would stay behind once it got through.
 */
export function needsLearnerMembership(
  roles: readonly Role[],
  { bootstrapAdmin }: { bootstrapAdmin: boolean }
): boolean {
  return roles.length === 0 && !bootstrapAdmin;
}
