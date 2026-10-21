import "server-only";

/**
 * Release 3 (D90, spec 9.2): which language a learner reads a course in.
 *
 * A course created here is translated by hand, and its text falls back to
 * English field by field (text-fallback.ts), so a half-translated course is
 * a mix. So a learner using German or Greek gets the whole course in English
 * until that language is signed off for the course (Course.readyLocales).
 * English is always ready, and so is every language of a bundled course
 * (the platform ships them complete).
 *
 * Decided outside getCourse: staff screens read each language through
 * getCourse and must keep seeing the translation. Lesson ids don't depend on
 * the language, so a change of the language a learner gets is safe for their
 * progress.
 *
 * R3_LANGUAGE_READY=off (r3-switches.ts) makes every language ready again
 * (Release 2's behaviour).
 */

import { prisma } from "@/lib/prisma";
import { COURSE_DEFS } from "@/data/course";
import { languageReadyOn } from "@/lib/r3-switches";
import type { Locale } from "./types";

type Env = Record<string, string | undefined>;

/** A course the platform ships ("builtin"), or one created here ("created"). */
export type CourseKind = "builtin" | "created";

/**
 * The language a learner who asked for `requested` gets a course in:
 * `requested` when it is English, when the course is bundled, or when the
 * language is signed off for it; otherwise English.
 */
export function contentLocaleFor(
  kind: CourseKind,
  readyLocales: readonly string[] | null | undefined,
  requested: Locale,
  env: Env = process.env
): Locale {
  if (requested === "en" || kind === "builtin" || !languageReadyOn(env)) return requested;
  return Array.isArray(readyLocales) && readyLocales.includes(requested) ? requested : "en";
}

/** Is `slug` a course the platform ships (the local provider's courses)? */
const isBundled = (slug: string) => Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug);

/**
 * contentLocaleFor for the course `slug` of `projectId`, read from the
 * database. A bundled course never depends on the database. Any error, or a
 * course not found, answers English: the course still shows (D18), never as
 * a half-translated mix.
 */
export async function learnerContentLocale(projectId: string, slug: string, requested: Locale): Promise<Locale> {
  if (requested === "en" || isBundled(slug) || !languageReadyOn()) return requested;
  try {
    const course = await prisma.course.findUnique({
      where: { projectId_slug: { projectId, slug } },
      select: { readyLocales: true, meta: true },
    });
    if (!course) return "en";
    return contentLocaleFor(course.meta === null ? "builtin" : "created", course.readyLocales, requested);
  } catch (e) {
    console.error(`[language] couldn't read which languages are ready: ${e instanceof Error ? e.name : "error"}`);
    return "en";
  }
}
