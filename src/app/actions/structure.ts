"use server";

/**
 * Interactive-stage authoring — write a CMS course's simulation / scenario /
 * assessment structure to Lesson.structure. Editor/admin only, validated with
 * validateStructure, audited.
 *
 * These only apply to CMS-CREATED courses (those carrying Course.meta).
 * Bundled courses own their structure in code; letting the CMS shadow it would
 * be silently ignored by getCourse (bundled wins), so we refuse it up front.
 */

import { Prisma } from "@prisma/client";
import { getCurrentUser, hasRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  validateStructure,
  type StoredStructure,
  type StructureStageKey,
} from "@/lib/cms/structure";

const PROJECT = "seq-elevate";

async function requireEditor() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ok =
    (await hasRole(PROJECT, "ADMIN")) ||
    (await hasRole(PROJECT, "CONTENT_EDITOR"));
  return ok ? user : null;
}

const KIND_FOR_STAGE: Record<StructureStageKey, StoredStructure["kind"]> = {
  simulation: "simulation",
  scenario: "scenario",
  assessment: "assessment",
};

export interface AuthorableCourse {
  slug: string;
  title: string;
}

/**
 * CMS-created courses only — the ones whose interactive stages can be authored.
 * Bundled courses own their structure in code, so they're excluded.
 */
export async function listAuthorableCourses(): Promise<
  AuthorableCourse[] | null
> {
  if (!(await requireEditor())) return null;
  try {
    const rows = await prisma.course.findMany({
      where: { projectId: PROJECT, NOT: { meta: { equals: Prisma.DbNull } } },
      orderBy: { createdAt: "asc" },
      select: { slug: true, meta: true },
    });
    return rows.map((r) => {
      const meta = r.meta as Record<string, { title?: string }> | null;
      const title =
        meta?.en?.title ?? Object.values(meta ?? {})[0]?.title ?? r.slug;
      return { slug: r.slug, title };
    });
  } catch {
    return [];
  }
}

/** Read the stored structure for one stage of a CMS course (editor UI). */
export async function getStructure(
  courseSlug: string,
  stageKey: StructureStageKey
): Promise<StoredStructure | null> {
  if (!(await requireEditor())) return null;
  try {
    const lesson = await prisma.lesson.findFirst({
      where: { projectId: PROJECT, courseSlug, stageKey },
      select: { structure: true },
    });
    return (lesson?.structure ?? null) as StoredStructure | null;
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

/**
 * Save a stage's structure. Validates before writing; the same kind must match
 * the stage. Publishing readiness is the caller's concern — we store drafts
 * too, but return the validation issues so the UI can warn.
 */
export async function saveStructure(
  courseSlug: string,
  stageKey: StructureStageKey,
  structure: StoredStructure
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };

  if (structure.kind !== KIND_FOR_STAGE[stageKey]) {
    return { ok: false as const, error: "kind-mismatch" };
  }
  if (!(await isCmsCourse(courseSlug))) {
    return { ok: false as const, error: "not-cms-course" };
  }

  const issues = validateStructure(structure);
  if (issues.length) {
    return { ok: false as const, error: "invalid", issues };
  }

  await prisma.lesson.upsert({
    where: {
      projectId_courseSlug_stageKey: {
        projectId: PROJECT,
        courseSlug,
        stageKey,
      },
    },
    create: {
      projectId: PROJECT,
      courseSlug,
      stageKey,
      structure: structure as unknown as Prisma.InputJsonValue,
    },
    update: { structure: structure as unknown as Prisma.InputJsonValue },
  });

  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: editor.id,
      action: "structure.saved",
      entity: "Lesson",
      entityId: `${courseSlug}:${stageKey}`,
      metadata: { kind: structure.kind },
    },
  });
  return { ok: true as const };
}

/** Remove a stage's structure — the interactive stage disappears from the course. */
export async function clearStructure(
  courseSlug: string,
  stageKey: StructureStageKey
) {
  const editor = await requireEditor();
  if (!editor) return { ok: false as const, error: "forbidden" };
  await prisma.lesson.updateMany({
    where: { projectId: PROJECT, courseSlug, stageKey },
    data: { structure: Prisma.DbNull },
  });
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: editor.id,
      action: "structure.cleared",
      entity: "Lesson",
      entityId: `${courseSlug}:${stageKey}`,
    },
  });
  return { ok: true as const };
}
