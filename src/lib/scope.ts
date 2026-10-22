import "server-only";

/**
 * Release 3 (D74, D75, spec 3.2): whose learner and people data a viewer may
 * read or change — the ONE place that says so.
 *
 *   ADMIN (DIESIS, SENIC)            the whole project, learners with no
 *                                    organisation included
 *   PARTNER_ADMIN or FACILITATOR     their own organisation, and only while
 *                                    R3_PARTNER_ACCESS is on (D77)
 *   anyone else                      no one
 *
 * A viewer whose own profile is not complete gets no one either (unless
 * R3_PROFILE_GATE=off): layouts don't run on every request and server actions
 * never pass through them, so this is where it holds. Any error reading the
 * viewer gives no one, and one log line without personal data (Next's own
 * signals excepted: they are thrown on).
 *
 * The scope says whose data; the role says which powers (permissions.ts).
 * An ADMIN-only action asks for both (requireAdminProject).
 *
 * Organisation scope reads a person's organisation from their
 * ProjectProfile only, never Membership.organisationId (D72). Every builder
 * answers a Prisma filter, and for "none" one that matches nothing — never
 * `undefined`, which Prisma reads as "no filter". Filters are combined with
 * AND: [...], never by spreading two objects that may share a key.
 *
 * A Scope is made only here (hardening SS4). Its type carries a brand no
 * other module can name, a class with a private field, which a spread
 * doesn't copy: outside this file neither a hand-made literal nor a copy of
 * a real scope with its fields changed type-checks. Its fields are
 * read-only, and every scope made here is frozen, so one can't be changed
 * in place either. Tests make one with testOnlyScope. The scope guard
 * (scope-guard.test.ts) reads src/ with the type checker and fails, outside
 * this file and tests, for that name, for an assertion to a Scope (or to a
 * type holding one) under any spelling, for an any or never where a Scope
 * is expected, for an object literal there, and for Object.assign and the
 * like on a Scope.
 */

