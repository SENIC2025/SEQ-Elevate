import "server-only";

/**
 * Overlays authored lesson content (DB) onto provider-built CourseContent:
 *   - the per-locale narrative override (title / subtitle / blocks),
 *   - an attached interactive video,
 *   - uploaded documents (published only), with the languages each is for,
 *   - further-reading links (Release 4, D107: published only, each address
 *     checked again as it is read).
 * The bundled provider supplies the baseline copy; this merges in whatever an
 * author edited in the in-app CMS. Defensive: any DB error (e.g. table not yet
 * migrated) falls back to the unmodified content, so lessons always render;
 * the links are read on their own, so a failure there costs only the links.
 *
 * Nothing here is filtered by language: getCourse doesn't know the page's
 * language, and staff screens read it too. The learner's lessons are
 * filtered where they are drawn (learner-course.ts, D108).
 */

import { prisma } from "@/lib/prisma";
import { furtherReadingOn } from "@/lib/r4-switches";
import { learnerLink, storedLanguages } from "./lesson-links";
import type { ItemLanguages, LessonLinkRef } from "./reading-types";
import { overlayNarrative } from "./text-fallback";
import type { CourseContent, VideoContent, LessonDocumentRef } from "./types";

/**
 * The published further-reading links of a course's lessons, by lesson key,
 * in order; a stored address the check refuses is left out (spec 4.4).
 * Empty with R4_FURTHER_READING=off, and on any error (logged): a course
 * never fails because of its further reading.
 */
export async function publishedLinksByLesson(
  projectId: string,
  slug: string
): Promise<Map<string, LessonLinkRef[]>> {
  const byLesson = new Map<string, LessonLinkRef[]>();
  if (!furtherReadingOn()) return byLesson;
  try {
    const rows = await prisma.lessonLink.findMany({
      where: { published: true, lesson: { projectId, courseSlug: slug } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        url: true,
        description: true,
        languages: true,
        published: true,
        lesson: { select: { stageKey: true } },
      },
    });
    for (const row of rows) {
      const link = learnerLink(row);
      if (!link) continue;
      const key = row.lesson.stageKey;
      byLesson.set(key, [...(byLesson.get(key) ?? []), link]);
    }
  } catch (error) {
    console.error(`Couldn't read the further reading of "${slug}"; its lessons show without it.`, error);
    byLesson.clear();
  }
  return byLesson;
}

/** A document as a page gets it, with its languages only when it isn't for every language. */
export function documentRef(d: {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  published: boolean;
  languages?: unknown;
}): LessonDocumentRef & ItemLanguages {
  const languages = storedLanguages(d.languages);
  return {
    id: d.id,
    name: d.name,
    url: d.url,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    published: d.published,
    ...(languages.length ? { languages } : {}),
  };
}

export async function applyLessonMedia(
  projectId: string,
  slug: string,
  content: CourseContent
): Promise<CourseContent> {
  const links = publishedLinksByLesson(projectId, slug);
  try {
    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      // Only what learners see (spec 9.4): never a lesson's extra content
      // (Lesson.parts, up to 600,000 characters, which no learner reads
      // before Release 2) or an editor's draft.
      select: {
        stageKey: true,
        narrative: true,
        video: true,
        // Learners only ever see published documents.
        documents: {
          where: { published: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            url: true,
            mimeType: true,
            sizeBytes: true,
            published: true,
            languages: true,
          },
        },
      },
    });
    if (lessons.length === 0) return content;

    const byStage = new Map(lessons.map((l) => [l.stageKey, l]));
    const linksOf = await links;

    const stages = content.stages.map((stage) => {
      const lesson = byStage.get(stage.key);
      if (!lesson) return stage;

      // Narrative override for this locale, field by field: a field left
      // blank (typed, then cleared) keeps the bundled copy rather than
      // showing learners nothing.
      const narrative = (lesson.narrative as Record<string, unknown>) ?? null;
      const ov = narrative?.[content.locale];

      const documents = lesson.documents.map(documentRef);
      const reading = linksOf.get(stage.key) ?? [];

      return {
        ...overlayNarrative(stage, ov),
        // DB-attached video overrides any bundled demo video for this stage.
        video: (lesson.video as VideoContent | null) ?? stage.video,
        documents: documents.length ? documents : stage.documents,
        ...(reading.length ? { links: reading } : {}),
      };
    });

    return { ...content, stages };
  } catch {
    return content;
  }
}
