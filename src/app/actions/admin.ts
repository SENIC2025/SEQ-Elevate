"use server";

/**
 * Admin management — organisations, cohorts and people.
 *
 * Closes the acceptance criterion "Admin manages users / orgs / cohorts".
 *
 * Release 3 (D74, D76, D101, spec 3.4 SP16–SP26, 6.3): who may do what is
 * decided by two things, as everywhere else (src/lib/scope.ts):
 * - the role says which powers: people managers are ADMINs and partner
 *   admins (canManagePeople); an ADMIN grants every role, a partner admin
 *   only LEARNER and FACILITATOR (grantableRoles), and changes or removes
 *   only people whose every role it could grant itself, so one partner
 *   admin never demotes another, or an editor;
 * - the scope says whose data: an ADMIN the whole project, a partner admin
 *   its own organisation's people (never an ADMIN holder or an ADMIN_EMAILS
 *   address). Someone outside it is answered as someone unknown.
 * Organisations, the country mapping and anyone's country or organisation
 * are an ADMIN's only (the ADMIN role and project scope, requireAdminProject).
 *
 * A person's organisation is their profile's (D72), and only
 * setPersonOrganisation writes it (D101): a change unshares their Comp Card
 * and clears another organisation's cohort, in the same transaction.
 * Membership.organisationId is no longer written. No one sets their own.
 *
 * Every change is audited with the scope it was made in (no personal data
 * in the metadata).
 *
 * Note on "adding people": sign-in is passwordless magic-link, so adding a
 * member provisions their User + Membership. By default the admin also sends
 * them an invitation email with a one-click join link (D27); they can always
 * sign in themselves at /signin with that email too. No password is ever set
 * or handled here.
 */

import type { Prisma, Role, User } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth-helpers";
import { getAdminMembers, getAdminOrgs, getCountryMappings } from "@/lib/admin-queries";
import { parseAdminEmails } from "@/lib/admin-bootstrap";
import { isCountry } from "@/lib/countries";
import { TELEMETRY_ACTIONS } from "@/lib/gdpr-export";
import { releaseIfCountryElsewhere, setPersonOrganisation, type OrganisationSource } from "@/lib/person-organisation";
import { canManagePeople, grantableRoles, seesWholeProject } from "@/lib/permissions";
import { parseProfileInput } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  cohortInScope,
  getViewer,
  inScope,
  membershipsInScope,
  organisationsInScope,
  requireAdminProject,
  type Scope,
} from "@/lib/scope";
import { prisma } from "@/lib/prisma";
import { sendInvitation, type InviteOutcome } from "@/lib/invitations";
import type { Locale } from "@/lib/cms/types";

const PROJECT = "seq-elevate";
const LOCALES: readonly string[] = ["en", "de", "el"];

function toLocale(locale?: string): Locale {
  return (LOCALES.includes(locale ?? "") ? locale : "en") as Locale;
}

type Db = Prisma.TransactionClient | typeof prisma;
type InScope = Exclude<Scope, { kind: "none" }>;

/** Someone who may manage people, and what they may do. */
interface Manager {
  /** The whole user row, for the invitation's "from" (cached per request). */
  user: User;
  scope: InScope;
  /** The roles they may grant, change and remove (grantableRoles). */
  grantable: readonly Role[];
  /** An ADMIN with project scope: organisations, the mapping, countries. */
  admin: boolean;
}

/**
 * The signed-in people manager (an ADMIN, or a partner admin of an
 * organisation), with their scope, else null. No scope (an incomplete
 * profile of their own, partner access off, no organisation) is no power.
 */
async function requirePeopleManager(): Promise<Manager | null> {
  const viewer = await getViewer();
  if (!viewer.user || !canManagePeople(viewer.roles) || viewer.scope.kind === "none") return null;
  const user = await getCurrentUser();
  if (!user || user.id !== viewer.user.id) return null;
  return {
    user,
    scope: viewer.scope,
    grantable: grantableRoles(viewer.roles),
    admin: seesWholeProject(viewer.roles) && viewer.scope.kind === "project",
  };
}

/** The signed-in ADMIN with project scope (requireAdminProject), else null. */
async function requireAdmin(): Promise<{ user: User; scope: InScope } | null> {
  const viewer = await requireAdminProject();
  if (!viewer?.user || viewer.scope.kind === "none") return null;
  const user = await getCurrentUser();
  return user && user.id === viewer.user.id ? { user, scope: viewer.scope } : null;
}

/** "project", or the partner admin's organisation: where a change was made. */
const scopeLabel = (scope: InScope) => (scope.kind === "project" ? "project" : scope.organisationId);

