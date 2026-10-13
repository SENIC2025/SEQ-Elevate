"use server";

/**
 * Interactive-stage authoring — write a CMS course's simulation / scenario /
 * assessment structure to Lesson.structure. Editor/admin only, validated with
 * validateStructure, audited.
 *
 * An unfinished stage can be kept as a draft (Lesson.structureDraft) instead:
 * same checks, minus validateStructure. Learners never get the draft — they
 * only ever read Lesson.structure (db-course.ts) — and the next save for
 * learners replaces the structure and clears the draft.
 *
 * These only apply to CMS-CREATED courses (those carrying Course.meta).
 * Bundled courses own their structure in code; letting the CMS shadow it would
 * be silently ignored by getCourse (bundled wins), so we refuse it up front.
 *
 * Release 1 (G6): a lesson of a created course's own ("s-…") whose main
 * content is an exercise is edited here too, only while it is in the
 * course's lesson list and only with its own kind (mainKindOf), checked
 * again under the Course row's FOR SHARE before the write. The standard
 * lessons' path is unchanged and never asks for the Course lock — except
 * "Remove stage", which on a published course with learners is refused
 * (G5), with the Course row locked FOR UPDATE first.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { canEditContent } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  validateStructure,
  type StoredStructure,
  type StructureStageKey,
} from "@/lib/cms/structure";
import { sanitizeStructure } from "@/lib/cms/structure-sanitize";
import { ChangedElsewhere, sameStoredJson } from "@/lib/cms/stored-json";
import {
  isCustomSectionId,
  mainKindOf,
  type CustomSectionId,
} from "@/lib/cms/sections/contract";
import { resolveOutline } from "@/lib/cms/sections/outline";
import {
  Refusal,
  learnerCount,
  lockCourse,
} from "@/lib/cms/sections/store.server";

const PROJECT = "seq-elevate";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  return canEditContent(roles) ? user : null;
}

const KIND_FOR_STAGE: Record<StructureStageKey, StoredStructure["kind"]> = {
  simulation: "simulation",
  scenario: "scenario",
  assessment: "assessment",
};

/**
 * One stage as the editor works on it: what learners get (`structure`) and
 * an editor's unfinished version of it (`draft`), each null when there is
 * none. The editor sends back the pair it started from with every write.
 */
export interface StructureState {
  structure: StoredStructure | null;
  draft: StoredStructure | null;
}

/**
 * Read one stage of a CMS course for the editor: the structure and any draft.
 * Null for anyone who isn't an editor, or when it couldn't be read (the
 * editor then says so, rather than offering an empty stage that a save would
 * put over the real one).
 */
export async function getStructure(
  courseSlug: string,
  stageKey: StructureStageKey | CustomSectionId
): Promise<StructureState | null> {
  if (!(await requireEditor())) return null;
  if (!validTarget(courseSlug, stageKey)) return null;
  try {
    if (!(await targetKind(courseSlug, stageKey)).ok) return null;
    const lesson = await prisma.lesson.findFirst({
      where: { projectId: PROJECT, courseSlug, stageKey },
      select: { structure: true, structureDraft: true },
    });
    return {
      structure: (lesson?.structure ?? null) as StoredStructure | null,
      draft: (lesson?.structureDraft ?? null) as StoredStructure | null,
    };
  } catch {
    return null;
  }
}

/** Is this a CMS-created course (carries meta)? Only those may be authored. */
async function isCmsCourse(courseSlug: string) {
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug: courseSlug },
    select: { meta: true },
  });
  return Boolean(course?.meta);
}

const isStructureStage = (key: unknown): key is StructureStageKey =>
  typeof key === "string" && Object.hasOwn(KIND_FOR_STAGE, key);

/** A standard exercise lesson, or a lesson of the course's own (G6). */
type Target = StructureStageKey | CustomSectionId;
type Kind = StoredStructure["kind"];

