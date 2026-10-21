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
import { canEditContent, canSignOffLanguage } from "@/lib/permissions";
import { COURSE_DEFS } from "@/data/course";
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
import { courseBadgeCopy } from "@/lib/cms/course-badge";
import {
  createCourseBadge,
  ensureCourseBadge,
} from "@/lib/cms/ensure-course-badge";
import { slugify } from "@/lib/slug";
import type { Locale } from "@/lib/cms/types";
import { LEGACY_ORDER, type PublishRefused } from "@/lib/cms/sections/contract";
import { newOnlyReasons } from "@/lib/cms/sections/guard";
import { resolveOutline, toStoredOutline } from "@/lib/cms/sections/outline";
import { publishBlockers } from "@/lib/cms/sections/publish-blockers";
import { publishGuardOn } from "@/lib/cms/sections/switches";

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

/** The full template's lesson list: every standard lesson, in the standard order. */
const FULL_TEMPLATE = toStoredOutline({
  sections: LEGACY_ORDER.map((id) => ({ id, template: id, custom: false })),
  removed: [],
  materialised: true,
}) as unknown as Prisma.InputJsonValue;

/** Thrown in setCourseStatus's transaction to refuse publishing (G1): nothing is written. */
class GuardRefused extends Error {
  constructor(readonly refused: PublishRefused) {
    super(refused.error);
    this.name = "GuardRefused";
  }
}

const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

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
  /**
   * "full" starts from the full template: a stored lesson list with all
   * seven standard lessons, the three exercises still to write. It is the
   * standard layout, so the course publishes as any other (D56).
   */
  layout?: "standard" | "full";
}) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  // A server action's arguments come straight from the client.
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.title !== "string" ||
    typeof input.tagline !== "string" ||
    typeof input.cluster !== "string" ||
    typeof input.clusterLabel !== "string" ||
    typeof input.durationMinutes !== "number" ||
    (input.layout !== undefined && input.layout !== "standard" && input.layout !== "full")
  ) {
    return { ok: false as const, error: "bad-input" };
  }
  if (!isContentLocale(input.locale)) return { ok: false as const, error: "bad-locale" };

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
    const badge = await createCourseBadge(tx, PROJECT, slug, { title, tagline });
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
        ...(input.layout === "full" ? { outline: FULL_TEMPLATE } : {}),
      },
    });
  });

  await audit(editor.id, "course.created", slug, { status: "draft" });
  return { ok: true as const, slug };
}

/**
 * G1, as Release 2 has it (D66, spec 4.8): may this course be published?
 * Learners get a created course as it is built, so only what can't be
 * promised stops it: a lesson list or a listed lesson's content that can't
 * be read, or no lesson learners would see (publishBlockers) — refused as
 * "cannot-publish". Lessons of its own, hidden or deleted ones, a new order,
 * extra content and step names all publish. Built-in courses are never
 * checked (G2).
 *
 * Under a kill switch (R2_PUBLISH_GUARD=on, or R2_LEARNER_PLAYER=off, which
 * gives learners Release 1's view again) Release 1's whole rule (D57,
 * newOnlyReasons) is back, refused as "needs-release-2" as then.
 *
 * Runs first in the publishing transaction, under the Course row lock, so
 * a lesson-list change (which takes the same lock) can't slip in between
 * the check and the publish. Throws GuardRefused, which rolls back.
 */
async function guardPublish(tx: Prisma.TransactionClient, courseId: string, slug: string) {
  await tx.$queryRaw`SELECT id FROM "Course" WHERE "id" = ${courseId} FOR UPDATE`;
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { meta: true, outline: true },
  });
  if (!course?.meta) return;
  const rows = await tx.lesson.findMany({
    where: { projectId: PROJECT, courseSlug: slug },
    select: {
      stageKey: true,
      narrative: true,
      structure: true,
      structureDraft: true,
      parts: true,
      video: true,
      // Learners only ever see published documents (D35).
      documents: { where: { published: true }, select: { id: true } },
    },
  });
  const lessons = rows.map((r) => ({
    stageKey: r.stageKey,
    narrative: r.narrative ?? null,
    structure: r.structure ?? null,
    structureDraft: r.structureDraft ?? null,
    parts: r.parts ?? null,
    video: r.video ?? null,
    hasVideo: isRecord(r.video),
    publishedDocuments: r.documents?.length ?? 0,
  }));
  if (publishGuardOn()) {
    const reasons = newOnlyReasons("cms", resolveOutline("cms", course.outline ?? null, lessons), lessons);
    if (reasons.length) throw new GuardRefused({ ok: false, error: "needs-release-2", reasons });
    return;
  }
  const reasons = publishBlockers("cms", course.outline ?? null, lessons);
  if (reasons.length) throw new GuardRefused({ ok: false, error: "cannot-publish", reasons });
}

