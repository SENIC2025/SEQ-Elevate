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
import { redirect, unstable_rethrow } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  BOOTSTRAP_PROJECT,
  BOOTSTRAP_ROLES,
  isBootstrapAdmin,
} from "@/lib/admin-bootstrap";
import { ensureProjectRoles } from "@/lib/role-grants";
import { isProfileComplete, profileRules } from "@/lib/profile";
import { profileGateOn } from "@/lib/r3-switches";
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

/**
 * Release 3 (D78, spec 5.3): the profile step's gate. A signed-in person
 * whose profile isn't complete (for the rules in force: a new Terms
 * version counts) goes to /welcome; a guest or a complete profile passes.
 * A profile that can't be read goes to /welcome too: it fails towards the
 * profile step, never through it (the step itself shows an error then,
 * so there is no loop).
 *
 * Called in exactly six places, all server code: the hub, and the learner,
 * facilitator, analytics, admin and content layouts. Never in the proxy or
 * the locale layout, and so never on /welcome, /legal, /account, /help, the
 * sign-in pages or /api/**: someone who won't accept the Terms can still
 * sign out, download their data and delete their account. It decides where
 * a page load goes, nothing more; every action and data read keeps its own
 * checks (scope.ts gives staff without a complete profile no one).
 *
 * R3_PROFILE_GATE=off switches it off (spec 15).
 */
const PROFILE_PROJECT = "seq-elevate";

export async function requireCompleteProfile(locale: string): Promise<void> {
  if (!profileGateOn()) return;
  let complete = false;
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const profile = await prisma.projectProfile.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROFILE_PROJECT } },
      select: { country: true, termsVersion: true, ageConfirmedAt: true, consentAt: true },
    });
    complete = isProfileComplete(user, profile, profileRules());
  } catch (e) {
    // Next's own signals (render per request) go through.
    unstable_rethrow(e);
    console.error(`[profile] couldn't read the profile; sent to the profile step: ${e instanceof Error ? e.name : "error"}`);
  }
  if (!complete) redirect(`/${locale}/welcome`);
}
