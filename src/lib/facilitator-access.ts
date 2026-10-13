/**
 * Who may write a facilitator's observation note or competence validation,
 * and about whom (C20).
 *
 * Both land on another person's record, which the learner reads in their
 * data export and the admin audit shows. So the writer must be a FACILITATOR
 * or ADMIN of the project (the same people who see the facilitator
 * workspace, getProjectLearners), and the person written about must be a
 * learner of the same project: someone who is only staff, or who isn't in
 * the project at all, is refused. Organisation and cohort aren't checked
 * yet; nothing else scopes staff by them either (D25).
 *
 * Pure (type-only imports), so it can be tested without a database.
 */

import type { Role } from "@prisma/client";

/** Roles that may record observations and validations in a project. */
export const FACILITATOR_WRITE_ROLES: readonly Role[] = ["FACILITATOR", "ADMIN"];

/**
 * May someone holding `writerRoles` in the project write about a person
 * holding `learnerRoles` in it?
 */
export function canRecordForLearner(
  writerRoles: readonly Role[],
  learnerRoles: readonly Role[]
): boolean {
  return (
    writerRoles.some((r) => FACILITATOR_WRITE_ROLES.includes(r)) &&
    learnerRoles.includes("LEARNER")
  );
}
