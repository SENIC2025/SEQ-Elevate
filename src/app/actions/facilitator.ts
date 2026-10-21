"use server";

/**
 * Facilitator actions — record an observation and validate a competence
 * against a learner. RBAC- and scope-gated: only someone who supports
 * learners (FACILITATOR, PARTNER_ADMIN or ADMIN of the project) may write,
 * only about a person in their scope (their own organisation's, or anyone
 * in the project for an ADMIN: inScope, D74), only about a learner of the
 * project (a LEARNER who holds no staff role there), and never about
 * themselves (canRecordForLearner). Both create rows the learner's record +
 * admin audit can read, so what they hold is checked too, and anything else
 * is refused with { ok: false } rather than an error.
 */

import {
  canRecordForLearner,
  facilitatorText,
  isSkillCluster,
} from "@/lib/facilitator-access";
import { prisma } from "@/lib/prisma";
import { getViewer, inScope } from "@/lib/scope";

const PROJECT = "seq-elevate";

/**
 * The signed-in staff member, when they may write about `learnerId`; null
 * otherwise, including when `learnerId` is their own. Fails closed: a
 * viewer with no scope (no organisation, the partner switch off, an
 * incomplete profile of their own), a person outside the scope, a read
 * that fails and an id that isn't a string (a server action is a public
 * endpoint) all refuse the write.
 */
async function requireStaffFor(learnerId: unknown) {
  if (typeof learnerId !== "string" || !learnerId) return null;
  try {
    const viewer = await getViewer();
    if (!viewer.user || viewer.user.id === learnerId) return null;
    if (!(await inScope(viewer.scope, learnerId))) return null;
    const learner = await prisma.membership.findMany({
      where: { userId: learnerId, projectId: PROJECT },
      select: { role: true },
    });
    const ok = canRecordForLearner(
      viewer.roles,
      learner.map((m) => m.role)
    );
    return ok ? viewer.user : null;
  } catch (e) {
    console.error("[facilitator] couldn't check who may write this", e);
    return null;
  }
}

export async function saveObservation(learnerId: string, note: string) {
  const text = facilitatorText(note);
  if (!text) return { ok: false };
  const staff = await requireStaffFor(learnerId);
  if (!staff) return { ok: false };
  const compCard = await prisma.compCard.findUnique({
    where: { userId_projectId: { userId: learnerId, projectId: PROJECT } },
  });
  await prisma.observation.create({
    data: {
      observerId: staff.id,
      observedId: learnerId,
      compCardId: compCard?.id ?? null,
      note: text,
    },
  });
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: staff.id,
      action: "observation.created",
      entity: "Observation",
    },
  });
  return { ok: true };
}

export async function recordValidation(
  learnerId: string,
  cluster: string,
  evidence?: string
) {
  if (!isSkillCluster(cluster)) return { ok: false };
  // No evidence is fine; evidence that isn't text, or is too long, isn't.
  const proof =
    evidence === undefined || evidence === null ? "" : facilitatorText(evidence);
  if (proof === null) return { ok: false };
  const staff = await requireStaffFor(learnerId);
  if (!staff) return { ok: false };
  const compCard = await prisma.compCard.findUnique({
    where: { userId_projectId: { userId: learnerId, projectId: PROJECT } },
  });
  await prisma.validation.create({
    data: {
      validatorId: staff.id,
      validatedId: learnerId,
      compCardId: compCard?.id ?? null,
      cluster,
      evidence: proof || null,
    },
  });
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: staff.id,
      action: "competence.validated",
      entity: "Validation",
      metadata: { cluster },
    },
  });
  return { ok: true };
}
