import { describe, it, expect } from "vitest";
import type { ProgressState } from "./contract";
import { answersOf, completeLesson, withAnswer } from "./answers";

/*
 * U10 (spec 5.4): one map of answers for the players, built from the four
 * standard columns and `responses`, and one way into it. A standard answer
 * lands in its own field, never in `responses` (D56), and an "s-…" lesson
 * never in stagesCompleted, so Release 1's enum cast can't meet one after a
 * rollback.
 */

const OWN = "s-abcdefgh";
const PART = "p-12345678";

const EMPTY: ProgressState = {
  stagesCompleted: [],
  sectionsCompleted: [],
  simulation: null,
  scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
  reflection: { p1: "", p2: "", p3: "" },
  assessment: { answers: {}, checked: false },
  responses: {},
  completedAt: null,
};
/** Like the store's CourseProgress: more fields than ProgressState. */
const STORE = { ...EMPTY, courseSlug: "speaking-up", courseTitle: "Speaking up" };

describe("withAnswer: the four standard keys", () => {
  it("puts a practice answer in the simulation field", () => {
    const p = withAnswer(STORE, "simulation/main", { type: "practice", optionId: "a", correct: true });
    expect(p.simulation).toEqual({ choice: "a", correct: true });
    expect(p.responses).toEqual({});
    expect(p.courseSlug).toBe("speaking-up");
  });

  it("puts a scenario in the scenario field, with the choices' text for the evidence", () => {
    const root = withAnswer(STORE, "scenario/main", { type: "scenario", rootId: "c1" }, { root: "Ask" });
    expect(root.scenario).toEqual({ root: "c1", followup: null, rootLabel: "Ask", followupLabel: null });
    const followup = withAnswer(
      root,
      "scenario/main",
      { type: "scenario", rootId: "c1", followupId: "f1" },
      { followup: "Again" }
    );
    expect(followup.scenario).toEqual({ root: "c1", followup: "f1", rootLabel: "Ask", followupLabel: "Again" });
  });

  it("clears the follow-up when another first choice is made", () => {
    const p = withAnswer(
      { ...STORE, scenario: { root: "c1", followup: "f1", rootLabel: "Ask", followupLabel: "Again" } },
      "scenario/main",
      { type: "scenario", rootId: "c2" },
      { root: "Wait" }
    );
    expect(p.scenario).toEqual({ root: "c2", followup: null, rootLabel: "Wait", followupLabel: null });
  });

  it("merges the standard reflection's p1–p3 and nothing else", () => {
    const p = withAnswer(
      { ...STORE, reflection: { p1: "One", p2: "", p3: "" } },
      "reflection/main",
      { type: "reflection", text: { p2: "Two", other: "x" } }
    );
    expect(p.reflection).toEqual({ p1: "One", p2: "Two", p3: "" });
  });

  it("puts a quick check in the assessment field", () => {
    const p = withAnswer(STORE, "assessment/main", { type: "quiz", answers: { q1: "x" }, checked: true });
    expect(p.assessment).toEqual({ answers: { q1: "x" }, checked: true });
  });

  it("marks a checked quick check tried again as retaken, as retakeQuiz does", () => {
    const checked = { ...STORE, assessment: { answers: { q1: "x" }, checked: true } };
    const again = withAnswer(checked, "assessment/main", { type: "quiz", answers: {}, checked: false });
    expect(again.assessment).toEqual({ answers: {}, checked: false, retaken: true });
    // The mark stays while the learner answers it again.
    const answered = withAnswer(again, "assessment/main", { type: "quiz", answers: { q1: "y" }, checked: false });
    expect(answered.assessment).toEqual({ answers: { q1: "y" }, checked: false, retaken: true });
  });

  it("ignores an answer of another type under a standard key", () => {
    expect(withAnswer(STORE, "simulation/main", { type: "rating", values: { s: 3 } })).toBe(STORE);
  });
});

