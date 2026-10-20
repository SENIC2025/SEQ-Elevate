/**
 * Opening a new step of the course player at its top, and taking the
 * learner to one place inside a step.
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
 * Continue pressed with something missing (spec 5.7) focuses the exact
 * item — the same way, without the browser's own scroll — and then
 * scrolls only as far as needed (revealTop): not at all when the item's
 * top is already in view; otherwise its top comes to rest just under the
 * sticky header, never further than the top of the page.
 *
 * No React: CoursePlayer and useContinue call these.
 */

/** The parts of `window` this needs. */
export interface StepWindow {
  scrollTo(options: ScrollToOptions): void;
  matchMedia(query: string): { matches: boolean };
}

/** And, to reveal one place in a step, where the page is and how tall the screen is. */
export interface RevealWindow extends StepWindow {
  scrollY: number;
  innerHeight: number;
}

/** What revealTop measures of the target. */
export interface RevealTarget {
  getBoundingClientRect(): { top: number; height: number };
}

/** Room left between the sticky header and a revealed target (the CSS scroll padding's too). */
export const REVEAL_GAP_PX = 16;
/**
 * How much of a target must be on screen for it to count as in view: a
 * heading's line, or all of a smaller target.
 */
export const REVEAL_MIN_VISIBLE_PX = 48;

const behaviourFor = (win: StepWindow): ScrollBehavior =>
  win.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function openStepAtTop(
  step: { focus(options?: FocusOptions): void } | null,
  win: StepWindow
): void {
  win.scrollTo({ top: 0, behavior: behaviourFor(win) });
  step?.focus({ preventScroll: true });
}

/**
 * Scroll so `target`'s top shows, only if it doesn't: when it is under the
 * sticky header (whose bottom is `headerBottom`, in viewport pixels) or
 * above it, or below the fold. Then its top rests REVEAL_GAP_PX under the
 * header — never past the top of the page. Smooth, or at once for a
 * learner who asked for less motion.
 */
export function revealTop(target: RevealTarget, win: RevealWindow, headerBottom: number): void {
  const { top, height } = target.getBoundingClientRect();
  const underHeader = top < headerBottom;
  const belowFold = top + Math.min(height, REVEAL_MIN_VISIBLE_PX) > win.innerHeight;
  if (!underHeader && !belowFold) return;
  const to = Math.max(0, Math.round(win.scrollY + top - headerBottom - REVEAL_GAP_PX));
  win.scrollTo({ top: to, behavior: behaviourFor(win) });
}

/**
 * The bottom of the page's sticky header in viewport pixels (AppHeaderClient),
 * 0 without one. Any header that sticks or is fixed counts.
 */
export function stickyHeaderBottom(doc: Pick<Document, "querySelectorAll"> & { defaultView: Window | null }): number {
  const view = doc.defaultView;
  if (!view) return 0;
  let bottom = 0;
  for (const header of Array.from(doc.querySelectorAll("header"))) {
    const position = view.getComputedStyle(header).position;
    if (position !== "sticky" && position !== "fixed") continue;
    const rect = header.getBoundingClientRect();
    if (rect.top <= 0 && rect.bottom > bottom) bottom = rect.bottom;
  }
  return bottom;
}

/**
 * Take the learner to `target`: focus it without the browser scrolling
 * (which would put it at the very top, under the header, or scroll when it
 * is already in view), then reveal its top if it isn't showing.
 */
export function focusTarget(
  target: (RevealTarget & { focus(options?: FocusOptions): void }) | null,
  win: RevealWindow,
  headerBottom: number
): void {
  if (!target) return;
  target.focus({ preventScroll: true });
  revealTop(target, win, headerBottom);
}
