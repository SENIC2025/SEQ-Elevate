import "server-only";

/**
 * Read queries for the admin management screens (organisations, cohorts,
 * people), for the viewer's scope (src/lib/scope.ts, D74): an ADMIN reads
 * the whole project, a partner admin its own organisation and its people
 * (never an ADMIN holder or an ADMIN_EMAILS address), anyone else nothing
 * (null, without a query). Which powers a viewer has on these screens is
 * the page's and the action's to check (canManagePeople, admin.ts). All
 * wrapped defensively so a DB hiccup renders an empty screen rather than a
 * crash.
 */

import { prisma } from "@/lib/prisma";
import { membershipsInScope, organisationsInScope, peopleInScope, type Scope } from "@/lib/scope";
import { COUNTRIES } from "@/lib/countries";
import { minimumAgeFor } from "@/lib/profile";
import type { Country, Prisma, Role } from "@prisma/client";

const PROJECT = "seq-elevate";

/**
 * The people Manage people lists for the scope: an ADMIN, everyone with a
 * role or a profile in the project; a partner admin, the people of its
 * organisation who hold a role (peopleInScope leaves out ADMIN holders and
 * ADMIN_EMAILS addresses). Never for no scope.
 */
function listedPeople(scope: Exclude<Scope, { kind: "none" }>): Prisma.UserWhereInput {
  return scope.kind === "project"
    ? peopleInScope(scope)
    : { AND: [peopleInScope(scope), { memberships: { some: { projectId: PROJECT } } }] };
}

export interface AdminCohort {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  /** The people in it the viewer is shown: someone with two roles is one member. */
  memberCount: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  shortName: string;
  cohorts: AdminCohort[];
  /**
   * How many people's profiles name it, of those the viewer is shown on
   * Manage people (for an ADMIN, everyone: while any do, it can't be
   * deleted).
   */
  people: number;
  /** The countries mapped to it (D73): while any are, it can't be deleted. */
  countries: Country[];
}

export interface AdminMember {
  id: string;
  email: string;
  name: string | null;
  /** Their roles in the project; none for someone removed, or who never finished the profile step. */
  roles: Role[];
  cohortId: string | null;
  cohortName: string | null;
  /** Their organisation in the project, from their profile (D72), never a membership row. */
  organisationId: string | null;
  orgName: string | null;
  /** Who set the organisation last (D101): "admin", "partner-admin", "country", "backfill" or "released". */
  organisationSource: string | null;
  /** The country on their profile, if they gave one (spec 5.2). */
  country: Country | null;
  /** They have completed the profile step. */
  profileComplete: boolean;
  /** Marked as a test account (D85). */
  testAccount: boolean;
  /** Held a staff role once (StaffHistory, D84) and holds none now. */
  formerStaff: boolean;
  /** An inviter recorded a parent's or guardian's permission (spec 5.6). */
  guardianConsent: boolean;
  /** That permission also covers sharing the Comp Card. */
  guardianSharing: boolean;
  /**
   * Invited under a guardian's permission (their profile step's age rule),
   * but none is recorded now: the record went with the organisation that
   * made it when they moved (setPersonOrganisation). Their organisation
   * records its own by adding them again with the tick.
   */
  guardianNeeded: boolean;
  /**
   * For ADMINs only (always false for a partner admin): a learner whose
   * country is mapped to another organisation than theirs, or whose
   * organisation the profile step released because the country they picked
   * is another organisation's (spec 5.4): DIESIS confirms or moves them.
   */
  countryMismatch: boolean;
  /** When they were added to the project (YYYY-MM-DD). */
  joinedAt: string;
  /** "joined" once they have signed in at least once (D27). */
  status: "joined" | "pending";
  /** Latest invitation sent while still pending (YYYY-MM-DD), if any. */
  invitedAt: string | null;
}

/**
 * The organisations in scope, with their cohorts and member counts. The
 * counts are of the people the viewer is shown on Manage people, so a
 * partner admin's never count an ADMIN, an ADMIN_EMAILS address or
 * someone with no role in its organisation.
 */
