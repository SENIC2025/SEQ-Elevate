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
 *
 * Release 2 (D64): a course's lessons are its lesson plan — in its own
 * order, lessons of its own ("s-…") included (lessonPlanOf,
 * src/lib/cms/sections/learner-path.ts) — and a lesson the learner finished
 * keeps counting once it is hidden or emptied, so hiding never lowers
 * anyone's progress. The unit is the lesson.
 */

import { STAGES } from "@/data/course";
import { isLegacySectionId, isSectionId } from "@/lib/cms/sections/contract";
import { nextLesson } from "@/lib/cms/sections/learner-nav";

export interface CourseProgressCount {
  /** The lessons counted: the course's, in learner order, then finished ones no longer shown. */
  keys: string[];
  /** Which of `keys` are done. */
  done: string[];
  total: number;
  pct: number;
}

/** A lesson id as the players spell it: standard keys lower case ("CONTEXT" as the database stores it). */
const lessonId = (k: string) => (isLegacySectionId(k.toLowerCase()) ? k.toLowerCase() : k);

/**
 * The course's lessons in the order given (the course's own), once each:
 * standard keys lower-cased, lessons of the course's own kept, anything
 * else dropped. Without a list, all seven — what a built-in course has,
 * and the safe reading for a source that doesn't say.
 */
export function courseStageKeys(
  stageKeys: readonly string[] | null | undefined
): string[] {
  if (!stageKeys) return [...STAGES];
  const out: string[] = [];
  for (const k of stageKeys.map(lessonId)) {
    if (isSectionId(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * A learner's progress in one course.
 *
 * The lessons counted are the course's (`stageKeys`), plus each lesson no
 * longer shown (`unseen`: hidden, or emptied) that the learner finished.
 * Saved progress can name a lesson the course no longer has at all (an
 * editor took a practice out again), which doesn't count. A completed
 * course counts as all done (D50), as the player's completion screen shows
 * it, even if an editor has added a lesson since.
 */
export function courseProgress(
  stageKeys: readonly string[] | null | undefined,
  completedStages: readonly string[],
  completed: boolean,
  unseen: readonly string[] = []
): CourseProgressCount {
  const finished = new Set(completedStages.map(lessonId));
  const shown = courseStageKeys(stageKeys);
  const keys = [
    ...shown,
    ...courseStageKeys(unseen).filter((k) => finished.has(k) && !shown.includes(k)),
  ];
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
 * yet, in the course's order, or "complete" once the course is (the
 * player's resume rule, nextLesson). (Counting the done steps and indexing
 * the seven-step list instead put a learner who had finished a four-lesson
 * course's first three lessons on "Guided practice", a step that course
 * doesn't have.) Every lesson done but the course not marked complete yet
 * reads as the last lesson, as before; a course with no lessons as
 * "complete".
 */
export function nextStage(
  stageKeys: readonly string[] | null | undefined,
  completedStages: readonly string[],
  completed: boolean
): string {
  const next = nextLesson(
    courseStageKeys(stageKeys),
    new Set(completedStages.map(lessonId)),
    completed ? "completed" : null
  );
  return next === "empty" ? "complete" : next;
}
