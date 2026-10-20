import { describe, it, expect } from "vitest";
import { focusTarget, openStepAtTop, revealTop } from "./step-focus";

/** A page and a step that record what's done to them, in order. */
function fake(reducedMotion: boolean) {
  const calls: string[] = [];
  const win = {
    scrollTo: (options: ScrollToOptions) =>
      calls.push(`scrollTo ${options.top} ${options.behavior}`),
    matchMedia: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
    }),
  };
  const step = {
    focus: (options?: FocusOptions) =>
      calls.push(`focus preventScroll=${options?.preventScroll === true}`),
  };
  return { calls, win, step };
}

describe("openStepAtTop", () => {
  it("scrolls smoothly to the top and focuses the step without scrolling, which would cut the scroll short", () => {
    const { calls, win, step } = fake(false);
    openStepAtTop(step, win);
    expect(calls).toEqual(["scrollTo 0 smooth", "focus preventScroll=true"]);
  });

  it("jumps to the top at once for a learner who asked for less motion", () => {
    const { calls, win, step } = fake(true);
    openStepAtTop(step, win);
    expect(calls).toEqual(["scrollTo 0 auto", "focus preventScroll=true"]);
  });

  it("still scrolls when there's no step to focus", () => {
    const { calls, win } = fake(false);
    openStepAtTop(null, win);
    expect(calls).toEqual(["scrollTo 0 smooth"]);
  });
});

/**
 * UA2 (spec 5.7): Continue pressed with something missing takes focus to
 * the item and scrolls only as far as needed — Release 1 focused the
 * heading with the browser's own scroll, which put it under the sticky
 * header or moved a page that was already showing it.
 */
describe("focusTarget and revealTop", () => {
  const HEADER = 57;

  /** A page `innerHeight` tall scrolled to `scrollY`, and a target at `top` (viewport px). */
  function page(o: { top: number; height?: number; scrollY?: number; innerHeight?: number; reducedMotion?: boolean }) {
    const calls: string[] = [];
    const win = {
      scrollY: o.scrollY ?? 1000,
      innerHeight: o.innerHeight ?? 800,
      scrollTo: (options: ScrollToOptions) => calls.push(`scrollTo ${options.top} ${options.behavior}`),
      matchMedia: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)" && !!o.reducedMotion,
      }),
    };
    const target = {
      getBoundingClientRect: () => ({ top: o.top, height: o.height ?? 28 }),
      focus: (options?: FocusOptions) => calls.push(`focus preventScroll=${options?.preventScroll === true}`),
    };
    return { calls, win, target };
  }

  it("focuses without the browser's scroll, and leaves a target in view where it is", () => {
    const { calls, win, target } = page({ top: 300 });
    focusTarget(target, win, HEADER);
    expect(calls).toEqual(["focus preventScroll=true"]);
  });

  it("brings a target under the sticky header down to just below it (header + 16)", () => {
    const { calls, win, target } = page({ top: 20, scrollY: 1000 });
    focusTarget(target, win, HEADER);
    // 1000 + 20 − 57 − 16
    expect(calls).toEqual(["focus preventScroll=true", "scrollTo 947 smooth"]);
  });

  it("brings a target above the screen back the same way", () => {
    const { calls, win, target } = page({ top: -400, scrollY: 1000 });
    revealTop(target, win, HEADER);
    expect(calls).toEqual(["scrollTo 527 smooth"]);
  });

  it("scrolls up to a target below the fold, its top just under the header", () => {
    const { calls, win, target } = page({ top: 900, scrollY: 200, innerHeight: 800 });
    revealTop(target, win, HEADER);
    expect(calls).toEqual(["scrollTo 1027 smooth"]);
  });

  it("counts a target whose first line is cut off at the bottom as below the fold", () => {
    const { calls, win, target } = page({ top: 790, height: 200, scrollY: 0, innerHeight: 800 });
    revealTop(target, win, HEADER);
    expect(calls).toEqual(["scrollTo 717 smooth"]);
    // Its first line showing is enough, however tall it is.
    const shown = page({ top: 700, height: 600, scrollY: 0, innerHeight: 800 });
    revealTop(shown.target, shown.win, HEADER);
    expect(shown.calls).toEqual([]);
  });

  it("never scrolls past the top of the page", () => {
    const { calls, win, target } = page({ top: 30, scrollY: 10 });
    revealTop(target, win, HEADER);
    expect(calls).toEqual(["scrollTo 0 smooth"]);
  });

  it("jumps at once for a learner who asked for less motion", () => {
    const { calls, win, target } = page({ top: 20, scrollY: 1000, reducedMotion: true });
    focusTarget(target, win, HEADER);
    expect(calls).toEqual(["focus preventScroll=true", "scrollTo 947 auto"]);
  });

  it("does nothing without a target", () => {
    const { calls, win } = page({ top: 0 });
    focusTarget(null, win, HEADER);
    expect(calls).toEqual([]);
  });
});