export async function getAdminOrgs(scope: Scope): Promise<AdminOrg[] | null> {
  if (scope.kind === "none") return null;
  try {
    const orgs = await prisma.organisation.findMany({
      where: organisationsInScope(scope),
      include: {
        cohorts: {
          orderBy: { createdAt: "asc" },
          // A membership per role: two for a learner who facilitates too.
          include: { memberships: { where: membershipsInScope(scope), select: { userId: true } } },
        },
        countryMappings: { select: { country: true } },
        _count: { select: { profiles: { where: { projectId: PROJECT, user: listedPeople(scope) } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      shortName: o.shortName,
      cohorts: o.cohorts.map((c) => ({
        id: c.id,
        name: c.name,
        startsAt: c.startsAt?.toISOString().slice(0, 10) ?? null,
        endsAt: c.endsAt?.toISOString().slice(0, 10) ?? null,
        memberCount: new Set(c.memberships.map((m) => m.userId)).size,
      })),
      people: o._count?.profiles ?? 0,
      countries: (o.countryMappings ?? []).map((m) => m.country),
    }));
  } catch {
    return [];
  }
}

/** Which organisation each country is mapped to (D73): for an ADMIN only, else null. */
export async function getCountryMappings(
  scope: Scope
): Promise<{ country: Country; organisationId: string }[] | null> {
  if (scope.kind !== "project") return null;
  try {
    return await prisma.countryMapping.findMany({
      where: { projectId: PROJECT },
      select: { country: true, organisationId: true },
    });
  } catch {
    return [];
  }
}

/**
 * The people in scope, with their roles and cohort, and what their profile
 * says. An ADMIN also gets people with a profile and no role (removed, or
 * who never finished the profile step), and which learners' country
 * doesn't match their organisation; a partner admin gets the people of
 * their organisation who hold a role.
 */
export async function getAdminMembers(scope: Scope): Promise<AdminMember[] | null> {
  if (scope.kind === "none") return null;
  try {
    const [users, mappings] = await Promise.all([
      prisma.user.findMany({
        where: listedPeople(scope),
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          createdAt: true,
          memberships: {
            where: { projectId: PROJECT },
            select: { role: true, cohortId: true, createdAt: true, cohort: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
          profiles: {
            where: { projectId: PROJECT },
            select: {
              organisationId: true,
              organisationSource: true,
              country: true,
              profileCompletedAt: true,
              testAccountAt: true,
              guardianConsentRecordedAt: true,
              guardianSharingConsentAt: true,
              ageRule: true,
              createdAt: true,
              organisation: { select: { name: true } },
            },
          },
          staffHistory: { where: { projectId: PROJECT }, select: { firstAt: true } },
        },
      }),
      scope.kind === "project"
        ? prisma.countryMapping.findMany({ where: { projectId: PROJECT }, select: { country: true, organisationId: true } })
        : Promise.resolve([]),
    ]);
    const mappedTo = new Map(mappings.map((m) => [m.country, m.organisationId]));

    const members: AdminMember[] = users.map((u) => {
      const profile = u.profiles[0] ?? null;
      const roles = [...new Set(u.memberships.map((m) => m.role))];
      // Prefer whichever row actually carries a cohort.
      const withCohort = u.memberships.find((m) => m.cohortId);
      const learner = roles.every((r) => r === "LEARNER");
      const mapped = profile?.country ? mappedTo.get(profile.country) : undefined;
      const added = u.memberships[0]?.createdAt ?? profile?.createdAt ?? u.createdAt;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        roles,
        cohortId: withCohort?.cohortId ?? null,
        cohortName: withCohort?.cohort?.name ?? null,
        organisationId: profile?.organisationId ?? null,
        orgName: profile?.organisation?.name ?? null,
        organisationSource: profile?.organisationSource ?? null,
        country: profile?.country ?? null,
        profileComplete: !!profile?.profileCompletedAt,
        testAccount: !!profile?.testAccountAt,
        formerStaff: u.staffHistory.length > 0 && learner,
        guardianConsent: !!profile?.guardianConsentRecordedAt,
        guardianSharing: !!profile?.guardianSharingConsentAt,
        guardianNeeded: profile?.ageRule === "INVITED_WITH_GUARDIAN_CONSENT" && !profile.guardianConsentRecordedAt,
        countryMismatch:
          scope.kind === "project" &&
          learner &&
          !!profile &&
          (profile.organisationSource === "released" ||
            (mapped !== undefined && profile.organisationId !== null && mapped !== profile.organisationId)),
        joinedAt: added.toISOString().slice(0, 10),
        // Auth.js sets emailVerified the first time someone uses a link.
        status: u.emailVerified ? "joined" : "pending",
        invitedAt: null,
      };
    });
    members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.email.localeCompare(b.email));

    // When was each not-yet-joined person last invited? (Audit log.)
    const byUser = new Map(members.map((m) => [m.id, m]));
    const pending = members.filter((u) => u.status === "pending").map((u) => u.id);
    if (pending.length) {
      const invites = await prisma.auditLog.findMany({
        where: {
          projectId: PROJECT,
          action: "member.invited",
          entityId: { in: pending },
        },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, createdAt: true },
      });
      for (const inv of invites) {
        const u = inv.entityId ? byUser.get(inv.entityId) : undefined;
        if (u && !u.invitedAt) u.invitedAt = inv.createdAt.toISOString().slice(0, 10);
      }
    }
    return members;
  } catch {
    return [];
  }
}

/**
 * The age a guardian's permission is recorded under, as Manage people says
 * it ("Under 16"): the minimum age of the profile step (minimumAgeFor) when
 * it is the same in every country the viewer's learners may come from (the
 * countries mapped to a partner admin's organisation; every country when
 * none is, or for an ADMIN), else null, and the screen says "the minimum
 * age in their country" (AGE_RULE=digital-consent gives BE 13 to DE 16).
 */
export function guardianAge(
  countries: readonly Country[],
  env: Record<string, string | undefined> = process.env
): number | null {
  const ages = new Set((countries.length ? countries : COUNTRIES).map((c) => minimumAgeFor(c, env)));
  return ages.size === 1 ? [...ages][0] : null;
}
