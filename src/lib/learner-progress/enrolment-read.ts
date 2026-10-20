/**
 * An enrolment as every counter reads it (spec 4.5, 6): the lessons the
 * learner finished, and whether anything at all is saved in it.
 *
 * Standard lessons are stored as the StageKey enum (upper case), the
 * course's own in sectionsCompleted; counting works on lesson ids, so both
 * come back as one list in the players' spelling.
 *
 * Pure, so the dashboard, the facilitator view, the statistics and the
 * learner actions read rows alike.
 */

import { readAssessment } from "@/lib/assessment-progress";
import { readIds, readResponses } from "./parse";

/** The lessons finished: standard ones lower case, then the course's own. */
export function completedLessonIds(row: {
  stagesCompleted: readonly string[];
  sectionsCompleted?: unknown;
}): string[] {
  const out = row.stagesCompleted.map((s) => s.toLowerCase());
  // readIds lists each once, and none is a standard key.
  for (const id of readIds(row.sectionsCompleted)) out.push(id);
  return out;
}

/** A text answer the learner wrote something in. */
const written = (v: unknown) => typeof v === "string" && v.trim() !== "";

/**
 * Has the learner done anything in this course: a lesson finished, an
 * answer of any kind, the course finished? (An enrolment exists only once
 * something was saved, but a quick check tried again is saved empty.)
 */
export function enrolmentHasProgress(row: {
  stagesCompleted: readonly string[];
  sectionsCompleted?: unknown;
  simulationChoice: string | null;
  scenarioRoot: string | null;
  reflection: unknown;
  assessment: unknown;
  responses?: unknown;
  completedAt: Date | null;
}): boolean {
  const reflection = (row.reflection ?? {}) as Record<string, unknown>;
  return (
    completedLessonIds(row).length > 0 ||
    row.simulationChoice !== null ||
    !!row.scenarioRoot ||
    ["p1", "p2", "p3"].some((p) => written(reflection[p])) ||
    Object.keys(readAssessment(row.assessment).answers).length > 0 ||
    Object.keys(readResponses(row.responses)).length > 0 ||
    row.completedAt !== null
  );
}