async function audit(
  db: Db,
  actorId: string,
  action: string,
  entity: string,
  entityId: string | null,
  scope: InScope,
  extra: Record<string, string | number | boolean> = {}
) {
  await db.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity,
      entityId,
      metadata: { scope: scopeLabel(scope), ...extra },
    },
  });
}

/** The organisation `id`, if it is one the scope covers. */
async function organisationInScope(scope: InScope, id: unknown): Promise<boolean> {
  if (typeof id !== "string" || !id) return false;
  const count = await prisma.organisation.count({ where: { AND: [{ id }, organisationsInScope(scope)] } });
  return count > 0;
}

/**
 * Thrown inside a transaction when what was checked before it no longer
 * holds (someone changed the person meanwhile): the transaction rolls back
 * and the caller answers instead.
 */
class ChangedMeanwhile extends Error {}

/** A name by the profile step's rule: 1–50 characters, no line breaks or hidden characters. */
function cleanName(raw: unknown): string | null {
  const parsed = parseProfileInput(
    { name: raw },
    { completed: true, nameRequired: true, termsCurrent: true, guardianConsentRecorded: false, consent: "off" }
  );
  return parsed.ok && parsed.value.name ? parsed.value.name : null;
}

/*
 * The actions that change a list on the admin screens return the list as it
 * is now, read with the caller's scope (spec 3.4 SP24), and the screen shows
 * it at once (PeopleManager, OrgCohortManager): a router.refresh() after an
 * action sometimes doesn't show until the next router update (Next 16), so
 * the change would seem not to have happened.
 */

/* ----------------------------- Organisations ---------------------------- */

export async function createOrganisation(name: string, shortName: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (typeof name !== "string" || !name.trim()) return { ok: false as const, error: "name-required" };
  const short = typeof shortName === "string" ? shortName.trim() : "";
  const org = await prisma.organisation.create({
    data: {
      projectId: PROJECT,
      name: name.trim().slice(0, 120),
      shortName: (short || name.trim()).slice(0, 40),
    },
  });
  await audit(prisma, admin.user.id, "org.created", "Organisation", org.id, admin.scope);
  return { ok: true as const, id: org.id, orgs: await getAdminOrgs(admin.scope) };
}

/**
 * Deletes an organisation. Refuses while it still has cohorts, a country is
 * mapped to it, or anyone's profile names it (the database refuses the last
 * two as well, whatever code tries).
 */
export async function deleteOrganisation(id: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (!(await organisationInScope(admin.scope, id))) return { ok: false as const, error: "unknown-org" };
  const [cohorts, mappings, people] = await Promise.all([
    prisma.cohort.count({ where: { organisationId: id } }),
    prisma.countryMapping.count({ where: { organisationId: id } }),
    prisma.projectProfile.count({ where: { projectId: PROJECT, organisationId: id } }),
  ]);
  if (cohorts > 0) return { ok: false as const, error: "has-cohorts" };
  if (mappings > 0) return { ok: false as const, error: "has-mapping" };
  if (people > 0) return { ok: false as const, error: "has-people" };
  try {
    await prisma.organisation.deleteMany({ where: { id, projectId: PROJECT } });
  } catch (e) {
    // A profile or mapping made since the counts above: the database's
    // foreign key refuses (P2003).
    if ((e as { code?: string }).code === "P2003") return { ok: false as const, error: "has-people" };
    throw e;
  }
  await audit(prisma, admin.user.id, "org.deleted", "Organisation", id, admin.scope);
  return { ok: true as const, orgs: await getAdminOrgs(admin.scope) };
}

/**
 * Which organisation supports learners from `country` (D73, Q24). With
 * `assignUnplaced`, the same transaction also gives that organisation to
 * every learner whose completed profile names the country and who has none,
 * except those the profile step released for an ADMIN to check (spec 5.4).
 */
export async function setCountryMapping(
  country: string,
  organisationId: string,
  opts?: { assignUnplaced?: boolean }
) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (!isCountry(country)) return { ok: false as const, error: "bad-country" };
  if (!(await organisationInScope(admin.scope, organisationId))) return { ok: false as const, error: "unknown-org" };

  const placed = await prisma.$transaction(async (tx) => {
    await tx.countryMapping.upsert({
      where: { projectId_country: { projectId: PROJECT, country } },
      create: { projectId: PROJECT, country, organisationId },
      update: { organisationId },
    });
    let count = 0;
    if (opts?.assignUnplaced === true) {
      const unplaced = await tx.projectProfile.findMany({
        where: {
          projectId: PROJECT,
          country,
          organisationId: null,
          profileCompletedAt: { not: null },
          OR: [{ organisationSource: null }, { organisationSource: { not: "released" } }],
          // Learners only: a staff member's organisation never follows a country.
          user: { memberships: { none: { projectId: PROJECT, role: { not: "LEARNER" } } } },
        },
        select: { userId: true },
      });
      for (const { userId } of unplaced) {
        const { changed } = await setPersonOrganisation(tx, userId, organisationId, {
          actorId: admin.user.id,
          source: "country",
          scope: scopeLabel(admin.scope),
        });
        if (changed) count += 1;
      }
    }
    await audit(tx, admin.user.id, "org.country_mapped", "CountryMapping", country, admin.scope, {
      organisationId,
      placed: count,
    });
    return count;
  });
  return {
    ok: true as const,
    placed,
    mappings: await getCountryMappings(admin.scope),
    orgs: await getAdminOrgs(admin.scope),
  };
}

