import "server-only";

/**
 * Course-status overlay — the DB decides which courses learners can see.
 *
 * Same shape as the lesson overlay (src/lib/cms/lesson-overlay.ts): the CMS
 * provider supplies the content, the DB supplies the editorial state on top.
 * The bundled provider hardcodes status "published"; the `Course` row is the
 * authority, so an editor can unpublish a course without touching code.
 *
 * The decisions live in ./course-status (pure, unit-tested); this file only
 * does the DB read. Defensive by design: if the DB is unreachable the bundled
 * summaries pass through untouched, so a database blip can never blank the
 * catalogue.
 */

import { prisma } from "@/lib/prisma";
import { normaliseStatus, selectByStatus, type CourseStatus } from "./course-status";
import type { CourseSummary } from "./types";

export type { CourseStatus };

export async function applyCourseStatus(
  projectId: string,
  summaries: CourseSummary[],
  includeUnpublished = false
): Promise<CourseSummary[]> {
  let rows: { slug: string; status: string }[];
  try {
    rows = await prisma.course.findMany({
      where: { projectId },
      select: { slug: true, status: true },
    });
  } catch {
    return summaries;
  }
  const dbStatus = new Map(
    rows.map((r) => [r.slug, normaliseStatus(r.status)] as const)
  );
  return selectByStatus(summaries, dbStatus, includeUnpublished);
}

/**
 * The editorial status of a single course. Returns null when the course has
 * no DB row at all (caller decides — usually "treat as published").
 */
export async function getCourseStatus(
  projectId: string,
  slug: string
): Promise<CourseStatus | null> {
  try {
    const row = await prisma.course.findFirst({
      where: { projectId, slug },
      select: { status: true },
    });
    return row ? normaliseStatus(row.status) : null;
  } catch {
    return null;
  }
}
