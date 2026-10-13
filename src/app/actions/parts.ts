"use server";

/**
 * Release 1: a lesson's extra content around its main content (D56, spec
 * 8.2) — add, move and remove content (a change to the lesson: Course row
 * FOR UPDATE, G3, the whole outline back), and save text and question
 * content with Release 0's draft model per piece of content (D52: Course
 * row FOR SHARE, then the lesson's row). The main content keeps today's
 * editors and actions (lesson.ts, structure.ts); every action here sends
 * the editor there for it (use-main-editor), and removing it is refused
 * (main-required).
 *
 * The steps are those of sections.ts (spec 8): editors only; arguments
 * checked; the course locked and readable (G8), the lesson in its list; the
 * lesson's row made, locked and read; the base compared — fingerprints
 * (versions.ts), never whole JSON; the content rebuilt by the same checks
 * "Save stage" makes (part-kinds.ts), with what is stored already allowed to
 * stay over a limit; G3 for changes to the lesson; then the write
 * (storedPartsValue: the main content alone is SQL NULL again); audited
 * after the commit.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCourseOutline } from "@/lib/cms/course-admin";
import { isContentLocale } from "@/lib/cms/course-admin-types";
import { ChangedElsewhere } from "@/lib/cms/stored-json";
import { sanitizeNarrativeBlocks } from "@/lib/rich-text/narrative";
import {
  KIND_OF_PART,
  MAIN_PART_ID,
  SECTION_LIMITS,
  isExtraPartId,
  isPartId,
  isSectionId,
  type ExerciseDiscardResult,
  type ExerciseDraftResult,
  type ExerciseSaveResult,
  type ExerciseState,
  type ExerciseValue,
  type ExtraPartId,
  type OutlineResult,
  type PartBase,
  type PartId,
  type PartIssue,
  type PartOp,
  type PartOpError,
  type PartType,
  type QuestionPartType,
  type Refused,
  type SectionFacts,
  type SectionId,
  type SectionsError,
  type StoredPart,
  type VersionResult,
} from "@/lib/cms/sections/contract";
import { PART_DEFAULTS } from "@/lib/cms/sections/defaults";
import { newOnlyReasons } from "@/lib/cms/sections/guard";
import { sanitizeExercise, validateExercise } from "@/lib/cms/sections/part-kinds";
import {
  applyPartOp,
  emptyPart,
  partsOf,
  storedPartsValue,
} from "@/lib/cms/sections/section-parts";
import {
  itemVersion,
  partsOrderVersion,
  partVersions,
  textPartVersion,
} from "@/lib/cms/sections/versions";
import {
  PROJECT,
  Refusal,
  SLUG,
  auditLesson,
  guardLive,
  isVersion,
  lockLessonRow,
  member,
  newPartId,
  openCourse,
  settle,
  type CourseState,
  type Settled,
} from "@/lib/cms/sections/store.server";
import type { Locale, NarrativeBlock } from "@/lib/cms/types";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

type Plain = Exclude<SectionsError, "changed-elsewhere" | "live-course-standard-only" | "has-learners">;
const refuse = (error: Plain) => ({ ok: false, error }) as const;

const PART_TYPES: readonly PartType[] = ["text", "practice", "scenario", "quiz", "reflection", "rating"];

const lessonWhere = (slug: string, sectionId: string) => ({
  projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: slug, stageKey: sectionId },
});

const isPartBase = (v: unknown): v is PartBase =>
  typeof v === "object" &&
  v !== null &&
  isVersion((v as PartBase).data) &&
  isVersion((v as PartBase).draft);

const badLesson = (slug: unknown, sectionId: unknown) =>
  typeof slug !== "string" || !SLUG.test(slug) || !isSectionId(sectionId);

/**
 * The lesson's content as its locked row holds it: the course locked first
 * (`mode`), the lesson in its list, then the row made (so there is
 * something to lock), locked and read.
 */
