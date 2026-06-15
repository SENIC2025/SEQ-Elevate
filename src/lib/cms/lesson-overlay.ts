import "server-only";

/**
 * Overlays authored lesson media (DB) onto provider-built CourseContent.
 * The narrative copy comes from the content provider (local/Strapi); this
 * merges in the video + documents an author attached to each (course, stage)
 * via the in-app CMS. Defensive: any DB error (e.g. table not yet migrated)
 * falls back to the unmodified content, so the lesson always renders.
 */

import { prisma } from "@/lib/prisma";
import type { CourseContent, VideoContent, LessonDocumentRef } from "./types";

export async function applyLessonMedia(
  projectId: string,
  slug: string,
  content: CourseContent
): Promise<CourseContent> {
  try {
    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      include: { documents: { orderBy: { createdAt: "asc" } } },
    });
    if (lessons.length === 0) return content;

    const byStage = new Map(lessons.map((l) => [l.stageKey, l]));

    const stages = content.stages.map((stage) => {
      const lesson = byStage.get(stage.key);
      if (!lesson) return stage;
      const documents: LessonDocumentRef[] = lesson.documents.map((d) => ({
        id: d.id,
        name: d.name,
        url: d.url,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
      }));
      return {
        ...stage,
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
