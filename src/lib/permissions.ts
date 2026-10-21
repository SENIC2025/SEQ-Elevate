/**
 * What each project role brings with it — the ONE place that says so.
 *
 * "Admin includes Editor": an ADMIN of a project can do everything a
 * CONTENT_EDITOR can (create and edit courses, lessons and uploads), whether
 * or not they also hold a separate CONTENT_EDITOR membership. Server gates ask
 * canEditContent(); the People screen asks includedVia() to show the included
 * role. Nothing extra is stored — the implication is applied when checking.
 *
 * Release 3 (D76): a PARTNER_ADMIN includes CONTENT_EDITOR and FACILITATOR
 * (it edits and translates courses and supports its organisation's
 * learners), manages its own organisation's people, and signs off a
 * translation. Which learners and people a viewer sees is not decided here
 * but by the scope (src/lib/scope.ts): these helpers say which powers a
 * role carries, the scope says whose data. An ADMIN-only action asks both
 * seesWholeProject() and for project scope.
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
  PARTNER_ADMIN: ["CONTENT_EDITOR", "FACILITATOR"],
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

/**
 * May someone holding `roles` support learners: see a roster and statistics,
 * and write notes and validations? Facilitators, partner admins (through
 * FACILITATOR) and Admins. Whose learners is the scope's to say.
 */
export function canSupportLearners(roles: readonly Role[]): boolean {
  return roles.some((r) => r === "ADMIN" || roleIncludes(r, "FACILITATOR"));
}

/** May someone holding `roles` manage people (partner admins: their own organisation's)? */
export function canManagePeople(roles: readonly Role[]): boolean {
  return roles.some((r) => r === "ADMIN" || r === "PARTNER_ADMIN");
}

/**
 * Does someone holding `roles` act for the whole project? ADMIN only (DIESIS,
 * SENIC). ADMIN-only powers (organisations, the country mapping, test
 * accounts, erasure, safeguarding contacts) check this and project scope.
 */
export function seesWholeProject(roles: readonly Role[]): boolean {
  return roles.includes("ADMIN");
}

/** Every role, in the order the People screen offers them. */
const ALL_ROLES: readonly Role[] = ["LEARNER", "FACILITATOR", "CONTENT_EDITOR", "PARTNER_ADMIN", "ADMIN"];

/** What a partner admin may grant, change and remove: nothing beyond these. */
const PARTNER_GRANTABLE: readonly Role[] = ["LEARNER", "FACILITATOR"];

/**
 * The roles someone holding `roles` may grant. An ADMIN grants every role;
 * a partner admin only LEARNER and FACILITATOR (so it never makes another
 * partner admin, an editor or an admin); anyone else nothing.
 */
export function grantableRoles(roles: readonly Role[]): readonly Role[] {
  if (roles.includes("ADMIN")) return ALL_ROLES;
  if (roles.includes("PARTNER_ADMIN")) return PARTNER_GRANTABLE;
  return [];
}

/** May someone holding `roles` switch a course's German or Greek on for learners (D90)? */
export function canSignOffLanguage(roles: readonly Role[]): boolean {
  return roles.some((r) => r === "ADMIN" || r === "PARTNER_ADMIN");
}