async function openLesson(
  tx: Prisma.TransactionClient,
  slug: string,
  sectionId: SectionId,
  mode: "update" | "share"
): Promise<{ state: CourseState; items: StoredPart[] }> {
  const state = await openCourse(tx, slug, mode);
  member(state, sectionId);
  await lockLessonRow(tx, slug, sectionId);
  const row = await tx.lesson.findUnique({
    where: lessonWhere(slug, sectionId),
    select: { parts: true },
  });
  const items = partsOf(row?.parts ?? null);
  if (items === "unreadable") throw new Refusal({ ok: false, error: "outline-unreadable" });
  return { state, items };
}

const jsonSize = (v: unknown) => (v === null ? 0 : JSON.stringify(v).length);

/**
 * Write the lesson's content list: SQL NULL for the main content alone. A
 * list over the column's limit is refused (parts-too-large) unless it is no
 * larger than what is stored already — content saved before can still be
 * edited down.
 */
async function writeParts(
  tx: Prisma.TransactionClient,
  slug: string,
  sectionId: SectionId,
  before: readonly StoredPart[],
  after: readonly StoredPart[]
) {
  const value = storedPartsValue(after);
  const size = jsonSize(value);
  if (size > SECTION_LIMITS.maxPartsJsonChars && size > jsonSize(storedPartsValue(before))) {
    throw new Refusal({ ok: false, error: "parts-too-large" });
  }
  await tx.lesson.update({
    where: lessonWhere(slug, sectionId),
    data: { parts: value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue) },
  });
}

/** The reasons once the lesson holds `items` (G3 compares them with today's). */
function reasonsWith(state: CourseState, sectionId: SectionId, items: readonly StoredPart[]) {
  const parts = storedPartsValue(items);
  const lessons: SectionFacts[] = state.lessons.some((l) => l.stageKey === sectionId)
    ? state.lessons.map((l) => (l.stageKey === sectionId ? { ...l, parts } : l))
    : [...state.lessons, { stageKey: sectionId, parts }];
  return newOnlyReasons("cms", state.outline, lessons);
}

function partOpRefusal(error: PartOpError): Refusal {
  return new Refusal({ ok: false, error });
}

/** A change to the lesson's content list: the whole outline back, or why not. */
async function outlineResult(
  slug: string,
  settled: Settled<unknown>,
  id: SectionId | ExtraPartId | undefined
): Promise<OutlineResult> {
  if (!settled.ok) {
    if ("changed" in settled) {
      return {
        ok: false,
        error: "changed-elsewhere",
        outline: (await getCourseOutline(slug)) ?? undefined,
      };
    }
    return settled.refused;
  }
  const outline = await getCourseOutline(slug);
  // The change is stored; without a page to show it, the page reloads.
  if (!outline) return refuse("unknown-course");
  return { ok: true, outline, ...(id ? { id } : {}) };
}

/**
 * One change to the lesson's content list (add, move, remove), under the
 * Course row's FOR UPDATE: the base is the list's order (and, to remove, the
 * item itself); on a published course the lesson may end up with extra
 * content only if it already had some (G3).
 */
async function changeParts(
  slug: string,
  sectionId: SectionId,
  orderBase: string,
  op: (items: StoredPart[]) => { op: PartOp; itemBase?: { id: string; version: string | null } }
): Promise<Settled<{ before: StoredPart[]; after: StoredPart[] }>> {
  return settle(() =>
    prisma.$transaction(async (tx) => {
      const { state, items } = await openLesson(tx, slug, sectionId, "update");
      if (partsOrderVersion(items) !== orderBase) throw new ChangedElsewhere();
      const { op: change, itemBase } = op(items);
      if (itemBase) {
        const target = items.find((i) => i.id === itemBase.id);
        if (!target) throw new Refusal({ ok: false, error: "unknown-part" });
        if (itemVersion(target) !== itemBase.version) throw new ChangedElsewhere();
      }
      const r = applyPartOp(items, change);
      if (!r.ok) throw partOpRefusal(r.error);
      guardLive(state, reasonsWith(state, sectionId, r.items));
      await writeParts(tx, slug, sectionId, items, r.items);
      return { before: items, after: r.items };
    })
  );
}

/* ------------------------------------------------------------------ read --- */

