/**
 * The core of the pre-deploy derivation check (spec 12, addendum 4;
 * scripts/r1-derivation-check.ts runs it on a database's rows). For every
 * created course it answers: does Release 1's editor see exactly the
 * course its learners get?
 *
 *   derived  — the editor's lesson list (resolveOutline), less hidden
 *              lessons and exercise lessons with nothing saved for
 *              learners — the lessons learners would get by it;
 *   present  — what the learner reader plays today (presentStageKeys);
 *   reasons  — newOnlyReasons: anything that would block publishing.
 *
 * A course differs when derived ≠ present or it has any reason; before
 * Release 1 every course has Course.outline and Lesson.parts null, so the
 * golden tests promise zero differences. Rows of a key that is no lesson of
 * the list ("stray", made by the media actions for any key) are listed for
 * information only.
 *
 * Pure: no Prisma, no "server-only", so the script runs under plain Node.
 */

import { presentStageKeys } from "../course-derive";
import { isLegacySectionId, mainKindOf, type NewOnlyReason, type SectionFacts } from "./contract";
import { newOnlyReasons } from "./guard";
import { resolveOutline } from "./outline";

export interface CheckedCourse {
  slug: string;
  derived: string[];
  present: string[];
  reasons: NewOnlyReason[];
  stray: string[];
  differs: boolean;
}

export interface CheckResult {
  reports: CheckedCourse[];
  differences: number;
}

/** Check every created course against its lesson rows. */
export function checkCourses(
  courses: readonly { slug: string; outline: unknown }[],
  lessons: readonly (SectionFacts & { courseSlug: string })[]
): CheckResult {
  const reports = courses.map((course) => {
    const rows = lessons.filter((l) => l.courseSlug === course.slug);
    const outline = resolveOutline("cms", course.outline, rows);
    const withStructure = new Set(rows.filter((l) => l.structure != null).map((l) => l.stageKey));
    const derived = outline.sections
      .filter((s) => !s.hidden)
      .filter((s) => {
        const kind = mainKindOf(s);
        return kind === "narrative" || kind === "reflection" || withStructure.has(s.id);
      })
      .map((s) => s.id as string);
    const present = presentStageKeys("cms", rows) as string[];
    const reasons = newOnlyReasons("cms", outline, rows);
    const listed = new Set<string>(outline.sections.map((s) => s.id));
    const stray = rows
      .map((l) => l.stageKey)
      .filter((k) => !listed.has(k) && !isLegacySectionId(k));
    const differs =
      reasons.length > 0 ||
      derived.length !== present.length ||
      derived.some((k, i) => k !== present[i]);
    return { slug: course.slug, derived, present, reasons, stray, differs };
  });
  return { reports, differences: reports.filter((r) => r.differs).length };
}

/** The report as the owner reads it in a terminal. */
export function formatReport(result: CheckResult): string {
  const lines = result.reports.map((r) => {
    const head = `${r.differs ? "✗" : "✓"} ${r.slug}`;
    const detail = [
      r.differs ? `  editor: ${r.derived.join(", ")}\n  learners: ${r.present.join(", ")}` : null,
      r.reasons.length
        ? `  reasons: ${r.reasons.map((x) => (x.sectionId ? `${x.code} (${x.sectionId})` : x.code)).join(", ")}`
        : null,
      r.stray.length ? `  stray rows (information only): ${r.stray.join(", ")}` : null,
    ].filter(Boolean);
    return [head, ...detail].join("\n");
  });
  const total = `${result.reports.length} created course${result.reports.length === 1 ? "" : "s"} checked, ${result.differences} difference${result.differences === 1 ? "" : "s"}`;
  return [...lines, total].join("\n");
}
