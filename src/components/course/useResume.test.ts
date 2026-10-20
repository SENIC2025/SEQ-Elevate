import { describe, it, expect, vi, afterEach } from "vitest";

// The hook's module reads the store; only its pure rules are tested here.
vi.mock("@/store/demo-state", () => ({ useCourseReady: () => false }));

import { initialPosition, resumeCheck, type Position, type ResumeProgress } from "./useResume";
import type { SectionId } from "@/lib/cms/sections/contract";

/**
 * UA3 (spec 5.5): where a learner opens a course, and the one check after
 * their saved progress is in. Release 1 resumed once, on mount, from what
 * the store held then (nothing yet, for a signed-in learner), by counting
 * finished lessons.
 */

const IDS: SectionId[] = ["s-abcd1234", "concept", "scenario", "s-efgh5678"];
const progress = (done: string[], completedAt: string | null = null): ResumeProgress => ({
  ids: IDS,
  done: new Set(done),
  completedAt,
});

/**
 * A fake ready signal: the course's saved progress "arrives" after `ms`, as
 * the store's load would, and the check runs then — once.
 */
function arrivesAfter(ms: number, check: ReturnType<typeof resumeCheck>, p: ResumeProgress, at: () => Position) {
  const moves: (Position | null)[] = [];
  setTimeout(() => moves.push(check.ready(p, at())), ms);
  return moves;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("initialPosition", () => {
  it("opens a signed-in learner where the server says, so lesson 1 never flashes", () => {
    expect(initialPosition(IDS, { preview: false, serverResume: "scenario" })).toBe("scenario");
    expect(initialPosition(IDS, { preview: false, serverResume: "complete" })).toBe("complete");
  });

  it("opens at the first lesson without a position, or with one the course hasn't got", () => {
    expect(initialPosition(IDS, { preview: false })).toBe("s-abcd1234");
    expect(initialPosition(IDS, { preview: false, serverResume: null })).toBe("s-abcd1234");
    expect(initialPosition(IDS, { preview: false, serverResume: "context" })).toBe("s-abcd1234");
  });

  it("opens a preview where the editor asked, never where a learner would resume", () => {
    expect(initialPosition(IDS, { preview: true, initialLesson: "scenario", serverResume: "concept" })).toBe(
      "scenario"
    );
    expect(initialPosition(IDS, { preview: true, initialLesson: "context" })).toBe("s-abcd1234");
    expect(initialPosition(IDS, { preview: true, serverResume: "complete" })).toBe("s-abcd1234");
  });

  it("is empty for a course without lessons, whatever the server says", () => {
    expect(initialPosition([], { preview: false, serverResume: "complete" })).toBe("empty");
    expect(initialPosition([], { preview: true })).toBe("empty");
  });
});

describe("resumeCheck", () => {
  it("runs once the progress is in: to the first lesson not done", () => {
    vi.useFakeTimers();
    const check = resumeCheck({ preview: false });
    const moves = arrivesAfter(1500, check, progress(["s-abcd1234", "concept"]), () => "s-abcd1234");
    vi.advanceTimersByTime(1499);
    expect(moves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(moves).toEqual(["scenario"]);
  });

  it("runs only once", () => {
    const check = resumeCheck({ preview: false });
    expect(check.ready(progress(["s-abcd1234"]), "s-abcd1234")).toBe("concept");
    expect(check.ready(progress(["s-abcd1234", "concept"]), "concept")).toBeNull();
  });

  it("never moves a learner who did something before the progress came", () => {
    vi.useFakeTimers();
    const check = resumeCheck({ preview: false });
    let current: Position = "s-abcd1234";
    const moves = arrivesAfter(3000, check, progress(["s-abcd1234", "concept"]), () => current);
    vi.advanceTimersByTime(1000);
    // The learner answered, or moved on.
    current = "concept";
    check.interacted();
    vi.advanceTimersByTime(2000);
    expect(moves).toEqual([null]);
  });

  it("leaves the learner where they are when that is where they'd go", () => {
    const check = resumeCheck({ preview: false });
    expect(check.ready(progress(["s-abcd1234"]), "concept")).toBeNull();
  });

  it("never moves in a preview, nor when a lesson was asked for", () => {
    expect(resumeCheck({ preview: true }).ready(progress(["s-abcd1234"]), "s-abcd1234")).toBeNull();
    expect(
      resumeCheck({ preview: false, initialLesson: "s-efgh5678" }).ready(progress(["s-abcd1234"]), "s-efgh5678")
    ).toBeNull();
  });

  it("opens a completed course on its completion screen", () => {
    const check = resumeCheck({ preview: false });
    expect(check.ready(progress(["s-abcd1234"], "2026-11-10T09:00:00.000Z"), "s-abcd1234")).toBe("complete");
  });

  it("opens a course whose every lesson is done, but not completed, on its last lesson — never completing it", () => {
    const check = resumeCheck({ preview: false });
    expect(check.ready(progress(IDS), "s-abcd1234")).toBe("s-efgh5678");
  });

  it("goes to a lesson added before ones already done (resume is by lesson, not by count)", () => {
    const check = resumeCheck({ preview: false });
    // Three lessons done; the one not done is the second.
    expect(check.ready(progress(["s-abcd1234", "scenario", "s-efgh5678"]), "s-efgh5678")).toBe("concept");
  });

  it("does nothing for an empty course", () => {
    const check = resumeCheck({ preview: false });
    expect(check.ready({ ids: [], done: new Set(), completedAt: null }, "empty")).toBeNull();
  });
});