/** Why a lesson of the course's own can't take an exercise, or its kind. */
function ownLessonKind(
  course: { meta: unknown; outline: unknown } | null,
  lessons: { stageKey: string; structure?: unknown; parts?: unknown }[],
  id: CustomSectionId
):
  | { ok: true; kind: Kind }
  | { ok: false; error: "not-cms-course" | "outline-unreadable" | "not-a-section" | "kind-mismatch" } {
  if (!course?.meta) return { ok: false, error: "not-cms-course" };
  const outline = resolveOutline("cms", course.outline ?? null, lessons);
  if (outline.unreadable) return { ok: false, error: "outline-unreadable" };
  const section = outline.sections.find((s) => s.id === id);
  if (!section) return { ok: false, error: "not-a-section" };
  const kind = mainKindOf(section);
  return isStructureStage(kind)
    ? { ok: true, kind: KIND_FOR_STAGE[kind] }
    : { ok: false, error: "kind-mismatch" };
}

/** The lesson's exercise kind: a standard key's own, or (read, not locked) a lesson of the course's own. */
async function targetKind(courseSlug: string, key: Target) {
  if (isStructureStage(key)) return { ok: true as const, kind: KIND_FOR_STAGE[key] };
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug: courseSlug },
    select: { meta: true, outline: true },
  });
  const lessons = course?.meta
    ? await prisma.lesson.findMany({
        where: { projectId: PROJECT, courseSlug },
        select: { stageKey: true, structure: true, parts: true },
      })
    : [];
  return ownLessonKind(course, lessons, key);
}

const isObject = (v: unknown): v is object =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isObjectOrNull = (v: unknown) => v === null || isObject(v);

const isBase = (base: unknown): base is StructureState =>
  isObject(base) &&
  isObjectOrNull((base as StructureState).structure) &&
  isObjectOrNull((base as StructureState).draft);

/** Server-action arguments come straight from the client. */
const validTarget = (courseSlug: unknown, stageKey: unknown): stageKey is Target =>
  typeof courseSlug === "string" &&
  Boolean(courseSlug) &&
  courseSlug.length <= 80 &&
  (isStructureStage(stageKey) || isCustomSectionId(stageKey));

/**
 * What may be stored for this stage: the structure rebuilt by
 * sanitizeStructure (D36's rule: never pass client JSON through), or why not.
 * Also checks that the course is one created here.
 *
 * Whatever is already over a size limit in `base` may stay, so a stage
 * saved before the limits existed can still be edited. Taking that from the
 * request is safe: every write goes through writeIfUnchanged, which writes
 * nothing unless `base` is exactly what the row holds.
 */
async function storable(
  courseSlug: string,
  stageKey: Target,
  input: unknown,
  base: StructureState
) {
  const target = await targetKind(courseSlug, stageKey);
  if (!target.ok) return target;
  if (isObject(input) && (input as { kind?: unknown }).kind !== target.kind) {
    return { ok: false as const, error: "kind-mismatch" as const };
  }
  const clean = sanitizeStructure(input, target.kind, [base.structure, base.draft]);
  if (!clean.ok) return clean;
  if (!(await isCmsCourse(courseSlug))) {
    return { ok: false as const, error: "not-cms-course" as const };
  }
  return { ...clean, kind: target.kind };
}

/** Why a write was refused under its locks (G5, G6); the transaction rolled back. */
type WriteRefused =
  | { ok: false; error: "changed-elsewhere" }
  | { ok: false; error: "not-cms-course" | "outline-unreadable" | "not-a-section" | "kind-mismatch" }
  | { ok: false; error: "has-learners"; count: number };

/**
 * Write to one lesson row, only if its structure and draft are still the
 * `base` the editor started from. Both columns hold every language, and the
 * page shows one language at a time — so a write from a page opened before a
 * colleague's save would silently wipe their translation (D33). The row is
 * locked until the write commits, so a second save can't slip in between the
 * check and the write. Refused ("changed-elsewhere") when the base is stale.
 *
 * A lesson of the course's own (`kind` given) is checked again under the
 * Course row's FOR SHARE, taken before the Lesson row: it must still be in
 * the lesson list with that kind (G6). Removing a stage (`guardLearners`)
 * locks the Course row FOR UPDATE first — an enrolment's foreign-key check
 * takes FOR KEY SHARE, which FOR SHARE wouldn't hold off — and is refused
 * while learners are enrolled and have the stage, whatever the course's
 * status (G5).
 */
