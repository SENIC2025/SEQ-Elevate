"use server";

/**
 * In-video quiz engagement. When an authenticated learner answers a question
 * that popped up in a lesson video, we record it so facilitators can see who
 * is engaging with the videos. Stored as an AuditLog event (the table is
 * built for exactly this — an `action` + JSON `metadata` event log), so this
 * needs no schema change. Guests are a no-op (their answers stay client-side).
 *
 * Formative: this is engagement signal, not a grade. One row per (learner,
 * cue) — re-answering updates the latest correctness.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const PROJECT = "seq-elevate";

export async function recordVideoCueAnswer(input: {
  courseSlug: string;
  cueId: string;
  correct: boolean;
}) {
  const user = await getCurrentUser();
  if (!user) return; // guest — nothing to persist server-side

  const projectId = user.lastProjectId ?? PROJECT;
  const metadata = {
    courseSlug: input.courseSlug,
    correct: input.correct,
  };

  // One event per (learner, cue): update if it exists, else create.
  const existing = await prisma.auditLog.findFirst({
    where: {
      actorId: user.id,
      action: "video.cue_answered",
      entityId: input.cueId,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.auditLog.update({
      where: { id: existing.id },
      data: { metadata },
    });
  } else {
    await prisma.auditLog.create({
      data: {
        projectId,
        actorId: user.id,
        action: "video.cue_answered",
        entity: "VideoCue",
        entityId: input.cueId,
        metadata,
      },
    });
  }
}
