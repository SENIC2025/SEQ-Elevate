import "server-only";

/**
 * Comp Card template overlay — reads the editor's per-locale wording from
 * `Project.compCardTemplate` and applies it to the bundled template.
 *
 * Decisions live in ./comp-card-template (pure, unit-tested); this file only
 * does the DB read. A DB problem returns the bundled template, so the Comp
 * Card always renders.
 */

import { prisma } from "@/lib/prisma";
import {
  applyTemplateOverride,
  pickOverride,
  type CompCardTemplateOverride,
} from "./comp-card-template";
import type { CompCardTemplate } from "./types";

export async function applyCompCardTemplate(
  projectId: string,
  locale: string,
  base: CompCardTemplate
): Promise<CompCardTemplate> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { compCardTemplate: true },
    });
    const all = (project?.compCardTemplate ??
      null) as CompCardTemplateOverride | null;
    return applyTemplateOverride(base, pickOverride(all, locale));
  } catch {
    return base;
  }
}

/** The raw stored override, for the editor UI. */
export async function readCompCardOverride(
  projectId: string
): Promise<CompCardTemplateOverride | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { compCardTemplate: true },
    });
    return (project?.compCardTemplate ?? null) as CompCardTemplateOverride | null;
  } catch {
    return null;
  }
}
