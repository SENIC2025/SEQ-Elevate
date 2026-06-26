"use server";

/**
 * Lightweight learning telemetry. Records active time-on-stage for signed-in
 * learners so facilitators can see where time is going. Stored as AuditLog
 * events (action "stage.time"), one accumulating row per (learner, course,
 * stage) — no schema migration, and consistent with how in-video answers are
 * recorded. Guests are a no-op.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const PROJECT = "seq-elevate";
const MAX_DELTA_SECONDS = 3600; // clamp absurd single deltas (clock jumps etc.)

/** Record that a learner opened a course (for "when they open" analytics). */
export async function recordCourseOpened(courseSlug: string) {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.auditLog.create({
    data: {
      projectId: user.lastProjectId ?? PROJECT,
      actorId: user.id,
      action: "course.opened",
      entity: "Course",
      entityId: courseSlug,
      metadata: { courseSlug },
    },
  });
}

export async function recordStageTime(input: {
  courseSlug: string;
  stage: string;
  seconds: number;
}) {
  const user = await getCurrentUser();
  if (!user) return;
  if (!Number.isFinite(input.seconds) || input.seconds <= 0) return;
  const seconds = Math.min(Math.round(input.seconds), MAX_DELTA_SECONDS);

  const projectId = user.lastProjectId ?? PROJECT;
  const entityId = `${input.courseSlug}:${input.stage}`;

  const existing = await prisma.auditLog.findFirst({
    where: { actorId: user.id, action: "stage.time", entityId },
    select: { id: true, metadata: true },
  });

  if (existing) {
    const md = (existing.metadata as { seconds?: number } | null) ?? {};
    await prisma.auditLog.update({
      where: { id: existing.id },
      data: {
        metadata: {
          courseSlug: input.courseSlug,
          stage: input.stage,
          seconds: (md.seconds ?? 0) + seconds,
        },
      },
    });
  } else {
    await prisma.auditLog.create({
      data: {
        projectId,
        actorId: user.id,
        action: "stage.time",
        entity: "Stage",
        entityId,
        metadata: {
          courseSlug: input.courseSlug,
          stage: input.stage,
          seconds,
        },
      },
    });
  }
}
