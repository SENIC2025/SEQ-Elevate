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
 *
 * Release 3 (D79): nothing is kept before the person's profile step is
 * done, whatever R3_PROFILE_GATE says, as the course and Comp Card saves and
 * the badge award refuse: answered "profile-incomplete", never thrown, and
 * nothing written (a page loaded before the Terms changed or before
 * Release 3, a hand-made call).
 *
 * D117: an answer is kept only to a question one of the course's videos
 * asks, in a course learners get, and counts against the limit the
 * activity records share (120 calls in 10 minutes per learner,
 * src/lib/learner-activity.ts). Anything else is ignored: nothing written,
 * answered as before.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { profileStepDone } from "@/lib/profile-step";
import { isSectionId } from "@/lib/cms/sections/contract";
import { SLUG } from "@/lib/cms/sections/store.server";
import {
  activityAllowed,
  activityCourse,
  lessonsWithCue,
  oneAtATime,
  takesActivity,
} from "@/lib/learner-activity";

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
 *
 * D117: the cue must be one of the course's stored questions — of a video
 * an editor attached to one of its lessons, or of the video a built-in
 * course ships (lessonsWithCue) — in a course learners get (published, or
 * published once: D62.f); any other cue id is ignored. `lessonId` is kept
 * only when it is a lesson whose video asks that question, as the player
 * sends it.
 */
export async function recordVideoCueAnswer(input: {
  courseSlug: string;
  cueId: string;
  correct: boolean;
  lessonId?: string;
}): Promise<"profile-incomplete" | undefined> {
  const user = await getCurrentUser();
  if (!user) return; // guest — nothing to persist server-side
  if (!(await profileStepDone(user))) return "profile-incomplete";
  if (
    typeof input.cueId !== "string" ||
    input.cueId.length === 0 ||
    input.cueId.length > MAX_CUE_ID_LENGTH
  ) {
    return;
  }
  if (typeof input.courseSlug !== "string" || !SLUG.test(input.courseSlug)) return;
  if (typeof input.correct !== "boolean") return;
  if (!(await activityAllowed(user.id))) return;
  const course = await activityCourse(input.courseSlug);
  if (!course || !takesActivity(course)) return;
  const lessons = await lessonsWithCue(course, input.cueId);
  if (!lessons.length) return;

  const projectId = user.lastProjectId ?? PROJECT;
  const cueId = input.cueId;
  const metadata = {
    courseSlug: input.courseSlug,
    correct: input.correct,
    ...(isSectionId(input.lessonId) && lessons.includes(input.lessonId) ? { lessonId: input.lessonId } : {}),
  };

  // One event per (learner, cue): update if it exists, else create — one
  // call at a time for the same cue (D117).
  await prisma.$transaction(async (tx) => {
    await oneAtATime(tx, `video.cue_answered:${user.id}:${cueId}`);
    const existing = await tx.auditLog.findFirst({
      where: {
        actorId: user.id,
        action: "video.cue_answered",
        entityId: cueId,
      },
      select: { id: true },
    });

    if (existing) {
      await tx.auditLog.update({
        where: { id: existing.id },
        data: { metadata },
      });
    } else {
      await tx.auditLog.create({
        data: {
          projectId,
          actorId: user.id,
          action: "video.cue_answered",
          entity: "VideoCue",
          entityId: cueId,
          metadata,
        },
      });
    }
  });
}