/* -------------------------------- Cohorts ------------------------------- */

/** A cohort, in an organisation the manager's scope covers (SP17). */
export async function createCohort(
  organisationId: string,
  name: string,
  startsAt?: string,
  endsAt?: string
) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (typeof name !== "string" || !name.trim()) return { ok: false as const, error: "name-required" };
  // Another organisation's is answered as an unknown one.
  if (!(await organisationInScope(m.scope, organisationId))) return { ok: false as const, error: "unknown-org" };
  const cohort = await prisma.cohort.create({
    data: {
      projectId: PROJECT,
      organisationId,
      name: name.trim().slice(0, 120),
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    },
  });
  await audit(prisma, m.user.id, "cohort.created", "Cohort", cohort.id, m.scope);
  return { ok: true as const, id: cohort.id, orgs: await getAdminOrgs(m.scope) };
}

/** Renames a cohort or changes its dates: only a cohort in scope (SP18). */
export async function updateCohort(
  id: string,
  patch: { name?: string; startsAt?: string | null; endsAt?: string | null }
) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (!(await cohortInScope(m.scope, id))) return { ok: false as const, error: "unknown-cohort" };
  const p = patch && typeof patch === "object" ? patch : {};
  if (p.name !== undefined && (typeof p.name !== "string" || !p.name.trim())) {
    return { ok: false as const, error: "name-required" };
  }
  await prisma.cohort.updateMany({
    where: { id, projectId: PROJECT },
    data: {
      ...(p.name !== undefined ? { name: p.name.trim().slice(0, 120) } : {}),
      ...(p.startsAt !== undefined ? { startsAt: p.startsAt ? new Date(p.startsAt) : null } : {}),
      ...(p.endsAt !== undefined ? { endsAt: p.endsAt ? new Date(p.endsAt) : null } : {}),
    },
  });
  await audit(prisma, m.user.id, "cohort.updated", "Cohort", id, m.scope);
  return { ok: true as const, orgs: await getAdminOrgs(m.scope) };
}

/**
 * Deletes a cohort in scope (SP18); members are unassigned (Membership.cohortId → null).
 * Only by someone shown everyone in it: the question before it counts the
 * members the viewer is shown (getAdminOrgs), so a partner admin can't delete
 * a cohort that holds someone it isn't shown (an ADMIN, an ADMIN_EMAILS
 * address, someone of another organisation) — that answers "has-others",
 * and nothing changes (D76: a partner admin never touches ADMIN holders).
 */
export async function deleteCohort(id: string) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (!(await cohortInScope(m.scope, id))) return { ok: false as const, error: "unknown-cohort" };
  const refused = await prisma.$transaction(async (tx) => {
    if (m.scope.kind !== "project") {
      const others = await tx.membership.count({ where: { cohortId: id, NOT: membershipsInScope(m.scope) } });
      if (others > 0) return true;
    }
    await tx.cohort.deleteMany({ where: { id, projectId: PROJECT } });
    return false;
  });
  if (refused) return { ok: false as const, error: "has-others" };
  await audit(prisma, m.user.id, "cohort.deleted", "Cohort", id, m.scope);
  return { ok: true as const, orgs: await getAdminOrgs(m.scope) };
}

/* -------------------------------- People -------------------------------- */

const ROLES: readonly Role[] = ["LEARNER", "FACILITATOR", "CONTENT_EDITOR", "PARTNER_ADMIN", "ADMIN"];
const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

/**
 * May `m` change `userId`? Only someone in their scope (anyone else is
 * "not-found", as someone who doesn't exist), and, for a partner admin,
 * only someone whose every current role it may grant itself (never another
 * partner admin, an editor or an admin). Answers the person's roles.
 */
