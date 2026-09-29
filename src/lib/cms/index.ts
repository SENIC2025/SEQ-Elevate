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
import { applyCourseStatus, applyCourseCopyOverride } from "./course-overlay";
import { listDbCourses, getDbCourse } from "./db-course";
import { applyCompCardTemplate } from "./comp-card-overlay";
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
  const [bundled, created] = await Promise.all([
    provider().listCourses(projectId, locale),
    // Courses an editor created in the CMS; they have no bundled definition.
    listDbCourses(projectId, locale),
  ]);
  return applyCourseStatus(
    projectId,
    [...bundled, ...created],
    locale,
    opts?.includeUnpublished
  );
}

export async function getCourse(
  projectId: string,
  slug: string,
  locale: Locale
): Promise<CourseContent | null> {
  // A bundled course comes from the provider; a course created in the CMS is
  // assembled from its DB rows. Bundled wins if a slug somehow exists in both.
  const bundled = await provider().getCourse(projectId, slug, locale);
  const content = bundled
    ? // An editor may have reworded a bundled course's title or subtitle.
      await applyCourseCopyOverride(projectId, bundled)
    : await getDbCourse(projectId, slug, locale);
  if (!content) return null;
  // Overlay author-attached lesson media (video + documents) from the DB.
  return applyLessonMedia(projectId, slug, content);
}

/**
 * A bundled course's title and subtitle exactly as the platform ships them,
 * with NO editor rewording — so the course page can show "Built-in: …" and
 * offer to go back to it. Null for a course the provider doesn't have (i.e.
 * one created in the CMS).
 */
export async function getBaseCourseCopy(
  projectId: string,
  slug: string,
  locale: Locale
): Promise<{ title: string; tagline: string; clusterLabel: string } | null> {
  const c = await provider().getCourse(projectId, slug, locale);
  return c
    ? { title: c.title, tagline: c.tagline, clusterLabel: c.clusterLabel }
    : null;
}

/**
 * The bundled template with NO editor override applied. The template editor
 * needs this: the effective template omits hidden fields, so editing from it
 * alone would make a hidden field impossible to bring back.
 */
export function getBaseCompCardTemplate(
  projectId: string,
  locale: Locale
): Promise<CompCardTemplate> {
  return provider().getCompCardTemplate(projectId, locale);
}

export async function getCompCardTemplate(
  projectId: string,
  locale: Locale
): Promise<CompCardTemplate> {
  const base = await provider().getCompCardTemplate(projectId, locale);
  // Overlay the editor's per-locale wording from the DB.
  return applyCompCardTemplate(projectId, locale, base);
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