/**
 * Set a course's editorial status. Any status can follow any other, so an
 * archived course can be published again or moved back to draft. Creates the
 * Course row if the course is bundled but was never seeded, so publishing
 * works on a fresh database.
 *
 * Publishing a created course that has no badge (one the old code made while
 * a deploy was building) gives it one in the same transaction, so learners
 * never take a course whose badge can't be saved (ensure-course-badge.ts).
 *
 * Publishing a created course is refused with "cannot-publish" and the
 * reasons when its lessons can't be read or learners would see none (G1,
 * guardPublish; "needs-release-2" under a kill switch) — also from
 * published or archived to published. Nothing is written then, and the
 * refusal is audited.
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
    try {
      await prisma.$transaction(async (tx) => {
        if (status === "published") {
          await guardPublish(tx, existing.id, slug);
          await ensureCourseBadge(tx, existing.id);
        }
        await tx.course.update({
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
      });
    } catch (error) {
      if (!(error instanceof GuardRefused)) throw error;
      await audit(editor.id, "course.publish_refused", slug, {
        error: error.refused.error,
        reasons: error.refused.reasons as unknown as Prisma.InputJsonValue,
      });
      return error.refused;
    }
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
        // another language leaves it as it is. A course without a badge
        // (one the old code made while a deploy was building) gets one
        // here, named after the copy just saved.
        if (row.badgeId) {
          await tx.badge.update({
            where: { id: row.badgeId },
            data: courseBadgeCopy(pickMeta(next, "en"), slug),
          });
        } else {
          await ensureCourseBadge(tx, row.id);
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

export type LanguageReadyResult =
  | { ok: true; readyLocales: Locale[] }
  | { ok: false; error: "forbidden" | "bad-input" | "unknown-course" | "built-in" };

const SIGN_OFF_LOCALES: readonly Locale[] = ["de", "el"];
// Slugs are [a-z0-9-] (src/lib/slug.ts); anything else can't be a course.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Switch a created course's German or Greek on or off for learners (D90,
 * spec 9.4): until a language is on, learners using it get the whole
 * course in English (language-ready.ts). Signed off by a partner admin or
 * an ADMIN (canSignOffLanguage); until partner admins are invited, an
 * ADMIN switches at the partner's written request, and this row records
 * who did. German is signed off by Pro Arbeit, Greek by a Greek-speaking
 * partner: a rule of the process, since a course has no owner here.
 *
 * Built-in courses are refused: they ship complete in every language and
 * are always on. The array changes in the database, in one statement under
 * the Course row lock this file's other changes take, so two languages
 * switched at the same moment never drop each other. A change is audited
 * (course.language_ready / course.language_unready); a switch to what is
 * already set changes and logs nothing.
 */
export async function setCourseLanguageReady(
  slug: string,
  locale: "de" | "el",
  ready: boolean
): Promise<LanguageReadyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  if (!canSignOffLanguage(roles)) return { ok: false, error: "forbidden" };
  if (
    typeof slug !== "string" ||
    !SLUG.test(slug) ||
    !SIGN_OFF_LOCALES.includes(locale) ||
    typeof ready !== "boolean"
  ) {
    return { ok: false, error: "bad-input" };
  }
  if (Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug)) return { ok: false, error: "built-in" };

  const result = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string; builtin: boolean; readyLocales: string[] | null }[]>`
      SELECT "id", "meta" IS NULL AS "builtin", "readyLocales" FROM "Course"
       WHERE "projectId" = ${PROJECT} AND "slug" = ${slug} FOR UPDATE`;
    if (!row) return { kind: "unknown-course" as const };
    if (row.builtin) return { kind: "built-in" as const };
    const [updated] = ready
      ? await tx.$queryRaw<{ readyLocales: string[] | null }[]>`UPDATE "Course" SET "readyLocales" = array_append(array_remove(COALESCE("readyLocales", ARRAY[]::TEXT[]), ${locale}), ${locale}) WHERE "id" = ${row.id} RETURNING "readyLocales"`
      : await tx.$queryRaw<{ readyLocales: string[] | null }[]>`UPDATE "Course" SET "readyLocales" = array_remove(COALESCE("readyLocales", ARRAY[]::TEXT[]), ${locale}) WHERE "id" = ${row.id} RETURNING "readyLocales"`;
    const before = (row.readyLocales ?? []).includes(locale);
    return { kind: "ok" as const, readyLocales: updated?.readyLocales ?? [], changed: before !== ready };
  });
  if (result.kind !== "ok") return { ok: false, error: result.kind };

  if (result.changed) {
    await audit(user.id, ready ? "course.language_ready" : "course.language_unready", slug, { locale });
  }
  return {
    ok: true,
    readyLocales: result.readyLocales.filter((l): l is Locale => SIGN_OFF_LOCALES.includes(l as Locale)),
  };
}