async function manageable(
  m: Manager,
  userId: unknown
): Promise<{ ok: true; roles: Role[] } | { ok: false; error: "not-found" | "not-grantable" }> {
  if (!(await inScope(m.scope, userId))) return { ok: false, error: "not-found" };
  const roles = (
    await prisma.membership.findMany({
      where: { userId: userId as string, projectId: PROJECT },
      select: { role: true },
    })
  ).map((r) => r.role);
  if (!roles.every((r) => m.grantable.includes(r))) return { ok: false, error: "not-grantable" };
  return { ok: true, roles };
}

/**
 * Send (or resend) someone's invitation and audit it. Deliberately NOT
 * exported: an export from a "use server" file is a public endpoint, and
 * this sends email. Reached only via the people actions below, for someone
 * they have already checked is in scope.
 */
async function inviteUser(
  m: Manager,
  user: { id: string; email: string; name: string | null; emailVerified: Date | null },
  locale: Locale
): Promise<{ outcome: InviteOutcome; reason?: string }> {
  // Someone who has signed in before doesn't need a join link.
  if (user.emailVerified) return { outcome: "already-joined" };
  const roles = (
    await prisma.membership.findMany({
      where: { userId: user.id, projectId: PROJECT },
      select: { role: true },
    })
  ).map((r) => r.role);
  const res = await sendInvitation({
    email: user.email,
    name: user.name,
    roles,
    locale,
    inviter: m.user,
  });
  if (!res.ok) return { outcome: res.error, reason: res.reason };
  // Audited only once the email service has actually accepted it.
  await audit(prisma, m.user.id, "member.invited", "User", user.id, m.scope);
  return { outcome: "sent" };
}

/** Why addMember refused, as the screen is told (never more). */
type AddRefusal =
  | "bad-email"
  | "bad-role"
  | "bad-name"
  | "unknown-org"
  | "guardian-learner-only"
  | "guardian-not-needed"
  | "self"
  | "has-organisation"
  | "out-of-scope"
  | "rate-limited";

/** Refusals a manager may get from addMember in an hour before every add is refused (spec 6.3). */
const ADD_REFUSALS = { limit: 30, windowMs: 60 * 60 * 1000 };

/**
 * Refuses an add: audited (member.add_refused, with the reason and never
 * the address) and counted against the manager's limit (add-by:, which
 * fails closed: an error of the limiter counts as over it), so probing for
 * whose address is in use elsewhere is slow and shows in the log. Over the
 * limit, the answer is only "rate-limited".
 */
async function refuseAdd(m: Manager, reason: AddRefusal) {
  await audit(prisma, m.user.id, "member.add_refused", "User", null, m.scope, { reason });
  let limited: boolean;
  try {
    limited = !(await checkRateLimit(`add-by:${m.user.id}`, ADD_REFUSALS)).ok;
  } catch {
    limited = true;
  }
  return { ok: false as const, error: limited ? ("rate-limited" as const) : reason };
}

/**
 * May a partner admin take on this account (spec 3.4 SP19, 5.6)? Only one
 * that holds nothing yet: no organisation, a profile step never completed,
 * no role but LEARNER, never an ADMIN or ADMIN_EMAILS address, and no
 * learner data in the project (no course started, no Comp Card, no badge,
 * no activity record — time on lessons, a course opened, a video answer —
 * and no note or validation about them).
 */
async function claimable(userId: string, email: string): Promise<boolean> {
  if (parseAdminEmails(process.env.ADMIN_EMAILS).has(email.trim().toLowerCase())) return false;
  const count = await prisma.user.count({
    where: {
      AND: [
        { id: userId },
        { memberships: { none: { projectId: PROJECT, role: { not: "LEARNER" } } } },
        {
          profiles: {
            none: {
              projectId: PROJECT,
              OR: [{ organisationId: { not: null } }, { profileCompletedAt: { not: null } }],
            },
          },
        },
        { enrollments: { none: { course: { projectId: PROJECT } } } },
        { compCards: { none: { projectId: PROJECT } } },
        { badges: { none: { badge: { projectId: PROJECT } } } },
        { auditEvents: { none: { action: { in: [...TELEMETRY_ACTIONS] } } } },
        { observedNotes: { none: {} } },
        { validatedNotes: { none: {} } },
      ],
    },
  });
  return count > 0;
}

