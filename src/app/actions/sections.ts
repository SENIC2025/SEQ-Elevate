"use server";

/**
 * Release 1: the lesson list of a course created here (D56) — add, move,
 * hide, rename and delete lessons. Each writes Course.outline (and, for a
 * delete, the lesson's row) under the Course lock, refuses on a published
 * course what learners couldn't get yet (G3), and returns the whole course
 * outline so the page shows exactly what was stored.
 *
 * Stubs with their final signatures until the Foundation's actions land
 * (F2), so the streams can code against them. Each refuses to run.
 */

import type {
  AddSectionChoice,
  OutlineResult,
  SectionId,
  VersionResult,
} from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";

/** Every stub: the real action comes with F2. */
function notYet(name: string, ...args: unknown[]): never {
  void args;
  throw new Error(`${name} is not implemented yet (Release 1 Foundation, F2)`);
}

export async function addSection(
  slug: string,
  choice: AddSectionChoice,
  at: number | null,
  base: string
): Promise<OutlineResult> {
  return notYet("addSection", slug, choice, at, base);
}

export async function moveSection(
  slug: string,
  id: SectionId,
  dir: -1 | 1,
  base: string
): Promise<OutlineResult> {
  return notYet("moveSection", slug, id, dir, base);
}

export async function setSectionHidden(
  slug: string,
  id: SectionId,
  hidden: boolean,
  base: string
): Promise<OutlineResult> {
  return notYet("setSectionHidden", slug, id, hidden, base);
}

export async function renameSection(
  slug: string,
  id: SectionId,
  locale: Locale,
  label: string,
  base: string | null
): Promise<VersionResult> {
  return notYet("renameSection", slug, id, locale, label, base);
}

export async function deleteSection(
  slug: string,
  id: SectionId,
  base: string,
  contentBase: string | null
): Promise<OutlineResult> {
  return notYet("deleteSection", slug, id, base, contentBase);
}
