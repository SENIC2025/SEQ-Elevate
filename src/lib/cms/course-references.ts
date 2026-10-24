import "server-only";

/**
 * A created course's references and bibliography as its pages read them
 * (D109, spec 5.4): the learner's references page, its tab title, and (from
 * the player) whether there is a list to link to. Parsing and the choice of
 * language are bibliography.ts's (pure); this only reads the row.
 *
 * Built-in courses have no list (their Course row has no `meta`, and may
 * not exist at all). Reads fail closed and quietly: any error answers "no
 * list", so no course page ever fails because of its references, and the
 * log names the error's kind only, never the list's text.
 */

import { prisma } from "@/lib/prisma";
import { COURSE_DEFS } from "@/data/course";
import { bibliographyFor, parseBibliography, writtenLocales, type BibliographyContent } from "./bibliography";
import type { Locale } from "./types";

/** A course the platform ships (built in). */
const isBundled = (slug: string) => Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug);

/**
 * Every language's list of the created course `slug`, as stored: an empty
 * list when the course has no references row yet; null when it is built in
 * or not found. Throws when the database does.
 */
export async function readCourseBibliography(projectId: string, slug: string): Promise<BibliographyContent | null> {
  if (isBundled(slug)) return null;
  const course = await prisma.course.findUnique({
    where: { projectId_slug: { projectId, slug } },
    select: { meta: true, bibliography: { select: { content: true } } },
  });
  if (!course || course.meta === null) return null;
  return parseBibliography(course.bibliography?.content ?? null);
}

/** The list a learner reads: its language (which may not be the one asked for), text and rich text. */
export interface CourseReferences {
  locale: Locale;
  text: string;
  rich?: unknown;
}

const logFailure = (slug: string, error: unknown) =>
  console.error(`[references] couldn't read the references of "${slug}": ${error instanceof Error ? error.name : "error"}`);

/**
 * The list of `slug` for a learner reading the course in `locale` (their
 * content language, Release 3's learnerContentLocale): in that language
 * when it is written there, else English, else the first language written.
 * Null when there is none, and on any error.
 */
export async function getCourseReferences(projectId: string, slug: string, locale: Locale): Promise<CourseReferences | null> {
  try {
    const content = await readCourseBibliography(projectId, slug);
    const chosen = content ? bibliographyFor(content, locale) : null;
    return chosen ? { locale: chosen.locale, ...chosen.entry } : null;
  } catch (error) {
    logFailure(slug, error);
    return null;
  }
}

/** Does `slug` have a list in any language? False on any error. */
export async function hasCourseReferences(projectId: string, slug: string): Promise<boolean> {
  try {
    const content = await readCourseBibliography(projectId, slug);
    return content !== null && writtenLocales(content).length > 0;
  } catch (error) {
    logFailure(slug, error);
    return false;
  }
}
