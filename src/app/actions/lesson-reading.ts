"use server";

/**
 * Release 4, Part B (D107, D108, D110; spec 4.3): a lesson's further-reading
 * links ("Add a link" next to "Upload document"), and the languages a
 * document is for.
 *
 * A further-reading link is its own record (LessonLink), never content: it
 * never makes a lesson appear and never counts for progress or completion.
 * A new link is hidden from learners until an editor chooses "Show to
 * learners" (Q15), like a document.
 *
 * Every write checks, in this order, before anything is written:
 *   1. the caller edits content (canEditContent: editors, partner admins,
 *      admins); content is project-wide, so no organisation scope;
 *   2. the arguments' types, then their values, refused, never cut: a
 *      title of 1–200 characters and a description of at most 300 once
 *      cleaned; an address checkLinkHref accepts (https, http or mailto, at
 *      most 2,048 characters, no Outlook safe link) that isn't on our own
 *      file store; a title that shows something and doesn't show another
 *      address than the link opens, however it is written (titleMisleads);
 *      languages from en, de and el (all three, or none, = every language);
 *   3. the target is of project seq-elevate: a lesson of a course there by
 *      the rules of the media actions (a lesson of the course's own only
 *      while it is in the course's list), or a link or document of such a
 *      lesson, by the same rules; else "not-found" (or "not-a-section", as
 *      for a lesson named by the page);
 *   4. the locks, only through store.server.ts (no raw SQL here): the Course
 *      row FOR SHARE, then the Lesson row FOR UPDATE, with the target read
 *      again under them;
 * and is audited after it commits, with the content's ids and what
 * changed, never a title, an address or a description (an email address
 * may name a person).
 *
 * Server actions since R2 (spec 10.5): the lesson's document card calls
 * them, and each export has its row in Release 3's action table
 * (e2e/fixtures/r3-action-table/r4.ts), so every action a request can reach
 * is tried as each person who must be refused. Its exports are async
 * functions only, as a "use server" module's must be.
 */

import type { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isCustomSectionId, isSectionId } from "@/lib/cms/sections/contract";
import {
  PROJECT,
  SLUG,
  lockCourse,
  lockLessonRow,
  lockLessonRowIfAny,
  ownSectionKind,
} from "@/lib/cms/sections/store.server";
import { normaliseLanguages } from "@/lib/cms/item-language";
import {
  LINK_LIMITS,
  cleanLinkLine,
  staffLink,
  titleMisleads,
  titleShowsNothing,
  type StaffLessonLink,
} from "@/lib/cms/lesson-links";
import type { Locale } from "@/lib/cms/types";
import { checkLinkHref, type LinkRefusal } from "@/lib/rich-text/link-url";
import { ownFileHost } from "@/lib/rich-text/own-file-host";

type Field = "title" | "url" | "description";
type Reason = LinkRefusal | "own-file" | "misleading" | "too-long" | "empty";

type Failure =
  | {
      ok: false;
      error: "forbidden" | "bad-input" | "not-found" | "not-a-section" | "outline-unreadable" | "too-many";
    }
  | { ok: false; error: "invalid"; field: Field; reason: Reason };

const refuse = (error: Exclude<Failure, { error: "invalid" }>["error"]) => ({ ok: false as const, error });
const invalid = (field: Field, reason: Reason) => ({ ok: false as const, error: "invalid" as const, field, reason });

/** Thrown inside a transaction to refuse with `result`; throwing rolls it back. */
class ReadingRefusal extends Error {
  constructor(readonly result: Failure) {
    super(result.error);
    this.name = "ReadingRefusal";
  }
}

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A row id as the page sends it back. */
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;

/** A course slug and a lesson id of the right form (as the media actions check them). */
const isLessonTarget = (courseSlug: unknown, stageKey: unknown): courseSlug is string =>
  typeof courseSlug === "string" && SLUG.test(courseSlug) && isSectionId(stageKey);