import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import type { Prisma, ProjectProfile, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { parseAdminEmails } from "@/lib/admin-bootstrap";
import { learnerMembershipWhere, learnerUserWhere } from "@/lib/learner-scope";
import { canSupportLearners, seesWholeProject } from "@/lib/permissions";
import { isProfileComplete, profileRules, type ProfileRules } from "@/lib/profile";
import { partnerAccessOn, profileGateOn } from "@/lib/r3-switches";

type Env = Record<string, string | undefined>;

/** The project every scope is in. */
export const PROJECT = "seq-elevate";

/** What a scope holds. Plain objects of this shape are not scopes: only this module makes one. */
export type ScopeShape =
  | { kind: "project"; viewerId: string; viewerOrganisationId: string | null } // ADMIN
  | { kind: "organisation"; viewerId: string; organisationId: string } // PARTNER_ADMIN, FACILITATOR
  | { kind: "none" };

/**
 * The brand: a type only, named nowhere else (at run time a scope is the
 * plain object, frozen). A class with a private field is matched by name,
 * not by shape, and a spread copies no private field.
 */
declare class MadeByTheScopeModule {
  #madeByTheScopeModule: true;
}

/** Whose data a viewer may read or change, as this module worked it out (see above). */
export type Scope = Readonly<ScopeShape> & MadeByTheScopeModule;

/** The one place a shape becomes a Scope: frozen, so it can't be changed in place. */
const made = (shape: ScopeShape): Scope => Object.freeze({ ...shape }) as Scope;

/**
 * A scope for a test, of any shape. For tests only: the scope guard
 * (scope-guard.test.ts) fails for this name anywhere in src/ outside tests
 * and this module. Code gets its scope from getViewer or scopeFor.
 */
export function testOnlyScope(shape: ScopeShape): Scope {
  return made(shape);
}

export type ProjectProfileRow = ProjectProfile;

/** Who is asking. Read-only, and frozen where it is made (getViewer): its scope stays the one made here. */
export interface Viewer {
  readonly user: { id: string; email: string } | null;
  /** In PROJECT, as getProjectMemberships reads them (ADMIN_EMAILS self-healing kept). */
  readonly roles: readonly Role[];
  readonly profile: ProjectProfileRow | null;
  readonly scope: Scope;
}

const NONE: Scope = made({ kind: "none" });
const NOBODY: Viewer = Object.freeze({ user: null, roles: Object.freeze([]), profile: null, scope: NONE });

/** A filter that matches no row: every model filtered here has an `id`. */
export const MATCH_NOTHING = { id: { in: [] as string[] } } as const;

/**
 * The scope of a signed-in viewer, from what was read about them. Pure, so
 * every rule is tested on its own.
 */
export function scopeFor(
  viewer: {
    userId: string;
    name: string | null;
    roles: readonly Role[];
    profile: Pick<
      ProjectProfileRow,
      "organisationId" | "country" | "termsVersion" | "ageConfirmedAt" | "consentAt"
    > | null;
  },
  env: Env = process.env,
  rules: ProfileRules = profileRules(env)
): Scope {
  if (profileGateOn(env) && !isProfileComplete({ name: viewer.name }, viewer.profile, rules)) return NONE;
  const organisationId = viewer.profile?.organisationId ?? null;
  if (seesWholeProject(viewer.roles)) {
    return made({ kind: "project", viewerId: viewer.userId, viewerOrganisationId: organisationId });
  }
  if (canSupportLearners(viewer.roles) && partnerAccessOn(env) && organisationId) {
    return made({ kind: "organisation", viewerId: viewer.userId, organisationId });
  }
  return NONE;
}

/** Who is asking, with their roles, profile and scope. Read once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  try {
    const user = await getCurrentUser();
    if (!user) return NOBODY;
    const [memberships, profile] = await Promise.all([
      getProjectMemberships(PROJECT),
      prisma.projectProfile.findUnique({
        where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      }),
    ]);
    const roles = Object.freeze(memberships.map((m) => m.role));
    return Object.freeze({
      user: { id: user.id, email: user.email },
      roles,
      profile,
      scope: scopeFor({ userId: user.id, name: user.name, roles, profile }),
    });
  } catch (e) {
    // Next's own signals (render per request, a redirect) go through: a
    // page is never built once as "nobody".
    unstable_rethrow(e);
    // No personal data in the log: only that the read failed, and how.
    console.error(`[scope] couldn't read the viewer; no learner data shown: ${e instanceof Error ? e.name : "error"}`);
    return NOBODY;
  }
});

/** The viewer's scope (getViewer's). */
export const getViewerScope = async (): Promise<Scope> => (await getViewer()).scope;

/** The person's profile in PROJECT names `organisationId`. */
const inOrganisation = (organisationId: string): Prisma.UserWhereInput => ({
  profiles: { some: { projectId: PROJECT, organisationId } },
});

/** The learners (D53: LEARNER and no staff role) the scope covers. */
export function learnerUsersInScope(scope: Scope): Prisma.UserWhereInput {
  switch (scope.kind) {
    case "project":
      return learnerUserWhere(PROJECT);
    case "organisation":
      return { AND: [learnerUserWhere(PROJECT), inOrganisation(scope.organisationId)] };
    default:
      return MATCH_NOTHING;
  }
}

/** The LEARNER memberships of the learners the scope covers (the roster). */
export function learnerMembershipsInScope(scope: Scope): Prisma.MembershipWhereInput {
  switch (scope.kind) {
    case "project":
      return learnerMembershipWhere(PROJECT);
    case "organisation":
      return { AND: [learnerMembershipWhere(PROJECT), { user: inOrganisation(scope.organisationId) }] };
    default:
      return MATCH_NOTHING;
  }
}

/**
 * The learners statistics count (D83, spec 7.2): the roster's learners who
 * never held a staff role (StaffHistory) and aren't marked as test accounts,
 * and, with a date, who started a course of the project since then (at least
 * one enrolment from `from`). Without a date it is an account count (the
 * admin overview's Learners figure).
 */
export function statisticsMembershipsInScope(scope: Scope, from: Date | null): Prisma.MembershipWhereInput {
  if (scope.kind === "none") return MATCH_NOTHING;
  const filters: Prisma.MembershipWhereInput[] = [
    learnerMembershipsInScope(scope),
    { user: { staffHistory: { none: { projectId: PROJECT } } } },
    { user: { profiles: { none: { projectId: PROJECT, testAccountAt: { not: null } } } } },
  ];
  if (from) {
    filters.push({
      user: { enrollments: { some: { enrolledAt: { gte: from }, course: { projectId: PROJECT } } } },
    });
  }
  return { AND: filters };
}

/** Admin holders and ADMIN_EMAILS addresses: never seen or touched by organisation scope. */
function notAnAdmin(env: Env): Prisma.UserWhereInput[] {
  const filters: Prisma.UserWhereInput[] = [{ memberships: { none: { projectId: PROJECT, role: "ADMIN" } } }];
  const emails = [...parseAdminEmails(env.ADMIN_EMAILS)];
  if (emails.length) {
    filters.push({ NOT: { OR: emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) } });
  }
  return filters;
}

