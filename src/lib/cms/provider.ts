/**
 * CMS provider selection.
 *
 * The app calls the public functions in src/lib/cms/index.ts, which
 * delegate to whichever provider CMS_SOURCE selects:
 *
 *   CMS_SOURCE=local   → local-provider  (reads bundled content; default)
 *   CMS_SOURCE=strapi  → strapi-provider (fetches from Strapi REST API)
 *
 * To migrate to native-in-Postgres authoring later, add a third provider
 * implementing this same interface — no app code changes required. This
 * is the "hybrid, swappable" CMS decision in action.
 */

import type {
  CourseContent,
  CourseSummary,
  CompCardTemplate,
  Locale,
} from "./types";

export interface CMSProvider {
  listCourses(projectId: string, locale: Locale): Promise<CourseSummary[]>;
  getCourse(
    projectId: string,
    slug: string,
    locale: Locale
  ): Promise<CourseContent | null>;
  getCompCardTemplate(
    projectId: string,
    locale: Locale
  ): Promise<CompCardTemplate>;
}

export type CMSSource = "local" | "strapi";

export function getCMSSource(): CMSSource {
  const v = process.env.CMS_SOURCE;
  return v === "strapi" ? "strapi" : "local";
}