interface LinkFields {
  title: string;
  url: string;
  description: string;
  languages: Locale[];
}

/**
 * A link's fields as an editor sent them, checked (step 2 above). For an
 * update every field is required; a new link may leave out its description
 * (none) and its languages (every language).
 */
function readLinkFields(input: unknown, every: boolean): { ok: true; value: LinkFields } | Failure {
  if (!isRecord(input)) return refuse("bad-input");
  const { title, url, description, languages } = input;
  if (typeof title !== "string" || typeof url !== "string") return refuse("bad-input");
  if (description !== undefined ? typeof description !== "string" : every) return refuse("bad-input");
  if (languages === undefined && every) return refuse("bad-input");
  const langs = normaliseLanguages(languages ?? []);
  if (!langs) return refuse("bad-input");

  // Cleaned as the form cleans it (cleanLinkLine), so both measure alike.
  const cleanTitle = cleanLinkLine(title, LINK_LIMITS.title);
  if (cleanTitle === null) return invalid("title", "too-long");
  if (titleShowsNothing(cleanTitle)) return invalid("title", "empty");
  const check = checkLinkHref(url, { ownFileHost: ownFileHost() });
  if (!check.ok) return invalid("url", check.reason);
  if (check.ownFile) return invalid("url", "own-file");
  // The title is shown as the link: it may not show another address, however it is written (D104).
  if (titleMisleads(cleanTitle, check.href)) return invalid("title", "misleading");
  const cleanDescription = cleanLinkLine(typeof description === "string" ? description : "", LINK_LIMITS.description);
  if (cleanDescription === null) return invalid("description", "too-long");

  return { ok: true, value: { title: cleanTitle, url: check.href, description: cleanDescription, languages: langs } };
}

const lessonKey = (courseSlug: string, stageKey: string) => ({
  projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug, stageKey },
});

/**
 * Step 3 and 4 for a lesson named by the page: the course (of this project)
 * locked FOR SHARE, the lesson checked under it (a lesson of the course's
 * own only while it is in the course's list), then the lesson's row locked
 * FOR UPDATE — made first when `make` (adding a link to a lesson that has no
 * row yet). Throws a ReadingRefusal.
 */
async function lockLesson(tx: Prisma.TransactionClient, courseSlug: string, stageKey: string, make: boolean) {
  const course = await lockCourse(tx, courseSlug, "share");
  if (!course) throw new ReadingRefusal(refuse("not-found"));
  if (isCustomSectionId(stageKey)) {
    const own = await ownSectionKind(tx, courseSlug, stageKey);
    if (!own.ok) throw new ReadingRefusal(refuse(own.error));
  }
  if (make) await lockLessonRow(tx, courseSlug, stageKey);
  else await lockLessonRowIfAny(tx, courseSlug, stageKey);
}

/**
 * Step 3 and 4 for a link named by its id: found only in a lesson of this
 * project, its lesson checked and locked as a lesson the page names is
 * (lockLesson: the course must have its row, and a lesson of the course's
 * own must be in its list), and read again under the locks, since a delete
 * may have come first. Throws a ReadingRefusal.
 */
async function lockLink(tx: Prisma.TransactionClient, linkId: string) {
  const where = { id: linkId, lesson: { projectId: PROJECT } };
  const found = await tx.lessonLink.findFirst({
    where,
    select: { lesson: { select: { courseSlug: true, stageKey: true } } },
  });
  if (!found) throw new ReadingRefusal(refuse("not-found"));
  const { courseSlug, stageKey } = found.lesson;
  await lockLesson(tx, courseSlug, stageKey, false);
  const link = await tx.lessonLink.findFirst({ where, select: { url: true } });
  if (!link) throw new ReadingRefusal(refuse("not-found"));
  return { courseSlug, stageKey, url: link.url };
}

/** Runs a write's transaction, turning a ReadingRefusal into its result. */
async function settle<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | Failure> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof ReadingRefusal) return error.result;
    throw error;
  }
}

