import "server-only";

/**
 * What an editor's "Preview as learner" shows (D56, spec 9.2): the learner
 * view itself — the very object the route loaded — for every course
 * learners can get as built: bundled, published, or standard (no reason in
 * newOnlyReasons). For a draft course with lessons or content learners
 * don't get until Release 2, the same course in the editor's layout
 * (SectionedCourseContent), played by the sectioned preview player:
 * the lesson list's order, hidden lessons left out, step names in the
 * preview's language, each lesson resolved by resolveSectionStage (main
 * content as learners read it, extra content's live versions only, video
 * and published documents).
 *
 * getCourse isn't cached, so the route passes in the learner view it
 * already has. Never built for learners: the route calls this for editors
 * only. Fails open: a course whose list can't be read, or any error,
 * previews as learners see it today.
 */

import { prisma } from "@/lib/prisma";
import { normaliseStatus } from "./course-status";
import {
  isLegacySectionId,
  mainKindOf,
  type SectionStage,
  type SectionedCourseContent,
} from "./sections/contract";
import { previewDefaults } from "./sections/defaults";
import { newOnlyReasons } from "./sections/guard";
import { nameSection, standardName } from "./sections/names";
import { resolveOutline } from "./sections/outline";
import { resolveSectionStage } from "./sections/resolve";
import { sectionTitle } from "./sections/views";
import type { CourseContent, Locale, StageKey } from "./types";

export async function getPreviewCourse(
  projectId: string,
  slug: string,
  locale: Locale,
  learner: CourseContent
): Promise<CourseContent | SectionedCourseContent> {
  try {
    const course = await prisma.course.findFirst({
      where: { projectId, slug },
      select: { meta: true, outline: true, status: true },
    });
    // Built-in courses and published ones: what learners get is the preview.
    if (!course?.meta || normaliseStatus(course.status) === "published") return learner;

    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      select: {
        stageKey: true,
        narrative: true,
        structure: true,
        structureDraft: true,
        parts: true,
        video: true,
        // Learners only ever see published documents (D35).
        documents: {
          where: { published: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, published: true },
        },
      },
    });
    const outline = resolveOutline("cms", course.outline ?? null, lessons);
    const reasons = newOnlyReasons("cms", outline, lessons);
    if (reasons.length === 0 || outline.unreadable || reasons.some((r) => r.code === "unreadable")) {
      return learner;
    }

    const rowOf = new Map(lessons.map((l) => [l.stageKey, l]));
    const defaults = previewDefaults(locale);
    const stages: SectionStage[] = [];
    for (const section of outline.sections) {
      if (section.hidden) continue;
      const row = rowOf.get(section.id);
      const label = nameSection(section, locale, {
        title: sectionTitle(row, mainKindOf(section), locale),
        n: stages.length + 1,
      }).text;
      const stage = resolveSectionStage({
        section,
        row,
        locale,
        label,
        standardTitle: isLegacySectionId(section.id)
          ? standardName(section.id as StageKey, locale)
          : label,
        defaults,
      });
      if (stage) stages.push(stage);
    }

    const { stages: _learnerStages, ...rest } = learner;
    void _learnerStages;
    return { ...rest, sectioned: true, stages };
  } catch {
    return learner;
  }
}
