import "server-only";

/**
 * Release 3 (D79): has the signed-in person done the profile step, for the
 * rules in force (a new Terms version counts)? For the activity records
 * (telemetry.ts, video.ts): before the profile step is done nothing of the
 * person's learning is saved, whatever R3_PROFILE_GATE says, as the course
 * and Comp Card saves, the badge award (learner.ts) and
 * POST /api/progress/beacon refuse.
 *
 * Called only with the session's own user (getCurrentUser), and reads that
 * person's own profile in the project, nobody else's.
 */

import { prisma } from "@/lib/prisma";
import { isProfileComplete, profileRules } from "@/lib/profile";

const PROJECT = "seq-elevate";

export async function profileStepDone(user: { id: string; name: string | null }): Promise<boolean> {
  const profile = await prisma.projectProfile.findUnique({
    where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
    select: { country: true, termsVersion: true, ageConfirmedAt: true, consentAt: true },
  });
  return isProfileComplete(user, profile, profileRules());
}
