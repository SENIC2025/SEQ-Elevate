import { describe, it, expect } from "vitest";
import {
  courseStageKeys,
  courseProgress,
  overallProgress,
  nextStage,
} from "./course-progress";

const CREATED = ["context", "concept", "behaviour", "reflection"];
const OWN = "s-abcdefgh";
const OWN2 = "s-00000002";

describe("courseStageKeys", () => {
  // Release 2 flips Release 1's "in learner order" (re-sorted to the seven
  // steps): the order given is the course's own (its outline), and lessons
  // of the course's own count too (spec 6).
  it("keeps the course's own lessons, in the order given", () => {
    expect(courseStageKeys(["reflection", "context", "assessment"])).toEqual([
      "reflection",
      "context",
      "assessment",
    ]);
  });

  it("keeps the course's own lessons and reads standard keys in any case", () => {
    expect(courseStageKeys(["CONTEXT", OWN, "concept"])).toEqual(["context", OWN, "concept"]);
  });

  it("drops anything that isn't a lesson, and repeats", () => {
    expect(courseStageKeys(["context", "complete", "nope", "s-SHOUTING", "context"])).toEqual([
      "context",
    ]);
  });

  it("falls back to all seven when the source doesn't say", () => {
    expect(courseStageKeys(undefined)).toHaveLength(7);
    expect(courseStageKeys(null)).toHaveLength(7);
  });
});

describe("courseProgress", () => {
  it("counts a finished four-lesson course as 4 of 4", () => {
    const p = courseProgress(CREATED, CREATED, true);
    expect(p).toMatchObject({ total: 4, pct: 100 });
    expect(p.done).toEqual(CREATED);
  });

  it("only counts completed steps the course has", () => {
    const p = courseProgress(CREATED, ["context", "simulation"], false);
    expect(p.done).toEqual(["context"]);
    expect(p.pct).toBe(25);
  });

  it("reads the database's upper-case stage keys", () => {
    expect(courseProgress(CREATED, ["CONTEXT", "CONCEPT"], false).pct).toBe(50);
  });

  it("counts a completed course as all done, even with a lesson added since", () => {
    const withPractice = [...CREATED, "simulation"];
    const p = courseProgress(withPractice, CREATED, true);
    expect(p).toMatchObject({ total: 5, pct: 100 });
  });

  it("divides a built-in course by seven", () => {
    expect(courseProgress(undefined, ["context", "concept"], false)).toMatchObject({
      total: 7,
      pct: 29,
    });
  });

  it("is 0% for a course with no lessons", () => {
    expect(courseProgress([], [], false)).toMatchObject({ total: 0, pct: 0 });
  });

  it("counts the course's own lessons, in the course's order", () => {
    const p = courseProgress([OWN, "context", OWN2], ["context", OWN], false);
    expect(p).toMatchObject({ keys: [OWN, "context", OWN2], done: [OWN, "context"], total: 3, pct: 67 });
  });

  it("keeps counting a lesson the learner finished once it is no longer shown", () => {
    // Hidden after the learner finished it (D64): it still counts, done.
    const p = courseProgress(["context", "concept"], ["context", OWN], false, [OWN, OWN2]);
    expect(p).toMatchObject({ keys: ["context", "concept", OWN], done: ["context", OWN], total: 3, pct: 67 });
  });

  it("doesn't count a lesson no longer shown that the learner hadn't finished", () => {
    expect(courseProgress(["context"], ["context"], false, ["concept"])).toMatchObject({
      total: 1,
      pct: 100,
    });
  });

  it("counts a completed course as all done, unseen lessons it finished included", () => {
    expect(courseProgress(["context", "concept"], [OWN], true, [OWN])).toMatchObject({
      done: ["context", "concept", OWN],
      total: 3,
      pct: 100,
    });
  });
});

describe("overallProgress", () => {
  it("adds every course's own lessons together", () => {
    const finished = courseProgress(CREATED, CREATED, true);
    const started = courseProgress(undefined, ["context"], false);
    expect(overallProgress([finished, started])).toEqual({
      done: 5,
      total: 11,
      pct: 45,
    });
  });

  it("is 0% with no courses", () => {
    expect(overallProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("nextStage", () => {
  it("is the course's next lesson, not the seven-step list's", () => {
    expect(
      nextStage(CREATED, ["context", "concept", "behaviour"], false)
    ).toBe("reflection");
  });

  it("is complete once the course is", () => {
    expect(nextStage(CREATED, CREATED, true)).toBe("complete");
  });

  it("stays on the last lesson when all are done but the course isn't marked complete", () => {
    expect(nextStage(CREATED, CREATED, false)).toBe("reflection");
  });

  it("starts at the first lesson", () => {
    expect(nextStage(undefined, [], false)).toBe("context");
  });

  it("follows the course's own order, its own lessons included", () => {
    expect(nextStage([OWN, "context", "concept"], [OWN], false)).toBe("context");
    expect(nextStage(["concept", "context"], ["CONCEPT"], false)).toBe("context");
    expect(nextStage(["context", OWN], ["context"], false)).toBe(OWN);
  });

  it("is complete for a course with no lessons", () => {
    expect(nextStage([], [], false)).toBe("complete");
  });
});
