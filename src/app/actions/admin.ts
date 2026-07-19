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
 * member provisions their User + Membership; they then sign in themselves at
 * /signin with that email. No password is ever set or handled here.
 */

import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

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
  return { ok: true as const, id: org.id };
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
  return { ok: true as const };
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
  return { ok: true as const, id: cohort.id };
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
  return { ok: true as const };
}

/* -------------------------------- People -------------------------------- */

const ALLOWED_ROLES: Role[] = [
  "LEARNER",
  "FACILITATOR",
  "CONTENT_EDITOR",
  "ADMIN",
];

/**
 * Add someone to the project by email. Creates the User if they don't exist
 * yet; they sign in themselves via magic link. Idempotent.
 */
export async function addMember(email: string, role: Role, name?: string) {
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
  return { ok: true as const, id: user.id };
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
  return { ok: true as const };
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
  return { ok: true as const };
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
  return { ok: true as const };
}