/** Audited after the write commits: ids and what changed, never a title, address or description. */
async function audit(
  actorId: string,
  action: string,
  entity: "LessonLink" | "LessonDocument" | "Lesson",
  entityId: string,
  metadata: Prisma.InputJsonValue
) {
  await prisma.auditLog.create({
    data: { projectId: PROJECT, actorId, action, entity, entityId, metadata },
  });
}

/**
 * Adds a further-reading link to a lesson, hidden from learners (Q15), after
 * the lesson's other links. Its address is stored as checkLinkHref
 * normalised it. Refused with "too-many" when the lesson has 30 already.
 */
export async function addLessonLink(
  courseSlug: string,
  stageKey: string,
  input: { title: string; url: string; description?: string; languages?: Locale[] }
) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (!isLessonTarget(courseSlug, stageKey)) return refuse("bad-input");
  const fields = readLinkFields(input, false);
  if (!fields.ok) return fields;
  const link = fields.value;

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      await lockLesson(tx, courseSlug, stageKey, true);
      const lesson = await tx.lesson.findUnique({ where: lessonKey(courseSlug, stageKey), select: { id: true } });
      if (!lesson) throw new ReadingRefusal(refuse("not-found"));
      const { _count, _max } = await tx.lessonLink.aggregate({
        where: { lessonId: lesson.id },
        _count: { _all: true },
        _max: { order: true },
      });
      if (_count._all >= LINK_LIMITS.perLesson) throw new ReadingRefusal(refuse("too-many"));
      const created = await tx.lessonLink.create({
        data: {
          lessonId: lesson.id,
          title: link.title,
          url: link.url,
          description: link.description,
          languages: link.languages,
          order: (_max.order ?? -1) + 1,
          published: false,
        },
        select: { id: true },
      });
      return created.id;
    })
  );
  if (!done.ok) return done;
  await audit(editor.id, "link.added", "LessonLink", done.value, { courseSlug, stageKey, languages: link.languages });
  return { ok: true as const, id: done.value };
}

/** Changes a link's title, address, description and languages; whether learners see it and its place stay. */
export async function updateLessonLink(
  linkId: string,
  input: { title: string; url: string; description: string; languages: Locale[] }
) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (!isId(linkId)) return refuse("bad-input");
  const fields = readLinkFields(input, true);
  if (!fields.ok) return fields;
  const link = fields.value;

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      const at = await lockLink(tx, linkId);
      await tx.lessonLink.update({
        where: { id: linkId },
        data: { title: link.title, url: link.url, description: link.description, languages: link.languages },
        select: { id: true },
      });
      return at;
    })
  );
  if (!done.ok) return done;
  const { courseSlug, stageKey, url } = done.value;
  await audit(editor.id, "link.updated", "LessonLink", linkId, {
    courseSlug,
    stageKey,
    languages: link.languages,
    urlChanged: url !== link.url,
  });
  return { ok: true as const };
}

/** Takes a link off its lesson (it holds no file, so nothing is queued). */
export async function removeLessonLink(linkId: string) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (!isId(linkId)) return refuse("bad-input");

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      const at = await lockLink(tx, linkId);
      await tx.lessonLink.delete({ where: { id: linkId }, select: { id: true } });
      return at;
    })
  );
  if (!done.ok) return done;
  const { courseSlug, stageKey } = done.value;
  await audit(editor.id, "link.removed", "LessonLink", linkId, { courseSlug, stageKey });
  return { ok: true as const };
}

/**
 * Puts a lesson's links in the order given: `orderedIds` must be exactly
 * the lesson's links (at most 30), else "not-found" (a colleague added or
 * removed one: the page reads the list again).
 */
