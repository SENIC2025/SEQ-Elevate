"use server";

/**
 * Release 1: a lesson's extra content around its main content (D56) — add,
 * move and remove content (structural: Course lock, G3, the whole outline
 * back), and save text and question content with Release 0's draft model
 * per piece of content (D52). The main content keeps today's editors and
 * actions (lesson.ts, structure.ts).
 *
 * Stubs with their final signatures until the Foundation's actions land
 * (F2), so the streams can code against them. Each refuses to run.
 */

import type {
  ExerciseDiscardResult,
  ExerciseDraftResult,
  ExerciseSaveResult,
  ExerciseState,
  ExtraPartId,
  OutlineResult,
  PartBase,
  PartId,
  PartType,
  SectionId,
  VersionResult,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";

/** Every stub: the real action comes with F2. */
function notYet(name: string, ...args: unknown[]): never {
  void args;
  throw new Error(`${name} is not implemented yet (Release 1 Foundation, F2)`);
}

export async function getPart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId
): Promise<ExerciseState | null> {
  return notYet("getPart", slug, sectionId, partId);
}

export async function addPart(
  slug: string,
  sectionId: SectionId,
  type: PartType,
  after: PartId | null,
  orderBase: string
): Promise<OutlineResult> {
  return notYet("addPart", slug, sectionId, type, after, orderBase);
}

export async function movePart(
  slug: string,
  sectionId: SectionId,
  partId: PartId,
  dir: -1 | 1,
  orderBase: string
): Promise<OutlineResult> {
  return notYet("movePart", slug, sectionId, partId, dir, orderBase);
}

export async function removePart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  orderBase: string,
  itemBase: string | null
): Promise<OutlineResult> {
  return notYet("removePart", slug, sectionId, partId, orderBase, itemBase);
}

export async function savePartText(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  locale: Locale,
  blocks: unknown,
  base: string | null
): Promise<VersionResult> {
  return notYet("savePartText", slug, sectionId, partId, locale, blocks, base);
}

export async function savePart(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  value: unknown,
  base: PartBase
): Promise<ExerciseSaveResult> {
  return notYet("savePart", slug, sectionId, partId, value, base);
}

export async function savePartDraft(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  value: unknown,
  base: PartBase
): Promise<ExerciseDraftResult> {
  return notYet("savePartDraft", slug, sectionId, partId, value, base);
}

export async function discardPartDraft(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  base: PartBase
): Promise<ExerciseDiscardResult> {
  return notYet("discardPartDraft", slug, sectionId, partId, base);
}
