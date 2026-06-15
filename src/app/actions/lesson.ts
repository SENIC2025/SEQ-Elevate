"use server";

/**
 * Lesson authoring — attach an interactive video and/or upload documents to a
 * (course, stage) lesson. RBAC-gated: only ADMIN / CONTENT_EDITOR of the
 * project may write. Read at render time by the lesson overlay (see
 * src/lib/cms/lesson-overlay.ts). The course player is dynamic, so changes
 * show on the next load — no revalidation needed.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import type { VideoContent, LessonDocumentRef } from "@/lib/cms/types";

const PROJECT = "seq-elevate";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ok =
    (await hasRole(PROJECT, "ADMIN")) ||
    (await hasRole(PROJECT, "CONTENT_EDITOR"));
  return ok ? user : null;
}

// Publishing is a lighter "release" control teachers run for their cohort, so
// facilitators may toggle it too (not just content authors).
async function requirePublisher() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ok =
    (await hasRole(PROJECT, "ADMIN")) ||
    (await hasRole(PROJECT, "CONTENT_EDITOR")) ||
    (await hasRole(PROJECT, "FACILITATOR"));
  return ok ? user : null;
}

/** Publish or unpublish a document (controls learner visibility). */
export async function setLessonDocumentPublished(
  documentId: string,
  published: boolean
) {
  const publisher = await requirePublisher();
  if (!publisher) return { ok: false as const, error: "forbidden" };
  await prisma.lessonDocument.updateMany({
    where: { id: documentId },
    data: { published },
  });
  return { ok: true as const };
}

function lessonKey(courseSlug: string, stageKey: string) {
  return {
    projectId_courseSlug_stageKey: {
      projectId: PROJECT,
      courseSlug,
      stageKey,
    },
  };
}

export async function saveLessonVideo(
  courseSlug: string,
  stageKey: string,
  video: VideoContent
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  await prisma.lesson.upsert({
    where: lessonKey(courseSlug, stageKey),
    create: {
      projectId: PROJECT,
      courseSlug,
      stageKey,
      video: video as unknown as Prisma.InputJsonValue,
    },
    update: { video: video as unknown as Prisma.InputJsonValue },
  });
  return { ok: true as const };
}

export async function clearLessonVideo(courseSlug: string, stageKey: string) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  await prisma.lesson.updateMany({
    where: { projectId: PROJECT, courseSlug, stageKey },
    data: { video: Prisma.DbNull },
  });
  return { ok: true as const };
}

export async function addLessonDocument(
  courseSlug: string,
  stageKey: string,
  doc: { name: string; url: string; mimeType: string; sizeBytes: number }
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const lesson = await prisma.lesson.upsert({
    where: lessonKey(courseSlug, stageKey),
    create: { projectId: PROJECT, courseSlug, stageKey },
    update: {},
  });
  // New documents append to the end of the lesson's sequence.
  const last = await prisma.lessonDocument.findFirst({
    where: { lessonId: lesson.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const created = await prisma.lessonDocument.create({
    data: {
      lessonId: lesson.id,
      name: doc.name.slice(0, 200),
      url: doc.url,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      order: (last?.order ?? -1) + 1,
    },
  });
  return { ok: true as const, id: created.id };
}

export async function removeLessonDocument(documentId: string) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  await prisma.lessonDocument.deleteMany({ where: { id: documentId } });
  return { ok: true as const };
}

/** Persist a new document order (ids in the desired sequence). */
export async function setLessonDocumentOrder(orderedIds: string[]) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.lessonDocument.updateMany({
        where: { id },
        data: { order: index },
      })
    )
  );
  return { ok: true as const };
}

/** Current author-attached media for a lesson (for the editor to preload). */
export async function getLessonMedia(
  courseSlug: string,
  stageKey: string
): Promise<{ video: VideoContent | null; documents: LessonDocumentRef[] }> {
  const editor = await requireEditor();
  if (!editor) return { video: null, documents: [] };
  const lesson = await prisma.lesson.findUnique({
    where: lessonKey(courseSlug, stageKey),
    include: {
      documents: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!lesson) return { video: null, documents: [] };
  return {
    video: (lesson.video as VideoContent | null) ?? null,
    documents: lesson.documents.map((d) => ({
      id: d.id,
      name: d.name,
      url: d.url,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      published: d.published,
    })),
  };
}
