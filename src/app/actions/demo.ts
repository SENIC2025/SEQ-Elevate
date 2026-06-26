"use server";

/**
 * One-click demo sign-in for client showcases. Provisions the profile's User
 * + Memberships, creates a database Session and sets the Auth.js session
 * cookie directly — bypassing the magic-link email so a client can explore a
 * role immediately. Gated by DEMO_ACCESS_CODE; disable with
 * DEMO_LOGIN_DISABLED=true on real production.
 */

import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDemoProfile, type DemoRole } from "@/lib/demo-profiles";
import type { Role } from "@prisma/client";

const PROJECT = "seq-elevate";
const ACCESS_CODE = process.env.DEMO_ACCESS_CODE ?? "elevate-demo";

/** Ensure a user holds the given project roles (idempotent). */
export async function grantRoles(userId: string, roles: DemoRole[]) {
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
  if (process.env.DEMO_LOGIN_DISABLED === "true") {
    return { ok: false as const, error: "disabled" };
  }
  if (code.trim() !== ACCESS_CODE) {
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
