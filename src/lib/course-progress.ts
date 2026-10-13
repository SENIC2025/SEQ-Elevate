/**
 * How far a learner is through a course, counted against THAT course's own
 * lessons. Pure and unit-tested; the learner dashboard, the facilitator view
 * and the analytics all use it, so they agree with each other and with the
 * course player.
 *
 * Why not the fixed seven-step list (STAGES): a course created in the CMS
 * starts with four lessons (context, concept, behaviour, reflection) and
 * gains the interactive ones only when an editor writes them. Dividing by
 * seven left a finished four-lesson course at 57% for good, with three steps
 * on the checklist that could never be ticked.
 */

import { STAGES, type Stage } from "@/data/course";

export interface CourseProgressCount {
  /** The course's lessons, in learner order. */
  keys: Stage[];
  /** Which of `keys` are done. */
  done: Stage[];
  total: number;
  pct: number;
}

/**
 * The course's lessons in canonical order: `stageKeys` when the caller knows
 * them (only real stage keys kept), else all seven — what a built-in course
 * has, and the safe reading for a source that doesn't say.
 */
export function courseStageKeys(
  stageKeys: readonly string[] | null | undefined
): Stage[] {
  if (!stageKeys) return [...STAGES];
  const own = new Set(stageKeys.map((k) => k.toLowerCase()));
  return STAGES.filter((k) => own.has(k));
}

/**
 * A learner's progress in one course.
 *
 * Only steps the course actually has count: saved progress can name a step
 * the course no longer has (an editor took a practice out again), or come
 * in another case ("CONTEXT" as the database stores it). A completed course
 * counts as all done, as the player's completion screen shows it, even if
 * an editor has added a lesson since.
 */
export function courseProgress(
  stageKeys: readonly string[] | null | undefined,
  completedStages: readonly string[],
  completed: boolean
): CourseProgressCount {
  const keys = courseStageKeys(stageKeys);
  const finished = new Set(completedStages.map((s) => s.toLowerCase()));
  const done = completed ? [...keys] : keys.filter((k) => finished.has(k));
  const total = keys.length;
  return {
    keys,
    done,
    total,
    pct: total ? Math.round((done.length / total) * 100) : 0,
  };
}

/** Progress across several courses: all their lessons, added together. */
export function overallProgress(
  courses: readonly Pick<CourseProgressCount, "done" | "total">[]
): { done: number; total: number; pct: number } {
  const done = courses.reduce((n, c) => n + c.done.length, 0);
  const total = courses.reduce((n, c) => n + c.total, 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * Where the learner is in the course: the first of its lessons not done
 * yet, or "complete" once the course is. (Counting the done steps and
 * indexing the seven-step list instead put a learner who had finished a
 * four-lesson course's first three lessons on "Guided practice", a step that
 * course doesn't have.) Every lesson done but the course not marked complete
 * yet reads as the last lesson, as before.
 */
export function nextStage(
  stageKeys: readonly string[] | null | undefined,
  completedStages: readonly string[],
  completed: boolean
): Stage | "complete" {
  if (completed) return "complete";
  const { keys, done } = courseProgress(stageKeys, completedStages, false);
  return keys.find((k) => !done.includes(k)) ?? keys.at(-1) ?? "complete";
}
