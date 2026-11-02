"use server";

/**
 * Lightweight learning telemetry. Records active time-on-stage for signed-in
 * learners so facilitators can see where time is going. Stored as AuditLog
 * events (action "stage.time"), one accumulating row per (learner, course,
 * stage) — no schema migration, and consistent with how in-video answers are
 * recorded. Guests are a no-op.
 *
 * Release 3 (D79): nothing is recorded before the person's profile step is
 * done, whatever R3_PROFILE_GATE says, as the course and Comp Card saves and
 * the badge award refuse: answered "profile-incomplete", never thrown, and
 * nothing written. A Release 3 page sends nothing then anyway; the refusal is
 * for a page loaded before the Terms changed or before Release 3, and for a
 * hand-made call.
 *
 * D117: each record stays within what the learner's own play makes
 * (src/lib/learner-activity.ts): only for a course of the project that
 * learners get and one of its lessons; a course opened at most once per
 * learner, course and clock hour; time added to a lesson never more than
 * the time since it was last added to; at most 120 calls of these and the
 * in-video answer together per learner in 10 minutes. Whatever the rules
 * refuse is ignored like any other input they refuse: nothing written,
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
  creditedSeconds,
  hourOf,
  isLessonOf,
  oneAtATime,
  opensToLearners,
  takesActivity,
} from "@/lib/learner-activity";

const PROJECT = "seq-elevate";

/**
 * Record that a learner opened a course (for "when they open" analytics).
 * Only for a course slug as the platform makes them, like its siblings:
 * whatever else the browser sends is ignored, never stored as a row's key.
 * Only for a published course of the project, and at most once per
 * learner, course and clock hour (D117): the statistics count opens by day
 * and by weekday and 4-hour block, so a second open in the same hour adds
 * nothing to either.
 */
export async function recordCourseOpened(courseSlug: string): Promise<"profile-incomplete" | undefined> {
  if (typeof courseSlug !== "string" || !SLUG.test(courseSlug)) return;
  const now = new Date();
  const user = await getCurrentUser();
  if (!user) return;
  if (!(await profileStepDone(user))) return "profile-incomplete";
  if (!(await activityAllowed(user.id))) return;
  const course = await activityCourse(courseSlug);
  if (!course || !opensToLearners(course)) return;

  await prisma.$transaction(async (tx) => {
    await oneAtATime(tx, `course.opened:${user.id}:${courseSlug}`);
    const already = await tx.auditLog.findFirst({
      where: { actorId: user.id, action: "course.opened", entityId: courseSlug, createdAt: { gte: hourOf(now) } },
      select: { id: true },
    });
    if (already) return;
    await tx.auditLog.create({
      data: {
        projectId: user.lastProjectId ?? PROJECT,
        actorId: user.id,
        action: "course.opened",
        entity: "Course",
        entityId: courseSlug,
        metadata: { courseSlug },
        // The clock the hour above is read by, so a record is never counted
        // in an hour that already has one.
        createdAt: now,
      },
    });
  });
}

/**
 * Add `seconds` to the learner's time on one lesson: a standard key or a
 * lesson of the course's own ("s-…", Release 2). Anything else the browser
 * sends — a lesson id that is no lesson's, a slug the platform wouldn't
 * make — is ignored, so no row is ever keyed by it.
 *
 * D117: the course must be one learners get, and the lesson one of its
 * lessons (isLessonOf). A row keeps when it was last added to
 * (`lastAddedAt`), and each call adds at most the time since then: the
 * player sends the time the lesson was visible since it last sent
 * (useStageTimer.ts), which is never more than that. A first write, or one
 * to a row from before, adds at most an hour, as before.
 */
export async function recordStageTime(input: {
  courseSlug: string;
  stage: string;
  seconds: number;
}): Promise<"profile-incomplete" | undefined> {
  const now = new Date();
  const user = await getCurrentUser();
  if (!user) return;
  if (!(await profileStepDone(user))) return "profile-incomplete";
  if (typeof input.courseSlug !== "string" || !SLUG.test(input.courseSlug)) return;
  if (!isSectionId(input.stage)) return;
  if (!Number.isFinite(input.seconds) || input.seconds <= 0) return;
  if (!(await activityAllowed(user.id))) return;
  const course = await activityCourse(input.courseSlug);
  if (!course || !takesActivity(course) || !(await isLessonOf(course, input.stage))) return;

  const projectId = user.lastProjectId ?? PROJECT;
  const entityId = `${input.courseSlug}:${input.stage}`;

  await prisma.$transaction(async (tx) => {
    await oneAtATime(tx, `stage.time:${user.id}:${entityId}`);
    const existing = await tx.auditLog.findFirst({
      where: { actorId: user.id, action: "stage.time", entityId },
      select: { id: true, metadata: true },
    });
    const md = (existing?.metadata as { seconds?: unknown; lastAddedAt?: unknown } | null) ?? {};
    const seconds = creditedSeconds(input.seconds, md.lastAddedAt, now);
    if (seconds <= 0) return;
    const metadata = {
      courseSlug: input.courseSlug,
      stage: input.stage,
      seconds: (typeof md.seconds === "number" ? md.seconds : 0) + seconds,
      lastAddedAt: now.toISOString(),
    };

    if (existing) {
      await tx.auditLog.update({ where: { id: existing.id }, data: { metadata } });
    } else {
      await tx.auditLog.create({
        data: {
          projectId,
          actorId: user.id,
          action: "stage.time",
          entity: "Stage",
          entityId,
          metadata,
        },
      });
    }
  });
}
