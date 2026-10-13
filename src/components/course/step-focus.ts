/**
 * Opening a new step of the course player at its top.
 *
 * The player used to start a smooth scroll to the top and then focus the
 * new step (for screen readers, WCAG 2.4.3) without preventScroll. Focusing
 * scrolls the focused element into view at once, which cancels the smooth
 * scroll; for a step taller than the screen whose bottom was already in
 * view — Continue pressed at the bottom of a long step, common on phones —
 * the learner landed at the end of the new step, past its first question.
 * So the page scrolls to the top, smoothly unless the learner asked for
 * less motion, and the step is focused without scrolling: the course
 * editor's lesson links do the same (CourseWorkspace).
 *
 * No React: CoursePlayer calls it when the step changes.
 */

/** The parts of `window` this needs. */
export interface StepWindow {
  scrollTo(options: ScrollToOptions): void;
  matchMedia(query: string): { matches: boolean };
}

export function openStepAtTop(
  step: { focus(options?: FocusOptions): void } | null,
  win: StepWindow
): void {
  const reduceMotion = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  win.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  step?.focus({ preventScroll: true });
}
