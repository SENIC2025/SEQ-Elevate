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
import { getCourse } from "@/lib/cms";
import type {
  VideoContent,
  LessonDocumentRef,
  NarrativeBlock,
  Locale,
} from "@/lib/cms/types";

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

interface NarrativePayload {
  title: string;
  subtitle?: string;
  blocks: NarrativeBlock[];
}

/**
 * The current effective narrative for a lesson + locale (bundled copy, with
 * any override already applied), for the editor to load and edit from.
 */
export async function getLessonContent(
  courseSlug: string,
  stageKey: string,
  locale: Locale
): Promise<{
  title: string;
  subtitle: string;
  blocks: NarrativeBlock[];
  isNarrative: boolean;
  hasOverride: boolean;
} | null> {
  const editor = await requireEditor();
  if (!editor) return null;
  const content = await getCourse(PROJECT, courseSlug, locale);
  const stage = content?.stages.find((s) => s.key === stageKey);
  const lesson = await prisma.lesson.findUnique({
    where: lessonKey(courseSlug, stageKey),
    select: { narrative: true },
  });
  const narrative = (lesson?.narrative as Record<string, unknown> | null) ?? {};
  return {
    title: stage?.title ?? "",
    subtitle: stage?.subtitle ?? "",
    blocks: stage?.blocks ?? [],
    isNarrative: !!stage?.blocks,
    hasOverride: !!narrative[locale],
  };
}

/** Save a per-locale narrative override for a lesson. */
export async function saveLessonNarrative(
  courseSlug: string,
  stageKey: string,
  locale: Locale,
  payload: NarrativePayload
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const existing = await prisma.lesson.findUnique({
    where: lessonKey(courseSlug, stageKey),
    select: { narrative: true },
  });
  const narrative = {
    ...((existing?.narrative as Record<string, unknown>) ?? {}),
    [locale]: {
      title: payload.title,
      subtitle: payload.subtitle || undefined,
      blocks: payload.blocks,
    },
  };
  await prisma.lesson.upsert({
    where: lessonKey(courseSlug, stageKey),
    create: {
      projectId: PROJECT,
      courseSlug,
      stageKey,
      narrative: narrative as Prisma.InputJsonValue,
    },
    update: { narrative: narrative as Prisma.InputJsonValue },
  });
  return { ok: true as const };
}

/** Remove a lesson's narrative override for a locale (revert to bundled copy). */
export async function clearLessonNarrative(
  courseSlug: string,
  stageKey: string,
  locale: Locale
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const existing = await prisma.lesson.findUnique({
    where: lessonKey(courseSlug, stageKey),
    select: { narrative: true },
  });
  const narrative = {
    ...((existing?.narrative as Record<string, unknown>) ?? {}),
  };
  delete narrative[locale];
  await prisma.lesson.updateMany({
    where: { projectId: PROJECT, courseSlug, stageKey },
    data: {
      narrative:
        Object.keys(narrative).length === 0
          ? Prisma.DbNull
          : (narrative as Prisma.InputJsonValue),
    },
  });
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
