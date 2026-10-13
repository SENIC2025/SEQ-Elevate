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
  stageKey: StructureStageKey
): Promise<StructureState | null> {
  if (!(await requireEditor())) return null;
  try {
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

const isObject = (v: unknown): v is object =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isObjectOrNull = (v: unknown) => v === null || isObject(v);

const isBase = (base: unknown): base is StructureState =>
  isObject(base) &&
  isObjectOrNull((base as StructureState).structure) &&
  isObjectOrNull((base as StructureState).draft);

/** Server-action arguments come straight from the client. */
const validTarget = (courseSlug: unknown, stageKey: unknown) =>
  typeof courseSlug === "string" &&
  Boolean(courseSlug) &&
  courseSlug.length <= 80 &&
  isStructureStage(stageKey);

/**
 * What may be stored for this stage: the structure rebuilt by
 * sanitizeStructure (D36's rule: never pass client JSON through), or why not.
 * Also checks that the course is one created here.
 */
async function storable(
  courseSlug: string,
  stageKey: StructureStageKey,
  input: unknown
) {
  if (isObject(input) && (input as { kind?: unknown }).kind !== KIND_FOR_STAGE[stageKey]) {
    return { ok: false as const, error: "kind-mismatch" as const };
  }
  const clean = sanitizeStructure(input, KIND_FOR_STAGE[stageKey]);
  if (!clean.ok) return clean;
  if (!(await isCmsCourse(courseSlug))) {
    return { ok: false as const, error: "not-cms-course" as const };
  }
  return clean;
}

/**
 * Write to one lesson row, only if its structure and draft are still the
 * `base` the editor started from. Both columns hold every language, and the
 * page shows one language at a time — so a write from a page opened before a
 * colleague's save would silently wipe their translation (D33). The row is
 * locked until the write commits, so a second save can't slip in between the
 * check and the write. Throws ChangedElsewhere when the base is stale.
 */
async function writeIfUnchanged(
  courseSlug: string,
  stageKey: StructureStageKey,
  base: StructureState,
  data: Prisma.LessonUpdateInput
) {
  const where = {
    projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug, stageKey },
  };
  await prisma.$transaction(async (tx) => {
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
    await tx.lesson.update({ where, data });
  });
}

async function audit(
  actorId: string,
  action:
    | "structure.saved"
    | "structure.cleared"
    | "structure.draft_saved"
    | "structure.draft_discarded",
  courseSlug: string,
  stageKey: StructureStageKey,
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
  stageKey: StructureStageKey,
  structure: StoredStructure,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isObject(structure) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  const clean = await storable(courseSlug, stageKey, structure);
  if (!clean.ok) return clean;

  const issues = validateStructure(clean.structure);
  if (issues.length) {
    return { ok: false as const, error: "invalid" as const, issues };
  }

  try {
    await writeIfUnchanged(courseSlug, stageKey, base, {
      structure: clean.structure as unknown as Prisma.InputJsonValue,
      structureDraft: Prisma.DbNull,
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    throw error;
  }

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
  stageKey: StructureStageKey,
  draft: StoredStructure,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isObject(draft) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  const clean = await storable(courseSlug, stageKey, draft);
  if (!clean.ok) return clean;

  try {
    await writeIfUnchanged(courseSlug, stageKey, base, {
      structureDraft: clean.structure as unknown as Prisma.InputJsonValue,
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    throw error;
  }

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
  stageKey: StructureStageKey,
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
  try {
    await writeIfUnchanged(courseSlug, stageKey, base, {
      structureDraft: Prisma.DbNull,
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    throw error;
  }
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
 */
export async function clearStructure(
  courseSlug: string,
  stageKey: StructureStageKey,
  base: StructureState
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" as const };
  if (!validTarget(courseSlug, stageKey) || !isBase(base)) {
    return { ok: false as const, error: "bad-input" as const };
  }
  try {
    await writeIfUnchanged(courseSlug, stageKey, base, {
      structure: Prisma.DbNull,
      structureDraft: Prisma.DbNull,
    });
  } catch (error) {
    if (error instanceof ChangedElsewhere) {
      return { ok: false as const, error: "changed-elsewhere" as const };
    }
    throw error;
  }
  await audit(editor.id, "structure.cleared", courseSlug, stageKey, {
    draftCleared: base.draft !== null,
  });
  return { ok: true as const };
}