export async function setLessonLinkOrder(courseSlug: string, stageKey: string, orderedIds: string[]) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (!isLessonTarget(courseSlug, stageKey)) return refuse("bad-input");
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length > LINK_LIMITS.perLesson ||
    !orderedIds.every(isId) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return refuse("bad-input");
  }

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      await lockLesson(tx, courseSlug, stageKey, false);
      const lesson = await tx.lesson.findUnique({ where: lessonKey(courseSlug, stageKey), select: { id: true } });
      if (!lesson) throw new ReadingRefusal(refuse("not-found"));
      const links = await tx.lessonLink.findMany({ where: { lessonId: lesson.id }, select: { id: true } });
      const theirs = new Set(links.map((l) => l.id));
      if (theirs.size !== orderedIds.length || !orderedIds.every((id) => theirs.has(id))) {
        throw new ReadingRefusal(refuse("not-found"));
      }
      for (const [order, id] of orderedIds.entries()) {
        await tx.lessonLink.update({ where: { id }, data: { order }, select: { id: true } });
      }
      return lesson.id;
    })
  );
  if (!done.ok) return done;
  await audit(editor.id, "link.reordered", "Lesson", done.value, { courseSlug, stageKey });
  return { ok: true as const };
}

/** "Show to learners" or "Hide from learners" (editors only, as for documents, SP33). */
export async function setLessonLinkPublished(linkId: string, published: boolean) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (!isId(linkId) || typeof published !== "boolean") return refuse("bad-input");

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      const at = await lockLink(tx, linkId);
      await tx.lessonLink.update({ where: { id: linkId }, data: { published }, select: { id: true } });
      return at;
    })
  );
  if (!done.ok) return done;
  const { courseSlug, stageKey } = done.value;
  await audit(editor.id, published ? "link.published" : "link.unpublished", "LessonLink", linkId, {
    courseSlug,
    stageKey,
  });
  return { ok: true as const };
}

/**
 * Every link of a lesson, drafts included, for the editor's list (editors
 * only; anyone else, or a lesson that isn't one, gets none). Each address
 * is checked again: a stored one the check refuses comes back `unusable`,
 * as stored, to be shown as text and fixed.
 */
export async function getLessonLinks(courseSlug: string, stageKey: string): Promise<{ links: StaffLessonLink[] }> {
  const editor = await requireEditor();
  if (!editor || !isLessonTarget(courseSlug, stageKey)) return { links: [] };
  if (isCustomSectionId(stageKey) && !(await ownSectionKind(prisma, courseSlug, stageKey)).ok) {
    return { links: [] };
  }
  const rows = await prisma.lessonLink.findMany({
    where: { lesson: { projectId: PROJECT, courseSlug, stageKey } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, url: true, description: true, languages: true, published: true },
  });
  return { links: rows.map(staffLink) };
}

/**
 * The languages a document is for (D108): any of en, de and el; all three,
 * or none, is every language ([]). Never changes which lessons there are.
 * The document's lesson is checked and locked as a link's is (lockLesson).
 */
export async function setLessonDocumentLanguages(documentId: string, languages: Locale[]) {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  const langs = normaliseLanguages(languages);
  if (!isId(documentId) || !langs) return refuse("bad-input");

  const done = await settle(() =>
    prisma.$transaction(async (tx) => {
      const where = { id: documentId, lesson: { projectId: PROJECT } };
      const found = await tx.lessonDocument.findFirst({
        where,
        select: { lesson: { select: { courseSlug: true, stageKey: true } } },
      });
      if (!found) throw new ReadingRefusal(refuse("not-found"));
      const { courseSlug, stageKey } = found.lesson;
      await lockLesson(tx, courseSlug, stageKey, false);
      const { count } = await tx.lessonDocument.updateMany({ where, data: { languages: langs } });
      if (!count) throw new ReadingRefusal(refuse("not-found"));
      return { courseSlug, stageKey };
    })
  );
  if (!done.ok) return done;
  await audit(editor.id, "document.languages_changed", "LessonDocument", documentId, {
    ...done.value,
    languages: langs,
  });
  return { ok: true as const };
}
