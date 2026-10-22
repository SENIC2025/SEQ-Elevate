"use server";

/**
 * References & bibliography (D109, spec 5.3): one list per created course,
 * per language, in the lesson-text format, written by the course's authors
 * in APA 7. It goes live when it is saved, like lesson text (D33): the
 * learner page reads it on every request.
 *
 * - Editors only: canEditContent (editors, partner admins, admins).
 * - Built-in courses have no list: their Course row may not exist, and
 *   writing one would change what learners get (course.ts).
 * - The Course row is taken FOR SHARE (lockCourse), never FOR UPDATE, which
 *   would wait for and block every learner's FOR KEY SHARE; the references
 *   row is taken by a Prisma upsert, whose update holds its row lock to the
 *   end of the transaction, so two editors' saves run one at a time and the
 *   second reads what the first committed. No raw SQL here: the locks are
 *   store.server.ts's.
 * - A save sends back the fingerprint of what it started from (`base`,
 *   D39): when someone else saved this language since, it is refused as
 *   "changed-elsewhere" and the transaction rolls back.
 * - The list is saved through richTextForSave, as lesson text is: refused,
 *   never cut, with one sentence per problem naming "The references list".
 *   An empty list removes its language.
 * - Audited against the course (its slug) with the language only, never
 *   the list's text.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { COURSE_DEFS } from "@/data/course";
import { isContentLocale } from "@/lib/cms/course-admin-types";
import { parseBibliography, type BibliographyEntry } from "@/lib/cms/bibliography";
import { readCourseBibliography } from "@/lib/cms/course-references";
import { PROJECT, SLUG, lockCourse } from "@/lib/cms/sections/store.server";
import { ChangedElsewhere, fingerprint } from "@/lib/cms/stored-json";
import { hasText } from "@/lib/cms/text-fallback";
import { richTextForSave } from "@/lib/rich-text/narrative";
import type { RichText } from "@/lib/rich-text/types";
import type { Locale } from "@/lib/cms/types";

/** How a refusal names the list (richTextForSave's `name`). */
const NAME = "The references list";

export type SaveCourseReferencesResult =
  /** `base`: the new fingerprint for the next save; `saved`: what is stored now (null: none). */
  | { ok: true; base: string | null; saved: { text: string; rich: RichText } | null }
  | { ok: false; error: "forbidden" | "bad-input" | "not-found" | "built-in" | "changed-elsewhere" }
  | { ok: false; error: "invalid"; issues: string[] };

/** Every language's list as the editor opens it, each with the base its next save sends. */
export type CourseReferencesForEditor = {
  locales: Partial<Record<Locale, BibliographyEntry & { base: string }>>;
};

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

/** A course the platform ships (built in): never a list. */
const isBundled = (slug: string) => Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug);

/** A base as the editor sends it back: a fingerprint, or null for "nothing stored". */
const isBase = (base: unknown): base is string | null =>
  base === null || (typeof base === "string" && base.length <= 32);

/** The list as sent: `{ rich }`, or null to remove this language's list. */
const isValue = (value: unknown): value is { rich: unknown } | null =>
  value === null || (typeof value === "object" && !Array.isArray(value) && "rich" in value);

/** Thrown inside the transaction to answer `result` with nothing written (it rolls back). */
class Stop extends Error {
  constructor(readonly result: SaveCourseReferencesResult) {
    super("stop");
    this.name = "Stop";
  }
}

/**
 * Save (or, with `value` null or an empty list, remove) a created course's
 * references in one language. `base` is the fingerprint of this language's
 * list when the editor opened it (null: none), as
 * loadCourseReferencesForEditor or the last save handed it over.
 */
export async function saveCourseReferences(
  slug: string,
  locale: Locale,
  value: { rich: unknown } | null,
  base: string | null
): Promise<SaveCourseReferencesResult> {
  const editor = await requireEditor();
  if (!editor) return { ok: false, error: "forbidden" };
  if (typeof slug !== "string" || !SLUG.test(slug) || !isContentLocale(locale) || !isValue(value) || !isBase(base)) {
    return { ok: false, error: "bad-input" };
  }
  if (isBundled(slug)) return { ok: false, error: "built-in" };

  // Read and checked before any lock is taken; refused only after the
  // checks under the lock, which come first (spec 5.3).
  const prepared = value === null ? null : richTextForSave(value.rich, NAME);
  const entry = prepared?.ok && hasText(prepared.text) ? { text: prepared.text, rich: prepared.rich } : null;

  const write = () =>
    prisma.$transaction(async (tx) => {
      const course = await lockCourse(tx, slug, "share");
      if (!course) throw new Stop({ ok: false, error: "not-found" });
      if (course.meta === null) throw new Stop({ ok: false, error: "built-in" });
      const row = await tx.courseBibliography.upsert({
        where: { courseId: course.id },
        create: { courseId: course.id, content: { v: 1, locales: {} } },
        update: { updatedAt: new Date() },
        select: { content: true },
      });
      const stored = parseBibliography(row.content);
      if (fingerprint(stored.locales[locale] ?? null) !== base) throw new ChangedElsewhere();
      if (prepared && !prepared.ok) throw new Stop({ ok: false, error: "invalid", issues: prepared.issues });
      const locales = { ...stored.locales };
      if (entry) {
        locales[locale] = entry;
      } else if (locales[locale]) {
        delete locales[locale];
      } else {
        // Nothing to remove: leave no row behind for it.
        throw new Stop({ ok: true, base: null, saved: null });
      }
      await tx.courseBibliography.update({
        where: { courseId: course.id },
        data: { content: { v: 1, locales } as unknown as Prisma.InputJsonValue },
      });
    });

  try {
    try {
      await write();
    } catch (error) {
      // Two first saves of a course's list can both try to create its row;
      // the later one tries again, and then takes (and waits for) the row.
      if ((error as { code?: string }).code !== "P2002") throw error;
      await write();
    }
  } catch (error) {
    if (error instanceof ChangedElsewhere) return { ok: false, error: "changed-elsewhere" };
    if (error instanceof Stop) return error.result;
    throw error;
  }

  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: editor.id,
      action: entry ? "course.references_saved" : "course.references_cleared",
      entity: "Course",
      entityId: slug,
      metadata: { locale },
    },
  });
  return entry ? { ok: true, base: fingerprint(entry), saved: entry } : { ok: true, base: null, saved: null };
}

/**
 * A created course's references in every language, for its editor on the
 * course page (each with its base), so the page's own data needn't carry
 * them. Null for anyone who can't edit content, and for a course that is
 * built in, unknown, or not a course slug at all.
 */
export async function loadCourseReferencesForEditor(slug: string): Promise<CourseReferencesForEditor | null> {
  const editor = await requireEditor();
  if (!editor) return null;
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  const content = await readCourseBibliography(PROJECT, slug);
  if (!content) return null;
  const locales: CourseReferencesForEditor["locales"] = {};
  for (const [locale, entry] of Object.entries(content.locales) as [Locale, BibliographyEntry][]) {
    locales[locale] = { ...entry, base: fingerprint(entry)! };
  }
  return { locales };
}
