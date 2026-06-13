"use server";

/**
 * Facilitator actions — record an observation and validate a competence
 * against a learner. RBAC-gated: only FACILITATOR/ADMIN of the project may
 * write. Both create rows the learner's record + admin audit can read.
 */

import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const PROJECT = "seq-elevate";

async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) return null;
  const isFac = await hasRole(PROJECT, "FACILITATOR");
  const isAdmin = await hasRole(PROJECT, "ADMIN");
  if (!isFac && !isAdmin) return null;
  return user;
}

export async function saveObservation(learnerId: string, note: string) {
  const staff = await requireStaff();
  if (!staff || !note.trim()) return { ok: false };
  const compCard = await prisma.compCard.findUnique({
    where: { userId_projectId: { userId: learnerId, projectId: PROJECT } },
  });
  await prisma.observation.create({
    data: {
      observerId: staff.id,
      observedId: learnerId,
      compCardId: compCard?.id ?? null,
      note: note.trim(),
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
  const staff = await requireStaff();
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
      evidence: evidence?.trim() || null,
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