/**
 * Add someone to the project by email, with one role. Creates the User if
 * they don't exist yet. With `invite`, also emails them a one-click join
 * link in `locale`. Idempotent.
 *
 * The address may be (spec 3.4 SP19, 6.3):
 * - new: the account is made, in the partner admin's organisation, or the
 *   one an ADMIN picks (or none, for SENIC staff);
 * - someone in the manager's scope: the role is added; the name only while
 *   they have never completed the profile step; their organisation never
 *   changes (an ADMIN asking for another one is told "has-organisation",
 *   and uses "Change country or organisation");
 * - an account a partner admin may claim (claimable): added, and given the
 *   partner admin's organisation;
 * - anyone else: "out-of-scope", and nothing is added or renamed. An ADMIN
 *   reaches everyone; no one adds their own address ("self", D81).
 * `guardianConsent` (learners only) records that the organisation holds a
 * parent's or guardian's permission, and `guardianSharing` that it covers
 * sharing the Comp Card (spec 5.6); only before the person's own profile
 * step. User, membership and profile change in one transaction.
 */
export async function addMember(
  email: string,
  role: Role,
  name?: string,
  opts?: {
    invite?: boolean;
    locale?: string;
    /** An ADMIN's choice (null or absent: none). A partner admin's people are in its own. */
    organisationId?: string | null;
    guardianConsent?: boolean;
    guardianSharing?: boolean;
  }
) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  // Over the limit, every add is refused until the hour has passed, before
  // anyone is looked up: counted from the refusals' own log rows, which the
  // log viewer shows.
  const refusedThisHour = await prisma.auditLog.count({
    where: {
      projectId: PROJECT,
      action: "member.add_refused",
      actorId: m.user.id,
      createdAt: { gte: new Date(Date.now() - ADD_REFUSALS.windowMs) },
    },
  });
  if (refusedThisHour >= ADD_REFUSALS.limit) return refuseAdd(m, "rate-limited");

  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return refuseAdd(m, "bad-email");
  if (!isRole(role) || !m.grantable.includes(role)) return refuseAdd(m, "bad-role");
  const typedName = typeof name === "string" && name.trim() ? name : null;
  const newName = typedName === null ? null : cleanName(typedName);
  if (typedName !== null && newName === null) return refuseAdd(m, "bad-name");
  const guardian = opts?.guardianConsent === true;
  const guardianSharing = guardian && opts?.guardianSharing === true;
  if (guardian && role !== "LEARNER") return refuseAdd(m, "guardian-learner-only");

  // The organisation a new or claimed person gets.
  let organisationId: string | null;
  if (m.scope.kind === "organisation") {
    organisationId = m.scope.organisationId;
  } else {
    organisationId = opts?.organisationId ?? null;
    if (organisationId !== null && !(await organisationInScope(m.scope, organisationId))) {
      return refuseAdd(m, "unknown-org");
    }
  }
  if (clean === m.user.email.trim().toLowerCase()) return refuseAdd(m, "self");
  // An ADMIN_EMAILS address is an ADMIN's, whether or not it has an account
  // yet: only an ADMIN adds it, and so sets its organisation (D81).
  if (m.scope.kind === "organisation" && parseAdminEmails(process.env.ADMIN_EMAILS).has(clean)) {
    return refuseAdd(m, "out-of-scope");
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: clean, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  // Whether the address is one this manager may add, before anything about
  // the person is looked at or told. Outside an ADMIN's scope is outside the
  // project: theirs to add.
  if (
    existing &&
    m.scope.kind === "organisation" &&
    !(await inScope(m.scope, existing.id)) &&
    !(await claimable(existing.id, existing.email))
  ) {
    return refuseAdd(m, "out-of-scope");
  }
  const [profile, held] = existing
    ? await Promise.all([
        prisma.projectProfile.findUnique({
          where: { userId_projectId: { userId: existing.id, projectId: PROJECT } },
          select: { organisationId: true, profileCompletedAt: true, ageRule: true },
        }),
        prisma.membership.findMany({ where: { userId: existing.id, projectId: PROJECT }, select: { role: true } }),
      ])
    : [null, []];
  // A partner admin changes only people whose every role it may grant.
  if (held.some((h) => !m.grantable.includes(h.role))) return refuseAdd(m, "out-of-scope");
  const currentOrganisation = profile?.organisationId ?? null;
  if (m.scope.kind === "project" && organisationId !== null && currentOrganisation !== null && currentOrganisation !== organisationId) {
    return refuseAdd(m, "has-organisation");
  }
  if (guardian && held.some((h) => h.role !== "LEARNER")) return refuseAdd(m, "guardian-learner-only");
  // After the profile step a guardian's permission is needed only by
  // someone who confirmed it there: an invited learner whose record went
  // with the organisation that made it (setPersonOrganisation) gets one
  // from their organisation now.
  if (guardian && profile?.profileCompletedAt && profile.ageRule !== "INVITED_WITH_GUARDIAN_CONSENT") {
    return refuseAdd(m, "guardian-not-needed");
  }

  const source: OrganisationSource = m.admin ? "admin" : "partner-admin";
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      if (existing) {
        // What was checked above still holds: their organisation, and whether
        // they have done the profile step (the row is locked from here on).
        // The row is made first if there is none, so the lock always holds
        // one: a profile step making it at this moment is waited for, and
        // what it wrote is seen below (an insert that does nothing when the
        // row is there; rolled back with the rest when anything is refused).
        await tx.projectProfile.createMany({
          data: [{ userId: existing.id, projectId: PROJECT }],
          skipDuplicates: true,
        });
        await tx.$queryRaw`SELECT 1 FROM "ProjectProfile" WHERE "userId" = ${existing.id} AND "projectId" = ${PROJECT} FOR UPDATE`;
        const now = await tx.projectProfile.findUnique({
          where: { userId_projectId: { userId: existing.id, projectId: PROJECT } },
          select: { organisationId: true, profileCompletedAt: true },
        });
        if ((now?.organisationId ?? null) !== currentOrganisation || !!now?.profileCompletedAt !== !!profile?.profileCompletedAt) {
          throw new ChangedMeanwhile();
        }
      }
      const id = existing
        ? existing.id
        : (await tx.user.create({ data: { email: clean, name: newName }, select: { id: true } })).id;
      // A name typed here replaces one only while the person has never
      // completed the profile step (after it, it is theirs, and changed only
      // with "Change details").
      if (existing && newName !== null && !profile?.profileCompletedAt) {
        await tx.user.update({ where: { id }, data: { name: newName } });
      }
      await tx.membership.upsert({
        where: { userId_projectId_role: { userId: id, projectId: PROJECT, role } },
        create: { userId: id, projectId: PROJECT, role },
        update: {},
      });
      // An organisation only for someone who has none yet (D101).
      if (organisationId !== null && currentOrganisation === null) {
        await setPersonOrganisation(tx, id, organisationId, {
          actorId: m.user.id,
          source,
          scope: scopeLabel(m.scope),
        });
      }
      // Someone removed (no role left) and added again as a learner: the
      // profile step's organisation rule, as for anyone who becomes a
      // learner after it (releaseIfCountryElsewhere).
      if (existing && held.length === 0 && role === "LEARNER") {
        await releaseIfCountryElsewhere(tx, id, { actorId: m.user.id, scope: scopeLabel(m.scope) });
      }
      if (guardian) {
        const now = new Date();
        const recorded = await tx.projectProfile.upsert({
          where: { userId_projectId: { userId: id, projectId: PROJECT } },
          create: {
            userId: id,
            projectId: PROJECT,
            guardianConsentRecordedAt: now,
            guardianSharingConsentAt: guardianSharing ? now : null,
          },
          update: { guardianConsentRecordedAt: now, guardianSharingConsentAt: guardianSharing ? now : null },
          select: { id: true },
        });
        await audit(tx, m.user.id, "member.guardian_consent_recorded", "ProjectProfile", recorded.id, m.scope, {
          sharing: guardianSharing,
        });
      }
      await audit(tx, m.user.id, "member.added", "User", id, m.scope);
      return id;
    });
  } catch (e) {
    if (e instanceof ChangedMeanwhile) return { ok: false as const, error: "changed" as const };
    throw e;
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerified: true },
  });
  const { outcome: invite, reason: inviteReason } = opts?.invite
    ? await inviteUser(m, user, toLocale(opts.locale))
    : { outcome: "not-requested" as InviteOutcome, reason: undefined };
  const members = await getAdminMembers(m.scope);
  return { ok: true as const, id: userId, invite, inviteReason, members };
}

