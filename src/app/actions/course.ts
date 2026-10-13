"use server";

/**
 * Course lifecycle — create a course, reword its title and subtitle, and
 * publish / unpublish / archive / move it back to draft, from the CMS.
 *
 * Closes half of the acceptance criterion "content editor manages the course
 * catalogue without a developer". Until now `status` existed on the Course row
 * but nothing ever wrote it, and the bundled provider hardcoded "published".
 *
 * The DB row is the authority; `src/lib/cms/course-overlay.ts` applies it when
 * the catalogue is read. Every surface that lists courses is dynamic, so a
 * change shows on the next load — no revalidation needed.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getBaseCourseCopy, listCourses } from "@/lib/cms";
import {
  applyCopy,
  cleanCopyText,
  mergeCopyOverride,
  readCopyOverride,
} from "@/lib/cms/course-copy";
import { isContentLocale } from "@/lib/cms/course-admin-types";
import { pickMeta, type CourseMeta } from "@/lib/cms/db-course";
import {
  COURSE_BADGE_ICON,
  courseBadgeCopy,
  courseBadgeSlug,
} from "@/lib/cms/course-badge";
import { slugify } from "@/lib/slug";
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
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

async function audit(
  actorId: string,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue
) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "Course",
      entityId,
      metadata,
    },
  });
}

/**
 * Create a brand-new course from the CMS — no code, no deploy.
 *
 * It starts as a DRAFT carrying the narrative stages (context → concept →
 * behaviour → reflection). The interactive stages (simulation, branching
 * scenario, assessment) appear once an editor writes them on the course page,
 * so a new course does not pretend to have them.
 */