describe("withAnswer: every other key", () => {
  it("keeps the answer in responses", () => {
    const p = withAnswer(STORE, `${OWN}/main`, { type: "practice", optionId: "b", correct: false });
    expect(p.responses).toEqual({ [`${OWN}/main`]: { type: "practice", optionId: "b", correct: false } });
    expect(p.simulation).toBeNull();
  });

  it("merges a reflection and a rating question by question", () => {
    let p = withAnswer(STORE, `${OWN}/${PART}`, { type: "reflection", text: { a: "First" } });
    p = withAnswer(p, `${OWN}/${PART}`, { type: "reflection", text: { b: "Second" } });
    p = withAnswer(p, `concept/${PART}`, { type: "rating", values: { s1: 2 } });
    p = withAnswer(p, `concept/${PART}`, { type: "rating", values: { s2: 5 } });
    expect(p.responses).toEqual({
      [`${OWN}/${PART}`]: { type: "reflection", text: { a: "First", b: "Second" } },
      [`concept/${PART}`]: { type: "rating", values: { s1: 2, s2: 5 } },
    });
  });

  it("marks an extra quick check tried again as retaken too", () => {
    const p = withAnswer(STORE, `${OWN}/${PART}`, { type: "quiz", answers: { q: "a" }, checked: true });
    expect(
      withAnswer(p, `${OWN}/${PART}`, { type: "quiz", answers: {}, checked: false }).responses[`${OWN}/${PART}`]
    ).toEqual({ type: "quiz", answers: {}, checked: false, retaken: true });
  });

  it("never changes the progress it was given", () => {
    const before = structuredClone(STORE);
    withAnswer(STORE, `${OWN}/${PART}`, { type: "reflection", text: { a: "x" } });
    withAnswer(STORE, "reflection/main", { type: "reflection", text: { p1: "x" } });
    expect(STORE).toEqual(before);
  });
});

describe("answersOf", () => {
  it("is empty when nothing is answered", () => {
    expect(answersOf(EMPTY)).toEqual({});
  });

  it("gives the standard columns under their …/main keys, beside responses", () => {
    const p: ProgressState = {
      ...EMPTY,
      simulation: { choice: "a", correct: true },
      scenario: { root: "c1", followup: "f1", rootLabel: "Ask", followupLabel: "Again" },
      reflection: { p1: "", p2: "Two", p3: "" },
      assessment: { answers: { q1: "x" }, checked: false, retaken: true },
      responses: {
        [`${OWN}/main`]: { type: "quiz", answers: {}, checked: false, retaken: true },
        [`${OWN}/${PART}`]: { type: "rating", values: { s1: 4 } },
      },
    };
    expect(answersOf(p)).toEqual({
      "simulation/main": { type: "practice", optionId: "a", correct: true },
      "scenario/main": { type: "scenario", rootId: "c1", followupId: "f1" },
      "reflection/main": { type: "reflection", text: { p1: "", p2: "Two", p3: "" } },
      "assessment/main": { type: "quiz", answers: { q1: "x" }, checked: false },
      [`${OWN}/main`]: { type: "quiz", answers: {}, checked: false },
      [`${OWN}/${PART}`]: { type: "rating", values: { s1: 4 } },
    });
  });

  it("gives a checked quick check with no answers left, and a scenario without a follow-up", () => {
    const p: ProgressState = {
      ...EMPTY,
      scenario: { root: "c1", followup: null },
      assessment: { answers: {}, checked: true },
    };
    expect(answersOf(p)).toEqual({
      "scenario/main": { type: "scenario", rootId: "c1" },
      "assessment/main": { type: "quiz", answers: {}, checked: true },
    });
  });

  it("reads back what withAnswer put in", () => {
    const answer = { type: "scenario", rootId: "c1", followupId: "f1" } as const;
    expect(answersOf(withAnswer(EMPTY, "scenario/main", answer))["scenario/main"]).toEqual(answer);
    expect(answersOf(withAnswer(EMPTY, `${OWN}/main`, answer))[`${OWN}/main`]).toEqual(answer);
  });
});

describe("completeLesson", () => {
  it("puts a standard lesson in stagesCompleted and the course's own in sectionsCompleted", () => {
    const p = completeLesson(completeLesson(STORE, "context"), OWN);
    expect(p.stagesCompleted).toEqual(["context"]);
    expect(p.sectionsCompleted).toEqual([OWN]);
  });

  it("never puts an s- id in stagesCompleted", () => {
    expect(completeLesson(STORE, OWN).stagesCompleted).toEqual([]);
  });

  it("changes nothing for a lesson already done, or no lesson at all", () => {
    const done = { ...STORE, stagesCompleted: ["context"], sectionsCompleted: [OWN] };
    expect(completeLesson(done, "context")).toBe(done);
    expect(completeLesson(done, OWN)).toBe(done);
    expect(completeLesson(done, "complete" as never)).toBe(done);
  });
});
