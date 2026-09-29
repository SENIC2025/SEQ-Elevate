import "server-only";

/**
 * Course-status overlay — the DB decides which courses learners can see.
 *
 * Same shape as the lesson overlay (src/lib/cms/lesson-overlay.ts): the CMS
 * provider supplies the content, the DB supplies the editorial state on top.
 * The bundled provider hardcodes status "published"; the `Course` row is the
 * authority, so an editor can unpublish a course without touching code.
 *
 * The same row also carries an editor's rewording of a bundled course's title
 * and subtitle (`copyOverride`, D34), applied here too so every surface that
 * lists or opens a course shows it.
 *
 * The decisions live in ./course-status and ./course-copy (pure, unit-tested);
 * this file only does the DB reads. Defensive by design: if the DB is
 * unreachable the bundled summaries pass through untouched, so a database blip
 * can never blank the catalogue.
 */

import { prisma } from "@/lib/prisma";
import { normaliseStatus, selectByStatus, type CourseStatus } from "./course-status";
import { applyCopy, readCopyOverride } from "./course-copy";
import type { CourseContent, CourseSummary, Locale } from "./types";

export type { CourseStatus };

export async function applyCourseStatus(
  projectId: string,
  summaries: CourseSummary[],
  locale: Locale,
  includeUnpublished = false
): Promise<CourseSummary[]> {
  let rows: { slug: string; status: string; copyOverride: unknown }[];
  try {
    rows = await prisma.course.findMany({
      where: { projectId },
      select: { slug: true, status: true, copyOverride: true },
    });
  } catch {
    return summaries;
  }
  const dbStatus = new Map(
    rows.map((r) => [r.slug, normaliseStatus(r.status)] as const)
  );
  const overrides = new Map(
    rows
      .filter((r) => r.copyOverride != null)
      .map((r) => [r.slug, readCopyOverride(r.copyOverride)] as const)
  );
  return selectByStatus(summaries, dbStatus, includeUnpublished).map((s) =>
    applyCopy(s, overrides.get(s.slug) ?? null, locale)
  );
}

/**
 * A bundled course's content with the editor's title/subtitle rewording for
 * its locale applied. CMS-created courses never carry an override (their copy
 * is `meta`), so only the bundled branch of getCourse calls this.
 */
export async function applyCourseCopyOverride(
  projectId: string,
  content: CourseContent
): Promise<CourseContent> {
  try {
    const row = await prisma.course.findFirst({
      where: { projectId, slug: content.slug },
      select: { copyOverride: true },
    });
    if (row?.copyOverride == null) return content;
    return applyCopy(content, readCopyOverride(row.copyOverride), content.locale);
  } catch {
    return content;
  }
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
