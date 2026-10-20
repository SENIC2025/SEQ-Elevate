import { describe, it, expect } from "vitest";
import { partKey, type PartKey } from "@/lib/cms/sections/contract";
import type { CourseStage } from "@/lib/cms/types";
import { lessonContinue, mainPartOf, needOf, questionsLeft, type LessonAnswers } from "./continue-gate";
import {
  emptyQuizPart,
  practicePart,
  quizPart,
  ratingPart,
  reflectionPart,
  scenarioPart,
  textPart,
} from "./sectioned/test-fixtures";

/**
 * UA1 (spec 5.7): what Continue waits for, per kind of content, for both
 * kinds of lesson. Release 1 only knew "the first part missing"; Release 2
 * names every item, what each one needs, and counts a part tried again as
 * unanswered.
 */

const S = "s-abcd1234" as const;
const key = (id: string) => partKey(S, id as "main") as PartKey;

describe("lessonContinue", () => {
  it("is ready when nothing needs an answer: text, reflection, rating, a question with nothing to answer", () => {
    expect(lessonContinue(S, [textPart, reflectionPart, ratingPart, emptyQuizPart], {})).toEqual({ ready: true });
    expect(lessonContinue(S, [], {})).toEqual({ ready: true });
  });

  it("lists every item still missing, in page order, with what each needs and its name", () => {
    const gate = lessonContinue(S, [textPart, practicePart, scenarioPart, quizPart], {});
    expect(gate).toEqual({
      ready: false,
      missing: [
        { partId: "p-practc01", need: { kind: "choose" }, item: "practice" },
        { partId: "p-scenar01", need: { kind: "scenarioRoot" }, item: "The meeting" },
        { partId: "p-quizaaaa", need: { kind: "quizLeft", left: 2, first: "q1" }, item: "quiz" },
      ],
    });
  });

  it("names an untitled item by the name the caller gives its kind", () => {
    const gate = lessonContinue(S, [practicePart], {}, new Set(), (p) => `<${p.type}>`);
    expect(gate).toEqual({ ready: false, missing: [{ partId: "p-practc01", need: { kind: "choose" }, item: "<practice>" }] });
  });

  it("takes any of a practice question's own options, right or wrong, never another's", () => {
    expect(needOf(practicePart, { type: "practice", optionId: "o2", correct: false })).toBeNull();
    expect(needOf(practicePart, { type: "practice", optionId: "gone" })).toEqual({ kind: "choose" });
    expect(needOf(practicePart, { type: "quiz", answers: {}, checked: false })).toEqual({ kind: "choose" });
  });

  it("asks a scenario for its first choice, then for the follow-up that choice has", () => {
    expect(needOf(scenarioPart, undefined)).toEqual({ kind: "scenarioRoot" });
    expect(needOf(scenarioPart, { type: "scenario", rootId: "nope" })).toEqual({ kind: "scenarioRoot" });
    expect(needOf(scenarioPart, { type: "scenario", rootId: "private" })).toEqual({ kind: "scenarioFollowup" });
    expect(needOf(scenarioPart, { type: "scenario", rootId: "private", followupId: "nope" })).toEqual({
      kind: "scenarioFollowup",
    });
    expect(needOf(scenarioPart, { type: "scenario", rootId: "private", followupId: "boundary" })).toBeNull();
    // A first choice with no follow-ups is enough.
    expect(needOf(scenarioPart, { type: "scenario", rootId: "public" })).toBeNull();
  });

  it("counts a quick check's questions left, then asks for the check", () => {
    expect(needOf(quizPart, undefined)).toEqual({ kind: "quizLeft", left: 2, first: "q1" });
    expect(needOf(quizPart, { type: "quiz", answers: { q1: "b" }, checked: false })).toEqual({
      kind: "quizLeft",
      left: 1,
      first: "q2",
    });
    // An answer that is no option of the question doesn't count.
    expect(needOf(quizPart, { type: "quiz", answers: { q1: "b", q2: "zz" }, checked: true })).toEqual({
      kind: "quizLeft",
      left: 1,
      first: "q2",
    });
    expect(needOf(quizPart, { type: "quiz", answers: { q1: "b", q2: "a" }, checked: false })).toEqual({
      kind: "quizCheck",
    });
    expect(needOf(quizPart, { type: "quiz", answers: { q1: "a", q2: "b" }, checked: true })).toBeNull();
  });

  it("counts a practice question or scenario tried again as unanswered on this visit, its answer kept", () => {
    const answers: LessonAnswers = Object.fromEntries([
      [key("p-practc01"), { type: "practice", optionId: "o1", correct: true }],
      [key("p-scenar01"), { type: "scenario", rootId: "public" }],
    ]);
    expect(lessonContinue(S, [practicePart, scenarioPart], answers)).toEqual({ ready: true });
    const gate = lessonContinue(S, [practicePart, scenarioPart], answers, new Set([key("p-practc01")]));
    expect(gate).toEqual({
      ready: false,
      missing: [{ partId: "p-practc01", need: { kind: "choose" }, item: "practice" }],
    });
    expect(lessonContinue(S, [practicePart, scenarioPart], answers, new Set([key("p-scenar01")]))).toMatchObject({
      ready: false,
      missing: [{ partId: "p-scenar01", need: { kind: "scenarioRoot" } }],
    });
  });

  it("keeps answers of two lessons apart", () => {
    const other: LessonAnswers = Object.fromEntries([
      [partKey("concept", "p-practc01"), { type: "practice", optionId: "o1", correct: true }],
    ]);
    expect(lessonContinue(S, [practicePart], other)).toMatchObject({ ready: false });
    expect(lessonContinue("concept", [practicePart], other)).toEqual({ ready: true });
  });
});

