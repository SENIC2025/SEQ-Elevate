"use server";

/**
 * Lesson authoring — attach an interactive video and/or upload documents to a
 * (course, stage) lesson. RBAC-gated: only ADMIN / CONTENT_EDITOR of the
 * project may write. Read at render time by the lesson overlay (see
 * src/lib/cms/lesson-overlay.ts). The course player is dynamic, so changes
 * show on the next load — no revalidation needed.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isContentLocale, isStageKey } from "@/lib/cms/course-admin-types";
import { unstorableVideoMessage } from "@/lib/media-url";
import { ChangedElsewhere, fingerprint } from "@/lib/cms/stored-json";
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
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

// Publishing is a lighter "release" control teachers run for their cohort, so
// facilitators may toggle it too (not just content authors).
async function requirePublisher() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) || roles.includes("FACILITATOR") ? user : null;
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
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  // Only web links load for learners — never an upload still in the author's
  // browser (blob:), which would save a broken video or captions.
  const unstorable = unstorableVideoMessage(video);
  if (unstorable) {
    return {
      ok: false as const,
      error: "unstorable-media" as const,
      message: unstorable,
    };
  }
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
 * Which lesson and language a narrative write targets — checked before any
 * write, since a server action's arguments come straight from the client.
 * (The blocks themselves are validated with the rich-text format, Round 3.)
 */
function narrativeTargetError(
  courseSlug: unknown,
  stageKey: unknown,
  locale: unknown
): "bad-input" | "bad-stage" | "bad-locale" | null {
  if (typeof courseSlug !== "string" || !courseSlug || courseSlug.length > 80) {
    return "bad-input";
  }
  if (!isStageKey(stageKey)) return "bad-stage";
  if (!isContentLocale(locale)) return "bad-locale";
  return null;
}

/**
 * Lock one lesson row until the surrounding transaction commits. The
 * narrative is a single JSON column holding every language, so without the
 * lock an English and a German save of the same lesson (two tabs, two
 * editors) would each write back what they read and one would be lost.
 */
async function lockLesson(
  tx: Prisma.TransactionClient,
  courseSlug: string,
  stageKey: string
) {
  await tx.$queryRaw`SELECT id FROM "Lesson" WHERE "projectId" = ${PROJECT} AND "courseSlug" = ${courseSlug} AND "stageKey" = ${stageKey} FOR UPDATE`;
}

/**
 * `base` is the fingerprint of this language's stored text when the editor
 * opened it (null = none stored; see stored-json.ts), as the course outline
 * or the last save handed it over.
 */
const isBase = (base: unknown): base is string | null =>
  base === null || (typeof base === "string" && base.length <= 32);

/**
 * Save a per-locale narrative override for a lesson. Refused with
 * "changed-elsewhere" when someone else saved this language's text since the
 * editor opened it (`base` no longer matches) — the later save would
 * otherwise silently undo theirs. Returns the new text's fingerprint, the
 * `base` for the next save.
 */
export async function saveLessonNarrative(
  courseSlug: string,
  stageKey: string,
  locale: Locale,
  payload: NarrativePayload,
  base: string | null
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const bad = narrativeTargetError(courseSlug, stageKey, locale);
  if (bad) return { ok: false as const, error: bad };
  if (
    typeof payload?.title !== "string" ||
    (payload.subtitle !== undefined && typeof payload.subtitle !== "string") ||
    !Array.isArray(payload.blocks) ||
    !isBase(base)
  ) {
    return { ok: false as const, error: "bad-input" };
  }

  const entry = {
    title: payload.title.slice(0, 200),
    subtitle: payload.subtitle?.slice(0, 200) || undefined,
    blocks: payload.blocks,
  };
  try {
    await prisma.$transaction(async (tx) => {
      // Make sure the row exists, so there is something to lock.
      await tx.lesson.upsert({
        where: lessonKey(courseSlug, stageKey),
        create: { projectId: PROJECT, courseSlug, stageKey },
        update: {},
      });
      await lockLesson(tx, courseSlug, stageKey);
      const existing = await tx.lesson.findUnique({
        where: lessonKey(courseSlug, stageKey),
        select: { narrative: true },
      });
      const stored = (existing?.narrative as Record<string, unknown>) ?? {};
      if (fingerprint(stored[locale]) !== base) throw new ChangedElsewhere();
      await tx.lesson.update({
        where: lessonKey(courseSlug, stageKey),
        data: {
          narrative: { ...stored, [locale]: entry } as Prisma.InputJsonValue,
        },
      });
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" };
    }
    throw error;
  }
  return { ok: true as const, version: fingerprint(entry) };
}

/**
 * Remove a lesson's narrative override for a locale (revert to bundled copy).
 * Like a save, refused when the text changed since the editor opened it:
 * removing it would throw away a colleague's newer text unseen.
 */
export async function clearLessonNarrative(
  courseSlug: string,
  stageKey: string,
  locale: Locale,
  base: string | null
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const bad = narrativeTargetError(courseSlug, stageKey, locale);
  if (bad) return { ok: false as const, error: bad };
  if (!isBase(base)) return { ok: false as const, error: "bad-input" };

  try {
    await prisma.$transaction(async (tx) => {
      // No row means nothing to clear — don't create one just to empty it.
      await lockLesson(tx, courseSlug, stageKey);
      const existing = await tx.lesson.findUnique({
        where: lessonKey(courseSlug, stageKey),
        select: { narrative: true },
      });
      const narrative = {
        ...((existing?.narrative as Record<string, unknown>) ?? {}),
      };
      const current = fingerprint(narrative[locale]);
      // Already gone (someone else removed it): that's what was asked for.
      if (current === null) return;
      if (current !== base) throw new ChangedElsewhere();
      delete narrative[locale];
      await tx.lesson.update({
        where: lessonKey(courseSlug, stageKey),
        data: {
          narrative:
            Object.keys(narrative).length === 0
              ? Prisma.DbNull
              : (narrative as Prisma.InputJsonValue),
        },
      });
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" };
    }
    throw error;
  }
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
