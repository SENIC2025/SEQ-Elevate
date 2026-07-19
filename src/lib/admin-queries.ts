import "server-only";

/**
 * Read queries for the admin management screens (organisations, cohorts,
 * people). ADMIN-gated; all wrapped defensively so a DB hiccup renders an
 * empty screen rather than a crash.
 */

import { prisma } from "@/lib/prisma";
import { getProjectMemberships } from "@/lib/auth-helpers";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

export async function isAdmin() {
  try {
    const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
    return roles.includes("ADMIN");
  } catch {
    return false;
  }
}

export interface AdminCohort {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  memberCount: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  shortName: string;
  cohorts: AdminCohort[];
}

export interface AdminMember {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  cohortId: string | null;
  cohortName: string | null;
  orgName: string | null;
  joinedAt: string;
}

/** Organisations with their cohorts and member counts. */
export async function getAdminOrgs(): Promise<AdminOrg[] | null> {
  if (!(await isAdmin())) return null;
  try {
    const orgs = await prisma.organisation.findMany({
      where: { projectId: PROJECT },
      include: {
        cohorts: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { memberships: true } } },
        },
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
        memberCount: c._count.memberships,
      })),
    }));
  } catch {
    return [];
  }
}

/** Everyone in the project, grouped by user with their roles + cohort. */
export async function getAdminMembers(): Promise<AdminMember[] | null> {
  if (!(await isAdmin())) return null;
  try {
    const rows = await prisma.membership.findMany({
      where: { projectId: PROJECT },
      include: { user: true, cohort: true, organisation: true },
      orderBy: { createdAt: "asc" },
    });
    const byUser = new Map<string, AdminMember>();
    for (const m of rows) {
      const existing = byUser.get(m.userId);
      if (existing) {
        if (!existing.roles.includes(m.role)) existing.roles.push(m.role);
        // Prefer whichever row actually carries a cohort.
        if (!existing.cohortId && m.cohortId) {
          existing.cohortId = m.cohortId;
          existing.cohortName = m.cohort?.name ?? null;
          existing.orgName = m.organisation?.name ?? null;
        }
        continue;
      }
      byUser.set(m.userId, {
        id: m.userId,
        email: m.user.email,
        name: m.user.name,
        roles: [m.role],
        cohortId: m.cohortId,
        cohortName: m.cohort?.name ?? null,
        orgName: m.organisation?.name ?? null,
        joinedAt: m.createdAt.toISOString().slice(0, 10),
      });
    }
    return [...byUser.values()];
  } catch {
    return [];
  }
}
