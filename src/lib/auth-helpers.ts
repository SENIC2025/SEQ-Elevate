/**
 * Server-side auth helpers. Use these in server components and server
 * actions to read the current user, their project-scoped memberships,
 * and to enforce role-based access.
 *
 * RBAC model: a User has one or more Memberships, each tying them to a
 * Project in a Role (LEARNER / FACILITATOR / ADMIN / CONTENT_EDITOR),
 * optionally within an Organisation and Cohort. Authorisation is always
 * project-scoped — never "is this user an admin" but "is this user an
 * admin *of this project*".
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  BOOTSTRAP_PROJECT,
  BOOTSTRAP_ROLES,
  isBootstrapAdmin,
} from "@/lib/admin-bootstrap";
import { ensureProjectRoles } from "@/lib/role-grants";
import type { Role } from "@prisma/client";

/** The authenticated user record, or null. Cached per request. */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
});

/** Require an authenticated user, else redirect to sign-in. */
export async function requireUser(locale = "en") {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/signin`);
  return user;
}

/** All memberships for the current user, with project/org/cohort. */
export const getMemberships = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return [];
  const load = () =>
    prisma.membership.findMany({
      where: { userId: user.id },
      include: { project: true, organisation: true, cohort: true },
      orderBy: { createdAt: "asc" },
    });
  const memberships = await load();

  // Self-healing admin bootstrap (D26): an ADMIN_EMAILS address receives its
  // roles on its next page load, not only at sign-in — so adding someone to
  // the list (and redeploying) never requires them to sign out and back in.
  // Costs nothing for everyone else: the check is an in-memory set lookup.
  if (isBootstrapAdmin(user.email)) {
    const held = new Set(
      memberships
        .filter((m) => m.projectId === BOOTSTRAP_PROJECT)
        .map((m) => m.role)
    );
    const missing = BOOTSTRAP_ROLES.filter((r) => !held.has(r));
    if (missing.length) {
      try {
        await ensureProjectRoles(user.id, BOOTSTRAP_PROJECT, missing);
        return await load();
      } catch (e) {
        // Never take a page down over this; the next load retries.
        console.error("[auth] admin bootstrap grant failed", e);
      }
    }
  }
  return memberships;
});

/** The user's memberships within a specific project. */
export async function getProjectMemberships(projectId: string) {
  const all = await getMemberships();
  return all.filter((m) => m.projectId === projectId);
}

/** Does the current user hold `role` in `projectId`? */
export async function hasRole(projectId: string, role: Role) {
  const memberships = await getProjectMemberships(projectId);
  return memberships.some((m) => m.role === role);
}

/** Require a role in a project, else redirect (to project home or sign-in). */
export async function requireRole(
  projectId: string,
  role: Role,
  locale = "en"
) {
  const user = await requireUser(locale);
  const ok = await hasRole(projectId, role);
  if (!ok) redirect(`/${locale}`);
  return user;
}