/**
 * The people (anyone with a role or a profile in the project) the scope
 * covers, for Manage people and every write about one person. Organisation
 * scope leaves out anyone holding ADMIN and anyone on ADMIN_EMAILS.
 */
export function peopleInScope(scope: Scope, env: Env = process.env): Prisma.UserWhereInput {
  switch (scope.kind) {
    case "project":
      return {
        OR: [{ memberships: { some: { projectId: PROJECT } } }, { profiles: { some: { projectId: PROJECT } } }],
      };
    case "organisation":
      return { AND: [inOrganisation(scope.organisationId), ...notAnAdmin(env)] };
    default:
      return MATCH_NOTHING;
  }
}

/** The memberships of the people the scope covers. */
export function membershipsInScope(scope: Scope, env: Env = process.env): Prisma.MembershipWhereInput {
  switch (scope.kind) {
    case "project":
      return { projectId: PROJECT };
    case "organisation":
      return { AND: [{ projectId: PROJECT }, { user: peopleInScope(scope, env) }] };
    default:
      return MATCH_NOTHING;
  }
}

/** The organisations the scope covers: all of the project's, or the viewer's own. */
export function organisationsInScope(scope: Scope): Prisma.OrganisationWhereInput {
  switch (scope.kind) {
    case "project":
      return { projectId: PROJECT };
    case "organisation":
      return { AND: [{ projectId: PROJECT }, { id: scope.organisationId }] };
    default:
      return MATCH_NOTHING;
  }
}

/** The cohorts the scope covers: those of the organisations it covers. */
export function cohortsInScope(scope: Scope): Prisma.CohortWhereInput {
  switch (scope.kind) {
    case "project":
      return { projectId: PROJECT };
    case "organisation":
      return { AND: [{ projectId: PROJECT }, { organisationId: scope.organisationId }] };
    default:
      return MATCH_NOTHING;
  }
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Is the person `userId` in the scope (peopleInScope)? One count; false for anything but an id. */
export async function inScope(scope: Scope, userId: unknown): Promise<boolean> {
  if (scope.kind === "none" || !isId(userId)) return false;
  const count = await prisma.user.count({ where: { AND: [{ id: userId }, peopleInScope(scope)] } });
  return count > 0;
}

/** Is the cohort `cohortId` one of an organisation the scope covers? */
export async function cohortInScope(scope: Scope, cohortId: unknown): Promise<boolean> {
  if (scope.kind === "none" || !isId(cohortId)) return false;
  const count = await prisma.cohort.count({ where: { AND: [{ id: cohortId }, cohortsInScope(scope)] } });
  return count > 0;
}

/** The viewer, when they hold ADMIN and have project scope; otherwise null. */
export async function requireAdminProject(): Promise<Viewer | null> {
  const viewer = await getViewer();
  return seesWholeProject(viewer.roles) && viewer.scope.kind === "project" ? viewer : null;
}
