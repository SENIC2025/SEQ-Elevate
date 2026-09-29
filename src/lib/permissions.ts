/**
 * What each project role brings with it — the ONE place that says so.
 *
 * "Admin includes Editor": an ADMIN of a project can do everything a
 * CONTENT_EDITOR can (create and edit courses, lessons and uploads), whether
 * or not they also hold a separate CONTENT_EDITOR membership. Server gates ask
 * canEditContent(); the People screen asks includedVia() to show the included
 * role. Nothing extra is stored — the implication is applied when checking.
 *
 * Pure (type-only imports), so client components can use it too.
 */

import type { Role } from "@prisma/client";

/** Roles that holding a role also grants (one level; no chains needed yet). */
const IMPLIED_ROLES: Readonly<Record<Role, readonly Role[]>> = {
  ADMIN: ["CONTENT_EDITOR"],
  CONTENT_EDITOR: [],
  FACILITATOR: [],
  LEARNER: [],
};

/** Does holding `role` give the rights of `included`? (A role includes itself.) */
export function roleIncludes(role: Role, included: Role): boolean {
  return role === included || IMPLIED_ROLES[role].includes(included);
}

/** Every role whose holders may author content: Editor, and Admin through it. */
export const EDITOR_ROLES: readonly Role[] = (
  Object.keys(IMPLIED_ROLES) as Role[]
).filter((r) => roleIncludes(r, "CONTENT_EDITOR"));

/** May someone holding `roles` (in a project) create and edit its content? */
export function canEditContent(roles: readonly Role[]): boolean {
  return roles.some((r) => EDITOR_ROLES.includes(r));
}

/**
 * The held role that already grants `role`, if any — e.g. "ADMIN" for
 * CONTENT_EDITOR when the person is an admin. Null when nothing else grants it
 * (whether or not `role` itself is held).
 */
export function includedVia(roles: readonly Role[], role: Role): Role | null {
  return roles.find((r) => r !== role && roleIncludes(r, role)) ?? null;
}