/** Send (again) the invitation for someone in scope who hasn't joined yet (SP20). */
export async function resendInvitation(userId: string, locale?: string) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (!(await inScope(m.scope, userId))) return { ok: false as const, error: "not-found" };
  const user = await prisma.user.findFirst({
    where: { id: userId, memberships: { some: { projectId: PROJECT } } },
    select: { id: true, email: true, name: true, emailVerified: true },
  });
  if (!user) return { ok: false as const, error: "not-found" };
  const { outcome, reason } = await inviteUser(m, user, toLocale(locale));
  return outcome === "sent"
    ? { ok: true as const, invite: outcome, members: await getAdminMembers(m.scope) }
    : { ok: false as const, error: outcome, reason };
}

/**
 * Replace a member's roles in the project (SP21). Only someone in scope;
 * a partner admin only someone whose current roles it may grant, and only
 * to roles it may grant. Never one's own Admin role: the admin would lose
 * this screen at once, and only another admin could give it back (as
 * removeMember refuses removing oneself). New role rows get no organisation
 * (the profile holds it) and keep the person's cohort. Someone made a
 * learner only (from a staff role, or from none) gets the profile step's
 * organisation rule in the same transaction (releaseIfCountryElsewhere): a
 * partner admin's organisation is released when the country they gave is
 * another organisation's.
 */