/**
 * One question part as its editor loads and reloads it: the live version
 * (`structure`, as StructureAuthor calls it) and the draft. Null for anyone
 * who isn't an editor, for anything that isn't a question part of the
 * lesson, or when it couldn't be read (the editor then says so rather than
 * offering an empty question that a save would put over the real one).
 */
export async function getPart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId
): Promise<ExerciseState | null> {
  if (!(await requireEditor())) return null;
  if (badLesson(slug, sectionId) || !isExtraPartId(partId)) return null;
  try {
    const row = await prisma.lesson.findUnique({
      where: lessonWhere(slug, sectionId),
      select: { parts: true },
    });
    const items = partsOf(row?.parts ?? null);
    if (items === "unreadable") return null;
    const item = items.find((i) => i.id === partId);
    if (!item || item.type === "main" || item.type === "text") return null;
    return { structure: item.data, draft: item.draft };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ structural --- */

/**
 * Add content to a lesson: at the top (`after` null) or after the named
 * part. Text starts with no language written; a question starts as a draft
 * (the standard questions, or the standard end labels, for reflection and
 * self-assessment). At most 12 items, the main content included.
 */
export async function addPart(
  slug: string,
  sectionId: SectionId,
  type: PartType,
  after: PartId | null,
  orderBase: string
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (
    badLesson(slug, sectionId) ||
    !PART_TYPES.includes(type) ||
    !(after === null || isPartId(after)) ||
    typeof orderBase !== "string" ||
    !isVersion(orderBase)
  ) {
    return refuse("bad-input");
  }
  let id: ExtraPartId | undefined;
  const settled = await changeParts(slug, sectionId, orderBase, (items) => {
    id = newPartId((p) => items.some((i) => i.id === p));
    return { op: { op: "add", part: emptyPart(type, id, PART_DEFAULTS), after } };
  });
  if (settled.ok && id) {
    await auditLesson(editor.id, "part.added", slug, sectionId, { partId: id, type });
  }
  return outlineResult(slug, settled, id);
}

/** Move a part (the main content too) one place up (-1) or down (1). */
export async function movePart(
  slug: string,
  sectionId: SectionId,
  partId: PartId,
  dir: -1 | 1,
  orderBase: string
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if (
    badLesson(slug, sectionId) ||
    !isPartId(partId) ||
    (dir !== -1 && dir !== 1) ||
    typeof orderBase !== "string" ||
    !isVersion(orderBase)
  ) {
    return refuse("bad-input");
  }
  const settled = await changeParts(slug, sectionId, orderBase, () => ({
    op: { op: "move", id: partId, dir },
  }));
  if (settled.ok) {
    await auditLesson(editor.id, "part.moved", slug, sectionId, {
      partId,
      from: settled.value.before.findIndex((i) => i.id === partId),
      to: settled.value.after.findIndex((i) => i.id === partId),
    });
  }
  return outlineResult(slug, settled, partId === MAIN_PART_ID ? sectionId : partId);
}

/**
 * Remove a part in every language. `itemBase` is the whole part as the page
 * showed it (itemVersion): nobody removes what they haven't seen. The main
 * content can't be removed. A lesson left with its main content alone is a
 * standard lesson again (Lesson.parts back to SQL NULL).
 */
export async function removePart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  orderBase: string,
  itemBase: string | null
): Promise<OutlineResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if ((partId as string) === MAIN_PART_ID) return refuse("main-required");
  if (
    badLesson(slug, sectionId) ||
    !isExtraPartId(partId) ||
    typeof orderBase !== "string" ||
    !isVersion(orderBase) ||
    !isVersion(itemBase)
  ) {
    return refuse("bad-input");
  }
  const settled = await changeParts(slug, sectionId, orderBase, () => ({
    op: { op: "remove", id: partId },
    itemBase: { id: partId, version: itemBase },
  }));
  if (settled.ok) {
    const removed = settled.value.before.find((i) => i.id === partId);
    await auditLesson(editor.id, "part.removed", slug, sectionId, {
      partId,
      type: removed?.type ?? null,
    });
  }
  return outlineResult(slug, settled, sectionId);
}

/* ----------------------------------------------------------------- saves --- */

