"use server";

/**
 * Lesson authoring — attach an interactive video and/or upload documents to a
 * (course, stage) lesson. RBAC-gated: only the project's editors (ADMIN,
 * CONTENT_EDITOR, PARTNER_ADMIN: canEditContent) may write. Read at render time by the lesson overlay (see
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
import {
  hostProblemMessage,
  mediaHostProblem,
  serverAppOrigin,
  storableVideo,
} from "@/lib/media-url";
import { ChangedElsewhere, fingerprint } from "@/lib/cms/stored-json";
import { queueFileDeletion, videoFileUrls } from "@/lib/blob-files";
import {
  cleanNarrativeLine,
  sanitizeNarrativeBlocks,
  type NarrativeText,
} from "@/lib/rich-text/narrative";
import { storedLanguages } from "@/lib/cms/lesson-links";
import { DOCUMENT_UPLOAD, typeOfAddress } from "@/lib/uploads";
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

/**
 * Publish or withdraw a document (whether learners see it). Editors only
 * (D76, spec 3.4 SP33): a document is part of the course every partner's
 * learners take, so a facilitator of one organisation can't withdraw it
 * for all the others. Each change is audited.
 */
export async function setLessonDocumentPublished(
  documentId: string,
  published: boolean
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  if (typeof documentId !== "string" || typeof published !== "boolean") {
    return { ok: false as const, error: "bad-input" };
  }
  const { count } = await prisma.lessonDocument.updateMany({
    where: { id: documentId },
    data: { published },
  });
  if (count > 0) {
    await auditDocument(editor.id, published ? "document.published" : "document.unpublished", documentId);
  }
  return { ok: true as const };
}

/** A document added, removed, published or withdrawn (spec 10.4): who, and which one. */
async function auditDocument(
  actorId: string,
  action: "document.added" | "document.removed" | "document.published" | "document.unpublished",
  documentId: string,
  metadata: Prisma.InputJsonValue = {},
  client: Pick<Prisma.TransactionClient, "auditLog"> = prisma
) {
  await client.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "LessonDocument",
      entityId: documentId,
      metadata,
    },
  });
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
  // Worked out here, never taken from the browser (D91): a YouTube link is
  // stored as YouTube, anything else must be our own file (source, poster,
  // captions) — never an upload still in the author's browser (blob:) or a
  // file on another host. Only the fields the player reads are stored.
  const checked = storableVideo(video, serverAppOrigin());
  if (!checked.ok) {
    return { ok: false as const, error: checked.error, message: checked.message };
  }
  const stored = checked.video as unknown as Prisma.InputJsonValue;
  // The files of the video this one replaces go to the queue in the same
  // transaction (D92); one the new video still uses stays off it.
  await prisma.$transaction(async (tx) => {
    await lockLesson(tx, courseSlug, stageKey);
    const before = await tx.lesson.findUnique({
      where: lessonKey(courseSlug, stageKey),
      select: { video: true },
    });
    await tx.lesson.upsert({
      where: lessonKey(courseSlug, stageKey),
      create: { projectId: PROJECT, courseSlug, stageKey, video: stored },
      update: { video: stored },
    });
    const kept = new Set(videoFileUrls(checked.video));
    await queueFileDeletion(
      tx,
      videoFileUrls(before?.video).filter((url) => !kept.has(url)),
      "video.replaced"
    );
  });
  return { ok: true as const };
}

export async function clearLessonVideo(courseSlug: string, stageKey: string) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  const bad = await mediaTargetError(courseSlug, stageKey);
  if (bad) return { ok: false as const, error: bad };
  // Its files go to the queue in the same transaction (D92): deleted by
  // the admin run a week later, unless a lesson uses them again by then.
  await prisma.$transaction(async (tx) => {
    await lockLesson(tx, courseSlug, stageKey);
    const before = await tx.lesson.findUnique({
      where: lessonKey(courseSlug, stageKey),
      select: { video: true },
    });
    await tx.lesson.updateMany({
      where: { projectId: PROJECT, courseSlug, stageKey },
      data: { video: Prisma.DbNull },
    });
    await queueFileDeletion(tx, videoFileUrls(before?.video), "video.cleared");
  });
  return { ok: true as const };
}

/**
 * A document as the editor's upload makes it (D119): a name, a type that is
 * the one its address's file name implies — the upload route stores a file
 * only as that type, so the type kept is the type the file is served as and
 * the lesson shows it as what it is — and a whole number of bytes within
 * the upload limit.
 */
function documentFits(doc: { name: unknown; url: string; mimeType: unknown; sizeBytes: unknown }): boolean {
  return (
    typeof doc.name === "string" &&
    doc.name.trim() !== "" &&
    typeof doc.mimeType === "string" &&
    doc.mimeType === typeOfAddress(doc.url.trim(), DOCUMENT_UPLOAD) &&
    typeof doc.sizeBytes === "number" &&
    Number.isInteger(doc.sizeBytes) &&
    doc.sizeBytes >= 0 &&
    doc.sizeBytes <= DOCUMENT_UPLOAD.maxBytes
  );
}

export async function addLessonDocument(
  courseSlug: string,
  stageKey: string,
  doc: { name: string; url: string; mimeType: string; sizeBytes: number }
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  const bad = await mediaTargetError(courseSlug, stageKey);
  if (bad) return { ok: false as const, error: bad };
  // Our own files only (D91): an upload, or a bundled sample.
  const host = mediaHostProblem(doc?.url, serverAppOrigin());
  if (host) return { ok: false as const, error: host, message: hostProblemMessage(host, "document") };
  if (!documentFits(doc)) return { ok: false as const, error: "bad-input" as const };
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
      url: doc.url.trim(),
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      order: (last?.order ?? -1) + 1,
    },
  });
  await auditDocument(editor.id, "document.added", created.id, { courseSlug, stageKey });
  return { ok: true as const, id: created.id };
}

/**
 * Take a document off its lesson. Its file goes to the queue in the same
 * transaction (D92): the admin run deletes it a week later, unless a lesson
 * uses it again by then. Audited.
 */
export async function removeLessonDocument(documentId: string) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  if (typeof documentId !== "string") return { ok: false as const, error: "bad-input" };
  await prisma.$transaction(async (tx) => {
    const doc = await tx.lessonDocument.findUnique({
      where: { id: documentId },
      select: { url: true },
    });
    if (!doc) return;
    const { count } = await tx.lessonDocument.deleteMany({ where: { id: documentId } });
    if (!count) return;
    await queueFileDeletion(tx, [doc.url], "document.removed");
    await auditDocument(editor.id, "document.removed", documentId, {}, tx);
  });
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
 * What a lesson's text is, for how a save names it (Release 4, R2): a
 * reflection lesson's text is its introduction (its editor's "Introduction",
 * RichTextEditor's "reflection-intro" variant), so a refusal names it as
 * "The introduction" with the advice to shorten it; any other lesson's text
 * is blocks, each named by its number and kind. The reflection lesson is the
 * standard one: a lesson of a course's own is never a reflection lesson
 * (mainKindOf), its reflection questions being added content.
 */
const narrativeTextOf = (stageKey: string): NarrativeText =>
  stageKey === "reflection" ? "reflection-intro" : "blocks";

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
  const clean = sanitizeNarrativeBlocks(payload.blocks, narrativeTextOf(stageKey));
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

/**
 * Current author-attached media for a lesson (for the editor to preload):
 * its video, and every document, drafts included, each with the languages
 * it is for (Release 4, D108: [] = every language).
 */
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
      languages: storedLanguages(d.languages),
    })),
  };
}