export async function setMemberRoles(userId: string, roles: Role[]) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  const asked: unknown[] = Array.isArray(roles) ? roles : [];
  const wanted = [...new Set(asked.filter(isRole))];
  if (wanted.length === 0) return { ok: false as const, error: "no-roles" };
  const target = await manageable(m, userId);
  if (!target.ok) return { ok: false as const, error: target.error };
  if (asked.some((r) => !isRole(r) || !m.grantable.includes(r))) {
    return { ok: false as const, error: "not-grantable" };
  }
  if (userId === m.user.id && target.roles.includes("ADMIN") && !wanted.includes("ADMIN")) {
    return { ok: false as const, error: "own-admin" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findMany({
        where: { userId, projectId: PROJECT },
        select: { id: true, role: true, cohortId: true },
      });
      // Given a role meanwhile that this manager may not change: left as is.
      if (!existing.every((r) => m.grantable.includes(r.role))) throw new ChangedMeanwhile();
      const keep = new Set(wanted);
      const cohortId = existing.find((r) => r.cohortId)?.cohortId ?? null;
      for (const row of existing) {
        if (!keep.has(row.role)) await tx.membership.delete({ where: { id: row.id } });
      }
      for (const role of wanted) {
        if (!existing.some((row) => row.role === role)) {
          await tx.membership.create({ data: { userId, projectId: PROJECT, role, cohortId } });
        }
      }
      await audit(tx, m.user.id, "member.roles_changed", "User", userId, m.scope);
      const becomesLearner =
        wanted.every((r) => r === "LEARNER") && (existing.length === 0 || existing.some((r) => r.role !== "LEARNER"));
      if (becomesLearner) {
        await releaseIfCountryElsewhere(tx, userId, { actorId: m.user.id, scope: scopeLabel(m.scope) });
      }
    });
  } catch (e) {
    if (e instanceof ChangedMeanwhile) return { ok: false as const, error: "not-grantable" as const };
    throw e;
  }
  return { ok: true as const, members: await getAdminMembers(m.scope) };
}

/**
 * Put a member in a cohort of their own organisation, or in none (SP22).
 * Never changes anyone's organisation: a cohort of another organisation
 * than the person's is refused.
 */
export async function assignCohort(userId: string, cohortId: string | null) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  const target = await manageable(m, userId);
  if (!target.ok) return { ok: false as const, error: target.error };
  if (cohortId !== null) {
    if (!(await cohortInScope(m.scope, cohortId))) return { ok: false as const, error: "unknown-cohort" };
    const [cohort, profile] = await Promise.all([
      prisma.cohort.findFirst({ where: { id: cohortId, projectId: PROJECT }, select: { organisationId: true } }),
      prisma.projectProfile.findUnique({
        where: { userId_projectId: { userId, projectId: PROJECT } },
        select: { organisationId: true },
      }),
    ]);
    if (!cohort || !profile?.organisationId || cohort.organisationId !== profile.organisationId) {
      return { ok: false as const, error: "cohort-other-organisation" };
    }
  }
  await prisma.membership.updateMany({
    where: { userId, projectId: PROJECT },
    data: { cohortId },
  });
  await audit(prisma, m.user.id, "member.cohort_changed", "User", userId, m.scope);
  return { ok: true as const, members: await getAdminMembers(m.scope) };
}

/**
 * Remove someone from the project (SP23): their roles go; their account,
 * profile and organisation stay (Q29). Never oneself; a partner admin only
 * someone whose roles it may grant.
 */
export async function removeMember(userId: string) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (userId === m.user.id) return { ok: false as const, error: "self" };
  const target = await manageable(m, userId);
  if (!target.ok) return { ok: false as const, error: target.error };
  // A partner admin's removal takes only the roles it may grant, even one
  // given meanwhile.
  await prisma.membership.deleteMany({
    where: { userId, projectId: PROJECT, ...(m.admin ? {} : { role: { in: [...m.grantable] } }) },
  });
  await audit(prisma, m.user.id, "member.removed", "User", userId, m.scope);
  return { ok: true as const, members: await getAdminMembers(m.scope) };
}

/**
 * Change someone's name, country or organisation (SP26).
 * - The name: by a people manager, for someone they may change; 1–50
 *   characters, as the profile step asks.
 * - The country and the organisation: by an ADMIN only (Q24), never on
 *   their own profile (D81). For a learner, a new country also brings the
 *   organisation the country is mapped to (none when it isn't), unless an
 *   organisation is given; a staff member's organisation never follows a
 *   country. Every organisation change goes through setPersonOrganisation
 *   (Comp Card unshared, other organisations' cohorts cleared, audited).
 */
