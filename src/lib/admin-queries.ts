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
import { membershipsInScope, organisationsInScope, type Scope } from "@/lib/scope";
import type { Country, Role } from "@prisma/client";

const PROJECT = "seq-elevate";

export interface AdminCohort {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  /** The people in it: someone with two roles is one member. */
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
  /** Their organisation in the project, from their profile (D72), never a membership row. */
  organisationId: string | null;
  orgName: string | null;
  /** The country on their profile, if they gave one (spec 5.2). */
  country: Country | null;
  /** When they were added to the project (YYYY-MM-DD). */
  joinedAt: string;
  /** "joined" once they have signed in at least once (D27). */
  status: "joined" | "pending";
  /** Latest invitation sent while still pending (YYYY-MM-DD), if any. */
  invitedAt: string | null;
}

/** The organisations in scope, with their cohorts and member counts. */
export async function getAdminOrgs(scope: Scope): Promise<AdminOrg[] | null> {
  if (scope.kind === "none") return null;
  try {
    const orgs = await prisma.organisation.findMany({
      where: organisationsInScope(scope),
      include: {
        cohorts: {
          orderBy: { createdAt: "asc" },
          // A membership per role: two for a learner who facilitates too.
          include: { memberships: { select: { userId: true } } },
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
        memberCount: new Set(c.memberships.map((m) => m.userId)).size,
      })),
    }));
  } catch {
    return [];
  }
}

/**
 * The people in scope, grouped by user with their roles + cohort, and the
 * organisation and country of their profile.
 */
export async function getAdminMembers(scope: Scope): Promise<AdminMember[] | null> {
  if (scope.kind === "none") return null;
  try {
    const rows = await prisma.membership.findMany({
      where: membershipsInScope(scope),
      select: {
        userId: true,
        role: true,
        cohortId: true,
        createdAt: true,
        cohort: { select: { name: true } },
        user: {
          select: {
            email: true,
            name: true,
            emailVerified: true,
            profiles: {
              where: { projectId: PROJECT },
              select: { organisationId: true, country: true, organisation: { select: { name: true } } },
            },
          },
        },
      },
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
        }
        continue;
      }
      const profile = m.user.profiles[0] ?? null;
      byUser.set(m.userId, {
        id: m.userId,
        email: m.user.email,
        name: m.user.name,
        roles: [m.role],
        cohortId: m.cohortId,
        cohortName: m.cohort?.name ?? null,
        organisationId: profile?.organisationId ?? null,
        orgName: profile?.organisation?.name ?? null,
        country: profile?.country ?? null,
        joinedAt: m.createdAt.toISOString().slice(0, 10),
        // Auth.js sets emailVerified the first time someone uses a link.
        status: m.user.emailVerified ? "joined" : "pending",
        invitedAt: null,
      });
    }

    // When was each not-yet-joined person last invited? (Audit log.)
    const pending = [...byUser.values()]
      .filter((u) => u.status === "pending")
      .map((u) => u.id);
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
    return [...byUser.values()];
  } catch {
    return [];
  }
}
