/**
 * Making and linking the Badge row of a course CREATED IN THE CMS (C9),
 * inside the caller's transaction. The rules are in course-badge.ts; this is
 * the one place that writes them, so a badge made with a new course and one
 * made later for a course that has none come out the same.
 *
 * Why later: createCourse makes the badge with the course, and the deploy
 * fills in any course without one (prisma/backfill-course-badges.mjs). But
 * while a deploy builds, the old code keeps serving and can create a course
 * without a badge, which the next deploy only fixes later. So publishing
 * such a course, rewording it, or a learner finishing it, gives it its
 * badge on the spot (ensureCourseBadge), rather than learners losing the
 * badge they earned there on the next reload.
 *
 * Takes the transaction client rather than importing Prisma, so the callers'
 * tests can hand it their mocked one.
 */

import type { Prisma } from "@prisma/client";
import {
  COURSE_BADGE_ICON,
  courseBadgeCopy,
  courseBadgeSlug,
} from "./course-badge";
import { pickMeta, type CourseMeta } from "./text-fallback";

/**
 * Create the Badge row of a created course: `<course slug>-complete`, or the
 * first free slug after it, named after the course's English copy (or its
 * first language). `entry` is that copy, as pickMeta(meta, "en") reads it.
 */
export async function createCourseBadge(
  tx: Prisma.TransactionClient,
  projectId: string,
  courseSlug: string,
  entry: { title?: string; tagline?: string } | null
) {
  const base = courseBadgeSlug(courseSlug);
  const taken = await tx.badge.findMany({
    where: { projectId, slug: { startsWith: base } },
    select: { slug: true },
  });
  return tx.badge.create({
    data: {
      projectId,
      slug: courseBadgeSlug(courseSlug, new Set(taken.map((b) => b.slug))),
      ...courseBadgeCopy(entry, courseSlug),
      iconRef: COURSE_BADGE_ICON,
    },
  });
}

/**
 * The id of the badge a course is linked to, giving a created course one
 * first when it has none: the badge is made, linked, and saved for every
 * learner who had already finished the course, dated when they did (as the
 * migration did for courses created before badges). A built-in course
 * (no `meta`) gets its badge from the seed, so it is left as it is: null.
 *
 * Locks the course's row until the caller's transaction ends, so two
 * requests healing the same course at once can't make it two badges: the
 * second finds the first one's link.
 */
export async function ensureCourseBadge(
  tx: Prisma.TransactionClient,
  courseId: string
): Promise<string | null> {
  await tx.$queryRaw`SELECT id FROM "Course" WHERE "id" = ${courseId} FOR UPDATE`;
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { id: true, projectId: true, slug: true, meta: true, badgeId: true },
  });
  if (!course) return null;
  if (course.badgeId) return course.badgeId;
  if (course.meta === null) return null;

  const badge = await createCourseBadge(
    tx,
    course.projectId,
    course.slug,
    pickMeta(course.meta as CourseMeta, "en")
  );
  await tx.course.update({
    where: { id: course.id },
    data: { badgeId: badge.id },
  });
  const finished = await tx.courseEnrollment.findMany({
    where: { courseId: course.id, completedAt: { not: null } },
    select: { userId: true, completedAt: true },
  });
  if (finished.length > 0) {
    await tx.userBadge.createMany({
      data: finished.map((e) => ({
        userId: e.userId,
        badgeId: badge.id,
        awardedAt: e.completedAt ?? undefined,
      })),
      // A learner who already holds it keeps the row they have.
      skipDuplicates: true,
    });
  }
  return badge.id;
}
