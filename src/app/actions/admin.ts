"use server";

/**
 * Admin management — organisations, cohorts and people.
 *
 * Closes the acceptance criterion "Admin manages users / orgs / cohorts".
 * All actions are ADMIN-gated within the project. The schema already carried
 * everything needed (Organisation, Cohort, Membership.organisationId/cohortId),
 * so this is pure application logic — no migration.
 *
 * Note on "adding people": sign-in is passwordless magic-link, so adding a
 * member provisions their User + Membership. By default the admin also sends
 * them an invitation email with a one-click join link (D27); they can always
 * sign in themselves at /signin with that email too. No password is ever set
 * or handled here.
 */

import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { getAdminMembers, getAdminOrgs } from "@/lib/admin-queries";
import { prisma } from "@/lib/prisma";
import { sendInvitation, type InviteOutcome } from "@/lib/invitations";
import type { Locale } from "@/lib/cms/types";
import type { Role, User } from "@prisma/client";

const PROJECT = "seq-elevate";
const LOCALES: readonly string[] = ["en", "de", "el"];

function toLocale(locale?: string): Locale {
  return (LOCALES.includes(locale ?? "") ? locale : "en") as Locale;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (await hasRole(PROJECT, "ADMIN")) ? user : null;
}

async function audit(actorId: string, action: string, entity: string, entityId: string) {
  await prisma.auditLog.create({
    data: { projectId: PROJECT, actorId, action, entity, entityId },
  });
}

/*
 * The actions that change a list on the admin screens return the list as it
 * is now, and the screen shows it at once (PeopleManager, OrgCohortManager):
 * a router.refresh() after an action sometimes doesn't show until the next
 * router update (Next 16), so the change would seem not to have happened.
 */

/* ----------------------------- Organisations ---------------------------- */

export async function createOrganisation(name: string, shortName: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (!name.trim()) return { ok: false as const, error: "name-required" };
  const org = await prisma.organisation.create({
    data: {
      projectId: PROJECT,
      name: name.trim().slice(0, 120),
      shortName: (shortName.trim() || name.trim()).slice(0, 40),
    },
  });
  await audit(admin.id, "org.created", "Organisation", org.id);
  return { ok: true as const, id: org.id, orgs: await getAdminOrgs() };
}

/** Deletes an organisation. Refuses while it still has cohorts. */
export async function deleteOrganisation(id: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  const cohorts = await prisma.cohort.count({ where: { organisationId: id } });
  if (cohorts > 0) return { ok: false as const, error: "has-cohorts" };
  await prisma.organisation.deleteMany({
    where: { id, projectId: PROJECT },
  });
  await audit(admin.id, "org.deleted", "Organisation", id);
  return { ok: true as const, orgs: await getAdminOrgs() };
}

/* -------------------------------- Cohorts ------------------------------- */

export async function createCohort(
  organisationId: string,
  name: string,
  startsAt?: string,
  endsAt?: string
) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (!name.trim()) return { ok: false as const, error: "name-required" };
  const org = await prisma.organisation.findFirst({
    where: { id: organisationId, projectId: PROJECT },
    select: { id: true },
  });
  if (!org) return { ok: false as const, error: "unknown-org" };
  const cohort = await prisma.cohort.create({
    data: {
      projectId: PROJECT,
      organisationId,
      name: name.trim().slice(0, 120),
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    },
  });
  await audit(admin.id, "cohort.created", "Cohort", cohort.id);
  return { ok: true as const, id: cohort.id, orgs: await getAdminOrgs() };
}

export async function updateCohort(
  id: string,
  patch: { name?: string; startsAt?: string | null; endsAt?: string | null }
) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  await prisma.cohort.updateMany({
    where: { id, projectId: PROJECT },
    data: {
      ...(patch.name !== undefined
        ? { name: patch.name.trim().slice(0, 120) }
        : {}),
      ...(patch.startsAt !== undefined
        ? { startsAt: patch.startsAt ? new Date(patch.startsAt) : null }
        : {}),
      ...(patch.endsAt !== undefined
        ? { endsAt: patch.endsAt ? new Date(patch.endsAt) : null }
        : {}),
    },
  });
  await audit(admin.id, "cohort.updated", "Cohort", id);
  return { ok: true as const };
}

/** Deletes a cohort; members are unassigned (Membership.cohortId → null). */
export async function deleteCohort(id: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  await prisma.cohort.deleteMany({ where: { id, projectId: PROJECT } });
  await audit(admin.id, "cohort.deleted", "Cohort", id);
  return { ok: true as const, orgs: await getAdminOrgs() };
}

/* -------------------------------- People -------------------------------- */

const ALLOWED_ROLES: Role[] = [
  "LEARNER",
  "FACILITATOR",
  "CONTENT_EDITOR",
  "ADMIN",
];

