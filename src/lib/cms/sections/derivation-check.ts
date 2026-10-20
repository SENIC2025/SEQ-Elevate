/**
 * The core of the pre-deploy checks: Release 1's derivation check (spec
 * 12, addendum 4; scripts/r1-derivation-check.ts) and Release 2's plan
 * check (checkPlans below; scripts/r2-progress-check.ts). Release 1's
 * answers, for every created course: does Release 1's editor see exactly
 * the course its learners get?
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

import { normaliseStatus } from "../course-status";
import { presentStageKeys } from "../course-derive";
import { isLegacySectionId, mainKindOf, type NewOnlyReason, type SectionFacts } from "./contract";
import { newOnlyReasons } from "./guard";
import { lessonPlanOf } from "./learner-path";
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

/* ---------------------------------------------------- Release 2 plans --- */

export interface PlanCheckResult {
  /** Created courses checked. */
  courses: number;
  /** Of them, courses Release 1 could publish (no newOnlyReasons). */
  standard: number;
  /** Of them, published courses. */
  published: number;
  /** Courses that must match and don't. */
  differences: number;
  /** Their slugs, for the report's --list only. */
  differing: string[];
}

/** A Lesson row as the plan reads it. */
type PlanRow = SectionFacts & { courseSlug: string };

/**
 * Release 2's pre-deploy check (spec 6, 10.6): for every created course
 * Release 1 could publish (no newOnlyReasons), and every published course
 * — all of them, since D57 blocked the rest — the lesson plan Release 2's
 * player plays (lessonPlanOf) is exactly what its learners get today
 * (presentStageKeys), every lesson by its stage screen. So on deploy day no
 * learner of a standard course gets a different lesson list.
 */
export function checkPlans(
  courses: readonly { slug: string; outline: unknown; status: string }[],
  lessons: readonly PlanRow[]
): PlanCheckResult {
  const result: PlanCheckResult = { courses: 0, standard: 0, published: 0, differences: 0, differing: [] };
  for (const course of courses) {
    const rows = lessons.filter((l) => l.courseSlug === course.slug);
    const standard = newOnlyReasons("cms", resolveOutline("cms", course.outline, rows), rows).length === 0;
    const published = normaliseStatus(course.status) === "published";
    result.courses++;
    if (standard) result.standard++;
    if (published) result.published++;
    if (!standard && !published) continue;

    const facts = rows.map((l) => ({
      stageKey: l.stageKey,
      structure: l.structure ?? null,
      parts: l.parts ?? null,
      narrative: l.narrative ?? null,
      hasVideo: typeof l.video === "object" && l.video !== null && !Array.isArray(l.video),
      publishedDocuments: l.documentCount ?? 0,
    }));
    const plan = lessonPlanOf("cms", course.outline, facts, "en");
    const present = presentStageKeys("cms", [...rows]) as string[];
    const same =
      plan.lessons.length === present.length &&
      plan.lessons.every((l, i) => l.id === present[i] && l.kind === "stage");
    if (!same) {
      result.differences++;
      result.differing.push(course.slug);
    }
  }
  return result;
}

/** The plan check as the owner reads it: counts, and the differing courses' slugs only when asked. */
export function formatPlanReport(result: PlanCheckResult, opts: { list?: boolean } = {}): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    `${plural(result.courses, "created course")}: ${result.standard} standard, ${result.published} published`,
    `${plural(result.differences, "difference")} between Release 2's lesson plans and what learners get today`,
    ...(opts.list ? result.differing.map((slug) => `  ✗ ${slug}`) : []),
  ].join("\n");
}