const sim: CourseStage = {
  key: "simulation",
  title: "Guided practice",
  simulation: {
    prompt: "Your colleague is late again.",
    instruction: "Pick what you'd say.",
    options: [
      { id: "a", text: "Say nothing", isBest: false, feedback: "Hmm." },
      { id: "b", text: "Say how you feel", isBest: true, feedback: "Yes." },
    ],
  },
};

describe("questionsLeft: how many questions still need an answer (finding 7)", () => {
  // The "several" hint says "N questions above still need an answer.": it
  // counted items, so a quick check with every question answered but not
  // checked, beside an unanswered practice question, made "2 questions".
  it("counts each question of a quick check, one per practice or scenario step, none for a check", () => {
    const missing = (parts: Parameters<typeof lessonContinue>[1], answers: LessonAnswers = {}) => {
      const gate = lessonContinue(S, parts, answers);
      return gate.ready ? [] : gate.missing;
    };
    expect(questionsLeft(missing([practicePart, quizPart]))).toBe(3);
    expect(
      questionsLeft(
        missing([quizPart, practicePart], {
          [key("p-quizaaaa")]: { type: "quiz" as const, answers: { q1: "b", q2: "a" }, checked: false },
        })
      )
    ).toBe(1);
    expect(questionsLeft(missing([scenarioPart]))).toBe(1);
    expect(
      questionsLeft(
        missing([quizPart], { [key("p-quizaaaa")]: { type: "quiz" as const, answers: { q1: "b", q2: "a" }, checked: false } })
      )
    ).toBe(0);
    expect(questionsLeft([])).toBe(0);
  });
});

describe("mainPartOf: a standard lesson goes through the same rule", () => {
  it("makes guided practice a practice question named by the lesson's title", () => {
    const part = mainPartOf(sim);
    expect(part).toMatchObject({ id: "main", type: "practice", title: "Guided practice" });
    expect(lessonContinue("simulation", [part], {})).toEqual({
      ready: false,
      missing: [{ partId: "main", need: { kind: "choose" }, item: "Guided practice" }],
    });
    expect(
      lessonContinue("simulation", [part], { "simulation/main": { type: "practice", optionId: "a", correct: false } })
    ).toEqual({ ready: true });
  });

  it("makes the applied scenario a scenario, and the quick check a quick check", () => {
    const scenario = mainPartOf({ key: "scenario", title: "Applied", scenario: scenarioPart.scenario });
    expect(scenario).toMatchObject({ type: "scenario", title: "Applied" });
    expect(needOf(scenario, { type: "scenario", rootId: "private" })).toEqual({ kind: "scenarioFollowup" });
    const quiz = mainPartOf({ key: "assessment", title: "Quick check", assessment: quizPart.assessment });
    expect(quiz).toMatchObject({ type: "quiz", title: "Quick check" });
    expect(needOf(quiz, { type: "quiz", answers: { q1: "a", q2: "a" }, checked: false })).toEqual({ kind: "quizCheck" });
  });

  it("never holds up a text or reflection lesson", () => {
    const reflection = mainPartOf({
      key: "reflection",
      title: "Look back",
      reflection: { intro: "", prompts: [{ label: "One", placeholder: "" }, { label: "Two", placeholder: "" }] },
    });
    expect(reflection).toMatchObject({ type: "reflection", prompts: [{ id: "p1" }, { id: "p2" }] });
    const text = mainPartOf({ key: "context", title: "Context", blocks: [] });
    expect(text.type).toBe("text");
    for (const part of [reflection, text]) expect(lessonContinue("context", [part], {})).toEqual({ ready: true });
  });

  it("treats a stage whose exercise is missing as text, which never blocks", () => {
    expect(mainPartOf({ key: "simulation", title: "Empty" }).type).toBe("text");
  });
});
