import "server-only";

/**
 * The lesson plans of every course created here, for the screens that
 * count progress across courses: the dashboard and the course grid
 * (listDbCourses), the facilitator view and the statistics (spec 3.3). The
 * plan is the one the player plays (lessonPlanOf), so their counts and the
 * player can't disagree (D64).
 *
 * Two queries for all courses' lessons, so the dashboard doesn't load every
 * lesson's text: the standard lessons without their narrative (it never
 * changes whether they are shown, nor their names), the course's own with
 * it (their title can name them). Cached per request (React cache), so
 * several callers on one page read once.
 *
 * Its own module, beside learner-course.ts (which re-exports it), because
 * db-course.ts reads it: learner-course.ts reads the platform's defaults,
 * which come from db-course.ts.
 *
 * Throws when the database can't be read; each caller decides what its
 * page shows then (listDbCourses: no created courses, as before).
 */

import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lessonPlanOf, type LessonFacts, type LessonPlan } from "./sections/learner-path";
import { learnerPlayerOff } from "./sections/switches";
import type { Locale } from "./types";

const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

async function readLessonPlans(projectId: string, locale: Locale): Promise<Map<string, LessonPlan>> {
  const courses = await prisma.course.findMany({
    // `meta` present = created in the CMS; DB NULL = bundled course.
    where: { projectId, NOT: { meta: { equals: Prisma.DbNull } } },
    select: { slug: true, outline: true },
  });
  if (!courses.length) return new Map();
  const slugs = courses.map((c) => c.slug);
  const common = {
    courseSlug: true,
    stageKey: true,
    structure: true,
    parts: true,
    video: true,
    // Learners only ever see published documents (D35).
    _count: { select: { documents: { where: { published: true } } } },
  } as const;
  const [standard, own] = await Promise.all([
    prisma.lesson.findMany({
      where: { projectId, courseSlug: { in: slugs }, NOT: { stageKey: { startsWith: "s-" } } },
      select: common,
    }),
    prisma.lesson.findMany({
      where: { projectId, courseSlug: { in: slugs }, stageKey: { startsWith: "s-" } },
      select: { ...common, narrative: true },
    }),
  ]);

  const factsBySlug = new Map<string, LessonFacts[]>();
  for (const l of [...standard, ...own]) {
    const facts: LessonFacts = {
      stageKey: l.stageKey,
      structure: l.structure ?? null,
      parts: l.parts ?? null,
      narrative: "narrative" in l ? (l.narrative ?? null) : null,
      hasVideo: isRecord(l.video),
      publishedDocuments: l._count.documents,
    };
    factsBySlug.set(l.courseSlug, [...(factsBySlug.get(l.courseSlug) ?? []), facts]);
  }
  const legacyOnly = learnerPlayerOff();
  return new Map(
    courses.map((c) => [
      c.slug,
      lessonPlanOf("cms", c.outline ?? null, factsBySlug.get(c.slug) ?? [], locale, { legacyOnly }),
    ])
  );
}

/** Each created course's lesson plan in `locale`, by slug. Built-in courses aren't in it. */
export const getLessonPlans: (projectId: string, locale: Locale) => Promise<Map<string, LessonPlan>> =
  cache(readLessonPlans);
