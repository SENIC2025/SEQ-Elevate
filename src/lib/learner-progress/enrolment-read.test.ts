import { describe, it, expect } from "vitest";
import { completedLessonIds, enrolmentHasProgress } from "./enrolment-read";
import { cpuRatio } from "../rich-text/cpu-time.test-helpers";

/*
 * Reading an enrolment the way every counter does (spec 4.5, 6): the
 * lessons finished are the standard ones (stored upper case) and the
 * course's own, and an enrolment has progress when anything at all was
 * saved in it — an own reflection or a rating alone included.
 */

const OWN = "s-abcdefgh";

const ROW = {
  stagesCompleted: [] as string[],
  sectionsCompleted: null as unknown,
  simulationChoice: null as string | null,
  scenarioRoot: null as string | null,
  reflection: {} as unknown,
  assessment: {} as unknown,
  responses: null as unknown,
  completedAt: null as Date | null,
};

describe("completedLessonIds", () => {
  it("is the standard lessons lower case, then the course's own", () => {
    expect(completedLessonIds({ stagesCompleted: ["CONTEXT", "SIMULATION"], sectionsCompleted: [OWN] })).toEqual([
      "context",
      "simulation",
      OWN,
    ]);
  });

  it("reads a Release 1 enrolment, which has no list of the course's own", () => {
    expect(completedLessonIds({ stagesCompleted: ["CONCEPT"] })).toEqual(["concept"]);
    expect(completedLessonIds({ stagesCompleted: [], sectionsCompleted: null })).toEqual([]);
  });

  // Measured as work done, not time passed (cpu-time.test-helpers.ts): 50,000
  // ids against eight lists of 6,250, by CPU time (cpuRatio: the least of 5
  // rounds each, run in turn). A Set takes a few milliseconds and about as
  // long for both; a list searched once per id (out.includes) seconds, and
  // eight times as long for the one list.
  it("reads 50,000 ids in well under a second of CPU time: every counter reads every enrolment", () => {
    const idsFrom = (from: number, n: number) => Array.from({ length: n }, (_, i) => `s-${String(from + i).padStart(8, "0")}`);
    const enrolment = (list: string[]) => ({ stagesCompleted: ["CONTEXT"], sectionsCompleted: [...list, list[0]] });
    const many = idsFrom(0, 50_000);
    expect(completedLessonIds(enrolment(many))).toHaveLength(50_001);
    const read = (lists: string[][]) => () => {
      for (const list of lists) completedLessonIds(enrolment(list));
    };
    const { long, ratio } = cpuRatio(read([many]), read(Array.from({ length: 8 }, (_, j) => idsFrom(j * 6_250, 6_250))), 5);
    expect(ratio, `${long.toFixed(1)} ms, ${ratio.toFixed(1)} times`).toBeLessThan(3);
    expect(long, "50,000 ids, in ms of CPU time").toBeLessThan(250);
  }, 60_000);

  it("skips what it can't read", () => {
    expect(completedLessonIds({ stagesCompleted: ["CONTEXT"], sectionsCompleted: [OWN, 5, "context"] })).toEqual([
      "context",
      OWN,
    ]);
  });
});

describe("enrolmentHasProgress", () => {
  it("is false for an enrolment with nothing in it", () => {
    expect(enrolmentHasProgress(ROW)).toBe(false);
    expect(
      enrolmentHasProgress({ ...ROW, reflection: { p1: " ", p2: "" }, assessment: { answers: {}, checked: false } })
    ).toBe(false);
    expect(enrolmentHasProgress({ ...ROW, responses: { v: 1, items: {} }, sectionsCompleted: [] })).toBe(false);
  });

  it.each([
    ["a standard lesson done", { stagesCompleted: ["CONTEXT"] }],
    ["one of the course's own done", { sectionsCompleted: [OWN] }],
    ["a practice answer", { simulationChoice: "a" }],
    ["a scenario path", { scenarioRoot: "c1" }],
    ["a standard reflection", { reflection: { p2: "Something" } }],
    ["a quick-check answer", { assessment: { answers: { q1: "x" }, checked: false } }],
    ["a rating alone", { responses: { v: 1, items: { [`${OWN}/main`]: { type: "rating", values: { s: 2 } } } } }],
    ["a finished course", { completedAt: new Date("2026-11-10T09:00:00.000Z") }],
  ])("is true for %s", (_name, cols) => {
    expect(enrolmentHasProgress({ ...ROW, ...cols })).toBe(true);
  });
});
