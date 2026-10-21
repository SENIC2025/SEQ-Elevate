"use server";

/**
 * One-click demo sign-in for client showcases. Provisions the profile's User
 * + Memberships, creates a database Session and sets the Auth.js session
 * cookie directly — bypassing the magic-link email so a client can explore a
 * role immediately. Runs only where demoLoginAllowed() says so (D98: opt-in
 * with DEMO_LOGIN_ENABLED=true and a private DEMO_ACCESS_CODE of at least 12
 * characters, never on production; src/lib/demo-gate.ts). There is no
 * default code.
 */

import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { demoCodeMatches, demoLoginAllowed } from "@/lib/demo-gate";
import { getDemoProfile, type DemoRole } from "@/lib/demo-profiles";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";

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

  // Create a database session and set the Auth.js cookie.
  const token = `demo-${crypto.randomUUID()}`;
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
