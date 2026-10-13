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
import { isContentLocale } from "@/lib/cms/course-admin-types";
import { isCustomSectionId, isSectionId } from "@/lib/cms/sections/contract";
import {
  Refusal,
  SLUG,
  lockCourse,
  ownSectionKind,
} from "@/lib/cms/sections/store.server";
import { unstorableVideoMessage } from "@/lib/media-url";
import { ChangedElsewhere, fingerprint } from "@/lib/cms/stored-json";
import {
  cleanNarrativeLine,
  sanitizeNarrativeBlocks,
} from "@/lib/rich-text/narrative";
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

/**
 * Which lesson a video or document action targets, checked before anything
 * is written (Release 1): a course slug and a lesson id of the right form,
 * and a lesson of a created course's own only while it is in the course's
 * lesson list. These actions upsert the row, so without the check any key
 * a request named became a stray Lesson row. A standard lesson is accepted
 * as before (built-in courses included).
 */
async function mediaTargetError(
  courseSlug: unknown,
  stageKey: unknown
): Promise<"bad-input" | "not-a-section" | "outline-unreadable" | null> {
  if (typeof courseSlug !== "string" || !SLUG.test(courseSlug) || !isSectionId(stageKey)) {
    return "bad-input";
  }
  if (!isCustomSectionId(stageKey)) return null;
  const own = await ownSectionKind(prisma, courseSlug, stageKey);
  return own.ok ? null : own.error;
}

export async function saveLessonVideo(
  courseSlug: string,
  stageKey: string,
  video: VideoContent
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  const bad = await mediaTargetError(courseSlug, stageKey);
  if (bad) return { ok: false as const, error: bad };
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
  const bad = await mediaTargetError(courseSlug, stageKey);
  if (bad) return { ok: false as const, error: bad };
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
  const bad = await mediaTargetError(courseSlug, stageKey);
  if (bad) return { ok: false as const, error: bad };
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
 * (The blocks themselves are rebuilt by sanitizeNarrativeBlocks, D36.)
 */
function narrativeTargetError(
  courseSlug: unknown,
  stageKey: unknown,
  locale: unknown
): "bad-input" | "bad-stage" | "bad-locale" | null {
  if (typeof courseSlug !== "string" || !courseSlug || courseSlug.length > 80) {
    return "bad-input";
  }
  // A standard lesson, or one of a created course's own (G6, checked under
  // the Course lock by ownTextLesson).
  if (!isSectionId(stageKey)) return "bad-stage";
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
 * G6: a lesson of a created course's own takes text only while it is in the
 * course's lesson list and its main content is text (mainKindOf). Checked
 * under the Course row's FOR SHARE, taken before the Lesson row, so a
 * lesson deleted meanwhile is refused; throws a Refusal, which rolls back.
 * A standard lesson's save never asks for the Course lock, as before.
 */
async function ownTextLesson(
  tx: Prisma.TransactionClient,
  courseSlug: string,
  stageKey: string
) {
  if (!isCustomSectionId(stageKey)) return;
  await lockCourse(tx, courseSlug, "share");
  const own = await ownSectionKind(tx, courseSlug, stageKey);
  if (!own.ok) throw new Refusal(own);
  if (own.kind !== "narrative" && own.kind !== "reflection") {
    throw new Refusal({ ok: false, error: "kind-mismatch" });
  }
}

/** A refusal of G6 as the narrative actions return it. */
const g6Error = (error: Refusal) =>
  ({ ok: false, error: error.result.error }) as {
    ok: false;
    error: "not-a-section" | "outline-unreadable" | "kind-mismatch";
  };

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
 * otherwise silently undo theirs. Refused with "invalid" and `issues` (one
 * sentence per problem, naming the block) when a block is over a limit or
 * its formatting can't be read; nothing is written then. Returns the new
 * text's fingerprint, the `base` for the next save.
 *
 * Blocks are stored as sanitizeNarrativeBlocks rebuilds them: rich text
 * cleaned to the whitelist, with its plain `text` derived here.
 */
export async function saveLessonNarrative(
  courseSlug: string,
  stageKey: string,
  locale: Locale,
  payload: NarrativePayload,
  base: string | null
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  const bad = narrativeTargetError(courseSlug, stageKey, locale);
  if (bad) return { ok: false as const, error: bad };
  if (
    typeof payload?.title !== "string" ||
    (payload.subtitle !== undefined && typeof payload.subtitle !== "string") ||
    !Array.isArray(payload.blocks) ||
    !isBase(base)
  ) {
    return { ok: false as const, error: "bad-input" as const };
  }
  const clean = sanitizeNarrativeBlocks(payload.blocks);
  if (!clean.ok) {
    return {
      ok: false as const,
      error: "invalid" as const,
      issues: clean.issues,
    };
  }

  const entry = {
    title: cleanNarrativeLine(payload.title, 200),
    subtitle: cleanNarrativeLine(payload.subtitle, 200) || undefined,
    blocks: clean.blocks,
  };
  try {
    await prisma.$transaction(async (tx) => {
      await ownTextLesson(tx, courseSlug, stageKey);
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
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    if (error instanceof Refusal) return g6Error(error);
    throw error;
  }
  await auditNarrative(
    editor.id,
    "narrative.saved",
    courseSlug,
    stageKey,
    locale
  );
  return { ok: true as const, version: fingerprint(entry) };
}

/** Lesson text goes live on save (D33), so it's audited like a structure save. */
async function auditNarrative(
  actorId: string,
  action: "narrative.saved" | "narrative.cleared",
  courseSlug: string,
  stageKey: string,
  locale: Locale
) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "Lesson",
      entityId: `${courseSlug}:${stageKey}`,
      metadata: { locale },
    },
  });
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
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  const bad = narrativeTargetError(courseSlug, stageKey, locale);
  if (bad) return { ok: false as const, error: bad };
  if (!isBase(base)) return { ok: false as const, error: "bad-input" as const };

  let removed: boolean;
  try {
    removed = await prisma.$transaction(async (tx) => {
      await ownTextLesson(tx, courseSlug, stageKey);
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
      if (current === null) return false;
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
      return true;
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    if (error instanceof Refusal) return g6Error(error);
    throw error;
  }
  if (removed) {
    await auditNarrative(
      editor.id,
      "narrative.cleared",
      courseSlug,
      stageKey,
      locale
    );
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
  if (await mediaTargetError(courseSlug, stageKey)) return { video: null, documents: [] };
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