/** A save of one part's own content, under the Course row's FOR SHARE. */
async function saveInPart<T>(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  write: (
    tx: Prisma.TransactionClient,
    items: StoredPart[],
    index: number
  ) => Promise<T>
): Promise<Settled<T, Refused | { ok: false; error: "invalid"; issues: unknown[] }>> {
  return settle(() =>
    prisma.$transaction(async (tx) => {
      const { items } = await openLesson(tx, slug, sectionId, "share");
      const index = items.findIndex((i) => i.id === partId);
      if (index === -1) throw new Refusal({ ok: false, error: "unknown-part" });
      return write(tx, items, index);
    })
  );
}

/**
 * Save one language of a text part: live at once (D33), no draft. `[]`
 * removes that language. The blocks are rebuilt by sanitizeNarrativeBlocks
 * (D36, D55); a block that can't be stored is refused with `issues` naming
 * the content and the block ("Content 2: Block 3 …"). `base` is that
 * language's fingerprint when the page opened it. Returns the new base.
 */
export async function savePartText(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  locale: Locale,
  blocks: unknown,
  base: string | null
): Promise<VersionResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  if ((partId as string) === MAIN_PART_ID) return refuse("use-main-editor");
  if (badLesson(slug, sectionId) || !isExtraPartId(partId) || !isVersion(base)) {
    return refuse("bad-input");
  }
  if (!isContentLocale(locale)) return refuse("bad-locale");
  if (!Array.isArray(blocks)) return refuse("bad-input");

  const settled = await saveInPart(slug, sectionId, partId, async (tx, items, index) => {
    const item = items[index];
    if (item.type !== "text") throw new Refusal({ ok: false, error: "kind-mismatch" });
    if (textPartVersion(item, locale) !== base) throw new ChangedElsewhere();
    const clean = sanitizeNarrativeBlocks(blocks);
    if (!clean.ok) {
      throw new Refusal({
        ok: false,
        error: "invalid",
        issues: clean.issues.map((issue) => `Content ${index + 1}: ${issue}`),
      });
    }
    const next: Partial<Record<Locale, NarrativeBlock[]>> = { ...item.blocks };
    if (clean.blocks.length) next[locale] = clean.blocks;
    else delete next[locale];
    const updated: StoredPart = { ...item, blocks: next };
    await writeParts(tx, slug, sectionId, items, items.map((i, n) => (n === index ? updated : i)));
    return textPartVersion(updated, locale);
  });
  if (!settled.ok) {
    if ("changed" in settled) return { ok: false, error: "changed-elsewhere" };
    return settled.refused as VersionResult;
  }
  await auditLesson(editor.id, "part.text_saved", slug, sectionId, { partId, locale });
  return { ok: true, version: settled.value };
}

type QuestionItem = Extract<StoredPart, { type: QuestionPartType }>;

/** The arguments of a question save, checked before anything is read. */
function questionArgs(slug: unknown, sectionId: unknown, partId: unknown, base: unknown) {
  if (partId === MAIN_PART_ID) return refuse("use-main-editor");
  if (badLesson(slug, sectionId) || !isExtraPartId(partId) || !isPartBase(base)) {
    return refuse("bad-input");
  }
  return null;
}

/**
 * A question save's common part: the item must be a question of the value's
 * kind, still at `base` (its live version and draft, each fingerprinted),
 * and the value is rebuilt with what the part holds now as its allowance
 * for text stored before the limits (read here, under the lock — never
 * taken from the request).
 */
function questionToStore(
  items: StoredPart[],
  index: number,
  value: unknown,
  base: PartBase
): { item: QuestionItem; clean: ExerciseValue } {
  const item = items[index];
  if (item.type === "main" || item.type === "text") {
    throw new Refusal({ ok: false, error: "kind-mismatch" });
  }
  const kind = KIND_OF_PART[item.type];
  if (typeof value === "object" && value !== null && (value as { kind?: unknown }).kind !== kind) {
    throw new Refusal({ ok: false, error: "kind-mismatch" });
  }
  const now = partVersions(item);
  if (now.data !== base.data || now.draft !== base.draft) throw new ChangedElsewhere();
  const clean = sanitizeExercise(value, kind, [item.data, item.draft]);
  if (!clean.ok) {
    throw new Refusal(
      clean.error === "too-large"
        ? { ok: false, error: "too-large", at: clean.at }
        : { ok: false, error: "bad-input" }
    );
  }
  return { item, clean: clean.value };
}