export async function createCourse(input: {
  title: string;
  tagline: string;
  cluster: string;
  clusterLabel: string;
  durationMinutes: number;
  locale: Locale;
}) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };

  const title = input.title.trim().slice(0, 120);
  if (!title) return { ok: false as const, error: "title-required" };
  const slug = slugify(title);
  if (!slug) return { ok: false as const, error: "bad-title" };

  // A CMS course must never shadow a bundled one, or `getCourse` would keep
  // serving the bundled content and the editor's work would look lost.
  const all = await listCourses(PROJECT, "en", { includeUnpublished: true });
  if (all.some((c) => c.slug === slug)) {
    return { ok: false as const, error: "slug-taken" };
  }

  const duration = Math.min(Math.max(input.durationMinutes || 20, 1), 240);
  const tagline = input.tagline.trim().slice(0, 200);
  // The course comes with its badge (course-badge.ts): without a Badge row
  // the badge a learner earns here would never be saved. Both are made in
  // one transaction, so there's never a course without its badge, or a
  // badge left over from a course that failed to save.
  await prisma.$transaction(async (tx) => {
    const base = courseBadgeSlug(slug);
    const taken = await tx.badge.findMany({
      where: { projectId: PROJECT, slug: { startsWith: base } },
      select: { slug: true },
    });
    const badge = await tx.badge.create({
      data: {
        projectId: PROJECT,
        slug: courseBadgeSlug(slug, new Set(taken.map((b) => b.slug))),
        ...courseBadgeCopy({ title, tagline }, slug),
        iconRef: COURSE_BADGE_ICON,
      },
    });
    await tx.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${slug}`,
        slug,
        cluster: input.cluster.trim() || "communication",
        durationMinutes: duration,
        status: "draft",
        badgeId: badge.id,
        meta: {
          [input.locale]: {
            title,
            tagline,
            clusterLabel: input.clusterLabel.trim().slice(0, 60) || "Skill",
          },
        },
      },
    });
  });

  await audit(editor.id, "course.created", slug, { status: "draft" });
  return { ok: true as const, slug };
}

/**
 * Set a course's editorial status. Any status can follow any other, so an
 * archived course can be published again or moved back to draft. Creates the
 * Course row if the course is bundled but was never seeded, so publishing
 * works on a fresh database.
 */
export async function setCourseStatus(slug: string, status: CourseStatus) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  if (typeof slug !== "string" || !STATUSES.includes(status)) {
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

  await audit(editor.id, `course.${status}`, slug, { status });
  return { ok: true as const, status };
}

export interface CourseCopy {
  title: string;
  tagline: string;
  clusterLabel: string;
}

export type UpdateCourseMetaResult =
  | { ok: true; copy: CourseCopy }
  | {
      ok: false;
      error:
        | "forbidden"
        | "bad-input"
        | "bad-locale"
        | "unknown-course"
        | "title-required";
    };

/**
 * Reword a course's title and subtitle (tagline) for one language, from the
 * course page. Changes are live at once, like every other course edit (D33).
 *
 * - A course CREATED IN THE CMS keeps its copy in `meta`: this writes
 *   `meta[locale]`, which is also how it gains a second or third language.
 *   A title is required; the skill area (clusterLabel) can change too.
 * - A BUILT-IN course keeps its shipped wording in the message catalogue:
 *   this writes a per-field rewording to `copyOverride` (D34). An empty field
 *   — or one identical to the built-in wording — goes back to the built-in
 *   text, so later fixes to the catalogue still show. The skill area of a
 *   built-in course isn't editable.
 *
 * Reads and writes the JSON under a row lock, so two editors saving different
 * languages at the same moment can't drop each other's change.
 */
export async function updateCourseMeta(
  slug: string,
  locale: Locale,
  input: { title: string; tagline: string; clusterLabel?: string }
): Promise<UpdateCourseMetaResult> {
  const editor = await requireEditor();
  if (!editor) return { ok: false, error: "forbidden" };
  if (
    typeof slug !== "string" ||
    typeof input?.title !== "string" ||
    typeof input.tagline !== "string" ||
    (input.clusterLabel !== undefined && typeof input.clusterLabel !== "string")
  ) {
    return { ok: false, error: "bad-input" };
  }
  if (!isContentLocale(locale)) return { ok: false, error: "bad-locale" };

  const title = cleanCopyText(input.title, 120);
  const tagline = cleanCopyText(input.tagline, 200);
  const clusterLabel = cleanCopyText(input.clusterLabel ?? "", 60);

  // Only a course the CMS actually knows about may be reworded.
  const known = await listCourses(PROJECT, "en", { includeUnpublished: true });
  const summary = known.find((c) => c.slug === slug);
  if (!summary) return { ok: false, error: "unknown-course" };
  const base = await getBaseCourseCopy(PROJECT, slug, locale);

  const write = () =>
    prisma.$transaction(async (tx) => {
      // Lock the row (when it exists) until this transaction commits.
      await tx.$queryRaw`SELECT id FROM "Course" WHERE "projectId" = ${PROJECT} AND "slug" = ${slug} FOR UPDATE`;
      const row = await tx.course.findFirst({
        where: { projectId: PROJECT, slug },
        select: { id: true, meta: true, copyOverride: true, badgeId: true },
      });

      if (row?.meta) {
        if (!title) return { kind: "title-required" as const };
        const meta = row.meta as CourseMeta;
        const entry = {
          title,
          tagline,
          clusterLabel:
            clusterLabel ||
            meta[locale]?.clusterLabel ||
            pickMeta(meta, locale)?.clusterLabel ||
            "Skill",
        };
        const next: CourseMeta = { ...meta, [locale]: entry };
        await tx.course.update({
          where: { id: row.id },
          data: { meta: next as Prisma.InputJsonValue },
        });
        // The badge keeps the course's name: it follows the English copy
        // (or the first language, until there is English), so rewording
        // another language leaves it as it is.
        if (row.badgeId) {
          await tx.badge.update({
            where: { id: row.badgeId },
            data: courseBadgeCopy(pickMeta(next, "en"), slug),
          });
        }
        return { kind: "cms" as const, copy: entry, cleared: false };
      }

      // Built-in: a field that matches the shipped wording is not a rewording.
      const next = mergeCopyOverride(readCopyOverride(row?.copyOverride), locale, {
        title: title === base?.title ? "" : title,
        tagline: tagline === base?.tagline ? "" : tagline,
      });
      if (row) {
        await tx.course.update({
          where: { id: row.id },
          data: {
            copyOverride: next
              ? (next as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      } else if (next) {
        // First edit of a built-in course that has no row yet.
        await tx.course.create({
          data: {
            projectId: PROJECT,
            strapiId: `placeholder-${slug}`,
            slug,
            cluster: summary.cluster,
            durationMinutes: summary.durationMinutes,
            // The column defaults to "draft": without this, rewording a
            // built-in course would take it away from learners.
            status: summary.status,
            publishedAt: null,
            copyOverride: next as Prisma.InputJsonValue,
          },
        });
      }
      const shipped = base ?? {
        title: summary.title,
        tagline: summary.tagline,
        clusterLabel: summary.clusterLabel,
      };
      return {
        kind: "bundled" as const,
        copy: applyCopy(shipped, next, locale),
        cleared: !next?.[locale],
      };
    });

  let result: Awaited<ReturnType<typeof write>>;
  try {
    result = await write();
  } catch (e) {
    // Two first-ever saves of the same built-in course can both try to create
    // its row; the loser retries once, and then finds (and locks) the row.
    if ((e as { code?: string }).code !== "P2002") throw e;
    result = await write();
  }
  if (result.kind === "title-required") {
    return { ok: false, error: "title-required" };
  }

  await audit(editor.id, "course.meta_updated", slug, {
    locale,
    kind: result.kind,
    cleared: result.cleared,
  });
  return {
    ok: true,
    copy: {
      title: result.copy.title,
      tagline: result.copy.tagline,
      clusterLabel: result.copy.clusterLabel,
    },
  };
}