async function writeIfUnchanged(
  courseSlug: string,
  stageKey: Target,
  base: StructureState,
  data: Prisma.LessonUpdateInput,
  opts: { kind?: Kind; guardLearners?: boolean } = {}
): Promise<{ ok: true } | WriteRefused> {
  const where = {
    projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug, stageKey },
  };
  try {
    await prisma.$transaction(async (tx) => {
      const own = isCustomSectionId(stageKey);
      const course =
        opts.guardLearners || own
          ? await lockCourse(tx, courseSlug, opts.guardLearners ? "update" : "share")
          : null;
      if (own) {
        const lessons = await tx.lesson.findMany({
          where: { projectId: PROJECT, courseSlug },
          select: { stageKey: true, structure: true, parts: true },
        });
        const target = ownLessonKind(course, lessons, stageKey);
        if (!target.ok) throw new Refusal(target);
        if (opts.kind && target.kind !== opts.kind) {
          throw new Refusal({ ok: false, error: "kind-mismatch" });
        }
      }
      // Make sure the row exists, so there is something to lock.
      await tx.lesson.upsert({
        where,
        create: { projectId: PROJECT, courseSlug, stageKey },
        update: {},
      });
      await tx.$queryRaw`SELECT id FROM "Lesson" WHERE "projectId" = ${PROJECT} AND "courseSlug" = ${courseSlug} AND "stageKey" = ${stageKey} FOR UPDATE`;
      const current = await tx.lesson.findUnique({
        where,
        select: { structure: true, structureDraft: true },
      });
      // Compare the stored JSON itself, not Lesson.updatedAt: a video or text
      // saved on the same lesson isn't a clash.
      if (
        !sameStoredJson(current?.structure ?? null, base.structure) ||
        !sameStoredJson(current?.structureDraft ?? null, base.draft)
      ) {
        throw new ChangedElsewhere();
      }
      // Whatever the status, as for deleting a lesson (G4): otherwise
      // unpublishing, removing and publishing again would take the exercise
      // from learners in three steps. Only a standard lesson's: learners
      // don't get a lesson of the course's own before Release 2.
      if (
        opts.guardLearners &&
        course &&
        !isCustomSectionId(stageKey) &&
        (current?.structure ?? null) !== null
      ) {
        const count = await learnerCount(tx, course.id);
        if (count > 0) throw new Refusal({ ok: false, error: "has-learners", count });
      }
      await tx.lesson.update({ where, data });
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false, error: "changed-elsewhere" };
    }
    if (error instanceof Refusal) return error.result as WriteRefused;
    throw error;
  }
  return { ok: true };
}

async function audit(
  actorId: string,
  action:
    | "structure.saved"
    | "structure.cleared"
    | "structure.draft_saved"
    | "structure.draft_discarded",
  courseSlug: string,
  stageKey: Target,
  metadata?: Prisma.InputJsonValue
) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId,
      action,
      entity: "Lesson",
      entityId: `${courseSlug}:${stageKey}`,
      ...(metadata ? { metadata } : {}),
    },
  });
}

/**
 * Save a stage for learners. Refused with "invalid" and `issues` (codes that
 * name the exact field, see validateStructure) when learners couldn't use it
 * yet — nothing is written then; the editor offers "Save draft" instead. On a
 * published course this goes live straight away, as every save does (D33).
 * Clears any draft: the saved stage is now the latest version.
 *
 * `base` is the structure and draft the editor started from; if either has
 * changed since, nothing is written ("changed-elsewhere").
 *
 * Returns the structure as stored (rebuilt by sanitizeStructure), the base
 * for the next write.
 */
