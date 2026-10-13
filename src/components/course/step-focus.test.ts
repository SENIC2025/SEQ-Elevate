import { describe, it, expect } from "vitest";
import { openStepAtTop } from "./step-focus";

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
