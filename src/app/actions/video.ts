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
import { isSectionId } from "@/lib/cms/sections/contract";
import { SLUG } from "@/lib/cms/sections/store.server";

const PROJECT = "seq-elevate";
/** Longer than any cue id the editor makes (= MAX_ASSESSMENT_ID_LENGTH). */
const MAX_CUE_ID_LENGTH = 100;

/**
 * Keep one in-video answer, under its cue's id. `lessonId` (Release 2) is
 * the lesson the video belongs to — a standard key or a lesson of the
 * course's own — kept beside it when it is one; a page from before doesn't
 * send it. AuditLog rows outlive account erasure (D62.g), so nothing else
 * the browser sends is kept: a cue id longer than any cue's, a slug the
 * platform wouldn't make or a "correct" that isn't true or false is
 * ignored.
 */
export async function recordVideoCueAnswer(input: {
  courseSlug: string;
  cueId: string;
  correct: boolean;
  lessonId?: string;
}) {
  const user = await getCurrentUser();
  if (!user) return; // guest — nothing to persist server-side
  if (
    typeof input.cueId !== "string" ||
    input.cueId.length === 0 ||
    input.cueId.length > MAX_CUE_ID_LENGTH
  ) {
    return;
  }
  if (typeof input.courseSlug !== "string" || !SLUG.test(input.courseSlug)) return;
  if (typeof input.correct !== "boolean") return;

  const projectId = user.lastProjectId ?? PROJECT;
  const metadata = {
    courseSlug: input.courseSlug,
    correct: input.correct,
    ...(isSectionId(input.lessonId) ? { lessonId: input.lessonId } : {}),
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
