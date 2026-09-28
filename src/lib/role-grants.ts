/**
 * Server-side role grants shared by sign-in (auth.ts) and the self-healing
 * admin bootstrap (auth-helpers). Lives in its own module so neither of those
 * has to import the other.
 */

import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

/**
 * Idempotently ensure `userId` holds each of `roles` in `projectId`.
 *
 * Safe under concurrency: two requests racing on the same (user, project,
 * role) both try to create it, and the loser's unique-constraint error
 * (P2002) only means the row now exists — so it is swallowed.
 */
export async function ensureProjectRoles(
  userId: string,
  projectId: string,
  roles: Iterable<Role>
) {
  for (const role of roles) {
    try {
      await prisma.membership.upsert({
        where: { userId_projectId_role: { userId, projectId, role } },
        create: { userId, projectId, role },
        update: {},
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
}
