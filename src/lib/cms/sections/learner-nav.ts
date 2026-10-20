/**
 * Moving through the lessons learners get (spec 3.2, Q4: in order, can go
 * back): where a learner resumes, how far the step bar reaches, and where
 * Continue goes. `ids` is the plan's lesson ids in order (learner-path.ts),
 * `done` the lessons the learner finished, by id.
 *
 * Its own module, with nothing but these rules, so the player (a client
 * component) can import them without the step-name messages lessonPlanOf
 * reads; learner-path.ts re-exports them for the server.
 *
 * Pure and client-safe.
 */

import type { SectionId } from "./contract";

/**
 * Where a learner opens the course: the completion screen once it is
 * completed; else the first lesson not done; with every lesson done but
 * the course not completed (an editor hid the last one they hadn't done),
 * the last lesson — never the completion, which would complete the course
 * on opening. "empty" when the course has no lessons.
 */
export function nextLesson(
  ids: readonly string[],
  done: ReadonlySet<string>,
  completedAt: string | null
): SectionId | "complete" | "empty" {
  if (completedAt) return "complete";
  if (!ids.length) return "empty";
  return (ids.find((id) => !done.has(id)) ?? ids[ids.length - 1]) as SectionId;
}

/**
 * The last lesson the step bar reaches: the first not done, or the last
 * lesson once all are done or the course is completed; -1 with none.
 */
export function frontierOf(ids: readonly string[], done: ReadonlySet<string>, completed: boolean): number {
  if (completed) return ids.length - 1;
  const first = ids.findIndex((id) => !done.has(id));
  return first === -1 ? ids.length - 1 : first;
}

/**
 * May the step bar open lesson `i`? Up to the frontier, the lesson being
 * shown, and every lesson in preview. A done lesson a reorder put past the
 * frontier shows as done but can't be opened from the bar.
 */
export function isReachable(i: number, frontier: number, currentIndex: number, preview: boolean): boolean {
  return preview || i <= frontier || i === currentIndex;
}

/**
 * Where Continue goes from `current` (which counts as done now): the next
 * lesson in order; after the last one, the first lesson still not done
 * (`stillToDo`, so the player can say why); else the completion.
 */
export function nextAfter(
  ids: readonly string[],
  done: ReadonlySet<string>,
  current: SectionId
): { to: SectionId | "complete"; stillToDo?: SectionId } {
  const i = ids.indexOf(current);
  if (i !== -1 && i < ids.length - 1) return { to: ids[i + 1] as SectionId };
  const left = ids.find((id) => id !== current && !done.has(id)) as SectionId | undefined;
  if (!left) return { to: "complete" };
  return i === -1 ? { to: left } : { to: left, stillToDo: left };
}
