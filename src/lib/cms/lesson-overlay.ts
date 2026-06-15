import "server-only";

/**
 * Overlays authored lesson content (DB) onto provider-built CourseContent:
 *   - the per-locale narrative override (title / subtitle / blocks),
 *   - an attached interactive video,
 *   - uploaded documents (published only).
 * The bundled provider supplies the baseline copy; this merges in whatever an
 * author edited in the in-app CMS. Defensive: any DB error (e.g. table not yet
 * migrated) falls back to the unmodified content, so lessons always render.
 */

import { prisma } from "@/lib/prisma";
import type {
  CourseContent,
  VideoContent,
  LessonDocumentRef,
  NarrativeBlock,
} from "./types";

interface NarrativeOverride {
  title?: string;
  subtitle?: string;
  blocks?: NarrativeBlock[];
}

export async function applyLessonMedia(
  projectId: string,
  slug: string,
  content: CourseContent
): Promise<CourseContent> {
  try {
    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      include: {
        // Learners only ever see published documents.
        documents: {
          where: { published: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (lessons.length === 0) return content;

    const byStage = new Map(lessons.map((l) => [l.stageKey, l]));

    const stages = content.stages.map((stage) => {
      const lesson = byStage.get(stage.key);
      if (!lesson) return stage;

      // Narrative override for this locale (falls back to bundled copy).
      const narrative = (lesson.narrative as Record<string, NarrativeOverride>) ?? null;
      const ov = narrative?.[content.locale];

      const documents: LessonDocumentRef[] = lesson.documents.map((d) => ({
        id: d.id,
        name: d.name,
        url: d.url,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        published: d.published,
      }));

      return {
        ...stage,
        title: ov?.title ?? stage.title,
        subtitle: ov?.subtitle ?? stage.subtitle,
        blocks: ov?.blocks ?? stage.blocks,
        // DB-attached video overrides any bundled demo video for this stage.
        video: (lesson.video as VideoContent | null) ?? stage.video,
        documents: documents.length ? documents : stage.documents,
      };
    });

    return { ...content, stages };
  } catch {
    return content;
  }
}
