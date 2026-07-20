/**
 * Pure course-status logic — no DB, no server-only boundary, unit-testable.
 * The DB read lives in course-overlay.ts, which delegates the decisions here.
 */

import type { CourseSummary } from "./types";

export type CourseStatus = "draft" | "published" | "archived";

/**
 * Anything unrecognised counts as published. A stray value in one row must
 * never blank the catalogue for learners — failing open is the safe direction
 * here, since the alternative is an empty dashboard with no explanation.
 */
export function normaliseStatus(value: string): CourseStatus {
  return value === "draft" || value === "archived" ? value : "published";
}

/**
 * Apply DB statuses to bundled summaries, preserving catalogue order.
 *
 * @param dbStatus  slug → status from the DB; a missing entry means the course
 *   has no row yet (bundled but never seeded) and keeps the provider's status.
 * @param includeUnpublished staff pass true to see drafts; learners leave it
 *   false so drafts are dropped entirely.
 */
export function selectByStatus(
  summaries: CourseSummary[],
  dbStatus: Map<string, CourseStatus>,
  includeUnpublished: boolean
): CourseSummary[] {
  const out: CourseSummary[] = [];
  for (const s of summaries) {
    const status = dbStatus.get(s.slug) ?? normaliseStatus(s.status);
    if (!includeUnpublished && status !== "published") continue;
    out.push({ ...s, status });
  }
  return out;
}