export async function saveStructure(
  courseSlug: string,
  stageKey: Target,
  structure: StoredStructure,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isObject(structure) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  const clean = await storable(courseSlug, stageKey, structure, base);
  if (!clean.ok) return clean;

  const issues = validateStructure(clean.structure);
  if (issues.length) {
    return { ok: false as const, error: "invalid" as const, issues };
  }

  const written = await writeIfUnchanged(
    courseSlug,
    stageKey,
    base,
    {
      structure: clean.structure as unknown as Prisma.InputJsonValue,
      structureDraft: Prisma.DbNull,
    },
    { kind: clean.kind }
  );
  if (!written.ok) return written;

  await audit(editor.id, "structure.saved", courseSlug, stageKey, {
    kind: clean.structure.kind,
    draftCleared: base.draft !== null,
  });
  return { ok: true as const, structure: clean.structure };
}

/**
 * Keep an unfinished stage as a draft: always allowed for an editor on a
 * created course, whatever is still missing. Learners don't see it, and what
 * they see (Lesson.structure) is left as it is.
 *
 * Returns the draft as stored (the base for the next write) and what is
 * still missing before it can be saved for learners.
 */
export async function saveStructureDraft(
  courseSlug: string,
  stageKey: Target,
  draft: StoredStructure,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isObject(draft) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  const clean = await storable(courseSlug, stageKey, draft, base);
  if (!clean.ok) return clean;

  const written = await writeIfUnchanged(
    courseSlug,
    stageKey,
    base,
    { structureDraft: clean.structure as unknown as Prisma.InputJsonValue },
    { kind: clean.kind }
  );
  if (!written.ok) return written;

  await audit(editor.id, "structure.draft_saved", courseSlug, stageKey, {
    kind: clean.structure.kind,
  });
  return {
    ok: true as const,
    draft: clean.structure,
    issues: validateStructure(clean.structure),
  };
}

/**
 * Throw a draft away; the stage goes back to what learners see (or to
 * nothing, if it was never saved for them). Refused like a save when the
 * draft changed since the editor opened it — it may be a colleague's.
 */
export async function discardStructureDraft(
  courseSlug: string,
  stageKey: Target,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  if (!(await isCmsCourse(courseSlug))) {
    return { ok: false as const, error: "not-cms-course" as const };
  }
  const written = await writeIfUnchanged(courseSlug, stageKey, base, {
    structureDraft: Prisma.DbNull,
  });
  if (!written.ok) return written;
  await audit(editor.id, "structure.draft_discarded", courseSlug, stageKey);
  return { ok: true as const };
}

/**
 * Remove a stage's structure — the interactive stage disappears from the
 * course — and any draft of it, so nothing of it is left behind.
 *
 * Refused like a save ("changed-elsewhere") when the structure or draft
 * changed since the editor opened the stage: a draft a colleague saved in
 * the meantime was never shown on this page, and removing the stage must
 * not delete it unseen.
 *
 * Refused with "has-learners" while learners are enrolled and the stage is
 * one they have (G5): they would lose it. (A lesson of the course's own
 * isn't theirs before Release 2.) This holds on a draft or archived
 * course too, as for deleting a lesson (G4), since the course can be
 * published again. A stage that is only a draft can always go.
 */
export async function clearStructure(
  courseSlug: string,
  stageKey: Target,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  // Like every other write here, only on a course created here.
  if (!(await isCmsCourse(courseSlug))) {
    return { ok: false as const, error: "not-cms-course" as const };
  }
  const written = await writeIfUnchanged(
    courseSlug,
    stageKey,
    base,
    { structure: Prisma.DbNull, structureDraft: Prisma.DbNull },
    { guardLearners: true }
  );
  if (!written.ok) return written;
  await audit(editor.id, "structure.cleared", courseSlug, stageKey, {
    draftCleared: base.draft !== null,
  });
  return { ok: true as const };
}
