import { describe, it, expect } from "vitest";
import { RESPONSE_LIMITS, type ProgressPatch } from "./contract";
import {
  EMPTY_ENROLLMENT,
  completionTime,
  finishesCourse,
  mergeIntoEnrollment,
  type CompletionRule,
  type EnrollmentProgress,
} from "./merge-server";
import { parseProgressPatch } from "./parse";

/*
 * U3 (spec 4.2): how a patch lands in an enrolment. Nothing the learner
 * did is ever lost or overwritten by a stale tab: finished lessons and the
 * completion only grow, reflection and rating answers merge question by
 * question, each answer stays in its one home, and a patch applied twice
 * is the same as once — the time of each change included.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const LATER = new Date("2026-11-10T10:00:00.000Z");
const OWN = "s-abcdefgh";
const OWN2 = "s-00000002";
const PART = "p-12345678";

function patch(p: Omit<ProgressPatch, "v">, now = NOW) {
  const r = parseProgressPatch({ v: 2, ...p }, now);
  if (!r.ok) throw new Error(r.error);
  return r.patch;
}
const row = (cols: Partial<EnrollmentProgress> = {}): EnrollmentProgress => ({ ...EMPTY_ENROLLMENT, ...cols });
/** When the enrolments here started, unless a test says otherwise: before every time they use. */
const STARTED = new Date("2026-11-01T00:00:00.000Z");
/** A course of one lesson, "context", as most tests here need it: the completion tests (D118) say otherwise. */
const ONE_LESSON: CompletionRule = { lessons: ["context"], startedAt: STARTED };
const merge = (
  r: EnrollmentProgress | null,
  p: Omit<ProgressPatch, "v">,
  now = NOW,
  completion: CompletionRule | null = ONE_LESSON
) => mergeIntoEnrollment(r, patch(p, now), now, completion);
const items = (v: unknown) => (v as { items: Record<string, unknown> }).items;

describe("mergeIntoEnrollment: finished lessons", () => {
  it("adds standard lessons upper case and the course's own to their own list, after what is stored", () => {
    const m = merge(row({ stagesCompleted: ["CONTEXT"], sectionsCompleted: [OWN] }), {
      completed: ["concept", OWN2, "context", OWN],
    });
    expect(m.next.stagesCompleted).toEqual(["CONTEXT", "CONCEPT"]);
    expect(m.next.sectionsCompleted).toEqual([OWN, OWN2]);
    expect(m.changed.sort()).toEqual(["sectionsCompleted", "stagesCompleted"]);
  });

  it("never shrinks either list", () => {
    const stored = row({ stagesCompleted: ["CONTEXT", "SIMULATION"], sectionsCompleted: [OWN] });
    const m = merge(stored, { completed: ["concept"] });
    expect(m.next.stagesCompleted).toEqual(["CONTEXT", "SIMULATION", "CONCEPT"]);
    expect(m.next.sectionsCompleted).toEqual([OWN]);
  });

  it("keeps entries of the stored list it can't read", () => {
    const m = merge(row({ sectionsCompleted: [OWN, 42, "junk"] }), { completed: [OWN2] });
    expect(m.next.sectionsCompleted).toEqual([OWN, 42, "junk", OWN2]);
  });

  it("own lessons past a row limit are refused per id (row-full)", () => {
    // Any "s-" id passes a patch's checks, so the list is bounded per row,
    // as the stored answers are.
    const stored = Array.from({ length: RESPONSE_LIMITS.ownLessonsPerRow - 1 }, (_, i) => `s-${String(i).padStart(8, "0")}`);
    const m = merge(row({ sectionsCompleted: stored }), { completed: [OWN, "context", stored[0], "s-zzzzzzzz"] });
    expect(m.next.sectionsCompleted).toEqual([...stored, OWN]);
    expect(m.next.stagesCompleted).toEqual(["CONTEXT"]);
    expect(m.refused).toEqual([{ key: "s-zzzzzzzz", reason: "row-full" }]);
    // One already there is never refused.
    expect(merge(row({ sectionsCompleted: [...stored, OWN] }), { completed: [OWN] }).refused).toEqual([]);
  });

  it("refuses the course's own lessons, keeping the column, when the column isn't a list", () => {
    const m = merge(row({ sectionsCompleted: { broken: true } }), { completed: [OWN, "context"] });
    expect(m.next.sectionsCompleted).toEqual({ broken: true });
    expect(m.next.stagesCompleted).toEqual(["CONTEXT"]);
    expect(m.refused).toEqual([{ key: OWN, reason: "invalid" }]);
  });
});

