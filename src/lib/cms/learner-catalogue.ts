import "server-only";

/**
 * Release 3 (D90, spec 9.3): the courses a learner's dashboard lists, each
 * in the language the learner gets it in. A created course whose German or
 * Greek isn't switched on yet is given in English (its English summary:
 * title, subtitle, step names), marked `contentLocale: "en"` so the
 * dashboard can say so; a built-in course and a signed-off language are
 * as requested (language-ready.ts). Lesson ids don't depend on the
 * language, so progress counts the same either way.
 *
 * One query for the signed-off languages besides the two catalogues. If it
 * fails, every created course is given in English: shown, never as a
 * half-translated mix (D18).
 */

import { prisma } from "@/lib/prisma";
import { COURSE_DEFS } from "@/data/course";
import { languageReadyOn } from "@/lib/r3-switches";
import { listCourses } from "./index";
import { contentLocaleFor } from "./language-ready";
import type { CourseSummary, Locale } from "./types";

/** Is `slug` a course the platform ships? Those are complete in every language. */
const isBundled = (slug: string) => Object.prototype.hasOwnProperty.call(COURSE_DEFS, slug);

/** Each course's signed-off languages, by slug; null when they can't be read. */
async function readyLocalesBySlug(projectId: string): Promise<Map<string, string[]> | null> {
  try {
    const rows = await prisma.course.findMany({
      where: { projectId },
      select: { slug: true, readyLocales: true },
    });
    return new Map(rows.map((r) => [r.slug, r.readyLocales ?? []]));
  } catch (e) {
    console.error(`[language] couldn't read which languages are ready: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

/** The learners' catalogue in `locale`, each course in the language they get it in. */
export async function learnerCatalogue(projectId: string, locale: Locale): Promise<CourseSummary[]> {
  if (locale === "en" || !languageReadyOn()) return listCourses(projectId, locale);
  const [requested, english, ready] = await Promise.all([
    listCourses(projectId, locale),
    listCourses(projectId, "en"),
    readyLocalesBySlug(projectId),
  ]);
  const englishBySlug = new Map(english.map((c) => [c.slug, c]));
  return requested.map((course) => {
    if (isBundled(course.slug)) return course;
    const shown = ready ? contentLocaleFor("created", ready.get(course.slug), locale) : "en";
    if (shown === locale) return course;
    const inEnglish = englishBySlug.get(course.slug);
    return inEnglish ? { ...inEnglish, contentLocale: "en" as const } : course;
  });
}
