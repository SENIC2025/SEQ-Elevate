/**
 * CMS public client. The whole app reads content through these functions.
 * They delegate to the provider selected by CMS_SOURCE (local | strapi).
 *
 * Swapping the content backend = changing one env var. Adding a future
 * native-Postgres provider = implementing CMSProvider and adding one case.
 */

import { getCMSSource, type CMSProvider } from "./provider";
import { localProvider } from "./local-provider";
import { strapiProvider } from "./strapi-provider";
import { applyLessonMedia } from "./lesson-overlay";
import { applyCourseStatus } from "./course-overlay";
import type { Locale, CourseContent, CourseSummary, CompCardTemplate } from "./types";

function provider(): CMSProvider {
  return getCMSSource() === "strapi" ? strapiProvider : localProvider;
}

/**
 * The course catalogue, with editorial status applied from the DB.
 *
 * Learner surfaces call this as-is and never see a draft. Staff surfaces pass
 * `{ includeUnpublished: true }` to see and manage drafts.
 */
export async function listCourses(
  projectId: string,
  locale: Locale,
  opts?: { includeUnpublished?: boolean }
): Promise<CourseSummary[]> {
  const summaries = await provider().listCourses(projectId, locale);
  return applyCourseStatus(projectId, summaries, opts?.includeUnpublished);
}

export async function getCourse(
  projectId: string,
  slug: string,
  locale: Locale
): Promise<CourseContent | null> {
  const content = await provider().getCourse(projectId, slug, locale);
  if (!content) return null;
  // Overlay author-attached lesson media (video + documents) from the DB.
  return applyLessonMedia(projectId, slug, content);
}

export function getCompCardTemplate(
  projectId: string,
  locale: Locale
): Promise<CompCardTemplate> {
  return provider().getCompCardTemplate(projectId, locale);
}

export type {
  Locale,
  CourseContent,
  CourseSummary,
  CompCardTemplate,
  CourseStage,
  ScenarioChoice,
  SimulationOption,
} from "./types";