describe("mergeIntoEnrollment: completedAt", () => {
  it("is set once, from the patch, and the course counts as finished now", () => {
    const m = merge(row({ stagesCompleted: ["CONTEXT"] }), { completedAt: "2026-11-10T08:59:00.000Z" });
    expect(m.next.completedAt?.toISOString()).toBe("2026-11-10T08:59:00.000Z");
    expect(m.completedNow).toBe(true);
    expect(m.changed).toEqual(["completedAt"]);
  });

  it("is never cleared, and the first one saved is kept", () => {
    const first = new Date("2026-11-01T00:00:00.000Z");
    expect(merge(row({ completedAt: first }), {}).next.completedAt).toBe(first);
    const again = merge(row({ completedAt: first }), { completedAt: "2026-11-10T08:00:00.000Z" });
    expect(again.next.completedAt).toBe(first);
    expect(again.completedNow).toBe(false);
    expect(again.changed).toEqual([]);
  });
});

/*
 * D118: a course's completion and its date follow from what the learner
 * did. The patch's completion is taken only once every lesson the
 * learner's player gives the course is finished, the patch's own lessons
 * included, and its time is held between the enrolment's start and now.
 * The rest of the patch is taken either way.
 */
describe("mergeIntoEnrollment: completing a course (D118)", () => {
  const PLAN: CompletionRule = { lessons: ["context", "concept", OWN], startedAt: STARTED };

  it("completes only once every lesson of the course is finished, stored ones and the patch's alike", () => {
    const stored = row({ stagesCompleted: ["CONTEXT"] });
    const early = merge(stored, { completed: ["concept"], completedAt: "2026-11-10T08:00:00.000Z" }, NOW, PLAN);
    expect(early.next.completedAt).toBeNull();
    expect(early.completedNow).toBe(false);
    expect(early.changed).toEqual(["stagesCompleted"]);
    expect(early.next.stagesCompleted).toEqual(["CONTEXT", "CONCEPT"]);
    const done = merge(early.next, { completed: [OWN], completedAt: "2026-11-10T08:00:00.000Z" }, NOW, PLAN);
    expect(done.next.completedAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect(done.completedNow).toBe(true);
    expect(done.changed.sort()).toEqual(["completedAt", "sectionsCompleted"]);
  });

  it("a patch with no finished lesson completes nothing, back-dated or not, and the rest of it is kept", () => {
    const m = merge(
      null,
      { completed: [], answers: { "reflection/main": { type: "reflection", text: { p1: "Mine" } } }, completedAt: "2020-01-01T00:00:00Z" },
      NOW,
      { lessons: ["context"], startedAt: NOW }
    );
    expect(m.next.completedAt).toBeNull();
    expect(m.completedNow).toBe(false);
    expect(m.changed).toEqual(["reflection"]);
    // With nothing else in it, nothing changes at all: no enrolment is made for it.
    const bare = merge(null, { completed: [], answers: {}, completedAt: "2020-01-01T00:00:00Z" }, NOW, { lessons: ["context"], startedAt: NOW });
    expect(bare.changed).toEqual([]);
    expect(bare.completedNow).toBe(false);
  });

  it("finished lessons the course doesn't have don't stand in for one it has", () => {
    const m = merge(row(), { completed: ["context", "behaviour", "s-00000009"], completedAt: "2026-11-10T08:00:00.000Z" }, NOW, PLAN);
    expect(m.next.completedAt).toBeNull();
  });

  it("a course with no lessons is never completed by a save", () => {
    const m = merge(row({ stagesCompleted: ["CONTEXT"] }), { completed: ["concept"], completedAt: "2026-11-10T08:00:00.000Z" }, NOW, {
      lessons: [],
      startedAt: STARTED,
    });
    expect(m.next.completedAt).toBeNull();
    expect(m.completedNow).toBe(false);
  });

  it("without the course's lessons (null), a patch completes nothing", () => {
    const m = merge(row({ stagesCompleted: ["CONTEXT"] }), { completedAt: "2026-11-10T08:00:00.000Z" }, NOW, null);
    expect(m.next.completedAt).toBeNull();
    expect(m.changed).toEqual([]);
  });

  it("a guest's course moving into an account completes it by the same rule", () => {
    const guest = { fill: true as const, completed: ["context", "concept"], completedAt: "2026-11-10T08:00:00.000Z" };
    expect(merge(null, guest, NOW, PLAN).completedNow).toBe(false);
    expect(merge(null, { ...guest, completed: ["context", "concept", OWN] }, NOW, PLAN).completedNow).toBe(true);
  });

  it("is dated no earlier than the enrolment's start: a time before it is the start", () => {
    const started = new Date("2026-11-05T12:00:00.000Z");
    const m = merge(row({ stagesCompleted: ["CONTEXT"] }), { completedAt: "2020-01-01T00:00:00Z" }, NOW, {
      lessons: ["context"],
      startedAt: started,
    });
    expect(m.next.completedAt).toEqual(started);
  });

  it("a completion that makes the enrolment is dated now, the time a new enrolment starts", () => {
    const m = merge(null, { completed: ["context"], completedAt: "2026-10-01T00:00:00Z" }, NOW, { lessons: ["context"], startedAt: NOW });
    expect(m.next.completedAt).toEqual(NOW);
  });

  it("is dated no later than now", () => {
    // parse.ts already takes a time ahead as now; the merge holds it too.
    const ahead = {
      completed: ["context" as const],
      answers: [],
      completedAt: new Date(NOW.getTime() + 60_000),
      fill: false,
      refused: [],
    };
    expect(mergeIntoEnrollment(null, ahead, NOW, ONE_LESSON).next.completedAt).toEqual(NOW);
  });
});

describe("finishesCourse and completionTime", () => {
  it("finishesCourse reads both lists, standard lessons in either case, and needs at least one lesson", () => {
    const r = { stagesCompleted: ["CONTEXT"], sectionsCompleted: [OWN, 42] };
    expect(finishesCourse(r, ["context", OWN])).toBe(true);
    expect(finishesCourse(r, ["context", OWN, "concept"])).toBe(false);
    expect(finishesCourse(r, [])).toBe(false);
    expect(finishesCourse({ stagesCompleted: [], sectionsCompleted: { broken: true } }, [OWN])).toBe(false);
  });

  it("completionTime keeps a time between the start and now, and holds one outside to the nearer end", () => {
    const start = new Date("2026-11-05T00:00:00.000Z");
    expect(completionTime(new Date("2026-11-06T00:00:00.000Z"), start, NOW)).toEqual(new Date("2026-11-06T00:00:00.000Z"));
    expect(completionTime(new Date("2020-01-01T00:00:00.000Z"), start, NOW)).toEqual(start);
    expect(completionTime(LATER, start, NOW)).toEqual(NOW);
    // The database's clock a moment ahead of the server's: never before the start.
    const ahead = new Date(NOW.getTime() + 50);
    expect(completionTime(NOW, ahead, NOW)).toEqual(ahead);
  });
});

describe("mergeIntoEnrollment: the four standard answers keep their columns", () => {
  it("never writes them into responses", () => {
    const m = merge(row(), {
      answers: {
        "simulation/main": { type: "practice", optionId: "a", correct: true },
        "scenario/main": { type: "scenario", rootId: "c1", followupId: "f1" },
        "reflection/main": { type: "reflection", text: { p1: "One" } },
        "assessment/main": { type: "quiz", answers: { q1: "x" }, checked: true },
      },
    });
    expect(m.next).toMatchObject({
      simulationChoice: "a",
      simulationCorrect: true,
      scenarioRoot: "c1",
      scenarioFollowup: "f1",
      reflection: { p1: "One" },
      assessment: { answers: { q1: "x" }, checked: true },
      responses: null,
      sectionsCompleted: null,
    });
    expect(m.changed.sort()).toEqual(
      ["assessment", "reflection", "scenarioFollowup", "scenarioRoot", "simulationChoice", "simulationCorrect"].sort()
    );
  });

  it("replaces the practice and the scenario whole: a new root clears the follow-up", () => {
    const stored = row({ simulationChoice: "a", simulationCorrect: true, scenarioRoot: "c1", scenarioFollowup: "f1" });
    const m = merge(stored, {
      answers: {
        "simulation/main": { type: "practice", optionId: "b", correct: false },
        "scenario/main": { type: "scenario", rootId: "c2" },
      },
    });
    expect(m.next).toMatchObject({ simulationChoice: "b", simulationCorrect: false, scenarioRoot: "c2", scenarioFollowup: null });
  });

  it("merges the standard reflection question by question, keeping what else the column holds", () => {
    const stored = row({ reflection: { p1: "Mine", p2: "Old", note: "kept" } });
    const m = merge(stored, { answers: { "reflection/main": { type: "reflection", text: { p2: "New" } } } });
    expect(m.next.reflection).toEqual({ p1: "Mine", p2: "New", note: "kept" });
  });

  it("replaces the quick check whole: the latest check counts (D49)", () => {
    const stored = row({ assessment: { answers: { q1: "x", q2: "y" }, checked: true } });
    const m = merge(stored, { answers: { "assessment/main": { type: "quiz", answers: {}, checked: false } } });
    expect(m.next.assessment).toEqual({ answers: {}, checked: false });
  });
});

describe("mergeIntoEnrollment: every other answer", () => {
  const STAMP = "2026-11-01T00:00:00.000Z";

  it("is stored by key with the server's time of the change", () => {
    const m = merge(row(), { answers: { [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true } } });
    expect(m.next.responses).toEqual({
      v: 1,
      items: { [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true, at: NOW.toISOString() } },
    });
    expect(m.changed).toEqual(["responses"]);
  });

  it("replaces a practice, scenario or quiz whole", () => {
    const stored = row({
      responses: {
        v: 1,
        items: {
          [`${OWN}/main`]: { type: "scenario", rootId: "c1", followupId: "f1", at: STAMP },
          [`concept/${PART}`]: { type: "quiz", answers: { q1: "a", q2: "b" }, checked: true, at: STAMP },
        },
      },
    });
    const m = merge(stored, {
      answers: {
        [`${OWN}/main`]: { type: "scenario", rootId: "c2" },
        [`concept/${PART}`]: { type: "quiz", answers: { q1: "b" }, checked: false },
      },
    });
    expect(items(m.next.responses)).toEqual({
      [`${OWN}/main`]: { type: "scenario", rootId: "c2", at: NOW.toISOString() },
      [`concept/${PART}`]: { type: "quiz", answers: { q1: "b" }, checked: false, at: NOW.toISOString() },
    });
  });

  it("merges a reflection and a rating question by question", () => {
    const stored = row({
      responses: {
        v: 1,
        items: {
          [`${OWN}/${PART}`]: { type: "reflection", text: { a: "First", b: "Second" }, at: STAMP },
          [`${OWN}/p-rating01`]: { type: "rating", values: { s1: 2, s2: 4 }, at: STAMP },
        },
      },
    });
    const m = merge(stored, {
      answers: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { b: "Changed" } },
        [`${OWN}/p-rating01`]: { type: "rating", values: { s3: 5 } },
      },
    });
    expect(items(m.next.responses)).toEqual({
      [`${OWN}/${PART}`]: { type: "reflection", text: { a: "First", b: "Changed" }, at: NOW.toISOString() },
      [`${OWN}/p-rating01`]: { type: "rating", values: { s1: 2, s2: 4, s3: 5 }, at: NOW.toISOString() },
    });
  });

  it("a stored rating with 13 statements keeps all 13 when one changes (and a reflection with 11 prompts keeps all 11)", () => {
    // An editor may swap a statement or a prompt of a live question (D33):
    // a learner who answered all twelve, then the new one, has more stored
    // than one save may carry. What is stored was saved; only new writes
    // are limited.
    const values = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`st${i + 1}`, 3]));
    const text = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 1}`, `Answer ${i + 1}`]));
    const stored = row({
      responses: {
        v: 1,
        items: {
          [`${OWN}/p-rating01`]: { type: "rating", values, at: STAMP },
          [`${OWN}/${PART}`]: { type: "reflection", text, at: STAMP },
        },
      },
    });
    const m = merge(stored, {
      answers: {
        [`${OWN}/p-rating01`]: { type: "rating", values: { st1: 5 } },
        [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Changed" } },
      },
    });
    expect(m.refused).toEqual([]);
    expect(items(m.next.responses)).toEqual({
      [`${OWN}/p-rating01`]: { type: "rating", values: { ...values, st1: 5 }, at: NOW.toISOString() },
      [`${OWN}/${PART}`]: { type: "reflection", text: { ...text, q1: "Changed" }, at: NOW.toISOString() },
    });

    // Moving a guest's answers in fills it question by question too.
    const filled = merge(stored, {
      fill: true,
      answers: { [`${OWN}/p-rating01`]: { type: "rating", values: { st1: 1, st14: 4 } } },
    });
    expect(items(filled.next.responses)[`${OWN}/p-rating01`]).toEqual({
      type: "rating",
      values: { ...values, st14: 4 },
      at: NOW.toISOString(),
    });
  });

  it("changes the time only when the value changes", () => {
    const stored = row({
      responses: { v: 1, items: { [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Same" }, at: STAMP } } },
    });
    const m = merge(stored, { answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Same" } } } });
    expect(items(m.next.responses)[`${OWN}/${PART}`]).toMatchObject({ at: STAMP });
    expect(m.changed).toEqual([]);
  });

  it("keeps stored entries it can't read, and replaces one only with a new answer to it", () => {
    const stored = row({
      responses: { v: 1, items: { "odd/key": { whatever: 1 }, [`${OWN}/main`]: "garbage", [`${OWN}/${PART}`]: 7 } },
    });
    const m = merge(stored, { answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { a: "New" } } } });
    expect(items(m.next.responses)).toEqual({
      "odd/key": { whatever: 1 },
      [`${OWN}/main`]: "garbage",
      [`${OWN}/${PART}`]: { type: "reflection", text: { a: "New" }, at: NOW.toISOString() },
    });
  });

  it("refuses every answer, keeping the column, when the column can't be read", () => {
    const m = merge(row({ responses: "garbage" }), {
      answers: {
        [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true },
        "simulation/main": { type: "practice", optionId: "a", correct: true },
      },
    });
    expect(m.next.responses).toBe("garbage");
    expect(m.next.simulationChoice).toBe("a");
    expect(m.refused).toEqual([{ key: `${OWN}/main`, reason: "invalid" }]);
  });

  it("refuses an answer that would grow the stored answers past the limit, for that key only", () => {
    const filler = "x".repeat(RESPONSE_LIMITS.rowJsonChars - 400);
    const stored = row({
      responses: { v: 1, items: { [`${OWN}/p-big00001`]: { type: "reflection", text: { a: filler }, at: STAMP } } },
    });
    const m = merge(stored, {
      answers: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: "y".repeat(400) } },
        [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true },
        "simulation/main": { type: "practice", optionId: "b", correct: false },
      },
    });
    expect(m.refused).toEqual([{ key: `${OWN}/${PART}`, reason: "row-full" }]);
    expect(Object.keys(items(m.next.responses))).toEqual([`${OWN}/p-big00001`, `${OWN}/main`]);
    expect(m.next.simulationChoice).toBe("b");
    expect(JSON.stringify(m.next.responses).length).toBeLessThanOrEqual(RESPONSE_LIMITS.rowJsonChars);
  });

  it("lets an answer over the limit shrink", () => {
    const filler = "x".repeat(RESPONSE_LIMITS.rowJsonChars);
    const stored = row({
      responses: { v: 1, items: { [`${OWN}/${PART}`]: { type: "rating", values: { s: 1 }, at: STAMP }, [`${OWN}/p-big00001`]: { type: "reflection", text: { a: filler }, at: STAMP } } },
    });
    const m = merge(stored, { answers: { [`${OWN}/p-big00001`]: { type: "reflection", text: { a: "short" } } } });
    expect(m.refused).toEqual([]);
    expect(items(m.next.responses)[`${OWN}/p-big00001`]).toMatchObject({ text: { a: "short" } });
  });
});

describe("mergeIntoEnrollment: fill mode (a guest's progress moving into the account)", () => {
  const STAMP = "2026-11-01T00:00:00.000Z";

  it("leaves alone everything the account already holds, and fills only what it lacks", () => {
    const stored = row({
      stagesCompleted: ["CONTEXT"],
      simulationChoice: "a",
      simulationCorrect: true,
      scenarioRoot: null,
      reflection: { p1: "Account", p2: " " },
      assessment: { answers: { q1: "x" }, checked: false },
      responses: {
        v: 1,
        items: {
          [`${OWN}/main`]: { type: "practice", optionId: "acct", correct: true, at: STAMP },
          [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Account", b: "" }, at: STAMP },
          [`${OWN}/p-rating01`]: { type: "rating", values: { s1: 2 }, at: STAMP },
        },
      },
    });
    const m = merge(stored, {
      fill: true,
      completed: ["concept", "context", OWN],
      answers: {
        "simulation/main": { type: "practice", optionId: "guest", correct: false },
        "scenario/main": { type: "scenario", rootId: "g1" },
        "reflection/main": { type: "reflection", text: { p1: "Guest", p2: "Guest", p3: "Guest" } },
        "assessment/main": { type: "quiz", answers: { q1: "guest" }, checked: true },
        [`${OWN}/main`]: { type: "practice", optionId: "guest", correct: false },
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Guest", b: "Guest" } },
        [`${OWN}/p-rating01`]: { type: "rating", values: { s1: 5, s2: 5 } },
        [`${OWN}/p-new00001`]: { type: "rating", values: { s1: 3 } },
      },
    });
    expect(m.next.stagesCompleted).toEqual(["CONTEXT", "CONCEPT"]);
    expect(m.next.sectionsCompleted).toEqual([OWN]);
    expect(m.next).toMatchObject({
      simulationChoice: "a",
      simulationCorrect: true,
      scenarioRoot: "g1",
      reflection: { p1: "Account", p2: "Guest", p3: "Guest" },
      assessment: { answers: { q1: "x" }, checked: false },
    });
    expect(items(m.next.responses)).toEqual({
      [`${OWN}/main`]: { type: "practice", optionId: "acct", correct: true, at: STAMP },
      [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Account", b: "Guest" }, at: NOW.toISOString() },
      [`${OWN}/p-rating01`]: { type: "rating", values: { s1: 2, s2: 5 }, at: NOW.toISOString() },
      [`${OWN}/p-new00001`]: { type: "rating", values: { s1: 3 }, at: NOW.toISOString() },
    });
    expect(m.refused).toEqual([]);
    // Where the account kept an answer of its own over a different one of the guest's.
    expect(m.kept).toEqual([
      "simulation/main",
      "reflection/main",
      "assessment/main",
      `${OWN}/main`,
      `${OWN}/${PART}`,
      `${OWN}/p-rating01`,
    ]);
  });

  it("leaves an entry of the account's it can't read as it is", () => {
    const stored = row({ responses: { v: 1, items: { [`${OWN}/${PART}`]: "garbage" } } });
    const m = merge(stored, {
      fill: true,
      answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { a: "Guest" } } },
    });
    expect(m.next.responses).toEqual(stored.responses);
    expect(m.changed).toEqual([]);
    expect(m.kept).toEqual([`${OWN}/${PART}`]);
  });

  it("keeps nothing of the account's over the guest's where they are the same, or the guest had none (a second move)", () => {
    const stored = row({
      simulationChoice: "g",
      simulationCorrect: true,
      scenarioRoot: "r",
      scenarioFollowup: "f",
      reflection: { p1: "Guest", p2: "Account" },
      assessment: { answers: { q1: "a" }, checked: true },
      responses: { v: 1, items: { [`${OWN}/${PART}`]: { type: "rating", values: { s1: 2, s2: 4 }, at: STAMP } } },
    });
    const m = merge(stored, {
      fill: true,
      answers: {
        "simulation/main": { type: "practice", optionId: "g", correct: true },
        "scenario/main": { type: "scenario", rootId: "r", followupId: "f" },
        "reflection/main": { type: "reflection", text: { p1: "Guest" } },
        "assessment/main": { type: "quiz", answers: { q1: "a" }, checked: true },
        [`${OWN}/${PART}`]: { type: "rating", values: { s1: 2 } },
      },
    });
    expect(m.changed).toEqual([]);
    expect(m.kept).toEqual([]);
    // Outside fill mode nothing is "kept".
    expect(merge(stored, { answers: { "simulation/main": { type: "practice", optionId: "x", correct: false } } }).kept).toEqual([]);
  });

  it("keeps the account's standard quick check once it has one of its own: tried again (saved empty), or its lesson done (D49: the latest check counts)", () => {
    const guestCheck = { "assessment/main": { type: "quiz" as const, answers: { q1: "old" }, checked: true } };
    // "Try again" pressed in the account and left: saved empty.
    const retaken = merge(row({ assessment: { answers: {}, checked: false } }), { fill: true, answers: guestCheck });
    expect(retaken.next.assessment).toEqual({ answers: {}, checked: false });
    expect(retaken.kept).toEqual(["assessment/main"]);
    // The quick check's lesson done, its column empty.
    const done = merge(row({ stagesCompleted: ["ASSESSMENT"], assessment: {} }), { fill: true, answers: guestCheck });
    expect(done.next.assessment).toEqual({});
    // A quick check of the course's own, tried again, follows the same rule.
    const own = merge(
      row({ responses: { v: 1, items: { [`${OWN}/${PART}`]: { type: "quiz", answers: {}, checked: false, at: STAMP } } } }),
      { fill: true, answers: { [`${OWN}/${PART}`]: { type: "quiz", answers: { q1: "old" }, checked: true } } }
    );
    expect(items(own.next.responses)[`${OWN}/${PART}`]).toMatchObject({ answers: {}, checked: false });
    // Never answered, never saved: the guest's check fills it.
    const none = merge(row({ stagesCompleted: ["CONTEXT"], assessment: {} }), { fill: true, answers: guestCheck });
    expect(none.next.assessment).toEqual({ answers: { q1: "old" }, checked: true });
    expect(none.kept).toEqual([]);
  });

  it("moves everything into an account that has nothing", () => {
    const m = merge(
      null,
      {
        fill: true,
        completed: [OWN],
        answers: { "simulation/main": { type: "practice", optionId: "g", correct: true } },
        completedAt: "2026-11-10T08:00:00.000Z",
      },
      NOW,
      { lessons: [OWN], startedAt: STARTED }
    );
    expect(m.next).toMatchObject({ sectionsCompleted: [OWN], simulationChoice: "g", simulationCorrect: true });
    expect(m.completedNow).toBe(true);
  });
});

describe("mergeIntoEnrollment: as a whole", () => {
  const BIG: Omit<ProgressPatch, "v"> = {
    completed: ["context", OWN],
    answers: {
      "simulation/main": { type: "practice", optionId: "a", correct: true },
      "reflection/main": { type: "reflection", text: { p3: "Three" } },
      [`${OWN}/main`]: { type: "scenario", rootId: "c1", followupId: "f1" },
      [`${OWN}/${PART}`]: { type: "rating", values: { s1: 4 } },
    },
    completedAt: "2026-11-10T08:00:00.000Z",
  };

  it("is idempotent: applying a patch twice gives the row once applied, times included", () => {
    const once = merge(row({ reflection: { p1: "x" } }), BIG);
    const twice = merge(once.next, BIG, LATER);
    expect(twice.next).toEqual(once.next);
    expect(twice.changed).toEqual([]);
    expect(twice.completedNow).toBe(false);
  });

  it("changes no column for a patch that changes nothing", () => {
    const stored = row({ stagesCompleted: ["CONTEXT"], simulationChoice: "a", simulationCorrect: true });
    const m = merge(stored, {
      completed: ["context"],
      answers: { "simulation/main": { type: "practice", optionId: "a", correct: true } },
    });
    expect(m.changed).toEqual([]);
    expect(m.refused).toEqual([]);
  });

  it("merges against an empty enrolment when there is none yet", () => {
    const m = merge(null, { completed: ["context"] });
    expect(m.next).toEqual({ ...EMPTY_ENROLLMENT, stagesCompleted: ["CONTEXT"] });
    expect(m.changed).toEqual(["stagesCompleted"]);
  });

  it("never changes the row it was given", () => {
    const stored = row({ stagesCompleted: ["CONTEXT"], reflection: { p1: "a" }, responses: { v: 1, items: {} } });
    const copy = structuredClone(stored);
    merge(stored, BIG);
    expect(stored).toEqual(copy);
  });

  it("passes on what the patch's checks refused", () => {
    const m = mergeIntoEnrollment(
      row(),
      { completed: [], answers: [], completedAt: null, fill: false, refused: [{ key: "x", reason: "invalid" }] },
      NOW,
      ONE_LESSON
    );
    expect(m.refused).toEqual([{ key: "x", reason: "invalid" }]);
  });
});

describe("mergeIntoEnrollment: the stored answers' length", () => {
  it("is counted exactly as the JSON written, entry by entry", () => {
    // Just under the limit, a new entry that fits exactly is taken; one
    // character more is refused.
    const base = { v: 1, items: { [`${OWN}/p-big00001`]: { type: "reflection", text: { a: "" }, at: NOW.toISOString() } } };
    const entry = (n: number) => ({ type: "reflection" as const, text: { a: "y".repeat(n) } });
    const added = (n: number) =>
      JSON.stringify({ ...base, items: { ...base.items, [`${OWN}/${PART}`]: { ...entry(n), at: NOW.toISOString() } } }).length;
    const room = RESPONSE_LIMITS.rowJsonChars - added(0);
    const fill = "x".repeat(room - 10);
    const stored = row({ responses: { v: 1, items: { [`${OWN}/p-big00001`]: { type: "reflection", text: { a: fill }, at: NOW.toISOString() } } } });
    expect(merge(stored, { answers: { [`${OWN}/${PART}`]: entry(10) } }).refused).toEqual([]);
    expect(merge(stored, { answers: { [`${OWN}/${PART}`]: entry(11) } }).refused).toEqual([
      { key: `${OWN}/${PART}`, reason: "row-full" },
    ]);
    const ok = merge(stored, { answers: { [`${OWN}/${PART}`]: entry(10) } });
    expect(JSON.stringify(ok.next.responses).length).toBe(RESPONSE_LIMITS.rowJsonChars);
  });
});
