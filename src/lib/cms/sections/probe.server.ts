import "server-only";

/**
 * The /dev/cms-check probe of the flexible editor's data (spec 2.1,
 * addendum 10): which created courses hold a lesson list (Course.outline)
 * or extra content (Lesson.parts) that can't be read. Such a course is
 * still shown — the derived list, the main content only — but nothing in
 * it can be changed and it can't be published until an admin repairs it
 * (repairOutline). Read-only.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStoredOutline } from "./outline";
import { partsOf } from "./section-parts";

export interface SectionProbe {
  ok: boolean;
  /** How many created courses were checked. */
  checked: number;
  unreadable: { slug: string; outline: boolean; lessons: string[] }[];
  error?: string;
}

export async function probeSectionData(projectId: string): Promise<SectionProbe> {
  try {
    const courses = await prisma.course.findMany({
      where: { projectId, NOT: { meta: { equals: Prisma.DbNull } } },
      select: { slug: true, outline: true },
      orderBy: { createdAt: "asc" },
    });
    const lessons = await prisma.lesson.findMany({
      where: {
        projectId,
        courseSlug: { in: courses.map((c) => c.slug) },
        NOT: { parts: { equals: Prisma.DbNull } },
      },
      select: { courseSlug: true, stageKey: true, parts: true },
    });
    const unreadable = courses
      .map((c) => ({
        slug: c.slug,
        outline: parseStoredOutline(c.outline) === "unreadable",
        lessons: lessons
          .filter((l) => l.courseSlug === c.slug && partsOf(l.parts) === "unreadable")
          .map((l) => l.stageKey),
      }))
      .filter((c) => c.outline || c.lessons.length > 0);
    return { ok: true, checked: courses.length, unreadable };
  } catch (e) {
    return { ok: false, checked: 0, unreadable: [], error: (e as Error).message.slice(0, 200) };
  }
}