/**
 * Save a question part for learners (and the preview): refused with
 * `issues` while it isn't ready, as "Save stage" is; otherwise its live
 * version is replaced and its draft cleared. Returns the question as
 * stored.
 */
export async function savePart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  value: unknown,
  base: PartBase
): Promise<ExerciseSaveResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  const bad = questionArgs(slug, sectionId, partId, base);
  if (bad) return bad;
  if (typeof value !== "object" || value === null) return refuse("bad-input");

  const settled = await saveInPart(slug, sectionId, partId, async (tx, items, index) => {
    const { item, clean } = questionToStore(items, index, value, base);
    const issues: PartIssue[] = validateExercise(clean);
    if (issues.length) throw new Refusal({ ok: false, error: "invalid", issues });
    const updated = { ...item, data: clean, draft: null } as StoredPart;
    await writeParts(tx, slug, sectionId, items, items.map((i, n) => (n === index ? updated : i)));
    return { kind: clean.kind, clean, draftCleared: item.draft !== null };
  });
  if (!settled.ok) {
    if ("changed" in settled) return { ok: false, error: "changed-elsewhere" };
    return settled.refused as ExerciseSaveResult;
  }
  await auditLesson(editor.id, "part.saved", slug, sectionId, {
    partId,
    kind: settled.value.kind,
    draftCleared: settled.value.draftCleared,
  });
  return { ok: true, structure: settled.value.clean };
}

/**
 * Keep an unfinished question part as a draft: always allowed for an editor,
 * whatever is still missing; its live version is left as it is. Returns the
 * draft as stored and what is still missing.
 */
export async function savePartDraft(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  value: unknown,
  base: PartBase
): Promise<ExerciseDraftResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  const bad = questionArgs(slug, sectionId, partId, base);
  if (bad) return bad;
  if (typeof value !== "object" || value === null) return refuse("bad-input");

  const settled = await saveInPart(slug, sectionId, partId, async (tx, items, index) => {
    const { item, clean } = questionToStore(items, index, value, base);
    const updated = { ...item, draft: clean } as StoredPart;
    await writeParts(tx, slug, sectionId, items, items.map((i, n) => (n === index ? updated : i)));
    return clean;
  });
  if (!settled.ok) {
    if ("changed" in settled) return { ok: false, error: "changed-elsewhere" };
    return settled.refused as ExerciseDraftResult;
  }
  await auditLesson(editor.id, "part.draft_saved", slug, sectionId, {
    partId,
    kind: settled.value.kind,
  });
  return { ok: true, draft: settled.value, issues: validateExercise(settled.value) };
}

/**
 * Throw a question part's draft away; it goes back to its live version (or
 * to nothing yet). Refused when the draft changed since the page opened it:
 * it may be a colleague's.
 */
export async function discardPartDraft(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  base: PartBase
): Promise<ExerciseDiscardResult> {
  const editor = await requireEditor();
  if (!editor) return refuse("forbidden");
  const bad = questionArgs(slug, sectionId, partId, base);
  if (bad) return bad;

  const settled = await saveInPart(slug, sectionId, partId, async (tx, items, index) => {
    const item = items[index];
    if (item.type === "main" || item.type === "text") {
      throw new Refusal({ ok: false, error: "kind-mismatch" });
    }
    const now = partVersions(item);
    if (now.data !== base.data || now.draft !== base.draft) throw new ChangedElsewhere();
    const updated = { ...item, draft: null } as StoredPart;
    await writeParts(tx, slug, sectionId, items, items.map((i, n) => (n === index ? updated : i)));
    return KIND_OF_PART[item.type];
  });
  if (!settled.ok) {
    if ("changed" in settled) return { ok: false, error: "changed-elsewhere" };
    return settled.refused as ExerciseDiscardResult;
  }
  await auditLesson(editor.id, "part.draft_discarded", slug, sectionId, {
    partId,
    kind: settled.value,
  });
  return { ok: true };
}