export async function updatePersonProfile(
  userId: string,
  changes: { name?: string; country?: string; organisationId?: string | null }
) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  const c = changes && typeof changes === "object" ? changes : {};
  const wantsName = c.name !== undefined;
  const wantsCountry = c.country !== undefined;
  const wantsOrganisation = c.organisationId !== undefined;
  if (!wantsName && !wantsCountry && !wantsOrganisation) return { ok: false as const, error: "nothing-to-change" };

  // A person's country and organisation are an ADMIN's to change.
  const admin = await requireAdmin();
  if ((wantsCountry || wantsOrganisation) && !admin) return { ok: false as const, error: "forbidden" };
  if ((wantsCountry || wantsOrganisation) && userId === m.user.id) return { ok: false as const, error: "self" };

  const target = await manageable(m, userId);
  if (!target.ok) return { ok: false as const, error: target.error };

  const name = wantsName ? cleanName(c.name) : null;
  if (wantsName && name === null) return { ok: false as const, error: "bad-name" };
  if (wantsCountry && !isCountry(c.country)) return { ok: false as const, error: "bad-country" };
  const organisationId = wantsOrganisation ? (c.organisationId ?? null) : undefined;
  if (organisationId && !(await organisationInScope(m.scope, organisationId))) {
    return { ok: false as const, error: "unknown-org" };
  }

  const staff = target.roles.some((r) => r !== "LEARNER");
  await prisma.$transaction(async (tx) => {
    if (name !== null) {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
      if (before?.name !== name) {
        await tx.user.update({ where: { id: userId }, data: { name } });
        await audit(tx, m.user.id, "person.name_changed", "User", userId, m.scope);
      }
    }
    let organisation = organisationId;
    if (wantsCountry && isCountry(c.country)) {
      const before = await tx.projectProfile.findUnique({
        where: { userId_projectId: { userId, projectId: PROJECT } },
        select: { country: true },
      });
      const profile = await tx.projectProfile.upsert({
        where: { userId_projectId: { userId, projectId: PROJECT } },
        create: { userId, projectId: PROJECT, country: c.country },
        update: { country: c.country },
        select: { id: true },
      });
      if (before?.country !== c.country) {
        await audit(tx, m.user.id, "person.country_changed", "ProjectProfile", profile.id, m.scope);
        // A learner moves with their country, unless an organisation is given.
        if (organisation === undefined && !staff) {
          const mapped = await tx.countryMapping.findUnique({
            where: { projectId_country: { projectId: PROJECT, country: c.country } },
            select: { organisationId: true },
          });
          organisation = mapped?.organisationId ?? null;
        }
      }
    }
    if (organisation !== undefined) {
      await setPersonOrganisation(tx, userId, organisation, {
        actorId: m.user.id,
        source: "admin",
        scope: scopeLabel(m.scope),
      });
    }
  });
  return { ok: true as const, members: await getAdminMembers(m.scope) };
}

/**
 * Record whether a learner's guardian's permission also covers sharing
 * their Comp Card with the organisation's facilitators (spec 5.6, SP19a).
 * Only for a learner in scope (holding LEARNER only) whose guardian's
 * permission was recorded when they were added. Taking it back also
 * unshares the card, at once.
 */
export async function setGuardianSharing(userId: string, on: boolean) {
  const m = await requirePeopleManager();
  if (!m) return { ok: false as const, error: "forbidden" };
  if (typeof on !== "boolean") return { ok: false as const, error: "bad-input" };
  const target = await manageable(m, userId);
  if (!target.ok) return { ok: false as const, error: target.error };
  if (target.roles.length !== 1 || target.roles[0] !== "LEARNER") return { ok: false as const, error: "not-learner" };
  const profile = await prisma.projectProfile.findUnique({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    select: { id: true, guardianConsentRecordedAt: true, guardianSharingConsentAt: true },
  });
  if (!profile?.guardianConsentRecordedAt) return { ok: false as const, error: "no-guardian-consent" };

  await prisma.$transaction(async (tx) => {
    await tx.projectProfile.update({
      where: { id: profile.id },
      data: { guardianSharingConsentAt: on ? (profile.guardianSharingConsentAt ?? new Date()) : null },
    });
    if (!on) {
      await tx.compCard.updateMany({
        where: { userId, projectId: PROJECT },
        data: { privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null },
      });
    }
    await audit(tx, m.user.id, "member.guardian_consent_recorded", "ProjectProfile", profile.id, m.scope, {
      sharing: on,
    });
  });
  return { ok: true as const, members: await getAdminMembers(m.scope) };
}
