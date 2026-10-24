import { describe, it, expect } from "vitest";
import { completedLessonIds, enrolmentHasProgress } from "./enrolment-read";

/*
 * Reading an enrolment the way every counter does (spec 4.5, 6): the
 * lessons finished are the standard ones (stored upper case) and the
 * course's own, and an enrolment has progress when anything at all was
 * saved in it — an own reflection or a rating alone included.
 */

const OWN = "s-abcdefgh";

/**
 * The CPU time this thread has used, in milliseconds. Unlike the wall clock it
 * doesn't count the time the test waits while other work has the processor,
 * so a loaded machine doesn't fail a test of how much work something takes.
 * Node tells a thread's own (threadCpuUsage, from 22.19); where it can't, the
 * process's, which under vitest's pool (forks) is this test file's alone.
 */
function cpuMs(): number {
  const own = (process as NodeJS.Process & { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage;
  const used = own ? own.call(process) : process.cpuUsage();
  return (used.user + used.system) / 1000;
}
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

  it("reads 50,000 ids in well under a second of CPU time: every counter reads every enrolment", () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `s-${String(i).padStart(8, "0")}`);
    const start = cpuMs();
    const ids = completedLessonIds({ stagesCompleted: ["CONTEXT"], sectionsCompleted: [...many, many[0]] });
    // Measured as work done, not time passed: a list searched once per id
    // (out.includes) takes seconds of CPU here, a Set a few milliseconds.
    expect(cpuMs() - start).toBeLessThan(250);
    expect(ids).toHaveLength(50_001);
  });

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
