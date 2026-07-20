"use server";

/**
 * Course lifecycle — publish / unpublish / archive a course from the CMS.
 *
 * Closes half of the acceptance criterion "content editor manages the course
 * catalogue without a developer". Until now `status` existed on the Course row
 * but nothing ever wrote it, and the bundled provider hardcoded "published".
 *
 * The DB row is the authority; `src/lib/cms/course-overlay.ts` applies it when
 * the catalogue is read. Every surface that lists courses is dynamic, so a
 * change shows on the next load — no revalidation needed.
 */

import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { listCourses } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";

const PROJECT = "seq-elevate";

export type CourseStatus = "draft" | "published" | "archived";
const STATUSES: CourseStatus[] = ["draft", "published", "archived"];

/**
 * Taking a course off the shelf changes what a whole cohort can reach, so it
 * stays with the people who own the catalogue — not every facilitator.
 * (Per-document publishing is the lighter, per-cohort control facilitators run.)
 */
async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ok =
    (await hasRole(PROJECT, "ADMIN")) ||
    (await hasRole(PROJECT, "CONTENT_EDITOR"));
  return ok ? user : null;
}

async function audit(
  actorId: string,
  action: string,
  entityId: string,
  status: CourseStatus
) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "Course",
      entityId,
      metadata: { status },
    },
  });
}

export interface CatalogueEntry {
  slug: string;
  title: string;
  status: CourseStatus;
  durationMinutes: number;
  /** Learners currently enrolled — shown before unpublishing so it's informed. */
  enrolled: number;
}

/** The full catalogue including drafts, for the content editor. */
export async function getCatalogue(
  locale: Locale
): Promise<CatalogueEntry[] | null> {
  if (!(await requireEditor())) return null;
  try {
    const summaries = await listCourses(PROJECT, locale, {
      includeUnpublished: true,
    });
    const rows = await prisma.course.findMany({
      where: { projectId: PROJECT },
      select: { slug: true, _count: { select: { enrollments: true } } },
    });
    const counts = new Map(rows.map((r) => [r.slug, r._count.enrollments]));
    return summaries
      .filter((s) => !s.comingSoon)
      .map((s) => ({
        slug: s.slug,
        title: s.title,
        status: s.status,
        durationMinutes: s.durationMinutes,
        enrolled: counts.get(s.slug) ?? 0,
      }));
  } catch {
    return [];
  }
}

/**
 * Set a course's editorial status. Creates the Course row if the course is
 * bundled but was never seeded, so publishing works on a fresh database.
 */
export async function setCourseStatus(slug: string, status: CourseStatus) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  if (!STATUSES.includes(status)) {
    return { ok: false as const, error: "bad-status" };
  }

  // Only a course the CMS actually knows about may be published.
  const known = await listCourses(PROJECT, "en", { includeUnpublished: true });
  const summary = known.find((c) => c.slug === slug);
  if (!summary) return { ok: false as const, error: "unknown-course" };

  const existing = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug },
    select: { id: true, publishedAt: true },
  });

  if (existing) {
    await prisma.course.update({
      where: { id: existing.id },
      data: {
        status,
        // Stamp first publication only — re-publishing keeps the original
        // date, so "published since" stays meaningful.
        ...(status === "published" && !existing.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
    });
  } else {
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `placeholder-${slug}`,
        slug,
        cluster: summary.cluster,
        durationMinutes: summary.durationMinutes,
        status,
        publishedAt: status === "published" ? new Date() : null,
      },
    });
  }

  await audit(editor.id, `course.${status}`, slug, status);
  return { ok: true as const };
}