/**
 * Send (or resend) someone's invitation and audit it. Deliberately NOT
 * exported: an export from a "use server" file is a public endpoint, and
 * this sends email. Reached only via the admin-gated actions below.
 */
async function inviteUser(
  admin: User,
  user: User,
  locale: Locale
): Promise<{ outcome: InviteOutcome; reason?: string }> {
  // Someone who has signed in before doesn't need a join link.
  if (user.emailVerified) return { outcome: "already-joined" };
  const roles = (
    await prisma.membership.findMany({
      where: { userId: user.id, projectId: PROJECT },
      select: { role: true },
    })
  ).map((m) => m.role);
  const res = await sendInvitation({
    email: user.email,
    name: user.name,
    roles,
    locale,
    inviter: admin,
  });
  if (!res.ok) return { outcome: res.error, reason: res.reason };
  // Audited only once the email service has actually accepted it.
  await audit(admin.id, "member.invited", "User", user.id);
  return { outcome: "sent" };
}

/**
 * Add someone to the project by email. Creates the User if they don't exist
 * yet. With `invite`, also emails them a one-click join link in `locale`.
 * Idempotent.
 */
export async function addMember(
  email: string,
  role: Role,
  name?: string,
  opts?: { invite?: boolean; locale?: string }
) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false as const, error: "bad-email" };
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return { ok: false as const, error: "bad-role" };
  }

  const user = await prisma.user.upsert({
    where: { email: clean },
    create: { email: clean, name: name?.trim() || null },
    update: name?.trim() ? { name: name.trim() } : {},
  });
  await prisma.membership.upsert({
    where: {
      userId_projectId_role: {
        userId: user.id,
        projectId: PROJECT,
        role,
      },
    },
    create: { userId: user.id, projectId: PROJECT, role },
    update: {},
  });
  await audit(admin.id, "member.added", "User", user.id);
  const { outcome: invite, reason: inviteReason } = opts?.invite
    ? await inviteUser(admin, user, toLocale(opts.locale))
    : { outcome: "not-requested" as InviteOutcome, reason: undefined };
  const members = await getAdminMembers();
  return { ok: true as const, id: user.id, invite, inviteReason, members };
}

/** Send (again) the invitation for someone who hasn't joined yet. */
export async function resendInvitation(userId: string, locale?: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  // Only people who are actually in this project.
  const user = await prisma.user.findFirst({
    where: { id: userId, memberships: { some: { projectId: PROJECT } } },
  });
  if (!user) return { ok: false as const, error: "not-found" };
  const { outcome, reason } = await inviteUser(admin, user, toLocale(locale));
  return outcome === "sent"
    ? { ok: true as const, invite: outcome, members: await getAdminMembers() }
    : { ok: false as const, error: outcome, reason };
}

/** Replace a member's roles in the project. */
export async function setMemberRoles(userId: string, roles: Role[]) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  const wanted = roles.filter((r) => ALLOWED_ROLES.includes(r));
  if (wanted.length === 0) return { ok: false as const, error: "no-roles" };

  const existing = await prisma.membership.findMany({
    where: { userId, projectId: PROJECT },
  });
  const keep = new Set(wanted);
  // Carry the current cohort/org assignment onto any newly added role rows.
  const ref = existing[0];

  for (const m of existing) {
    if (!keep.has(m.role)) {
      await prisma.membership.delete({ where: { id: m.id } });
    }
  }
  for (const role of wanted) {
    if (!existing.some((m) => m.role === role)) {
      await prisma.membership.create({
        data: {
          userId,
          projectId: PROJECT,
          role,
          organisationId: ref?.organisationId ?? null,
          cohortId: ref?.cohortId ?? null,
        },
      });
    }
  }
  await audit(admin.id, "member.roles_changed", "User", userId);
  return { ok: true as const, members: await getAdminMembers() };
}

/** Assign (or clear) a member's cohort across their project memberships. */
export async function assignCohort(userId: string, cohortId: string | null) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  let organisationId: string | null = null;
  if (cohortId) {
    const cohort = await prisma.cohort.findFirst({
      where: { id: cohortId, projectId: PROJECT },
      select: { organisationId: true },
    });
    if (!cohort) return { ok: false as const, error: "unknown-cohort" };
    organisationId = cohort.organisationId;
  }
  await prisma.membership.updateMany({
    where: { userId, projectId: PROJECT },
    data: { cohortId, organisationId },
  });
  await audit(admin.id, "member.cohort_changed", "User", userId);
  return { ok: true as const, members: await getAdminMembers() };
}

/** Remove someone from the project (keeps their user account). */
export async function removeMember(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { ok: false as const, error: "forbidden" };
  if (userId === admin.id) return { ok: false as const, error: "self" };
  await prisma.membership.deleteMany({
    where: { userId, projectId: PROJECT },
  });
  await audit(admin.id, "member.removed", "User", userId);
  return { ok: true as const, members: await getAdminMembers() };
}
