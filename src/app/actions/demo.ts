"use server";

/**
 * One-click demo sign-in for client showcases. Provisions the profile's User
 * + Memberships, creates a database Session and sets the Auth.js session
 * cookie directly — bypassing the magic-link email so a client can explore a
 * role immediately. Runs only where demoLoginAllowed() says so (D98: opt-in
 * with DEMO_LOGIN_ENABLED=true and a private DEMO_ACCESS_CODE of at least 12
 * characters, never on production; src/lib/demo-gate.ts). There is no
 * default code.
 *
 * Each demo sign-in also completes the person's profile with the current
 * Terms version (spec 5.8), so the showcase doesn't stop at the profile
 * step, which compares versions.
 */

import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { demoCodeMatches, demoLoginAllowed } from "@/lib/demo-gate";
import { DEMO_SESSION_PREFIX } from "@/lib/demo-session";
import { getDemoProfile, type DemoRole } from "@/lib/demo-profiles";
import { setPersonOrganisation } from "@/lib/person-organisation";
import { currentTermsVersion, profileRules } from "@/lib/profile";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

/** Demo people take part in Germany (the Berlin pilot cohort's country). */
const DEMO_COUNTRY = "DE" as const;

/**
 * Ensure a user holds the given project roles (idempotent).
 *
 * NOT exported: a `"use server"` export is a public HTTP endpoint, and this
 * function grants roles with no auth check. It must only be reachable through
 * `demoSignIn` below, which enforces the demo gates first.
 */
async function grantRoles(userId: string, roles: DemoRole[]) {
  for (const role of roles) {
    await prisma.membership.upsert({
      where: {
        userId_projectId_role: {
          userId,
          projectId: PROJECT,
          role: role as Role,
        },
      },
      create: { userId, projectId: PROJECT, role: role as Role },
      update: {},
    });
  }
}

/**
 * A complete profile for a demo person, as the profile step would leave it:
 * a country, the current Terms version, the age rule and, where required,
 * consent. NOT exported (see grantRoles). A demo learner with no
 * organisation gets the one its country maps to, through the one writer of
 * a person's organisation (D101); demo staff get none (a staff member's
 * organisation is an ADMIN's to set, spec 6.4).
 */
async function completeDemoProfile(userId: string, roles: readonly DemoRole[]) {
  const now = new Date();
  const answers = {
    country: DEMO_COUNTRY,
    termsVersion: currentTermsVersion(),
    termsAcceptedAt: now,
    ageRule: "SELF_MIN_AGE" as const,
    ageConfirmedAt: now,
    ...(profileRules().consent !== "off" ? { consentVersion: "demo", consentAt: now } : {}),
  };
  await prisma.$transaction(async (tx) => {
    const where = { userId_projectId: { userId, projectId: PROJECT } };
    const stored = await tx.projectProfile.findUnique({ where, select: { profileCompletedAt: true } });
    // Completed once: the first completion's time is kept.
    const completed = { ...answers, profileCompletedAt: stored?.profileCompletedAt ?? now };
    const profile = await tx.projectProfile.upsert({
      where,
      create: { userId, projectId: PROJECT, ...completed },
      update: completed,
      select: { id: true, organisationId: true },
    });
    const learner = roles.every((r) => r === "LEARNER");
    if (!learner || profile.organisationId) return;
    const mapped = await tx.countryMapping.findUnique({
      where: { projectId_country: { projectId: PROJECT, country: DEMO_COUNTRY } },
      select: { organisationId: true },
    });
    if (mapped) {
      await setPersonOrganisation(tx, userId, mapped.organisationId, { actorId: null, source: "country" });
    }
  });
}

export async function demoSignIn(profileId: string, code: string) {
  // Off unless this deployment opted in, and never on production (D98).
  if (!demoLoginAllowed()) {
    return { ok: false as const, error: "disabled" };
  }
  if (!demoCodeMatches(code)) {
    return { ok: false as const, error: "bad-code" };
  }
  const profile = getDemoProfile(profileId);
  if (!profile) return { ok: false as const, error: "unknown" };

  const user = await prisma.user.upsert({
    where: { email: profile.email },
    create: {
      email: profile.email,
      name: profile.name,
      emailVerified: new Date(),
    },
    update: { name: profile.name },
  });

  await grantRoles(user.id, profile.roles);
  await completeDemoProfile(user.id, profile.roles);

  // Create a database session and set the Auth.js cookie.
  // A demo session's token says so: where demo sign-in isn't allowed it
  // resolves to no one (demo-session.ts).
  const token = `${DEMO_SESSION_PREFIX}${crypto.randomUUID()}`;
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires },
  });

  // Match Auth.js's cookie naming: __Secure- prefix over HTTPS.
  const proto = (await headers()).get("x-forwarded-proto");
  const secure = proto === "https";
  const cookieName = secure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires,
  });

  return { ok: true as const, landing: profile.landing };
}
